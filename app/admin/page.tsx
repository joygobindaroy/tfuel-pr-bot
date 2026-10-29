"use client";

import "./admin.css";
import Script from "next/script";
import { useCallback, useEffect, useState } from "react";
import Bots from "./sections/Bots";
import Broadcast from "./sections/Broadcast";
import Network from "./sections/Network";
import System from "./sections/System";
import Dashboard from "./sections/Dashboard";
import Disputes from "./sections/Disputes";
import Promos from "./sections/Promos";
import Settings from "./sections/Settings";
import Tasks from "./sections/Tasks";
import Team from "./sections/Team";
import Tickets from "./sections/Tickets";
import Users from "./sections/Users";
import { can, Icon, q, ToastProvider } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Telegram?: { WebApp: any } } }

const NAV: { id: string; label: string; icon: string; perm: string | null; sub: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", perm: null, sub: "How the bot is doing right now" },
  { id: "users", label: "Users", icon: "users", perm: "users.view", sub: "Find people, ban, adjust balances" },
  { id: "tasks", label: "Tasks", icon: "tasks", perm: "tasks", sub: "Promotions people are running" },
  { id: "disputes", label: "Disputes", icon: "disputes", perm: "tasks", sub: "Rejected proofs a worker disagrees with" },
  { id: "tickets", label: "Tickets", icon: "tickets", perm: "tickets", sub: "Support requests waiting for a reply" },
  { id: "promos", label: "Promo codes", icon: "promo", perm: "promo", sub: "Create and retire codes" },
  { id: "broadcast", label: "Broadcast", icon: "broadcast", perm: "broadcast", sub: "Message a segment of users" },
  { id: "network", label: "Network", icon: "network", perm: "network", sub: "Chats where the bot is admin, and sponsored posts" },
  { id: "bots", label: "Bots", icon: "bots", perm: "bots", sub: "Primary and mirror bots, webhooks" },
  { id: "system", label: "System", icon: "system", perm: "system", sub: "Scheduler health and error log" },
  { id: "settings", label: "Settings", icon: "settings", perm: "config", sub: "Rewards, prices, fees, limits and maintenance" },
  { id: "team", label: "Team & audit", icon: "team", perm: "audit", sub: "Who can do what, and what was done" },
];

const readHash = () => {
  const [tab, arg] = (typeof location === "undefined" ? "" : location.hash.slice(1)).split(":");
  return { tab: tab || "dashboard", arg };
};

export default function AdminPage() {
  const [me, setMe] = useState<{ role: string; id: number; name: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState({ tab: "dashboard", arg: undefined as string | undefined });

  const boot = useCallback(async () => {
    setBooting(true);
    try {
      const token = new URLSearchParams(location.search).get("token");
      if (token) {
        const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        const j = await r.json().catch(() => null);
        history.replaceState(null, "", location.pathname + location.hash);
        if (!j?.ok) { setMsg(j?.message || "Login failed."); setBooting(false); return; }
      }
      for (let i = 0; i < 15 && !window.Telegram?.WebApp; i++) await new Promise((r) => setTimeout(r, 100));
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
      const j = await q("me");
      setMe({ role: j.role, id: j.id, name: j.name });
      setMsg("");
    } catch (e: any) {
      if (e.status === 401) setMsg("You're not logged in. In the bot, send /admin login and open the link it gives you.");
      else if (e.status === 403) setMsg("This account is not an admin.");
      else setMsg(`Couldn't reach the server: ${e.message}`);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    setRoute(readHash());
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    void boot();
    return () => window.removeEventListener("hashchange", onHash);
  }, [boot]);

  const go = (tab: string, arg?: string) => { location.hash = arg ? `${tab}:${arg}` : tab; };
  const logout = async () => { await fetch("/api/admin/logout", { method: "POST" }); setMe(null); setMsg("You've been logged out."); };

  const script = <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />;

  if (!me) {
    return (
      <div className="adm" style={{ display: "block" }}>
        {script}
        <div className="a-gate">
          <div className="adm-brand" style={{ paddingLeft: 0 }}><i /> TFUEL ADMIN</div>
          {booting ? <p className="a-muted"><span className="a-spin" aria-hidden /> Signing you in…</p> : (
            <>
              <h1>Sign in</h1>
              <p className="a-muted">{msg || "Send /admin login to the bot to get a one-time link."}</p>
              <button className="a-btn primary" onClick={() => void boot()}>Try again</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const items = NAV.filter((n) => !n.perm || can(me.role, n.perm));
  const current = items.find((n) => n.id === route.tab) ?? items[0];

  return (
    <ToastProvider>
      <div className="adm">
        {script}
        <aside className="adm-side">
          <div className="adm-brand"><i /> TFUEL ADMIN</div>
          <nav className="adm-nav" aria-label="Admin sections">
            {items.map((n) => (
              <button key={n.id} aria-current={current.id === n.id ? "page" : undefined} onClick={() => go(n.id)}>
                <Icon name={n.icon} /> {n.label}
              </button>
            ))}
          </nav>
          <div className="adm-foot">
            <div>{me.name || "Admin"} · <span className="mono">{me.role}</span></div>
            <button onClick={() => void logout()}>Log out</button>
          </div>
        </aside>
        <main className="adm-main">
          <header className="adm-head">
            <div><h1>{current.label}</h1><p>{current.sub}</p></div>
          </header>
          {current.id === "dashboard" && <Dashboard go={go} />}
          {current.id === "users" && <Users role={me.role} arg={route.arg} />}
          {current.id === "tasks" && <Tasks arg={route.arg} />}
          {current.id === "disputes" && <Disputes />}
          {current.id === "tickets" && <Tickets />}
          {current.id === "promos" && <Promos />}
          {current.id === "broadcast" && <Broadcast />}
          {current.id === "network" && <Network meId={me.id} />}
          {current.id === "bots" && <Bots />}
          {current.id === "system" && <System />}
          {current.id === "settings" && <Settings />}
          {current.id === "team" && <Team role={me.role} />}
        </main>
      </div>
    </ToastProvider>
  );
}
