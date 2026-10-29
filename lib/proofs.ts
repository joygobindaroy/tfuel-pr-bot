import { FieldValue } from "firebase-admin/firestore";
import { InlineKeyboard } from "grammy";
import { notifyAchievements } from "./achievements";
import { notifyAdmins } from "./botInstance";
import { getConfig } from "./config";
import { getDb } from "./firebase";
import { lbDoc } from "./leaderboard";
import { sendPhotoToUser } from "./media";
import { sendToUser } from "./notify";
import { incStats } from "./stats";
import { tasksCol, type TaskDoc } from "./tasks";
import { dayKey, displayName, ledger, levelFor, round, usersCol, withDefaults } from "./users";

export type ProofStatus = "pending" | "approved" | "rejected" | "disputed" | "resolved_paid" | "rejected_final";
export type ProofDoc = {
  id: string; taskId: string; userId: number; ownerId: number; botId: string; fileId: string; status: ProofStatus;
  submittedAt: number; autoAt?: number; releaseAt?: number; reason?: string; decidedBy?: string; decidedAt?: number;
  reward: number; cost: number; commission: number; title: string; type: string; payout?: number;
};

export const proofsCol = () => getDb().collection("proofs");
export const REJECT_REASONS = ["The task wasn't completed", "The screenshot is unclear", "Wrong account, post or bot"];
const HOUR = 3_600_000;

/** Worker sends a screenshot: the task's money for that unit moves from "reserved" to "held" until someone decides. */
export async function submitProof(userId: number, taskId: string, fileId: string, botId: string) {
  const cfg = await getConfig();
  const tref = tasksCol().doc(taskId);
  const pref = proofsCol().doc(`${taskId}_${userId}`);
  type R = { ok: true; proof: ProofDoc } | { ok: false; reason: "gone" | "done" | "own" | "unavailable" };
  const res = await getDb().runTransaction(async (t): Promise<R> => {
    const [ts, ps] = await Promise.all([t.get(tref), t.get(pref)]);
    if (!ts.exists) return { ok: false, reason: "gone" };
    if (ps.exists) return { ok: false, reason: "done" };
    const task = ts.data() as TaskDoc;
    if (task.ownerId === userId) return { ok: false, reason: "own" };
    const now = Date.now();
    const today = dayKey(now);
    const dailySpent = task.dailyDay === today ? task.dailySpent : 0;
    if (
      task.status !== "active" || task.remaining <= 0 || task.startAt > now || task.reserved < task.cost ||
      (task.dailyBudget > 0 && dailySpent + task.cost > task.dailyBudget)
    ) return { ok: false, reason: "unavailable" };

    t.update(tref, {
      remaining: task.remaining - 1, reserved: round(task.reserved - task.cost), held: round((task.held ?? 0) + task.cost),
      pending: (task.pending ?? 0) + 1, dailyDay: today, dailySpent: round(dailySpent + task.cost),
    });
    const proof: ProofDoc = {
      id: pref.id, taskId, userId, ownerId: task.ownerId, botId, fileId, status: "pending", submittedAt: now,
      autoAt: now + cfg.tasks.proofAutoApproveHours * HOUR, reward: task.reward, cost: task.cost, commission: task.commission,
      title: task.title, type: task.type,
    };
    t.set(pref, proof);
    return { ok: true, proof };
  });
  if (res.ok) await sendProofToOwner(res.proof);
  return res;
}

async function sendProofToOwner(p: ProofDoc) {
  const cfg = await getConfig();
  const kb = new InlineKeyboard().text("✅ Approve", `pfa:${p.id}`).text("❌ Reject", `pfr:${p.id}`);
  const caption = `📸 New proof\n\nTask: ${p.title}\nWorker: ${p.userId}\n\nApprove or reject it. If you don't answer within ${cfg.tasks.proofAutoApproveHours} hours it is approved automatically.`;
  try {
    await sendPhotoToUser(p.ownerId, p.fileId, p.botId, caption, { reply_markup: kb });
  } catch (e) {
    console.error("proof delivery to promoter failed", e);
    await sendToUser(p.ownerId, `${caption}\n\n(The screenshot could not be shown here. Open the bot with the account that owns the task.)`, { reply_markup: kb });
  }
}

