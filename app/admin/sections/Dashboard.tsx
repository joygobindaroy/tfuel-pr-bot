"use client";

import { Fragment, useState } from "react";
import { api, Chip, fmt, Loading, useLoad } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const LABELS: Record<string, string> = {
  newUsers: "New users", verified: "Verified", completions: "Tasks completed", revenue: "Revenue",
  depositsStars: "Stars deposited", depositsUsdt: "USDT deposited", tfuelMinted: "TFUEL issued", penalties: "Leave penalties",
};

function Bars({ values, labels, title }: { values: number[]; labels: string[]; title: string }) {
  const max = Math.max(1, ...values);
  const w = 600, h = 140, n = Math.max(values.length, 1), bw = w / n;
  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label={title} style={{ width: "100%", height: "auto" }}>
      {values.map((v, i) => {
        const bh = (v / max) * h;
        return (
          <g key={i}>
            <rect x={i * bw + 5} y={h - bh} width={Math.max(bw - 10, 2)} height={Math.max(bh, v > 0 ? 2 : 0)} rx="3" fill="var(--accent)" opacity=".92">
              <title>{`${labels[i]}: ${fmt(v)}`}</title>
            </rect>
            <text x={i * bw + bw / 2} y={h + 15} textAnchor="middle" fontSize="10" fill="var(--muted)">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard({ go }: { go: (tab: string, arg?: string) => void }) {
  const { data: d, err, loading, reload } = useLoad<any>(() => api("/api/admin/overview"), []);
  const [metric, setMetric] = useState("completions");
  if (!d) return <Loading err={err} loading={loading} />;

  const daily: any[] = d.daily ?? [];
  const keys = ["newUsers", "verified", "completions", "revenue", "depositsStars", "depositsUsdt", "tfuelMinted", "penalties"];

  return (
    <>
      {d.errors?.length > 0 && <div className="a-card"><strong>Some sections failed to load</strong>{d.errors.map((e: string, i: number) => <div className="a-muted" key={i}>{e}</div>)}</div>}

      <div className="a-grid">
        {d.users && <><div className="a-stat"><div className="v">{fmt(d.users.total)}</div><div className="l">Users</div></div>
          <div className="a-stat"><div className="v">{fmt(d.users.verified)}</div><div className="l">Verified</div></div></>}
        {d.attention && <>
          <button className={`a-stat ${d.attention.openTickets ? "alert" : ""}`} onClick={() => go("tickets")}><div className="v">{d.attention.openTickets}</div><div className="l">Open tickets</div></button>
          <button className={`a-stat ${d.attention.disputes ? "alert" : ""}`} onClick={() => go("disputes")}><div className="v">{d.attention.disputes ?? 0}</div><div className="l">Open disputes</div></button>
          <button className={`a-stat ${d.attention.reportedTasks ? "alert" : ""}`} onClick={() => go("tasks", "reported")}><div className="v">{d.attention.reportedTasks}</div><div className="l">Reported tasks</div></button>
          <div className="a-stat"><div className="v">{d.attention.banned}</div><div className="l">Banned users</div></div>
        </>}
      </div>

      {d.users && (
        <div className="a-card" style={{ marginTop: 14 }}>
          <div className="a-maint" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Last 14 days</h2>
            <button className="a-btn sm" onClick={reload}>Refresh</button>
          </div>
          <div className="a-filters">
            {keys.map((k) => <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{LABELS[k]}</button>)}
          </div>
          {daily.length === 0 ? <p className="a-empty">No activity recorded yet.</p> :
            <Bars values={daily.map((x) => Number(x[metric] ?? 0))} labels={daily.map((x) => String(x.day).slice(5))} title={LABELS[metric]} />}
        </div>
      )}

      {d.users && (
        <div className="a-split" style={{ marginTop: 14 }}>
          <div className="a-card" style={{ marginTop: 0 }}>
            <h2>Today</h2>
            <dl className="a-kv">{keys.map((k) => <Fragment key={k}><dt>{LABELS[k]}</dt><dd className="mono">{fmt(d.today?.[k])}</dd></Fragment>)}</dl>
          </div>
          <div className="a-card" style={{ marginTop: 0 }}>
            <h2>All time</h2>
            <dl className="a-kv">{keys.map((k) => <Fragment key={k}><dt>{LABELS[k]}</dt><dd className="mono">{fmt(d.totals?.[k])}</dd></Fragment>)}</dl>
          </div>
        </div>
      )}

      {d.risky && (
        <div className="a-card">
          <h2>Highest risk users</h2>
          {d.risky.length === 0 ? <p className="a-empty">Nobody flagged.</p> : (
            <div className="a-scroll"><table className="a-table">
              <thead><tr><th>User</th><th>Score</th><th>Flags</th><th>Country</th><th /></tr></thead>
              <tbody>{d.risky.map((u: any) => (
                <tr key={u.id}>
                  <td className="mono">{u.id}{u.username ? ` @${u.username}` : ""} {u.banned && <Chip kind="bad">banned</Chip>}</td>
                  <td><Chip kind={u.score >= 60 ? "bad" : "warn"}>{u.score}</Chip></td>
                  <td className="a-muted">{u.flags.join(", ") || "—"}</td>
                  <td>{u.country ?? "—"}</td>
                  <td><button className="a-btn sm" onClick={() => go("users", String(u.id))}>Open</button></td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      )}
    </>
  );
}
