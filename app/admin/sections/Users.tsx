"use client";

import { useEffect, useState } from "react";
import { act, can, Chip, Field, fmt, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

function Detail({ id, role, onChanged }: { id: number; role: string; onChanged: () => void }) {
  const { data, err, loading, reload } = useLoad<any>(() => q("user", { id }), [id]);
  const run = useRun();
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const refresh = () => { reload(); onChanged(); };

  if (!data) return <Loading err={err} loading={loading} />;
  const u = data.user;
  if (!u) return <p className="a-empty">User not found.</p>;

  return (
    <div className="a-card" style={{ marginTop: 0 }}>
      <div className="a-maint" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{u.firstName || "User"} {u.username && <span className="a-muted">@{u.username}</span>}</h2>
          <span className="mono a-muted">{u.id}</span>
        </div>
        <div className="a-actions">
          {u.banned ? <Chip kind="bad">banned</Chip> : u.verified ? <Chip kind="good">verified</Chip> : <Chip kind="warn">unverified</Chip>}
          {u.isPremium && <Chip kind="info">premium</Chip>}
        </div>
      </div>
      <dl className="a-kv">
        <dt>Balance</dt><dd className="mono">{fmt(u.balance)}</dd>
        <dt>Level</dt><dd>{u.level} · {fmt(u.xp)} XP</dd>
        <dt>Country</dt><dd>{u.country ?? "—"} {u.countryTrusted ? "" : <span className="a-muted">(untrusted)</span>}</dd>
        <dt>Risk</dt><dd>{u.risk ? <>{u.risk.score} <span className="a-muted">{u.risk.flags.join(", ")}</span></> : "—"}</dd>
        <dt>Tasks done</dt><dd>{u.tasksDone} <span className="a-muted">· left early {u.penalties}×</span></dd>
        <dt>Referrals</dt><dd>{u.referralCount} <span className="a-muted">· referrer {u.referrerId ?? "—"}</span></dd>
        <dt>Deposited</dt><dd>{fmt(u.depositedStars)} ⭐ · {fmt(u.depositedUsdt)} USDT</dd>
        <dt>Joined</dt><dd>{when(u.createdAt)}</dd>
        <dt>Last seen</dt><dd>{when(u.lastActiveAt)}</dd>
        {u.banned && <><dt>Ban reason</dt><dd>{u.banReason ?? "—"}</dd></>}
      </dl>

      {can(role, "users.ban") && (
        <div style={{ marginTop: 18 }}>
          {u.banned ? (
            <button className="a-btn" onClick={() => run(() => act("unban", { id: u.id }), refresh)}>Unban user</button>
          ) : (
            <div className="a-search">
              <input className="a-in" placeholder="Ban reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="a-btn danger" onClick={() => confirm(`Ban ${u.id}?`) && run(() => act("ban", { id: u.id, reason }), () => { setReason(""); refresh(); })}>Ban</button>
            </div>
          )}
        </div>
      )}

      {can(role, "balance") && (
        <div style={{ marginTop: 18 }}>
          <h2>Adjust balance</h2>
          <div className="a-row">
            <Field label="Amount (+ or −)"><input className="a-in mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500 or -200" /></Field>
            <Field label="Reason (logged)"><input className="a-in" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why?" /></Field>
          </div>
          <button className="a-btn primary" onClick={() => run(() => act("balance", { id: u.id, amount, reason: why }), () => { setAmount(""); setWhy(""); refresh(); })}>Apply</button>
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>Recent transactions</h2>
      {data.ledger.length === 0 ? <p className="a-muted">None.</p> : (
        <div className="a-scroll"><table className="a-table"><tbody>
          {data.ledger.map((l: any, i: number) => (
            <tr key={i}><td className="a-muted">{when(l.createdAt)}</td><td>{String(l.type).replace(/_/g, " ")}</td>
              <td className={`mono ${l.amount > 0 ? "a-pos" : "a-neg"}`} style={{ textAlign: "right" }}>{l.amount > 0 ? "+" : ""}{fmt(l.amount)}</td></tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}

export default function Users({ role, arg }: { role: string; arg?: string }) {
  const [text, setText] = useState(arg && /^\d+$/.test(arg) ? arg : "");
  const [query, setQuery] = useState(text);
  const [sel, setSel] = useState<number | null>(arg && /^\d+$/.test(arg) ? Number(arg) : null);
  const { data, err, loading, reload } = useLoad<any>(() => q("users", { q: query }), [query]);

  useEffect(() => { if (arg && /^\d+$/.test(arg)) { setText(arg); setQuery(arg); setSel(Number(arg)); } }, [arg]);

  return (
    <div className="a-split">
      <div>
        <form className="a-search" onSubmit={(e) => { e.preventDefault(); setQuery(text.trim()); }}>
          <input className="a-in" placeholder="Search by Telegram id or @username" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search users" />
          <button className="a-btn primary" type="submit">Search</button>
        </form>
        <div className="a-card" style={{ padding: 8 }}>
          <Loading err={err} loading={loading && !data} />
          {data && (data.users.length === 0 ? <p className="a-empty">No users found.</p> : (
            <div className="a-scroll"><table className="a-table">
              <thead><tr><th>User</th><th>Balance</th><th>Country</th><th>Status</th></tr></thead>
              <tbody>{data.users.map((u: any) => (
                <tr key={u.id} className={`click ${sel === u.id ? "sel" : ""}`} onClick={() => setSel(u.id)}>
                  <td><div>{u.firstName || "—"}</div><div className="mono a-muted" style={{ fontSize: 12 }}>{u.id}{u.username ? ` · @${u.username}` : ""}</div></td>
                  <td className="mono">{fmt(u.balance)}</td>
                  <td>{u.country ?? "—"}</td>
                  <td>{u.banned ? <Chip kind="bad">banned</Chip> : u.verified ? <Chip kind="good">ok</Chip> : <Chip kind="warn">new</Chip>}</td>
                </tr>))}</tbody></table></div>
          ))}
        </div>
        {!query && <p className="a-muted" style={{ marginTop: 8 }}>Showing the newest users.</p>}
      </div>
      <div>{sel ? <Detail id={sel} role={role} onChanged={reload} /> : <div className="a-card"><p className="a-empty">Select a user to see details and actions.</p></div>}</div>
    </div>
  );
}
