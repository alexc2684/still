import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalkingMeditation from "./WalkingMeditation";

const bowl = vi.hoisted(() => ({ playBowl: vi.fn(), unlockBowlAudio: vi.fn() }));
vi.mock("@/lib/bowl", () => bowl);
const fetchMock = vi.fn();
const clearWatch = vi.fn();
let success: PositionCallback;
let failure: PositionErrorCallback;
const response = (body: unknown, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: vi.fn().mockResolvedValue(body) });

describe("WalkingMeditation", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    bowl.playBowl.mockClear();
    bowl.unlockBowlAudio.mockClear();
    clearWatch.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: vi.fn((ok: PositionCallback, bad: PositionErrorCallback) => { success = ok; failure = bad; return 7; }), clearWatch } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks signed-out people to sign in and honors disabled state", async () => {
    const onSignIn = vi.fn(), ui = userEvent.setup();
    const view = render(<WalkingMeditation user={null} onSignIn={onSignIn} />);
    await ui.click(screen.getByRole("button", { name: /Sign in to walk/ }));
    expect(onSignIn).toHaveBeenCalled();
    view.rerender(<WalkingMeditation user={{ id: "u" }} disabled />);
    expect(screen.getByRole("button", { name: /Another practice/ })).toBeDisabled();
  });

  it("starts only after the gesture, tracks GPS, pauses, resumes, and ends cleanly", async () => {
    const ui = userEvent.setup(), onActive = vi.fn();
    fetchMock.mockResolvedValueOnce(response({ session: { id: "walk", startedAt: new Date().toISOString(), plannedSeconds: 600 } })).mockResolvedValueOnce(response({}));
    render(<WalkingMeditation user={{ id: "u" }} onActiveChange={onActive} />);
    await ui.selectOptions(screen.getByLabelText("Duration"), "10");
    await ui.selectOptions(screen.getByLabelText("Interval bell"), "5");
    await ui.click(screen.getByRole("button", { name: /Begin walk/ }));
    expect(screen.getByRole("heading", { name: "Walking meditation" })).toBeInTheDocument();
    expect(screen.queryByText("Let your walk unfold")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting for steady steps")).not.toBeInTheDocument();
    expect(bowl.unlockBowlAudio).toHaveBeenCalled(); expect(bowl.playBowl).toHaveBeenCalledWith(true);
    expect(navigator.geolocation.watchPosition).toHaveBeenCalled();
    success({ coords: { latitude: 40, longitude: -73, accuracy: 5 } as GeolocationCoordinates, timestamp: Date.now() } as GeolocationPosition);
    expect(screen.queryByText(/points|bonus|GPS connected/i)).not.toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: /Pause/ })); expect(clearWatch).toHaveBeenCalledWith(7);
    await ui.click(screen.getByRole("button", { name: "Resume" })); expect(bowl.unlockBowlAudio).toHaveBeenCalledTimes(2);
    await ui.click(screen.getByRole("button", { name: "End walk" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Begin walk/ })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/walk", { method: "DELETE" });
    fetchMock.mockResolvedValueOnce(response({ session: { id: "walk-2", startedAt: new Date().toISOString(), plannedSeconds: 600 } }));
    await ui.click(screen.getByRole("button", { name: /Begin walk/ }));
    expect(JSON.parse(localStorage.getItem("still:walking:u")!).growthSeconds).toBe(0);
  });

  it("reports denied location, stops on hide and account change, and clears malformed recovery", async () => {
    const ui = userEvent.setup(); fetchMock.mockResolvedValueOnce(response({ session: { id: "walk", startedAt: new Date().toISOString(), plannedSeconds: 600 } }));
    const view = render(<WalkingMeditation user={{ id: "a" }} />); await ui.click(screen.getByRole("button", { name: /Begin walk/ }));
    failure({ code: 1 } as GeolocationPositionError); expect(screen.queryByText(/points|location denied/i)).not.toBeInTheDocument();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); fireEvent(document, new Event("visibilitychange")); expect(clearWatch).toHaveBeenCalled();
    view.rerender(<WalkingMeditation user={{ id: "b" }} />); expect(await screen.findByRole("button", { name: /Begin walk/ })).toBeInTheDocument();
    localStorage.setItem("still:walking:c", "{"); view.rerender(<WalkingMeditation user={{ id: "c" }} />); expect(localStorage.getItem("still:walking:c")).toBeNull();
  });

  it("keeps a failed completion pending for an explicit retry without double ringing", async () => {
    const now = Date.now(); localStorage.setItem("still:walking:u", JSON.stringify({ sessionId:"done",deadlineMs:now-1,plannedSeconds:60,intervalSeconds:null,elapsedBeforePause:60,distanceMeters:4,movingSeconds:50,points:12 }));
    fetchMock.mockResolvedValueOnce(response({ error:"offline" },false,500)); render(<WalkingMeditation user={{ id:"u" }} />);
    expect(await screen.findByRole("button",{name:"Retry save"})).toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(1); expect(bowl.playBowl).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({})); await userEvent.click(screen.getByRole("button",{name:"Retry save"}));
    expect(await screen.findByRole("heading", { name: "Practice complete" })).toBeInTheDocument(); expect(screen.getByText("1 minute")).toBeInTheDocument(); expect(screen.queryByText(/points|Unhurried/i)).not.toBeInTheDocument(); expect(bowl.playBowl).toHaveBeenCalledTimes(1); expect(localStorage.getItem("still:walking:u")).toBeNull(); await userEvent.click(screen.getByRole("button",{name:/Finish practice/})); expect(screen.getByRole("button",{name:/Begin walk/})).toBeInTheDocument();
  });

  it("handles unavailable GPS, duration validation, start response failures, and snake-case start time", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    const ui=userEvent.setup(); fetchMock.mockResolvedValueOnce(response({error:"closed"},false,400)); const view=render(<WalkingMeditation user={{id:"u"}}/>);
    await ui.selectOptions(screen.getByLabelText("Duration"),"5"); expect(screen.getByLabelText("Interval bell")).toHaveValue("0"); await ui.click(screen.getByRole("button",{name:/Begin walk/})); expect(await screen.findByRole("alert")).toHaveTextContent("closed");
    fetchMock.mockResolvedValueOnce(response({session:{id:"missing"}})); await ui.click(screen.getByRole("button",{name:/Begin walk/})); expect(await screen.findByRole("alert")).toHaveTextContent("start time");
    fetchMock.mockResolvedValueOnce(response({session:{id:"snake",started_at:new Date().toISOString()}})); await ui.click(screen.getByRole("button",{name:/Begin walk/})); expect(await screen.findByRole("heading", {name:"Walking meditation"})).toBeInTheDocument(); view.unmount();
  });

  it("retries a clock-skew completion once and shows a neutral result without movement", async () => {
    localStorage.setItem("still:walking:u",JSON.stringify({sessionId:"skew",deadlineMs:Date.now()-1,plannedSeconds:60,intervalSeconds:null,elapsedBeforePause:60,distanceMeters:0,movingSeconds:0,points:0}));
    fetchMock.mockResolvedValueOnce(response({},false,422)).mockResolvedValueOnce(response({})); const saved=vi.fn(); render(<WalkingMeditation user={{id:"u"}} onSessionSaved={saved}/>); expect(await screen.findByRole("heading", {name:"Practice complete"},{timeout:3000})).toBeInTheDocument(); expect(saved).toHaveBeenCalled();
  });

  it("reports non-permission location and failed end errors, then resumes tracking", async () => {
    const ui=userEvent.setup(); fetchMock.mockResolvedValueOnce(response({session:{id:"w",startedAt:new Date().toISOString(),plannedSeconds:600}})).mockRejectedValueOnce("offline"); render(<WalkingMeditation user={{id:"u"}}/>); await ui.click(screen.getByRole("button",{name:/Begin walk/})); failure({code:2} as GeolocationPositionError); expect(screen.queryByText(/GPS|points/i)).not.toBeInTheDocument(); await ui.click(screen.getByRole("button",{name:"End walk"})); expect(await screen.findByRole("alert")).toHaveTextContent("Could not end this walk"); expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(2);
  });

  it("restores paused and pending sessions", async () => {
    const base={sessionId:"r",deadlineMs:Date.now()+60_000,plannedSeconds:60,intervalSeconds:null,elapsedBeforePause:0,distanceMeters:0,movingSeconds:0,points:0};
    localStorage.setItem("still:walking:paused",JSON.stringify({...base,intervalSeconds:30,pausedRemainingSeconds:20}));const view=render(<WalkingMeditation user={{id:"paused"}}/>);expect(await screen.findByText("Your walk is paused")).toBeInTheDocument();
    localStorage.setItem("still:walking:pending",JSON.stringify({...base,completionPending:true}));view.rerender(<WalkingMeditation user={{id:"pending"}}/>);expect(await screen.findByRole("button",{name:"Retry save"})).toBeInTheDocument();
  });
  it("preserves recovered growth and keeps the plant frozen while paused", async () => {
    const stored={sessionId:"r",deadlineMs:Date.now()+60_000,plannedSeconds:600,intervalSeconds:null,elapsedBeforePause:300,growthSeconds:60,pausedRemainingSeconds:300};
    localStorage.setItem("still:walking:paused-growth",JSON.stringify(stored));
    render(<WalkingMeditation user={{id:"paused-growth"}}/>);
    const plant=await screen.findByRole("img",{name:/growing/});
    const before=plant.querySelector("g")?.getAttribute("transform");
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,550))});
    expect(plant.querySelector("g")?.getAttribute("transform")).toBe(before);
    expect(JSON.parse(localStorage.getItem("still:walking:paused-growth")!).growthSeconds).toBe(60);
    await userEvent.click(screen.getByRole("button", {name:"Resume"}));
    const base=Date.now(), at=(meters:number,seconds:number)=>success({coords:{latitude:meters/111195,longitude:0,accuracy:1} as GeolocationCoordinates,timestamp:base+seconds*1000} as GeolocationPosition);
    await act(async()=>{at(0,0);at(4,10);at(8,20)});
    await waitFor(()=>expect(JSON.parse(localStorage.getItem("still:walking:paused-growth")!).growthSeconds).toBeGreaterThan(60));
  });
  it("removes a well-formed but invalid recovery record", async () => {
    localStorage.setItem("still:walking:invalid",JSON.stringify({sessionId:""}));render(<WalkingMeditation user={{id:"invalid"}}/>);await waitFor(()=>expect(localStorage.getItem("still:walking:invalid")).toBeNull());
  });

  it("grows from elapsed practice time without relying on GPS movement", async () => {
    const ui=userEvent.setup();fetchMock.mockResolvedValueOnce(response({session:{id:"paced",startedAt:new Date(Date.now()-301_000).toISOString(),plannedSeconds:600}}));render(<WalkingMeditation user={{id:"u"}}/>);await ui.click(screen.getByRole("button",{name:/Begin walk/}));expect(bowl.playBowl).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole("img", {name:/growing/}).querySelector("g")?.getAttribute("transform")).toContain("scale(0.79"));
    failure({code:1} as GeolocationPositionError);
    expect(screen.queryByText(/GPS|points|bonus|km\/h/i)).not.toBeInTheDocument();
  });

  it("finishes rather than resurrecting when pause lands at expiry and handles an HTTP end failure", async () => {
    const ui=userEvent.setup();const now=Date.now();fetchMock.mockResolvedValueOnce(response({session:{id:"expire",startedAt:new Date(now).toISOString(),plannedSeconds:60}})).mockResolvedValueOnce(response({}));render(<WalkingMeditation user={{id:"u"}}/>);await ui.click(screen.getByRole("button",{name:/Begin walk/}));vi.spyOn(Date,"now").mockReturnValue(now+61_000);await ui.click(screen.getByRole("button",{name:/Pause/}));expect(await screen.findByRole("heading", {name:"Practice complete"})).toBeInTheDocument();vi.restoreAllMocks();
    localStorage.setItem("still:walking:v",JSON.stringify({sessionId:"end",deadlineMs:Date.now()+60_000,plannedSeconds:60,intervalSeconds:null,elapsedBeforePause:0,distanceMeters:0,movingSeconds:0,points:0,pausedRemainingSeconds:30}));fetchMock.mockResolvedValueOnce(response({},false,500));render(<WalkingMeditation user={{id:"v"}}/>);await ui.click(await screen.findByRole("button",{name:"End walk"}));expect(await screen.findByRole("alert")).toHaveTextContent("Could not end this walk");
  });
});
