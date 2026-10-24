"use client";

import { useState } from "react";
import { act, Field, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

function Ticket({ t, reload }: { t: any; reload: () => void }) {
  const [text, setText] = useState("");
  const run = useRun();
  return (
    <div className="a-card">
      <div className="a-maint"><strong className="mono">#{t.id}</strong><span className="a-muted">user {t.userId} · {when(t.createdAt)}</span></div>
      <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>{t.text}</p>
      {t.replies?.map((r: any, i: number) => <p key={i} className="a-muted" style={{ margin: "4px 0" }}>↳ admin {r.by}: {r.text}</p>)}
      <Field label="Reply to user"><textarea className="a-in" style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="a-actions">
        <button className="a-btn primary" onClick={() => run(() => act("ticket_reply", { id: t.id, text, close: true }), () => { setText(""); reload(); })}>Reply and close</button>
        <button className="a-btn" onClick={() => run(() => act("ticket_reply", { id: t.id, text }), () => { setText(""); reload(); })}>Reply</button>
        <button className="a-btn" onClick={() => run(() => act("ticket_close", { id: t.id }), reload)}>Close without reply</button>
      </div>
    </div>
  );
}

export default function Tickets() {
  const { data, err, loading, reload } = useLoad<any>(() => q("tickets"), []);
  if (!data) return <Loading err={err} loading={loading} />;
  return data.tickets.length === 0
    ? <div className="a-card"><p className="a-empty">No open tickets. 🎉</p></div>
    : <>{data.tickets.map((t: any) => <Ticket key={t.id} t={t} reload={reload} />)}</>;
}
