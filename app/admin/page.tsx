"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    const t = setInterval(async () => {
      const tg = window.Telegram?.WebApp;
      if (!tg) return;
      clearInterval(t);
      tg.ready(); tg.expand();
      try {
        const r = await fetch("/api/admin/overview", { method: "POST", headers: { "x-init-data": tg.initData || "" } });
        const j = await r.json();
        if (!j.ok) setErr("Admins only. Open this from the bot's Open App button with an admin account.");
        else setD(j);
      } catch { setErr("Network error."); }
    }, 100);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="wrap wide">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <h1>Admin</h1>
      {err && <p className="error" role="alert">{err}</p>}
      {!d && !err && <div className="status"><span className="spinner" aria-hidden /><span>Loading…</span></div>}
      {d && (
        <>
          <p className="muted">Role: {d.role}. Actions (ban, balance, broadcast, config) run through the bot: /admin help</p>
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
