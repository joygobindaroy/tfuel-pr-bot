"use client";

import { useState } from "react";
import { act, Chip, Field, Loading, q, statusKind, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Broadcast() {
  const { data, err, loading, reload } = useLoad<any>(() => q("broadcasts"), []);
  const run = useRun();
  const [kind, setKind] = useState("all");
  const [param, setParam] = useState("");
  const [text, setText] = useState("");

  const segment = kind === "all" || kind === "premium" ? kind : `${kind}:${param.trim().replace(/\s+/g, "_")}`;
  const needsParam = !["all", "premium"].includes(kind);

  return (
    <div className="a-split">
      <div className="a-card" style={{ marginTop: 0 }}>
        <h2>Send a message</h2>
        <div className="a-row">
          <Field label="Audience">
            <select className="a-in" value={kind} onChange={(e) => { setKind(e.target.value); setParam(""); }}>
              <option value="all">Everyone (verified)</option>
              <option value="premium">Telegram Premium users</option>
              <option value="country">Country</option>
              <option value="active">Active in the last N days</option>
              <option value="level">Level</option>
            </select>
          </Field>
          {needsParam && (
            <Field label={kind === "country" ? "Country code (e.g. BD)" : kind === "active" ? "Days (e.g. 7)" : "Level name (e.g. Pro)"}>
              <input className="a-in" value={param} onChange={(e) => setParam(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label={`Message (${text.length}/3500)`}>
          <textarea className="a-in" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={3500} />
        </Field>
        <p className="a-muted" style={{ marginTop: 0 }}>Users who turned off “News & broadcasts” are skipped automatically.</p>
        <button className="a-btn primary" disabled={!text.trim() || (needsParam && !param.trim())}
          onClick={() => confirm(`Send to "${segment}" now? This can't be undone.`) && run(() => act("broadcast", { segment, text }), () => { setText(""); reload(); })}>
          Send broadcast
        </button>
      </div>
      <div className="a-card" style={{ marginTop: 0 }}>
        <div className="a-maint"><h2 style={{ margin: 0 }}>Recent broadcasts</h2><button className="a-btn sm" onClick={reload}>Refresh</button></div>
        <Loading err={err} loading={loading && !data} />
        {data && (data.broadcasts.length === 0 ? <p className="a-empty">None yet.</p> : data.broadcasts.map((b: any) => (
          <div key={b.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="a-maint"><span className="mono a-muted">{b.segment}</span><Chip kind={statusKind(b.status)}>{b.status}</Chip></div>
            <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{String(b.text).slice(0, 140)}</p>
            <span className="a-muted mono" style={{ fontSize: 12 }}>sent {b.sent} · failed {b.failed} · skipped {b.skipped} · {when(b.createdAt)}</span>
          </div>
        )))}
      </div>
    </div>
  );
}
