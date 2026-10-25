"use client";

import { useState } from "react";
import { act, Chip, Field, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A webhook error only matters if it is recent or updates are piling up. */
const recent = (b: any) => !!b.webhook?.lastErrorAt && Date.now() - b.webhook.lastErrorAt < 30 * 60_000 || (b.webhook?.pending ?? 0) > 5;

export default function Bots() {
  const { data, err, loading, reload } = useLoad<any>(() => q("bots"), []);
  const run = useRun();
  const [token, setToken] = useState("");

  return (
    <div className="a-split">
      <div>
        <Loading err={err} loading={loading && !data} />
        {data?.bots.map((b: any) => (
          <div className="a-card" key={b.id}>
            <div className="a-maint">
              <div>
                <h2 style={{ margin: 0 }}>@{b.username} {b.primary && <Chip kind="info">primary</Chip>}</h2>
                <span className="mono a-muted">id {b.id}</span>
              </div>
              {b.error ? <Chip kind="bad">unreachable</Chip> : recent(b) ? <Chip kind="warn">webhook error</Chip> : !b.webhook?.url ? <Chip kind="bad">no webhook</Chip> : <Chip kind="good">healthy</Chip>}
            </div>
            {b.error && <p className="a-neg">{b.error}</p>}
            {b.webhook && (
              <dl className="a-kv" style={{ marginTop: 12 }}>
                <dt>Webhook</dt><dd className="mono" style={{ fontSize: 13 }}>{b.webhook.url || "not set"}</dd>
                <dt>Pending</dt><dd className="mono">{b.webhook.pending}</dd>
                <dt>Last error</dt><dd>{b.webhook.lastError ? <>{b.webhook.lastError} <span className="a-muted">({when(b.webhook.lastErrorAt)} UTC{recent(b) ? "" : ", old: Telegram keeps showing it, no action needed"})</span></> : "none"}</dd>
              </dl>
            )}
            <div className="a-actions" style={{ marginTop: 14 }}>
              <button className="a-btn" onClick={() => run(() => act("bot_webhook", { id: b.id }), reload)}>Re-register webhook</button>
              <button className="a-btn" onClick={reload}>Refresh</button>
              {!b.primary && <button className="a-btn danger" onClick={() => confirm(`Remove @${b.username}? Its webhook is deleted.`) && run(() => act("bot_remove", { id: b.id }), reload)}>Remove</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="a-card" style={{ marginTop: 0 }}>
        <h2>Add a mirror bot</h2>
        <ol className="a-muted" style={{ paddingLeft: 18, marginTop: 0 }}>
          <li>Create the bot in @BotFather and copy its token.</li>
          <li>Paste it below. It's checked with Telegram, encrypted, and never shown again.</li>
          <li>The webhook is registered for you.</li>
        </ol>
        <Field label="Bot token"><input className="a-in mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC…" /></Field>
        <button className="a-btn primary" disabled={!token.trim()} onClick={() => run(() => act("bot_add", { token }), () => { setToken(""); reload(); })}>Add bot</button>
        <p className="a-muted" style={{ margin: "14px 0 0" }}>Mirror bots share users, balances and tasks. Each one must be made admin in the chats it should work in.</p>
      </div>
    </div>
  );
}
