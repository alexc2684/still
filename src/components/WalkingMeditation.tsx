"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { playBowl, unlockBowlAudio } from "@/lib/bowl";
import {
  addWalkSample,
  emptyWalkTrack,
  intervalCueDue,
  slowBonus,
  type WalkTrack,
} from "@/lib/walking";
import { storageGet, storageRemove, storageSet } from "@/lib/practice-storage";
import WalkingPlant from "./WalkingPlant";
import "./walking-meditation.css";
type Session = {
  sessionId: string;
  deadlineMs: number;
  plannedSeconds: number;
  pausedRemainingSeconds?: number;
  intervalSeconds: number | null;
  elapsedBeforePause: number;
  distanceMeters: number;
  movingSeconds: number;
  points: number;
  completionPending?: boolean;
};
type Props = {
  user: { id: string } | null;
  disabled?: boolean;
  onSignIn?: () => void;
  onActiveChange?: (v: boolean) => void;
  onSessionSaved?: () => void;
};
export default function WalkingMeditation({
  user,
  disabled,
  onSignIn,
  onActiveChange,
  onSessionSaved,
}: Props) {
  const key = user ? `still:walking:${user.id}` : null,
    [minutes, setMinutes] = useState(10),
    [intervalMinutes, setIntervalMinutes] = useState(5),
    [session, setSession] = useState<Session | null>(null),
    [remaining, setRemaining] = useState(600),
    [track, setTrack] = useState<WalkTrack>(emptyWalkTrack),
    [gps, setGps] = useState<
      "idle" | "connecting" | "connected" | "unavailable" | "denied"
    >("idle"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [complete, setComplete] = useState(false);
  const watch = useRef<number | null>(null),
    previousElapsed = useRef(0),
    finishing = useRef(false),
    completionBell = useRef(false),
    ending = useRef(false),
    trackRef = useRef(track),
    sessionRef = useRef(session),
    sessionOwnerKey = useRef<string | null>(null),
    accountGeneration = useRef(0),
    watchGeneration = useRef(0);
  trackRef.current = track;
  sessionRef.current = session;
  const persist = useCallback(
    (v: Session | null) =>
      v ? storageSet(key, JSON.stringify(v)) : storageRemove(key),
    [key],
  );
  const stopGps = useCallback(() => {
    watchGeneration.current += 1;
    if (watch.current !== null && navigator.geolocation)
      navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);
  const startGps = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (!navigator.geolocation) {
      setGps("unavailable");
      return;
    }
    stopGps();
    const watchToken = watchGeneration.current;
    setGps("connecting");
    setTrack((v) => ({
      ...v,
      anchor: null,
      candidate: null,
      lastSample: null,
      lastSpeedMps: null,
    }));
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (watchToken !== watchGeneration.current) return;
        setGps("connected");
        setTrack((v) =>
          addWalkSample(v, {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            timestamp: p.timestamp || Date.now(),
          }),
        );
      },
      (e) => {
        if (watchToken === watchGeneration.current)
          setGps(e.code === 1 ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }, [stopGps]);
  const finish = useCallback(
    async (s: Session) => {
      if (finishing.current) return;
      const accountToken = accountGeneration.current;
      finishing.current = true;
      stopGps();
      setBusy(true);
      setError("");
      if (!completionBell.current) {
        completionBell.current = true;
        playBowl(true);
      }
      try {
        let r = await fetch(`/api/sessions/${s.sessionId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elapsedSeconds: s.plannedSeconds }),
        });
        if (r.status === 422) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          r = await fetch(`/api/sessions/${s.sessionId}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ elapsedSeconds: s.plannedSeconds }),
          });
        }
        if (!r.ok)
          throw new Error(
            ((await r.json().catch(() => ({}))) as { error?: string }).error ||
              "Could not save your walk.",
          );
        if (accountToken !== accountGeneration.current) return;
        persist(null);
        setSession(null);
        setRemaining(0);
        setComplete(true);
        onSessionSaved?.();
      } catch (e) {
        if (accountToken !== accountGeneration.current) return;
        const pending = { ...s, completionPending: true };
        persist(pending);
        setSession(pending);
        setError(e instanceof Error ? e.message : "Could not save your walk.");
      } finally {
        finishing.current = false;
        if (accountToken === accountGeneration.current) setBusy(false);
      }
    },
    [onSessionSaved, persist, stopGps],
  );
  useEffect(() => {
    accountGeneration.current += 1;
    stopGps();
    setTrack(emptyWalkTrack());
    setGps("idle");
    setSession(null);
    sessionOwnerKey.current = null;
    setComplete(false);
    setBusy(false);
    setError("");
    previousElapsed.current = 0;
    completionBell.current = false;
    ending.current = false;
    if (!key) {
      return;
    }
    const raw = storageGet(key);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as Session,
        valid =
          typeof s.sessionId === "string" &&
          s.sessionId.length > 0 &&
          Number.isFinite(s.deadlineMs) &&
          Number.isFinite(s.plannedSeconds) &&
          s.plannedSeconds > 0 &&
          s.plannedSeconds <= 7200 &&
          Number.isFinite(s.elapsedBeforePause) &&
          Number.isFinite(s.distanceMeters) &&
          s.distanceMeters >= 0 &&
          Number.isFinite(s.movingSeconds) &&
          s.movingSeconds >= 0 &&
          s.movingSeconds <= s.plannedSeconds &&
          Number.isFinite(s.points) &&
          s.points >= 0 &&
          (s.intervalSeconds === null ||
            (Number.isFinite(s.intervalSeconds) &&
              s.intervalSeconds > 0 &&
              s.intervalSeconds < s.plannedSeconds)) &&
          (s.pausedRemainingSeconds === undefined ||
            (Number.isFinite(s.pausedRemainingSeconds) &&
              s.pausedRemainingSeconds > 0 &&
              s.pausedRemainingSeconds <= s.plannedSeconds));
      if (!valid) {
        storageRemove(key);
        return;
      }
      previousElapsed.current = s.elapsedBeforePause || 0;
      setMinutes(Math.round(s.plannedSeconds / 60));
      setIntervalMinutes(s.intervalSeconds ? s.intervalSeconds / 60 : 0);
      setTrack({
        ...emptyWalkTrack(),
        distanceMeters: s.distanceMeters,
        movingSeconds: s.movingSeconds,
        points: s.points,
      });
      sessionOwnerKey.current = key;
      setSession(s);
      if (s.pausedRemainingSeconds) setRemaining(s.pausedRemainingSeconds);
      else if (s.completionPending) setRemaining(0);
      else if (s.deadlineMs <= Date.now()) void finish(s);
      else startGps();
    } catch {
      storageRemove(key);
    }
    return () => stopGps();
  }, [key, finish, startGps, stopGps]);
  useEffect(() => {
    onActiveChange?.(Boolean(session || complete));
    return () => onActiveChange?.(false);
  }, [session, complete, onActiveChange]);
  useEffect(() => () => stopGps(), [stopGps]);
  useEffect(() => {
    const visibility = () => {
      const current = sessionRef.current;
      if (document.visibilityState !== "visible") stopGps();
      else if (current && !current.pausedRemainingSeconds && !current.completionPending && !ending.current)
        startGps();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [startGps, stopGps]);
  useEffect(() => {
    if (
      !session ||
      sessionOwnerKey.current !== key ||
      session.pausedRemainingSeconds ||
      session.completionPending
    )
      return;
    const tick = () => {
      const next = Math.max(
          0,
          Math.ceil((session.deadlineMs - Date.now()) / 1000),
        ),
        elapsed = session.plannedSeconds - next;
      if (
        intervalCueDue(
          previousElapsed.current,
          elapsed,
          session.intervalSeconds,
          session.plannedSeconds,
        )
      )
        playBowl(true);
      previousElapsed.current = elapsed;
      setRemaining(next);
      persist({
        ...session,
        elapsedBeforePause: elapsed,
        distanceMeters: trackRef.current.distanceMeters,
        movingSeconds: trackRef.current.movingSeconds,
        points: trackRef.current.points,
      });
      if (!next && !ending.current)
        void finish({
          ...session,
          distanceMeters: trackRef.current.distanceMeters,
          movingSeconds: trackRef.current.movingSeconds,
          points: trackRef.current.points,
        });
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [
    session,
    track.distanceMeters,
    track.movingSeconds,
    track.points,
    finish,
    persist,
  ]);
  useEffect(() => {
    if (session && !session.completionPending && sessionOwnerKey.current === key)
      persist({
        ...session,
        elapsedBeforePause: previousElapsed.current,
        distanceMeters: track.distanceMeters,
        movingSeconds: track.movingSeconds,
        points: track.points,
      });
  }, [
    track.distanceMeters,
    track.movingSeconds,
    track.points,
    session,
    persist,
  ]);
  async function begin() {
    if (!user) {
      onSignIn?.();
      return;
    }
    unlockBowlAudio();
    setBusy(true);
    setError("");
    setComplete(false);
    completionBell.current = false;
    const accountToken = accountGeneration.current;
    try {
      const r = await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plannedSeconds: minutes * 60 }),
        }),
        b = (await r.json().catch(() => ({}))) as {
          error?: string;
          session?: {
            id: string;
            startedAt?: string;
            started_at?: string;
            plannedSeconds?: number;
          };
        };
      if (!r.ok || !b.session)
        throw new Error(b.error || "Could not begin your walk.");
      if (accountToken !== accountGeneration.current) return;
      const planned = b.session.plannedSeconds || minutes * 60,
        startedAt = b.session.startedAt || b.session.started_at;
      if (!startedAt)
        throw new Error("The server did not return a start time.");
      const
        s: Session = {
          sessionId: b.session.id,
          deadlineMs: new Date(startedAt).getTime() + planned * 1000,
          plannedSeconds: planned,
          intervalSeconds: intervalMinutes ? intervalMinutes * 60 : null,
          elapsedBeforePause: 0,
          distanceMeters: 0,
          movingSeconds: 0,
          points: 0,
        };
      previousElapsed.current = 0;
      playBowl(true);
      setTrack(emptyWalkTrack());
      setRemaining(planned);
      persist(s);
      sessionOwnerKey.current = key;
      setSession(s);
      startGps();
    } catch (e) {
      if (accountToken !== accountGeneration.current) return;
      setError(e instanceof Error ? e.message : "Could not begin your walk.");
    } finally {
      if (accountToken === accountGeneration.current) setBusy(false);
    }
  }
  function pause() {
    const current = session!;
    const left = Math.ceil((current.deadlineMs - Date.now()) / 1000);
    if (left <= 0) {
      void finish({
        ...current,
        distanceMeters: trackRef.current.distanceMeters,
        movingSeconds: trackRef.current.movingSeconds,
        points: trackRef.current.points,
      });
      return;
    }
    const
      s = {
        ...current,
        pausedRemainingSeconds: left,
        elapsedBeforePause: current.plannedSeconds - left,
        distanceMeters: track.distanceMeters,
        movingSeconds: track.movingSeconds,
        points: track.points,
      };
    stopGps();
    persist(s);
    setSession(s);
    setRemaining(left);
  }
  function resume() {
    const current = session!;
    unlockBowlAudio();
    const s = {
      ...current,
      deadlineMs: Date.now() + current.pausedRemainingSeconds! * 1000,
      pausedRemainingSeconds: undefined,
    };
    previousElapsed.current = s.elapsedBeforePause;
    persist(s);
    setSession(s);
    startGps();
  }
  async function end() {
    const current = session!;
    const accountToken = accountGeneration.current;
    ending.current = true;
    stopGps();
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${current.sessionId}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("Could not end this walk.");
      if (accountToken !== accountGeneration.current) return;
      persist(null);
      setSession(null);
      setTrack(emptyWalkTrack());
      setRemaining(minutes * 60);
      setGps("idle");
    } catch (e) {
      if (accountToken !== accountGeneration.current) return;
      setError(e instanceof Error ? e.message : "Could not end this walk.");
      if (!current.pausedRemainingSeconds) startGps();
    } finally {
      ending.current = false;
      if (accountToken === accountGeneration.current) setBusy(false);
    }
  }
  const format = (s: number) =>
      `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
    averageBonus = track.movingSeconds
      ? (track.points * 6) / track.movingSeconds
      : 0,
    unhurried = averageBonus >= 1.2,
    pace = track.lastSpeedMps
      ? `${(track.lastSpeedMps * 3.6).toFixed(1)} km/h`
      : "Waiting for steady steps";
  if (complete)
    return (
      <section className="walking-view walking-complete">
        <div className="walking-eyebrow">Walking meditation</div>
        <h1>You made room to grow.</h1>
        <WalkingPlant complete />
        <div className="walking-points-total">{Math.round(track.points)}</div>
        <div className="walking-points-label">mindful points</div>
        <p>
          {minutes} minutes · {Math.round(track.distanceMeters)} m
        </p>
        <span className="walking-badge">
          {unhurried ? "⌁ Unhurried" : "Practice complete"}
        </span>
        <p className="walking-note">
          More points for slower confirmed movement.
          <br />
          Standing still pauses points.
        </p>
        <button
          className="primary-button"
          onClick={() => {
            setComplete(false);
            setRemaining(minutes * 60);
            setTrack(emptyWalkTrack());
            setGps("idle");
          }}
        >
          Finish practice <span>→</span>
        </button>
      </section>
    );
  return (
    <section className={`walking-view ${!session ? "walking-setup" : "walking-active"}`}>
      {!session && (
        <>
          <div className="walking-eyebrow">Walking meditation</div>
          <h1>Grow calm, one step at a time.</h1>
          <p className="walking-intro">
            Slow, steady movement helps the plant grow. Your location stays on
            this device and is reduced to distance and points.
          </p>
          <div className="walking-settings">
            <label>
              Duration
              <select
                value={minutes}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMinutes(v);
                  if (intervalMinutes >= v) setIntervalMinutes(0);
                  setRemaining(v * 60);
                }}
              >
                {[5, 10, 15, 20, 30].map((v) => (
                  <option key={v} value={v}>
                    {v} minutes
                  </option>
                ))}
              </select>
            </label>
            <label>
              Interval bell
              <select
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              >
                <option value="0">Off</option>
                {[1, 5, 10, 15]
                  .filter((v) => v < minutes)
                  .map((v) => (
                    <option key={v} value={v}>
                      Every {v} min
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <WalkingPlant progress={0.16} />
          <p className="walking-setup-note">
            Keep Still open during your walk for GPS tracking and interval
            bells. Lock-screen delivery depends on your browser.
          </p>
          <button
            className="primary-button"
            disabled={busy || disabled}
            onClick={() => void begin()}
          >
            {busy
              ? "Starting…"
              : user
                ? disabled
                  ? "Another practice is active"
                  : "Begin walk"
                : "Sign in to walk"}{" "}
            <span>→</span>
          </button>
        </>
      )}
      {session && (
        <>
          <div className="walking-status-row">
            <span className="walking-countdown">
              {format(remaining)} remaining
            </span>
            <span className={`gps-chip ${gps}`}>
              {gps === "connected"
                ? "GPS connected"
                : gps === "connecting"
                  ? "Finding GPS"
                  : gps === "denied"
                    ? "Location denied"
                    : "GPS unavailable"}
            </span>
          </div>
          <h1>
            {session.pausedRemainingSeconds
              ? "Your walk is paused"
              : "Let your walk unfold"}
          </h1>
          <WalkingPlant progress={1 - remaining / session.plannedSeconds} />
          <div className="walking-growth-copy">Your calm is growing</div>
          <div className="walking-score-card">
            <div>
              <strong>{Math.round(track.points)}</strong>
              <span>mindful points</span>
            </div>
            <div>
              <strong>
                {track.lastSpeedMps
                  ? `${slowBonus(track.lastSpeedMps).toFixed(1)}×`
                  : "—"}
              </strong>
              <span>slow bonus</span>
            </div>
            <p>
              {pace}
              {track.lastSpeedMps && slowBonus(track.lastSpeedMps) > 0
                ? " · Gentle pace"
                : ""}
            </p>
            <small>⌁ Slow, steady steps help it grow.</small>
          </div>
          <div className="walking-actions">
            {session.completionPending ? (
              <button className="primary-button" disabled={busy} onClick={() => void finish(session)}>
                Retry save
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={session.pausedRemainingSeconds ? resume : pause}
                disabled={busy}
              >
                {session.pausedRemainingSeconds ? "Resume" : "Ⅱ  Pause"}
              </button>
            )}
            <button
              className="secondary-button"
              onClick={() => void end()}
              disabled={busy}
            >
              End walk
            </button>
          </div>
          {(gps === "denied" || gps === "unavailable") && (
            <p className="walking-location-message">
              No points without a reliable location. You can still use the
              timer.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="practice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
