"use client";

import { useMemo, useState } from "react";
import { act, api, Chip, Field, fmt, Loading, q, statusKind, useLoad, useRun, useToast, when } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Sub = "chats" | "compose" | "campaigns";

function Chats({ selected, setSelected, goCompose }: { selected: number[]; setSelected: (v: number[]) => void; goCompose: () => void }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const { data, err, loading, reload } = useLoad<any>(() => q("chats", { q: term }), [term]);
  const run = useRun();

  const rows = useMemo(() => {
    const l: any[] = data?.chats ?? [];
    return l.filter((c) => filter === "all" ? true : filter === "ads" ? c.adsEnabled : filter === "channel" ? c.type === "channel" : filter === "group" ? c.type !== "channel" : filter === "blocked" ? c.blacklisted : filter === "issues" ? !c.botAdmin || c.status !== "active" : true);
  }, [data, filter]);
  const toggle = (id: number) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const allOn = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  return (
    <>
      <form className="a-search" onSubmit={(e) => { e.preventDefault(); setTerm(text.trim()); }}>
        <input className="a-in" placeholder="Search title, @username, chat id or owner id" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search chats" />
        <button className="a-btn primary" type="submit">Search</button>
      </form>
      <div className="a-filters">
        {[["all", "All"], ["ads", "Ads on"], ["channel", "Channels"], ["group", "Groups"], ["blocked", "Blacklisted"], ["issues", "Needs attention"]].map(([k, l]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <button onClick={reload} style={{ marginLeft: "auto" }}>Refresh</button>
      </div>
      {selected.length > 0 && (
        <div className="a-card" style={{ marginBottom: 14 }}>
          <div className="a-maint"><span><strong>{selected.length}</strong> selected</span>
            <div className="a-actions"><button className="a-btn sm" onClick={() => setSelected([])}>Clear</button><button className="a-btn sm primary" onClick={goCompose}>Write a post for these</button></div></div>
        </div>
      )}
      <div className="a-card" style={{ padding: 8 }}>
        <Loading err={err} loading={loading && !data} />
        {data && (rows.length === 0 ? (
          data.total === 0 ? (
            <div style={{ padding: 18 }}>
              <h2>No chats registered yet</h2>
              <p className="a-muted">Chats appear here when the bot is made admin in them, but only after the webhook was re-registered (Bots page, “Re-register webhook”). Chats that already have tasks can be imported now.</p>
              <ol className="a-muted" style={{ paddingLeft: 18 }}>
                <li>Bots page, Re-register webhook (once).</li>
                <li>Import chats from existing tasks (button below).</li>
                <li>For any other chat: remove the bot and add it as admin again, or in the bot open More, My chats, Add.</li>
              </ol>
              <button className="a-btn primary" onClick={() => run(() => act("chats_backfill"), reload)}>Import chats from existing tasks</button>
            </div>
          ) : <p className="a-empty">No chats match this filter.</p>
        ) : (
          <div className="a-scroll"><table className="a-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSelected(allOn ? selected.filter((x) => !rows.some((r) => r.id === x)) : [...new Set([...selected, ...rows.map((r) => r.id)])])} /></th>
              <th>Chat</th><th>Members</th><th>Owner</th><th>Ads</th><th>Today</th><th>Earned</th><th /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" aria-label={`Select ${c.title}`} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /></td>
                <td><div>{c.type === "channel" ? "📢" : "👥"} {c.title}</div>
                  <div className="a-muted mono" style={{ fontSize: 12 }}>{c.username ? `@${c.username} · ` : ""}{c.id}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {!c.botAdmin && <Chip kind="bad">bot not admin</Chip>}
                    {c.status !== "active" && <Chip kind="bad">removed</Chip>}
                    {c.blacklisted && <Chip kind="bad">blacklisted</Chip>}
                    {c.mandatory && <Chip kind="info">mandatory sub</Chip>}
                    {c.blocker && c.status === "active" && <Chip kind="warn">won't get posts: {c.blocker}</Chip>}
                    {!c.blocker && c.status === "active" && <Chip kind="good">ready for posts</Chip>}
                    {c.tags.map((t: string) => <Chip key={t}>{t}</Chip>)}
                  </div></td>
                <td className="mono">{fmt(c.memberCount)}</td>
                <td className="mono">{c.ownerId ?? "—"}</td>
                <td>{c.adsEnabled ? <Chip kind="good">on · {c.maxPerDay}/day</Chip> : <Chip>off</Chip>}</td>
                <td className="mono">{c.postsToday}</td>
                <td className="mono">{fmt(c.earned)}</td>
                <td><div className="a-actions" style={{ flexWrap: "nowrap" }}>
                  <button className="a-btn sm" onClick={() => { const t = prompt("Tags, comma separated", c.tags.join(", ")); if (t !== null) void run(() => act("chat_flag", { id: c.id, tags: t.split(",").map((x) => x.trim()).filter(Boolean) }), reload); }}>Tags</button>
                  <button className={`a-btn sm ${c.blacklisted ? "" : "danger"}`} onClick={() => run(() => act("chat_flag", { id: c.id, blacklisted: !c.blacklisted }), reload)}>{c.blacklisted ? "Allow" : "Blacklist"}</button>
                </div></td>
              </tr>))}</tbody></table></div>
        ))}
      </div>
      {data && <p className="a-muted" style={{ marginTop: 10 }}>Showing {rows.length} of {data.total}. Chats need at least {fmt(data.minMembers)} members, an owner who is a verified user, and ads switched on by the owner to receive posts.</p>}
    </>
  );
}

function Compose({ selected, onCreated }: { selected: number[]; onCreated: () => void }) {
  const toast = useToast();
  const run = useRun();
  const [f, setF] = useState({
    title: "", text: "", photoUrl: "", pin: false, deleteAfterHours: "24", releaseAfterHours: "6",
    mode: "fixed", amount: "0", min: "0", max: "0", scheduledAt: "",
    audience: selected.length ? "selected" : "all", minMembers: "", types: [] as string[], tags: "", ids: "", exclude: "",
  });
  const [buttons, setButtons] = useState<{ text: string; url: string }[]>([{ text: "Open the bot", url: "{BOT}" }]);
  const [est, setEst] = useState<any>(null);
  const [testChat, setTestChat] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const build = () => {
    const nums = (s: string) => s.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n !== 0);
    const target: any = { mode: f.audience === "selected" || f.audience === "ids" ? "ids" : f.audience === "filter" ? "filter" : "all" };
    if (f.audience === "selected") target.ids = selected;
    if (f.audience === "ids") target.ids = nums(f.ids);
    if (f.minMembers) target.minMembers = Number(f.minMembers);
    if (f.types.length) target.types = f.types;
    if (f.tags.trim()) target.tags = f.tags.split(",").map((x) => x.trim()).filter(Boolean);
    if (f.exclude.trim()) target.exclude = nums(f.exclude);
    const scheduledAt = f.scheduledAt ? new Date(f.scheduledAt + "Z").getTime() : null;
    return {
      title: f.title, text: f.text, photoUrl: f.photoUrl.trim() || null, buttons: buttons.filter((b) => b.text && b.url), pin: f.pin,
      deleteAfterHours: Number(f.deleteAfterHours) || 0, releaseAfterHours: Number(f.releaseAfterHours) || 0,
      bonus: { mode: f.mode, amount: Number(f.amount) || 0, min: Number(f.min) || 0, max: Number(f.max) || 0 }, target, scheduledAt,
    };
  };

  const estimate = async () => {
    setBusy(true);
    try { const c = build(); setEst(await q("net_estimate", { target: c.target, bonus: c.bonus })); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="a-split">
      <div className="a-card" style={{ marginTop: 0 }}>
        <h2>Message</h2>
        <Field label="Internal title"><input className="a-in" value={f.title} onChange={set("title")} placeholder="e.g. Launch week push" /></Field>
        <Field label={`Text (${f.text.length}/3500). A “Sponsored” label is added automatically.`}><textarea className="a-in" style={{ minHeight: 150 }} value={f.text} onChange={set("text")} maxLength={3500} /></Field>
        <Field label="Image URL (optional, https)"><input className="a-in" value={f.photoUrl} onChange={set("photoUrl")} placeholder="https://…/banner.jpg" /></Field>
        <h2 style={{ marginTop: 18 }}>Buttons</h2>
        {buttons.map((b, i) => (
          <div className="a-row" key={i} style={{ marginBottom: 8, alignItems: "end", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr) auto" }}>
            <Field label="Label"><input className="a-in" value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} /></Field>
            <Field label={b.url === "{BOT}" ? "Link (tracked bot link)" : "Link"}><input className="a-in mono" value={b.url} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} /></Field>
            <button className="a-btn sm danger" style={{ marginBottom: 12 }} onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div className="a-actions">
          <button className="a-btn sm" onClick={() => setButtons([...buttons, { text: "Open the bot", url: "{BOT}" }])}>+ Bot link (tracked)</button>
          <button className="a-btn sm" onClick={() => setButtons([...buttons, { text: "", url: "https://" }])}>+ Other link</button>
        </div>
        <p className="a-muted">{"{BOT}"} becomes a link to the bot that records which chat each new user came from.</p>
        <div className="a-row" style={{ marginTop: 10 }}>
          <Field label="Delete after (hours, 0 = keep)"><input className="a-in mono" inputMode="numeric" value={f.deleteAfterHours} onChange={set("deleteAfterHours")} /></Field>
          <Field label="Pin the post"><select className="a-in" value={f.pin ? "1" : "0"} onChange={(e) => setF({ ...f, pin: e.target.value === "1" })}><option value="0">No</option><option value="1">Yes (if the bot can)</option></select></Field>
        </div>
      </div>

      <div>
        <div className="a-card" style={{ marginTop: 0 }}>
          <h2>Audience</h2>
          <Field label="Send to">
            <select className="a-in" value={f.audience} onChange={set("audience")}>
              <option value="all">Every eligible chat</option>
              <option value="selected">The {selected.length} chats I selected</option>
              <option value="ids">Specific chat ids</option>
              <option value="filter">Filter (size, type, tags)</option>
            </select>
          </Field>
          {f.audience === "ids" && <Field label="Chat ids (comma or space separated)"><textarea className="a-in mono" style={{ minHeight: 70 }} value={f.ids} onChange={set("ids")} /></Field>}
          <div className="a-row">
            <Field label="Minimum members"><input className="a-in mono" inputMode="numeric" value={f.minMembers} onChange={set("minMembers")} placeholder="default rule" /></Field>
            <Field label="Only these tags"><input className="a-in" value={f.tags} onChange={set("tags")} placeholder="vip, tech" /></Field>
          </div>
          <div className="a-filters" style={{ marginBottom: 8 }}>
            {["channel", "supergroup", "group"].map((t) => <button key={t} aria-pressed={f.types.includes(t)} onClick={() => setF({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })}>{t}</button>)}
          </div>
          <Field label="Exclude chat ids"><input className="a-in mono" value={f.exclude} onChange={set("exclude")} /></Field>
        </div>

        <div className="a-card">
          <h2>Bonus for the chat owner</h2>
          <div className="a-row">
            <Field label="Mode"><select className="a-in" value={f.mode} onChange={set("mode")}><option value="fixed">Fixed per chat</option><option value="per1000">Per 1,000 members</option></select></Field>
            <Field label="Amount (0 = none)"><input className="a-in mono" inputMode="decimal" value={f.amount} onChange={set("amount")} /></Field>
            <Field label="Min per chat"><input className="a-in mono" inputMode="decimal" value={f.min} onChange={set("min")} /></Field>
            <Field label="Max per chat (0 = no cap)"><input className="a-in mono" inputMode="decimal" value={f.max} onChange={set("max")} /></Field>
          </div>
          <Field label="Pay after (hours), only if the post is still there"><input className="a-in mono" inputMode="numeric" value={f.releaseAfterHours} onChange={set("releaseAfterHours")} /></Field>
          <p className="a-muted" style={{ margin: 0 }}>With amount 0 nothing is paid and owners get no notification.</p>
        </div>

        <div className="a-card">
          <h2>Send</h2>
          <Field label="Schedule (UTC, optional)"><input className="a-in" type="datetime-local" value={f.scheduledAt} onChange={set("scheduledAt")} /></Field>
          {est && (
            <div className="a-card" style={{ background: "var(--raised)", marginBottom: 12 }}>
              <div className="a-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                <div><div className="mono" style={{ fontSize: 22 }}>{fmt(est.count)}</div><div className="a-muted">chats</div></div>
                <div><div className="mono" style={{ fontSize: 22 }}>{fmt(est.members)}</div><div className="a-muted">members reached</div></div>
                <div><div className="mono" style={{ fontSize: 22 }}>{fmt(est.totalBonus)}</div><div className="a-muted">bonus promised</div></div>
              </div>
              {est.needsApproval && <p style={{ margin: "10px 0 0" }}><Chip kind="warn">needs a second super admin</Chip></p>}
              {est.count === 0 && (
                <p className="a-neg" style={{ margin: "10px 0 0" }}>
                  {est.registered === 0 ? "No chats are registered yet. Open Chats and import them." : `${est.registered} chat(s) are registered but none can receive this post.`}
                </p>
              )}
              {Object.keys(est.excluded || {}).length > 0 && (
                <div style={{ margin: "10px 0 0" }}>
                  <div className="a-muted" style={{ marginBottom: 4 }}>Skipped, and why:</div>
                  {Object.entries(est.excluded as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([why, n]) => (
                    <div key={why} className="row" style={{ padding: "3px 0" }}><span>{why}</span><strong className="mono">{n}</strong></div>
                  ))}
                </div>
              )}
              {est.sample.length > 0 && <p className="a-muted" style={{ margin: "10px 0 0" }}>e.g. {est.sample.join(", ")}</p>}
            </div>
          )}
          <Field label="Test in one chat (ignores the rules, no bonus): chat id">
            <div className="a-search" style={{ marginBottom: 0 }}>
              <input className="a-in mono" value={testChat} onChange={(e) => setTestChat(e.target.value)} placeholder="-1001234567890" />
              <button className="a-btn" onClick={() => run(() => act("net_test_chat", { campaign: build(), chatId: testChat.trim() }))}>Send test</button>
            </div>
          </Field>
          <div className="a-actions">
            <button className="a-btn" disabled={busy} onClick={estimate}>Estimate</button>
            <button className="a-btn" onClick={() => run(() => act("net_test", { campaign: build() }))}>Send test to me</button>
            <button className="a-btn primary" disabled={busy || !f.text.trim()}
              onClick={async () => { if (confirm("Create this campaign now?")) { setBusy(true); const ok = await run(() => act("net_create", { campaign: build() })); setBusy(false); if (ok) onCreated(); } }}>
              {f.scheduledAt ? "Schedule" : "Create and send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campaigns({ meId }: { meId: number }) {
  const { data, err, loading, reload } = useLoad<any>(() => q("campaigns"), []);
  const run = useRun();
  return (
    <>
      <div className="a-maint" style={{ marginBottom: 12 }}><span className="a-muted">Newest 15 campaigns.</span><button className="a-btn sm" onClick={reload}>Refresh</button></div>
      <Loading err={err} loading={loading && !data} />
      {data && (data.campaigns.length === 0 ? <div className="a-card"><p className="a-empty">No campaigns yet.</p></div> : data.campaigns.map((c: any) => {
        const t = c.totals;
        const pct = t.targets ? Math.min(100, ((t.sent + t.failed) / t.targets) * 100) : 0;
        return (
          <div className="a-card" key={c.id}>
            <div className="a-maint">
              <div><strong>{c.title}</strong><div className="a-muted mono" style={{ fontSize: 12 }}>{c.id} · by {c.createdBy} · {when(c.createdAt)}{c.scheduledAt ? ` · scheduled ${when(c.scheduledAt)}` : ""}</div></div>
              <Chip kind={statusKind(c.status)}>{String(c.status).replace("_", " ")}</Chip>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>{String(c.text).slice(0, 160)}</p>
            <div className="a-bar"><i style={{ width: `${pct}%` }} /></div>
            <dl className="a-kv" style={{ marginTop: 10, gridTemplateColumns: "150px 1fr" }}>
              <dt>Sent / failed</dt><dd className="mono">{t.sent} / {t.failed} of {t.targets}</dd>
              <dt>Bonus paid / promised</dt><dd className="mono">{fmt(t.bonusPaid)} / {fmt(t.bonusPromised)}</dd>
              <dt>Bot starts / verified</dt><dd className="mono">{t.starts} / {t.verified}{t.verified > 0 && t.bonusPaid > 0 ? ` · ${fmt(t.bonusPaid / t.verified)} per verified user` : ""}</dd>
            </dl>
            {c.lastErrors?.length > 0 && (
              <div className="a-card" style={{ background: "var(--raised)", marginTop: 10, padding: 12 }}>
                <div className="a-muted" style={{ marginBottom: 4 }}>Why some posts were not delivered:</div>
                {c.lastErrors.map((e: any, i: number) => <div key={i} style={{ fontSize: 13 }}><span className="mono a-muted">{e.chatId}</span> {e.error}</div>)}
              </div>
            )}
            <div className="a-actions" style={{ marginTop: 12 }}>
              {c.status === "pending_approval" && (c.createdBy === meId
                ? <span className="a-muted">Waiting for another super admin to approve.</span>
                : <button className="a-btn primary sm" onClick={() => run(() => act("net_approve", { id: c.id }), reload)}>Approve and send</button>)}
              {["running", "scheduled", "pending_approval"].includes(c.status) && <button className="a-btn danger sm" onClick={() => confirm("Cancel this campaign?") && run(() => act("net_cancel", { id: c.id }), reload)}>Cancel</button>}
            </div>
          </div>
        );
      }))}
    </>
  );
}

export default function Network({ meId }: { meId: number }) {
  const [sub, setSub] = useState<Sub>("chats");
  const [selected, setSelected] = useState<number[]>([]);
  void api;
  return (
    <>
      <div className="a-filters">
        {([["chats", "Chats"], ["compose", "New post"], ["campaigns", "Campaigns"]] as [Sub, string][]).map(([k, l]) => (
          <button key={k} aria-pressed={sub === k} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {sub === "chats" && <Chats selected={selected} setSelected={setSelected} goCompose={() => setSub("compose")} />}
      {sub === "compose" && <Compose selected={selected} onCreated={() => setSub("campaigns")} />}
      {sub === "campaigns" && <Campaigns meId={meId} />}
    </>
  );
}