/** Pays the worker. Used by the promoter, by the 24h timer, and by an admin resolving a dispute. */
export async function approveProof(id: string, mode: "owner" | "auto" | "admin") {
  const cfg = await getConfig();
  const pref = proofsCol().doc(id);
  const out = await getDb().runTransaction(async (t) => {
    const ps = await t.get(pref);
    if (!ps.exists) return null;
    const p = ps.data() as ProofDoc;
    if (!["pending", "rejected", "disputed"].includes(p.status)) return null;
    const tref = tasksCol().doc(p.taskId);
    const wref = usersCol().doc(String(p.userId));
    const [ts, ws] = await Promise.all([t.get(tref), t.get(wref)]);
    const task = ts.data() as TaskDoc;
    const w = withDefaults(ws.data());
    const bonus = round((p.reward * levelFor(w.xp, cfg.levels).taskBonus) / 100);
    const payout = round(p.reward + bonus);
    const pendingAfter = Math.max(0, (task.pending ?? 0) - 1);

    t.update(tref, {
      held: round(Math.max(0, (task.held ?? 0) - p.cost)), pending: pendingAfter, spent: round(task.spent + p.cost),
      completed: FieldValue.increment(1),
      status: task.status === "active" && task.remaining <= 0 && pendingAfter === 0 ? "done" : task.status,
    });
    const bal = round(w.balance + payout);
    t.update(wref, { balance: bal, xp: FieldValue.increment(cfg.tasks.xpPerTask), tasksDone: FieldValue.increment(1) });
    t.set(ledger(p.userId).doc(), { amount: payout, type: "task_complete", meta: { taskId: p.taskId, proof: true, bonus }, balanceAfter: bal, createdAt: Date.now() });
    t.set(lbDoc(p.userId), { userId: p.userId, name: displayName(w), earn: FieldValue.increment(payout) }, { merge: true });
    t.update(usersCol().doc(String(p.ownerId)), { proofsApproved: FieldValue.increment(1) });
    t.update(pref, { status: mode === "admin" ? "resolved_paid" : "approved", decidedBy: mode, decidedAt: Date.now(), payout, autoAt: FieldValue.delete(), releaseAt: FieldValue.delete() });
    return { p, payout, bonus };
  });
  if (!out) return null;
  void incStats({ completions: 1, revenue: out.p.commission - out.bonus });
  await sendToUser(out.p.userId, `✅ Your proof for "${out.p.title}" was approved.\n+${out.payout} ${cfg.currency}${mode === "auto" ? "\n(Approved automatically: the promoter didn't answer in time.)" : mode === "admin" ? "\n(An admin settled the dispute in your favour.)" : ""}`);
  void notifyAchievements(out.p.userId);
  return out;
}

/** Promoter rejects. The money stays held until the dispute window ends, so a dispute can still pay the worker. */
export async function rejectProof(id: string, reasonIndex: number) {
  const cfg = await getConfig();
  const reason = REJECT_REASONS[reasonIndex] ?? REJECT_REASONS[0];
  const pref = proofsCol().doc(id);
  const p = await getDb().runTransaction(async (t) => {
    const ps = await t.get(pref);
    if (!ps.exists) return null;
    const d = ps.data() as ProofDoc;
    if (d.status !== "pending") return null;
    t.update(pref, { status: "rejected", reason, decidedBy: "owner", decidedAt: Date.now(), autoAt: FieldValue.delete(), releaseAt: Date.now() + cfg.tasks.disputeHours * HOUR });
    t.update(usersCol().doc(String(d.ownerId)), { proofsRejected: FieldValue.increment(1) });
    return d;
  });
  if (!p) return null;
  const kb = new InlineKeyboard().text("⚖️ Dispute", `pfd:${id}`);
  await sendToUser(p.userId, `❌ Your proof for "${p.title}" was rejected.\nReason: ${reason}\n\nIf you think this is wrong, press Dispute within ${cfg.tasks.disputeHours} hours and an admin will review it.`, { reply_markup: kb });
  return p;
}

export async function disputeProof(id: string, userId: number) {
  const pref = proofsCol().doc(id);
  const p = await getDb().runTransaction(async (t) => {
    const ps = await t.get(pref);
    if (!ps.exists) return null;
    const d = ps.data() as ProofDoc;
    if (d.userId !== userId || d.status !== "rejected") return null;
    t.update(pref, { status: "disputed", disputedAt: Date.now(), releaseAt: FieldValue.delete() });
    return d;
  });
  if (p) await notifyAdmins(`⚖️ New dispute on "${p.title}" (worker ${p.userId}, promoter ${p.ownerId}). Open the admin panel, Disputes.`);
  return p;
}

/** Gives the held money back to the task (rejection stands) and reopens the slot. */
export async function releaseProof(id: string, notifyWorker = false) {
  const pref = proofsCol().doc(id);
  const p = await getDb().runTransaction(async (t) => {
    const ps = await t.get(pref);
    if (!ps.exists) return null;
    const d = ps.data() as ProofDoc;
    if (!["rejected", "disputed"].includes(d.status)) return null;
    const tref = tasksCol().doc(d.taskId);
    const task = (await t.get(tref)).data() as TaskDoc;
    t.update(tref, {
      held: round(Math.max(0, (task.held ?? 0) - d.cost)), reserved: round(task.reserved + d.cost), remaining: task.remaining + 1,
      pending: Math.max(0, (task.pending ?? 0) - 1), status: task.status === "done" ? "active" : task.status,
    });
    t.update(pref, { status: "rejected_final", decidedAt: Date.now(), releaseAt: FieldValue.delete() });
    return d;
  });
  if (p && notifyWorker) await sendToUser(p.userId, `The admin reviewed your dispute for "${p.title}" and kept the rejection.`);
  return p;
}

/** Timers: unanswered proofs are approved, and rejections nobody disputed are released. */
export async function processProofs(deadline: number) {
  const now = Date.now();
  let approved = 0, released = 0;
  for (const d of (await proofsCol().where("autoAt", "<=", now).limit(30).get()).docs) {
    if (Date.now() > deadline) break;
    if (await approveProof(d.id, "auto")) approved++;
  }
  for (const d of (await proofsCol().where("releaseAt", "<=", now).limit(30).get()).docs) {
    if (Date.now() > deadline) break;
    if (await releaseProof(d.id)) released++;
  }
  return { approved, released };
}
