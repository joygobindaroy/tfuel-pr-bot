"use client";

import { useState } from "react";
import { Field, fmt, Modal, PencilIcon, TrashIcon, useToast } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Col = { k: string; label: string; type?: "number" | "text" | "select"; suffix?: string; options?: [string, string][]; hint?: string };
type Plan = {
  path: string; title: string; newLabel: string; cols: Col[]; blank: any; sortBy?: string; scalar?: boolean;
  minRows?: number; note?: string;
  computedLabels?: string[]; computed?: (row: any, cfg: any) => string[];
};

const get = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

const bonusPct = (n: number, tiers: any[], key: string) => tiers.reduce((p, t) => (n >= t[key] ? Math.max(p, t.percent) : p), 0);

export const PLANS: Plan[] = [
  {
    path: "levels", title: "Levels (VIP)", newLabel: "New level", sortBy: "xp", minRows: 1,
    cols: [
      { k: "name", label: "Level", type: "text" },
      { k: "xp", label: "XP needed", type: "number" },
      { k: "taskBonus", label: "Task bonus", type: "number", suffix: "%", hint: "Extra % on every task reward, paid by the platform." },
      { k: "dailyBonus", label: "Daily bonus", type: "number", suffix: "%", hint: "Extra % on the daily bonus." },
    ],
    blank: { name: "", xp: 0, taskBonus: 0, dailyBonus: 0 },
    note: "People move up a level when their XP reaches the number shown. The first level must start at 0 XP.",
  },
  {
    path: "referralTiers", title: "Referral tiers", newLabel: "New tier", sortBy: "minRefs", minRows: 1,
    cols: [
      { k: "minRefs", label: "From referrals", type: "number" },
      { k: "reward", label: "Reward per friend", type: "number" },
    ],
    blank: { minRefs: 0, reward: 0 },
    note: "A person is paid the reward of the highest tier they have reached, for each friend who verifies.",
  },
  {
    path: "deposit.packages", title: "Stars deposit packages", newLabel: "New package", scalar: true, sortBy: "value", minRows: 1,
    cols: [{ k: "value", label: "Stars", type: "number" }],
    blank: { value: 100 },
    computedLabels: ["Bonus", "You get"],
    computed: (r, cfg) => {
      const base = r.value * cfg.deposit.rate;
      const pct = bonusPct(r.value, cfg.deposit.bonusTiers, "minStars");
      return [pct ? `+${pct}%` : "none", `${fmt(base + Math.floor((base * pct) / 100))} ${cfg.currency}`];
    },
  },
  {
    path: "deposit.bonusTiers", title: "Stars bonus tiers", newLabel: "New tier", sortBy: "minStars",
    cols: [
      { k: "minStars", label: "From Stars", type: "number" },
      { k: "percent", label: "Bonus", type: "number", suffix: "%" },
    ],
    blank: { minStars: 100, percent: 5 },
    note: "Bonus TFUEL is created for free and can be spent on tasks, so set these tiers with your budget in mind.",
  },
  {
    path: "usdt.packages", title: "USDT deposit packages", newLabel: "New package", scalar: true, sortBy: "value", minRows: 1,
    cols: [{ k: "value", label: "USDT", type: "number" }],
    blank: { value: 10 },
    computedLabels: ["Bonus", "You get"],
    computed: (r, cfg) => {
      const base = r.value * cfg.usdt.rate;
      const pct = bonusPct(r.value, cfg.usdt.bonusTiers, "minUsdt");
      return [pct ? `+${pct}%` : "none", `${fmt(base + Math.floor((base * pct) / 100))} ${cfg.currency}`];
    },
  },
  {
    path: "usdt.bonusTiers", title: "USDT bonus tiers", newLabel: "New tier", sortBy: "minUsdt",
    cols: [
      { k: "minUsdt", label: "From USDT", type: "number" },
      { k: "percent", label: "Bonus", type: "number", suffix: "%" },
    ],
    blank: { minUsdt: 25, percent: 5 },
  },
  {
    path: "achievements", title: "Achievements", newLabel: "New achievement", minRows: 0,
    cols: [
      { k: "name", label: "Name", type: "text" },
      { k: "metric", label: "Counts", type: "select", options: [["tasksDone", "Tasks done"], ["referralCount", "Referrals"], ["bestStreak", "Best daily streak"], ["depositedStars", "Stars deposited"], ["depositedUsdt", "USDT deposited"]] },
      { k: "threshold", label: "Goal", type: "number" },
      { k: "reward", label: "Reward", type: "number" },
    ],
    blank: { id: "", name: "", metric: "tasksDone", threshold: 1, reward: 10 },
  },
];

