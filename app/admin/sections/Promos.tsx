"use client";

import { useState } from "react";
import { act, Chip, Field, fmt, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Promos() {
  const { data, err, loading, reload } = useLoad<any>(() => q("promos"), []);
  const run = useRun();
  const [f, setF] = useState({ code: "", reward: "", maxUses: "", days: "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="a-split">
      <div className="a-card" style={{ marginTop: 0 }}>
        <h2>New promo code</h2>
        <Field label="Code"><input className="a-in mono" value={f.code} onChange={set("code")} placeholder="WELCOME50" autoCapitalize="characters" /></Field>
        <div className="a-row">
          <Field label="Reward"><input className="a-in mono" inputMode="decimal" value={f.reward} onChange={set("reward")} /></Field>
          <Field label="Max uses"><input className="a-in mono" inputMode="numeric" value={f.maxUses} onChange={set("maxUses")} /></Field>
          <Field label="Expires in days (optional)"><input className="a-in mono" inputMode="numeric" value={f.days} onChange={set("days")} /></Field>
        </div>
        <button className="a-btn primary" onClick={() => run(() => act("promo_create", f), () => { setF({ code: "", reward: "", maxUses: "", days: "" }); reload(); })}>Create code</button>
      </div>
      <div className="a-card" style={{ marginTop: 0, padding: 8 }}>
        <Loading err={err} loading={loading && !data} />
        {data && (data.promos.length === 0 ? <p className="a-empty">No promo codes yet.</p> : (
          <div className="a-scroll"><table className="a-table">
            <thead><tr><th>Code</th><th>Reward</th><th>Used</th><th>Expires</th><th /></tr></thead>
            <tbody>{data.promos.map((p: any) => (
              <tr key={p.code}>
                <td className="mono">{p.code}</td><td className="mono">{fmt(p.reward)}</td><td className="mono">{p.uses}/{p.maxUses}</td>
                <td className="a-muted">{p.expiresAt ? when(p.expiresAt) : "never"}</td>
                <td>{p.active ? <button className="a-btn sm danger" onClick={() => run(() => act("promo_off", { code: p.code }), reload)}>Disable</button> : <Chip>off</Chip>}</td>
              </tr>))}</tbody></table></div>
        ))}
      </div>
    </div>
  );
}
