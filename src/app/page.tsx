"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Journal from "@/components/Journal";
import Profile from "@/components/Profile";
import PracticeTimer from "@/components/PracticeTimer";
import CircleView from "@/components/Circle";
import AuthModal from "@/components/AuthModal";
import Avatar from "@/components/Avatar";
import SharedSit from "@/components/SharedSit";
import { readOfflineAccount, rememberOfflineAccount, forgetOfflineAccount, syncOfflineJobs } from "@/lib/offline-practice";
type Tab = "practice" | "circle" | "journal" | "profile";
type User = {
  id: string;
  name: string;
  email: string;
  timezone: string;
  weeklyTarget?: number;
  avatarKey?: string | null;
};
const dateKey = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
export default function Home() {
  const [tab, setTab] = useState<Tab>("practice"),
    [auth, setAuth] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [dates, setDates] = useState<string[]>([]),
    [mode, setMode] = useState<"solo" | "together">("solo"),
    [inviteToken, setInviteToken] = useState<string>(),
    [sitActive, setSitActive] = useState(false),
    [sharedActive, setSharedActive] = useState(false),
    soloActive = sitActive;
  const [offline, setOffline] = useState(false);
  const [syncError, setSyncError] = useState('');
  const refresh = useCallback(async () => {
    try {
      if (!navigator.onLine) throw new Error('offline');
      const m = await fetch('/api/auth/me');
      if (!m.ok) {
        forgetOfflineAccount();
        setUser(null);
        setDates([]);
        return;
      }
      const b = await m.json();
      setUser(b.user);
      const h = await fetch('/api/sessions');
      if (h.ok) {
        const x = await h.json();
        const next = [...new Set((x.practiceDates ?? []) as string[])];
        setDates(next);
        if (b.user) rememberOfflineAccount(b.user, next);
      }
      setOffline(false);
    } catch {
      const cached = readOfflineAccount();
      if (cached) {
        setUser(cached.user);
        setDates(cached.dates);
      }
      setOffline(true);
      setMode('solo');
    }
  }, []);
  useEffect(() => {
    const reconnect = () => { setOffline(false); void refresh(); };
    const disconnect = () => { setOffline(true); setMode('solo'); };
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', disconnect);
    return () => {
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', disconnect);
    };
  }, [refresh]);
  useEffect(() => {
    if (!user || offline) return;
    let cancelled = false;
    const sync = () => {
      void syncOfflineJobs(user.id).then(changed => {
        if (!cancelled) {
          setSyncError('');
          if (changed) void refresh();
        }
      }).catch(error => {
        if (!cancelled) setSyncError(error.message);
      });
    };
    sync();
    window.addEventListener('still:outbox', sync);
    const timer = window.setInterval(sync, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('still:outbox', sync);
    };
  }, [user, offline, refresh]);
  useEffect(() => {
    void refresh();
    const token =
      new URLSearchParams(window.location.search).get("sit") ?? undefined;
    setInviteToken(token);
    if (token) setMode("together");
  }, [refresh]);
  const tz = user?.timezone ?? "UTC",
    today = dateKey(new Date(), tz),
    streak = useMemo(() => {
      let c = today,
        n = 0;
      if (!dates.includes(c)) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        c = d.toISOString().slice(0, 10);
      }
      while (dates.includes(c)) {
        n++;
        const d = new Date(`${c}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        c = d.toISOString().slice(0, 10);
      }
      return n;
    }, [dates, today]);
  return (
    <main className={`app-shell ${tab === "practice" ? "practice-screen" : ""} ${tab === "practice" && mode === "solo" ? "sit-screen" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setTab("practice")}>
          <span className="brand-mark" />
          Still
        </button>
        <div className="topbar-actions">
          {user && tab !== "practice" && <span className="streak-pill">✦ {streak} day streak</span>}
          <button className="avatar" disabled={offline} onClick={() => setTab("profile")}>
            {user ? (
              <Avatar
                name={user.name}
                avatarKey={user.avatarKey}
                size="medium"
              />
            ) : (
              "·"
            )}
          </button>
        </div>
      </header>
      <div className="page-wrap">
        {offline&&<p role="status" className="offline-notice">Offline · Solo practice and reflections save on this device. Together, Circle, and account changes need a connection. <button className="text-button" onClick={()=>void refresh()}>Retry connection</button></p>}
        {syncError&&<p role="status">{syncError}</p>}
        {tab === "practice" && !soloActive && (
          <div className="practice-mode">
            <button
              className={mode === "solo" ? "selected" : ""}
              aria-pressed={mode === "solo"}
              onClick={() => setMode("solo")}
            >
              Solo
            </button>
            <button
              className={mode === "together" ? "selected" : ""}
              aria-pressed={mode === "together"}
              disabled={offline} onClick={() => setMode("together")}
            >
              Together
            </button>
          </div>
        )}
        <div hidden={offline || tab !== "practice" || mode !== "together"}>
          <SharedSit
            user={offline ? null : user}
            initialToken={inviteToken}
            disabled={soloActive}
            onActiveChange={setSharedActive}
            onSignIn={() => setAuth(true)}
            onSessionSaved={refresh}
          />
        </div>
        <div hidden={tab !== "practice" || mode !== "solo"}>
          <PracticeTimer
            offline={offline}
            user={user}
            disabled={sharedActive}
            onActiveChange={setSitActive}
            onSignIn={() => setAuth(true)}
            onSessionSaved={refresh}
          />
        </div>
        {tab === "circle" && !offline && (
          <CircleView
            signedIn={!!user}
            userId={user?.id}
            onSignIn={() => setAuth(true)}
          />
        )}{" "}
        {tab === "journal" && (
          <Journal
            userId={user?.id} offline={offline} accountTimezone={user?.timezone}
            signedIn={!!user}
            onSignIn={() => setAuth(true)}
            refreshKey={dates.length}
            onChanged={refresh}
          />
        )}{" "}
        {tab === "profile" && !offline && (
          <Profile
            signedIn={!!user}
            onSignIn={() => setAuth(true)}
            onSignOut={() => {
              forgetOfflineAccount();
              setUser(null);
              setDates([]);
            }}
            onProfileUpdated={(u) => setUser(u)}
          />
        )}
      </div>
      <nav className="bottom-nav">
        {(
          [
            ["practice", "◌", "Practice"],
            ["circle", "◒", "Circle"],
            ["journal", "▤", "Journal"],
            ["profile", "○", "Profile"],
          ] as const
        ).map(([id, i, l]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            disabled={offline && (id === "circle" || id === "profile")} onClick={() => setTab(id)}
          >
            <span className="nav-icon">{i}</span>
            {l}
          </button>
        ))}
      </nav>
      {auth && (
        <AuthModal
          onClose={() => setAuth(false)}
          onSuccess={(u) => {
            setUser(u);
            setAuth(false);
            void refresh();
          }}
        />
      )}
    </main>
  );
}