function cell(col: Col, v: any) {
  if (col.type === "select") return col.options?.find(([k]) => k === v)?.[1] ?? v;
  if (col.type === "number") return `${fmt(v)}${col.suffix ?? ""}`;
  return v;
}

function PlanTable({ plan, cfg, save }: { plan: Plan; cfg: any; save: (path: string, value: unknown) => Promise<boolean> }) {
  const toast = useToast();
  const raw: any[] = get(cfg, plan.path) ?? [];
  const rows = plan.scalar ? raw.map((value) => ({ value })) : raw;
  const [edit, setEdit] = useState<{ index: number | null; row: any } | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async (next: any[]) => {
    let arr = plan.scalar ? next.map((r) => Number(r.value)) : next;
    if (plan.sortBy) arr = [...arr].sort((a, b) => (plan.scalar ? a - b : Number(a[plan.sortBy!]) - Number(b[plan.sortBy!])));
    setBusy(true);
    const ok = await save(plan.path, arr);
    setBusy(false);
    return ok;
  };

  const validate = (row: any) => {
    for (const c of plan.cols) {
      const v = row[c.k];
      if (c.type === "number") { if (v === "" || !Number.isFinite(Number(v)) || Number(v) < 0) return `${c.label} must be a number, zero or more.`; }
      else if (c.type === "text" && !String(v ?? "").trim()) return `${c.label} can't be empty.`;
    }
    if (plan.path === "levels") {
      const next = withRow(row);
      if (Math.min(...next.map((r) => Number(r.xp))) !== 0) return "The first level must start at 0 XP.";
      if (new Set(next.map((r) => Number(r.xp))).size !== next.length) return "Two levels can't need the same XP.";
    }
    if (plan.path === "referralTiers" && Math.min(...withRow(row).map((r) => Number(r.minRefs))) !== 0) return "The first tier must start at 0 referrals.";
    return "";
  };

  const withRow = (row: any) => {
    const clean = plan.scalar ? { value: Number(row.value) } : Object.fromEntries(plan.cols.map((c) => [c.k, c.type === "number" ? Number(row[c.k]) : String(row[c.k]).trim()]));
    if (plan.path === "achievements") (clean as any).id = row.id || String(row.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24) + "_" + Math.random().toString(36).slice(2, 5);
    const next = [...rows];
    if (edit && edit.index !== null) next[edit.index] = clean; else next.push(clean);
    return next;
  };

  const remove = async (i: number) => {
    if (rows.length <= (plan.minRows ?? 0)) return toast(`Keep at least ${plan.minRows} row.`, "err");
    if (!confirm("Delete this row?")) return;
    await commit(rows.filter((_, j) => j !== i));
  };

  return (
    <section className="a-plan">
      <div className="a-plan-head">
        <h3>{plan.title}</h3>
        <button className="a-newbtn" onClick={() => setEdit({ index: null, row: { ...plan.blank } })}>+ {plan.newLabel}</button>
      </div>
      <div className="a-card" style={{ padding: 8 }}>
        {rows.length === 0 ? <p className="a-empty">Nothing here yet.</p> : (
          <div className="a-scroll"><table className="a-table">
            <thead><tr>
              {plan.cols.map((c) => <th key={c.k}>{c.label}</th>)}
              {plan.computedLabels?.map((l) => <th key={l}>{l}</th>)}
              <th />
            </tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                {plan.cols.map((c, ci) => <td key={c.k} className={ci === 0 ? "strong" : "mono"}>{cell(c, r[c.k])}</td>)}
                {plan.computed?.(r, cfg).map((v, j) => <td key={j} className="mono">{v}</td>)}
                <td><div className="a-rowact">
                  <button className="a-iconbtn" aria-label="Edit" onClick={() => setEdit({ index: i, row: { ...r } })}><PencilIcon /></button>
                  <button className="a-iconbtn danger" aria-label="Delete" disabled={busy} onClick={() => remove(i)}><TrashIcon /></button>
                </div></td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      {plan.note && <div className="a-note"><span aria-hidden>ⓘ</span><span>{plan.note}</span></div>}

      {edit && (
        <Modal title={edit.index === null ? plan.newLabel : `Edit ${plan.title.toLowerCase()}`} onClose={() => setEdit(null)}>
          {plan.cols.map((c) => (
            <Field key={c.k} label={`${c.label}${c.suffix ? ` (${c.suffix})` : ""}`}>
              {c.type === "select" ? (
                <select className="a-in" value={edit.row[c.k]} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, [c.k]: e.target.value } })}>
                  {c.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              ) : (
                <input className={`a-in ${c.type === "number" ? "mono" : ""}`} inputMode={c.type === "number" ? "decimal" : undefined} value={edit.row[c.k] ?? ""} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, [c.k]: e.target.value } })} />
              )}
              {c.hint && <span className="a-hint">{c.hint}</span>}
            </Field>
          ))}
          <div className="a-actions" style={{ marginTop: 6 }}>
            <button className="a-newbtn" disabled={busy} onClick={async () => {
              const err = validate(edit.row);
              if (err) return toast(err, "err");
              if (await commit(withRow(edit.row))) setEdit(null);
            }}>Save</button>
            <button className="a-btn" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

