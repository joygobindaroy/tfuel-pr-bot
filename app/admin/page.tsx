"use client";

import Script from "next/script";
import { useCallback, useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Telegram?: { WebApp: any } } }

function Obj({ o }: { o: Record<string, number> }) {
  const entries = Object.entries(o || {});
  if (!entries.length) return <p className="muted">No data yet.</p>;
  return <>{entries.map(([k, v]) => <div className="row" key={k}><span>{k}</span><strong>{Number(v).toLocaleString()}</strong></div>)}</>;
}

export default function AdminPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || "";
    try {
      const r = await fetch("/api/admin/overview", { method: "POST", headers: { "x-init-data": initData } });
      const j = await r.json().catch(() => null);
      if (r.status === 401) setErr("Not logged in. In the bot send /admin login and open the link it gives you.");
      else if (r.status === 403) setErr("This account is not an admin.");
      else if (!r.ok || !j?.ok) setErr(`Server error (${r.status}). ${j?.message ?? "Check the Vercel logs."}`);
      else setD(j);
    } catch (e) {
      setErr(`Couldn't reach the server (${String((e as Error).message)}).`);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = new URLSearchParams(location.search).get("token");
      if (token) {
        try {
          const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
          const j = await r.json().catch(() => null);
          history.replaceState(null, "", location.pathname);
          if (!j?.ok) { setErr(j?.message || "Login failed."); return; }
        } catch { setErr("Login request failed. Check your connection."); return; }
      }
      // give the Telegram script a moment (only exists inside Telegram, harmless elsewhere)
      for (let i = 0; i < 15 && !window.Telegram?.WebApp; i++) await new Promise((r) => setTimeout(r, 100));
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
      await load();
    })();
  }, [load]);

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setD(null);
    setErr("Logged out.");
  };

  return (
    <main className="wrap wide">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <h1>Admin</h1>
      {err && <p className="error" role="alert">{err}</p>}
      {!d && !err && <div className="status"><span className="spinner" aria-hidden /><span>Loading…</span></div>}
      {d && (
        <>
          <p className="muted">
            Role: {d.role}. Actions (ban, balance, broadcast, config) run through the bot: /admin help.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); void logout(); }}>Log out</a>
          </p>
          {d.errors?.length > 0 && (
            <div className="card"><strong>Some sections failed</strong>{d.errors.map((e: string, i: number) => <div className="muted" key={i}>{e}</div>)}</div>
          )}
          {d.users && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Users</h2>
              <div className="row"><span>Total</span><strong>{d.users.total}</strong></div>
              <div className="row"><span>Verified</span><strong>{d.users.verified}</strong></div>
              <h3>Today</h3><Obj o={d.today} />
              <h3>All time</h3><Obj o={d.totals} />
            </div>
          )}
          {d.risky && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Fraud</h2>
              <h3>Highest risk</h3>
              <div style={{ overflowX: "auto" }}><table><thead><tr><th>ID</th><th>Score</th><th>Flags</th><th>Country</th></tr></thead>
                <tbody>{d.risky.map((u: any) => <tr key={u.id}><td>{u.id}{u.banned ? " 🚫" : ""}</td><td>{u.score}</td><td>{u.flags.join(", ")}</td><td>{u.country}</td></tr>)}</tbody></table></div>
              <h3>Reported tasks</h3>
              {d.reportedTasks.length === 0 ? <p className="muted">None.</p> : d.reportedTasks.map((t: any) => <div className="row" key={t.id}><span>{t.title} ({t.status})</span><strong>{t.reports}</strong></div>)}
              <h3>Frequent leavers</h3>
              {d.leavers.length === 0 ? <p className="muted">None.</p> : d.leavers.map((u: any) => <div className="row" key={u.id}><span>{u.id}</span><strong>{u.penalties}×</strong></div>)}
            </div>
          )}
          {d.tickets && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Open tickets</h2>
              {d.tickets.length === 0 ? <p className="muted">None.</p> : d.tickets.map((t: any) => <div className="row" key={t.id}><span>#{t.id} · {t.userId}: {String(t.text).slice(0, 80)}</span></div>)}
            </div>
          )}
          {d.audit && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Audit log</h2>
              {d.audit.map((a: any, i: number) => <div className="row" key={i}><span>{new Date(a.at).toISOString().slice(5, 16)} · {a.adminId} · {a.action}</span><span className="muted">{a.target}</span></div>)}
            </div>
          )}
        </>
      )}
    </main>
  );
}
