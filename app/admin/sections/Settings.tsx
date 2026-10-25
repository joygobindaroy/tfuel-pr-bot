"use client";

import { useState } from "react";
import { act, Loading, q, useLoad, useRun, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const human = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase();

function Leaf({ path, value, onSave }: { path: string; value: any; onSave: (p: string, v: unknown) => Promise<boolean> }) {
  const key = path.split(".").pop()!;
  const [v, setV] = useState<any>(value);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);

  let input;
  if (typeof value === "boolean") {
    input = <button className="a-switch" role="switch" aria-checked={value} aria-label={human(key)} onClick={() => onSave(path, !value)} />;
  } else if (path === "vpnMode") {
    input = <select className="a-in" value={v} onChange={(e) => setV(e.target.value)}><option value="block">block</option><option value="limit">limit</option><option value="allow">allow</option></select>;
  } else if (typeof value === "number") {
    input = <input className="a-in mono" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />;
  } else {
    input = <input className="a-in" value={v ?? ""} onChange={(e) => setV(e.target.value)} />;
  }
  const save = () => onSave(path, typeof value === "number" ? Number(v) : v);

  return (
    <div className="a-leaf">
      <div><span style={{ textTransform: "capitalize" }}>{human(key)}</span><small className="mono">{path}</small></div>
      <div>{input}</div>
      <div>{typeof value !== "boolean" && dirty && <button className="a-btn sm primary" onClick={save}>Save</button>}</div>
    </div>
  );
}

function Json({ path, value, onSave }: { path: string; value: any; onSave: (p: string, v: unknown) => Promise<boolean> }) {
  const original = JSON.stringify(value, null, 2);
  const [t, setT] = useState(original);
  const [bad, setBad] = useState("");
  const key = path.split(".").pop()!;
  const save = () => {
    try { const parsed = JSON.parse(t); setBad(""); void onSave(path, parsed); } catch { setBad("That isn't valid JSON."); }
  };
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px dashed var(--line)" }}>
      <div style={{ marginBottom: 6 }}><span style={{ textTransform: "capitalize" }}>{human(key)}</span> <small className="mono a-muted">{path}</small></div>
      <textarea className="a-in mono" style={{ minHeight: 110, fontSize: 13 }} value={t} onChange={(e) => setT(e.target.value)} spellCheck={false} />
      {bad && <p className="a-neg" style={{ margin: "4px 0" }}>{bad}</p>}
      {t !== original && <div style={{ marginTop: 8 }}><button className="a-btn sm primary" onClick={save}>Save</button></div>}
    </div>
  );
}

function Node({ path, value, onSave, root }: { path: string; value: any; onSave: (p: string, v: unknown) => Promise<boolean>; root?: boolean }) {
  if (Array.isArray(value)) return <Json path={path} value={value} onSave={onSave} />;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([k]) => !(root && k === "maintenance"));
    const leaves = entries.filter(([, x]) => !(x && typeof x === "object") || Array.isArray(x));
    const groups = entries.filter(([, x]) => x && typeof x === "object" && !Array.isArray(x));
    const body = (
      <>
        {leaves.map(([k, x]) => <Node key={k} path={path ? `${path}.${k}` : k} value={x} onSave={onSave} />)}
        {groups.map(([k, x]) => <Node key={k} path={path ? `${path}.${k}` : k} value={x} onSave={onSave} />)}
      </>
    );
    return root ? body : <fieldset className="a-group"><legend>{human(path.split(".").pop()!)}</legend>{body}</fieldset>;
  }
  return <Leaf path={path} value={value} onSave={onSave} />;
}

function History({ onDone }: { onDone: () => void }) {
  const { data, err, loading, reload } = useLoad<any>(() => q("config_history"), []);
  const run = useRun();
  const show = (v: unknown) => { const t = JSON.stringify(v); return t && t.length > 40 ? t.slice(0, 40) + "…" : t ?? "—"; };
  return (
    <div className="a-card" style={{ padding: 8 }}>
      <h2 style={{ padding: "10px 10px 0" }}>Change history</h2>
      <Loading err={err} loading={loading && !data} />
      {data && (data.history.length === 0 ? <p className="a-empty">No changes recorded yet.</p> : (
        <div className="a-scroll"><table className="a-table">
          <thead><tr><th>When (UTC)</th><th>Setting</th><th>Before</th><th>After</th><th>By</th><th /></tr></thead>
          <tbody>{data.history.map((h: any) => (
            <tr key={h.id}>
              <td className="a-muted mono">{when(h.at)}</td><td className="mono">{h.path}</td>
              <td className="mono a-muted">{h.hadValue ? show(h.before) : "default"}</td><td className="mono">{show(h.after)}</td>
              <td className="mono">{h.by}</td>
              <td>{!h.rollbackOf && <button className="a-btn sm" onClick={() => confirm(`Revert ${h.path}?`) && run(() => act("config_rollback", { id: h.id }), () => { reload(); onDone(); })}>Revert</button>}</td>
            </tr>))}</tbody></table></div>
      ))}
    </div>
  );
}

export default function Settings() {
  const { data, err, loading, reload } = useLoad<any>(() => q("config"), []);
  const run = useRun();
  if (!data) return <Loading err={err} loading={loading} />;
  const cfg = data.config;
  const save = (path: string, value: unknown) => run(() => act("config_set", { path, value }), reload);

  return (
    <>
      <div className="a-card">
        <div className="a-maint">
          <div><h2 style={{ margin: 0 }}>Maintenance mode</h2><span className="a-muted">Pauses the bot for everyone except admins. Payments still go through.</span></div>
          <button className="a-switch" role="switch" aria-checked={!!cfg.maintenance} aria-label="Maintenance mode"
            onClick={() => run(() => act("maintenance", { on: !cfg.maintenance }), reload)} />
        </div>
      </div>
      <div className="a-card">
        <h2>Live configuration</h2>
        <p className="a-muted" style={{ marginTop: 0 }}>Changes apply to the bot within about 30 seconds. Rewards, prices, fees, bonuses, limits and links all live here.</p>
        <Node path="" value={cfg} onSave={save} root />
      </div>
      <History onDone={reload} />
    </>
  );
}
