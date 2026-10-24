"use client";

import { useEffect, useState } from "react";
import { act, Chip, fmt, Loading, q, statusKind, useLoad, useRun } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FILTERS = ["all", "active", "paused", "reported", "done", "cancelled"];

export default function Tasks({ arg }: { arg?: string }) {
  const [filter, setFilter] = useState(arg && FILTERS.includes(arg) ? arg : "all");
  const { data, err, loading, reload } = useLoad<any>(() => q("tasks"), []);
  const run = useRun();
  useEffect(() => { if (arg && FILTERS.includes(arg)) setFilter(arg); }, [arg]);

  if (!data) return <Loading err={err} loading={loading} />;
  const list = (data.tasks as any[]).filter((t) => filter === "all" ? true : filter === "reported" ? t.reports > 0 : t.status === filter);
  const op = (id: string, o: string) => run(() => act("task", { id, op: o }), reload);

  return (
    <>
      <div className="a-filters">
        {FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ textTransform: "capitalize" }}>{f}</button>)}
        <button onClick={reload} style={{ marginLeft: "auto" }}>Refresh</button>
      </div>
      <div className="a-card" style={{ padding: 8 }}>
        {list.length === 0 ? <p className="a-empty">No tasks here.</p> : (
          <div className="a-scroll"><table className="a-table">
            <thead><tr><th>Task</th><th>Owner</th><th>Progress</th><th>Left</th><th>Reports</th><th>Status</th><th /></tr></thead>
            <tbody>{list.map((t) => (
              <tr key={t.id}>
                <td><div>{t.title}</div><div className="a-muted mono" style={{ fontSize: 12 }}>{t.type} · <a href={t.link} target="_blank" rel="noreferrer">{t.username}</a></div></td>
                <td className="mono">{t.ownerId}</td>
                <td style={{ minWidth: 120 }}><div className="mono" style={{ fontSize: 12 }}>{fmt(t.completed)}/{fmt(t.total)}</div><div className="a-bar"><i style={{ width: `${t.total ? (t.completed / t.total) * 100 : 0}%` }} /></div></td>
                <td className="mono">{t.leaves}</td>
                <td>{t.reports > 0 ? <Chip kind="warn">{t.reports}</Chip> : <span className="a-muted">0</span>}</td>
                <td><Chip kind={statusKind(t.status)}>{t.status}</Chip>{t.pauseReason ? <div className="a-muted" style={{ fontSize: 11 }}>{t.pauseReason}</div> : null}</td>
                <td><div className="a-actions" style={{ flexWrap: "nowrap" }}>
                  {t.status === "active" && <button className="a-btn sm" onClick={() => op(t.id, "pause")}>Pause</button>}
                  {t.status === "paused" && <button className="a-btn sm" onClick={() => op(t.id, "resume")}>Resume</button>}
                  {t.status !== "cancelled" && <button className="a-btn sm danger" onClick={() => confirm("Cancel this task and refund the unspent budget to the owner?") && op(t.id, "cancel")}>Cancel</button>}
                </div></td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      <p className="a-muted" style={{ marginTop: 10 }}>Showing the 60 newest tasks.</p>
    </>
  );
}
