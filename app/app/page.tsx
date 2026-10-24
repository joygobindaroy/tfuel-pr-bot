"use client";

import Script from "next/script";
import { useCallback, useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Telegram?: { WebApp: any } } }

type Tab = "home" | "tasks" | "history" | "top";

const fmt = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [board, setBoard] = useState<"earn" | "refs">("earn");

  const load = useCallback(async () => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) { setErr("Open this page from the bot's Open App button."); return; }
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "x-init-data": tg.initData } });
      const j = await r.json();
      if (!j.ok) setErr("Couldn't load your account. Send /start to the bot and verify first.");
      else setData(j);
    } catch { setErr("Network error. Try again."); }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (window.Telegram?.WebApp) { clearInterval(t); window.Telegram.WebApp.ready(); window.Telegram.WebApp.expand(); void load(); }
    }, 100);
    return () => clearInterval(t);
  }, [load]);

  const tabs: [Tab, string][] = [["home", "Home"], ["tasks", "My tasks"], ["history", "History"], ["top", "Top"]];

  return (
    <main className="wrap">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <div className="status" role="status"><span className="spinner" aria-hidden /><span>Loading…</span></div>}

      {data && (
        <>
          <div className="tabs" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === "home" && (
            <>
              <p className="muted">Balance</p>
              <p className="balance">{fmt(data.user.balance)} {data.currency}</p>
              <div className="card" style={{ marginTop: 16 }}>
                <strong>{data.user.level}</strong>
                <div className="muted">{data.user.xp}{data.user.nextXp ? ` / ${data.user.nextXp}` : ""} XP</div>
                {data.user.nextXp && <div className="bar"><i style={{ width: `${Math.min(100, (data.user.xp / data.user.nextXp) * 100)}%` }} /></div>}
              </div>
              <div className="card">
                <div className="row"><span>Tasks done</span><strong>{data.user.tasksDone}</strong></div>
                <div className="row"><span>Daily streak</span><strong>{data.user.streak}</strong></div>
                <div className="row"><span>Referrals</span><strong>{data.user.referrals}</strong></div>
                <div className="row"><span>Country</span><strong>{data.user.country ?? "—"}</strong></div>
              </div>
              <div className="card">
                <div className="muted" style={{ marginBottom: 8 }}>Your referral link</div>
                <div style={{ wordBreak: "break-all", marginBottom: 10 }}>{data.referralLink}</div>
                <button onClick={() => navigator.clipboard?.writeText(data.referralLink)}>Copy link</button>
              </div>
              <h2 style={{ fontSize: "1.1rem" }}>Achievements</h2>
              {data.achievements.map((a: any) => (
                <div className="row" key={a.id}>
                  <span>{a.done ? "✅" : "🔒"} {a.name}</span>
                  <span className="muted">{a.progress}/{a.threshold}</span>
                </div>
              ))}
              {data.isAdmin && <p style={{ marginTop: 20 }}><a href="/admin">Open admin dashboard</a></p>}
            </>
          )}

          {tab === "tasks" && (
            data.tasks.length === 0 ? <p className="muted">No tasks yet. Create one with Promote in the bot.</p> :
            data.tasks.map((t: any) => (
              <div className="card" key={t.id}>
                <strong>{t.title}</strong>
                <div className="muted">{t.status} · {t.completed}/{t.total} done · {t.leaves} left early · {t.reports} reports</div>
                <div className="bar"><i style={{ width: `${t.total ? (t.completed / t.total) * 100 : 0}%` }} /></div>
                <div className="muted" style={{ marginTop: 6 }}>Spent {fmt(t.spent)} {data.currency}</div>
              </div>
            ))
          )}

          {tab === "history" && (
            data.history.length === 0 ? <p className="muted">Nothing yet.</p> :
            data.history.map((h: any, i: number) => (
              <div className="row" key={i}>
                <span>{h.type.replace(/_/g, " ")}<span className="muted"> · {new Date(h.createdAt).toISOString().slice(5, 10)}</span></span>
                <strong className={h.amount > 0 ? "pos" : "neg"}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</strong>
              </div>
            ))
          )}

          {tab === "top" && (
            <>
              <div className="tabs">
                <button aria-pressed={board === "earn"} onClick={() => setBoard("earn")}>Top earners</button>
                <button aria-pressed={board === "refs"} onClick={() => setBoard("refs")}>Top referrers</button>
              </div>
              {data.leaderboard[board].length === 0 ? <p className="muted">No activity yet this week.</p> :
                data.leaderboard[board].map((r: any, i: number) => (
                  <div className="row" key={r.userId}>
                    <span>{i + 1}. {r.name}</span><strong>{fmt(r[board] ?? 0)}</strong>
                  </div>
                ))}
            </>
          )}
        </>
      )}
    </main>
  );
}