const TASK_TYPES: [string, string][] = [["channel", "Channel subscription"], ["group", "Group join"]];

function TaskPrices({ cfg, save }: { cfg: any; save: (path: string, value: unknown) => Promise<boolean> }) {
  const toast = useToast();
  const [edit, setEdit] = useState<{ type: string; reward: string; premiumReward: string } | null>(null);
  const t = cfg.tasks;
  return (
    <section className="a-plan">
      <div className="a-plan-head"><h3>Task prices (minimum reward per action)</h3></div>
      <div className="a-card" style={{ padding: 8 }}>
        <div className="a-scroll"><table className="a-table">
          <thead><tr><th>Task</th><th>Reward</th><th>Premium audience</th><th>Promoter pays</th><th /></tr></thead>
          <tbody>{TASK_TYPES.map(([k, label]) => (
            <tr key={k}>
              <td className="strong">{label}</td>
              <td className="mono">{fmt(t[k].reward)}</td>
              <td className="mono">{fmt(t[k].premiumReward)}</td>
              <td className="mono">{fmt(t[k].reward * (1 + t.commissionPct / 100))} <span className="a-hint">(+{t.commissionPct}% fee)</span></td>
              <td><div className="a-rowact"><button className="a-iconbtn" aria-label={`Edit ${label}`} onClick={() => setEdit({ type: k, reward: String(t[k].reward), premiumReward: String(t[k].premiumReward) })}><PencilIcon /></button></div></td>
            </tr>))}</tbody></table></div>
      </div>
      <div className="a-note"><span aria-hidden>ⓘ</span><span>Promoters choose their own price, but never below the reward shown here. The fee ({t.commissionPct}%) is set in the other settings below.</span></div>
      {edit && (
        <Modal title={`Edit ${TASK_TYPES.find(([k]) => k === edit.type)![1].toLowerCase()} price`} onClose={() => setEdit(null)}>
          <Field label="Minimum reward"><input className="a-in mono" inputMode="decimal" value={edit.reward} onChange={(e) => setEdit({ ...edit, reward: e.target.value })} /></Field>
          <Field label="Minimum reward, Premium audience"><input className="a-in mono" inputMode="decimal" value={edit.premiumReward} onChange={(e) => setEdit({ ...edit, premiumReward: e.target.value })} /></Field>
          <div className="a-actions">
            <button className="a-newbtn" onClick={async () => {
              const r = Number(edit.reward), p = Number(edit.premiumReward);
              if (!(r > 0) || !(p > 0)) return toast("Both prices must be above zero.", "err");
              if (await save(`tasks.${edit.type}`, { reward: r, premiumReward: p })) setEdit(null);
            }}>Save</button>
            <button className="a-btn" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function Plans({ cfg, save }: { cfg: any; save: (path: string, value: unknown) => Promise<boolean> }) {
  return (
    <>
      <TaskPrices cfg={cfg} save={save} />
      {PLANS.map((p) => <PlanTable key={p.path} plan={p} cfg={cfg} save={save} />)}
    </>
  );
}
