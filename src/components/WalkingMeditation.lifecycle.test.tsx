import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalkingMeditation from "./WalkingMeditation";

const bowl = vi.hoisted(() => ({ playBowl: vi.fn(), unlockBowlAudio: vi.fn() }));
vi.mock("@/lib/bowl", () => bowl);

const response = (body: unknown, ok = true, status = ok ? 200 : 500) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(body),
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const storedSession = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "walk-a",
  deadlineMs: Date.now() + 600_000,
  plannedSeconds: 600,
  intervalSeconds: 300,
  elapsedBeforePause: 0,
  distanceMeters: 0,
  movingSeconds: 0,
  points: 0,
  ...overrides,
});

describe("WalkingMeditation lifecycle isolation", () => {
  const fetchMock = vi.fn();
  const clearWatch = vi.fn();
  let positionCallbacks: PositionCallback[];
  let positionErrorCallbacks: PositionErrorCallback[];

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    clearWatch.mockReset();
    bowl.playBowl.mockReset();
    bowl.unlockBowlAudio.mockReset();
    positionCallbacks = [];
    positionErrorCallbacks = [];
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
          positionCallbacks.push(success);
          positionErrorCallbacks.push(failure);
          return positionCallbacks.length;
        }),
        clearWatch,
      },
    });
  });

  it("ignores a delayed start response after the account changes", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = render(<WalkingMeditation user={{ id: "a" }} />);

    fireEvent.click(screen.getByRole("button", { name: /Begin walk/ }));
    view.rerender(<WalkingMeditation user={{ id: "b" }} />);
    pending.resolve(response({ session: { id: "walk-a", startedAt: new Date().toISOString(), plannedSeconds: 600 } }));

    await act(async () => { await pending.promise; });
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeInTheDocument();
    expect(localStorage.getItem("still:walking:a")).toBeNull();
    expect(localStorage.getItem("still:walking:b")).toBeNull();
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("ignores a delayed start rejection after the account changes", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Begin walk/ }));
    view.rerender(<WalkingMeditation user={{ id: "b" }} />);

    pending.resolve(response({}, false, 500) as unknown as Response);
    await act(async () => { await pending.promise; });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeEnabled();
  });

  it("uses a safe start error when an invalid response body cannot be decoded", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    });
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Begin walk/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not begin your walk.");
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeEnabled();
  });

  it("uses the safe start message for a non-Error rejection", async () => {
    fetchMock.mockRejectedValueOnce("offline");
    render(<WalkingMeditation user={{ id: "a" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Begin walk/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not begin your walk.");
  });

  it("ignores delayed completion and deletion results from the prior account", async () => {
    const completion = deferred<ReturnType<typeof response>>();
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession({ deadlineMs: Date.now() - 1 })));
    fetchMock.mockReturnValueOnce(completion.promise);
    const completed = vi.fn();
    const view = render(<WalkingMeditation user={{ id: "a" }} onSessionSaved={completed} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/walk-a/complete", expect.anything()));
    view.rerender(<WalkingMeditation user={{ id: "b" }} onSessionSaved={completed} />);
    completion.resolve(response({}));
    await act(async () => { await completion.promise; });
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeInTheDocument();
    expect(screen.queryByText("You made room to grow.")).not.toBeInTheDocument();
    expect(completed).not.toHaveBeenCalled();

    const deletion = deferred<ReturnType<typeof response>>();
    localStorage.setItem("still:walking:c", JSON.stringify(storedSession({ sessionId: "walk-c" })));
    fetchMock.mockReturnValueOnce(deletion.promise);
    view.rerender(<WalkingMeditation user={{ id: "c" }} onSessionSaved={completed} />);
    await screen.findByRole("button", { name: "End walk" });
    fireEvent.click(screen.getByRole("button", { name: "End walk" }));
    view.rerender(<WalkingMeditation user={{ id: "d" }} onSessionSaved={completed} />);
    deletion.resolve(response({}, false, 500));
    await act(async () => { await deletion.promise; });
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeInTheDocument();
    expect(localStorage.getItem("still:walking:c")).not.toBeNull();
  });

  it("drops queued GPS callbacks after account change and logout", async () => {
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession()));
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    await waitFor(() => expect(positionCallbacks).toHaveLength(1));
    const stalePosition = positionCallbacks[0];
    const staleError = positionErrorCallbacks[0];

    view.rerender(<WalkingMeditation user={{ id: "b" }} />);
    act(() => stalePosition({ coords: { latitude: 40, longitude: -73, accuracy: 5 } as GeolocationCoordinates, timestamp: Date.now() } as GeolocationPosition));
    act(() => staleError({ code: 1 } as GeolocationPositionError));
    expect(screen.queryByText("GPS connected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeInTheDocument();

    view.rerender(<WalkingMeditation user={null} />);
    act(() => stalePosition({ coords: { latitude: 41, longitude: -74, accuracy: 5 } as GeolocationCoordinates, timestamp: Date.now() + 1000 } as GeolocationPosition));
    expect(screen.getByRole("button", { name: /Sign in to walk/ })).toBeInTheDocument();
    expect(clearWatch).toHaveBeenCalled();
  });

  it("uses receipt time when a live GPS position has no timestamp", async () => {
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession()));
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    await waitFor(() => expect(positionCallbacks).toHaveLength(1));
    act(() => positionCallbacks[0]({
      coords: { latitude: 40, longitude: -73, accuracy: 5 } as GeolocationCoordinates,
      timestamp: 0,
    } as GeolocationPosition));
    await waitFor(() => expect(view.container.querySelector(".gps-chip.connected")).not.toBeNull());
  });

  it("ignores a delayed completion failure after the account changes", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession({ deadlineMs: Date.now() - 1 })));
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    view.rerender(<WalkingMeditation user={{ id: "b" }} />);

    pending.resolve(response({ error: "offline" }, false, 500));
    await act(async () => { await pending.promise; });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(localStorage.getItem("still:walking:b")).toBeNull();
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeEnabled();
  });

  it("uses a safe completion error when an error response cannot be decoded", async () => {
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession({ deadlineMs: Date.now() - 1 })));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    });
    render(<WalkingMeditation user={{ id: "a" }} />);
    expect(await screen.findByRole("button", { name: "Retry save" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save your walk.");
  });

  it("uses the safe completion message for a non-Error rejection", async () => {
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession({ deadlineMs: Date.now() - 1 })));
    fetchMock.mockRejectedValueOnce("offline");
    render(<WalkingMeditation user={{ id: "a" }} />);
    expect(await screen.findByRole("button", { name: "Retry save" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save your walk.");
  });

  it("restores a completion-pending session without restarting GPS", async () => {
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession({ completionPending: true })));
    render(<WalkingMeditation user={{ id: "a" }} />);
    expect(await screen.findByRole("button", { name: "Retry save" })).toBeInTheDocument();
    expect(screen.getByText("00:00 remaining")).toBeInTheDocument();
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    fireEvent(document, new Event("visibilitychange"));
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("ignores a successful deletion that resolves after account change", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession()));
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    await screen.findByRole("button", { name: "End walk" });
    fireEvent.click(screen.getByRole("button", { name: "End walk" }));
    view.rerender(<WalkingMeditation user={{ id: "b" }} />);
    pending.resolve(response({}));
    await act(async () => { await pending.promise; });
    expect(localStorage.getItem("still:walking:a")).not.toBeNull();
    expect(localStorage.getItem("still:walking:b")).toBeNull();
    expect(screen.getByRole("button", { name: /Begin walk/ })).toBeEnabled();
  });

  it("does not start GPS while recovering hidden and resumes only when visible", async () => {
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession()));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    render(<WalkingMeditation user={{ id: "a" }} />);
    expect(await screen.findByRole("button", { name: /Pause/ })).toBeInTheDocument();
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("persists an interval boundary through a GPS update and remount", async () => {
    const now = Date.now();
    localStorage.setItem("still:walking:a", JSON.stringify(storedSession({ deadlineMs: now + 299_000, elapsedBeforePause: 299 })));
    const view = render(<WalkingMeditation user={{ id: "a" }} />);
    await waitFor(() => expect(bowl.playBowl).toHaveBeenCalledTimes(1));
    expect(positionCallbacks).toHaveLength(1);
    act(() => positionCallbacks[0]({ coords: { latitude: 40, longitude: -73, accuracy: 5 } as GeolocationCoordinates, timestamp: now } as GeolocationPosition));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("still:walking:a")!).elapsedBeforePause).toBeGreaterThanOrEqual(300));

    view.unmount();
    render(<WalkingMeditation user={{ id: "a" }} />);
    await waitFor(() => expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(2));
    expect(bowl.playBowl).toHaveBeenCalledTimes(1);
  });
});
