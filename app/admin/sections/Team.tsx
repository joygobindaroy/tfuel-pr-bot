"use client";

import { useState } from "react";
import { act, can, Chip, Field, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

function Roles() {
  const { data, err, loading, reload } = useLoad<any>(() => q("roles"), []);
  const run = useRun();
  const [id, setId] = useState("");
  const [role, setRole] = useState("moderator");
  if (!data) return <Loading err={err} loading={loading} />;
  return (
    <div className="a-card">
      <h2>Team and roles</h2>
      <div className="a-scroll"><table className="a-table"><tbody>
        {data.env.map((x: string) => <tr key={x}><td className="mono">{x}</td><td><Chip kind="good">super</Chip></td><td className="a-muted">set in ADMIN_IDS</td><td /></tr>)}
        {data.admins.map((a: any) => (
          <tr key={a.id}><td className="mono">{a.id}</td><td><Chip kind="info">{a.role}</Chip></td><td className="a-muted">{when(a.at)}</td>
            <td><button className="a-btn sm danger" onClick={() => confirm(`Remove ${a.id}?`) && run(() => act("role_remove", { id: a.id }), reload)}>Remove</button></td></tr>
        ))}</tbody></table></div>
      <div className="a-row" style={{ marginTop: 14 }}>
        <Field label="Telegram id"><input className="a-in mono" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} /></Field>
        <Field label="Role">
          <select className="a-in" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="moderator">moderator: users, bans, tasks, tickets</option>
            <option value="finance">finance: stats, balance, promo</option>
            <option value="super">super: everything</option>
          </select>
        </Field>
      </div>
      <button className="a-btn primary" onClick={() => run(() => act("role_add", { id, role }), () => { setId(""); reload(); })}>Add or change</button>
    </div>
  );
}

export default function Team({ role }: { role: string }) {
  const { data, err, loading } = useLoad<any>(() => q("audit"), []);
  return (
    <>
      {can(role, "roles") && <Roles />}
      <div className="a-card" style={{ padding: 8 }}>
        <h2 style={{ padding: "10px 10px 0" }}>Audit log</h2>
        <Loading err={err} loading={loading && !data} />
        {data && (data.audit.length === 0 ? <p className="a-empty">Nothing logged yet.</p> : (
          <div className="a-scroll"><table className="a-table">
            <thead><tr><th>When (UTC)</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>{data.audit.map((a: any, i: number) => <tr key={i}><td className="a-muted mono">{when(a.at)}</td><td className="mono">{a.adminId}</td><td>{String(a.action).replace(/_/g, " ")}</td><td className="mono a-muted">{a.target}</td></tr>)}</tbody></table></div>
        ))}
      </div>
    </>
  );
}
