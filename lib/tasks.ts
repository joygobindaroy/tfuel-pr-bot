import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { notifyAdmins } from "./botInstance";
import { apiFor } from "./bots";
import { leaveWarning } from "./leave";
import { sendToUser } from "./notify";
import { getConfig, type AppConfig } from "./config";
import { getDb } from "./firebase";
import { lbDoc } from "./leaderboard";
import { incStats } from "./stats";
import { dayKey, displayName, ledger, levelFor, round, usersCol, withDefaults } from "./users";

export type TaskType = "channel" | "group" | "post" | "bot" | "reaction";
/** Join-and-stay tasks are checked for leaving; post views are instant; bot starts and reactions need a screenshot proof. */
export const RETAINED_TYPES: TaskType[] = ["channel", "group"];
export const PROOF_TYPES: TaskType[] = ["bot", "reaction"];
export type TaskMeta = { fromChatId?: number; messageId?: number; postLink?: string; instruction?: string; botUsername?: string };
export type TaskStatus = "active" | "paused" | "done" | "cancelled";

export type TaskDoc = {
  id: string;
  ownerId: number;
  type: TaskType;
  chatId: number;
  username: string;
  title: string;
  link: string;
  reward: number;
  commission: number;
  cost: number;
  total: number;
  remaining: number;
  completed: number;
  reserved: number;
  spent: number;
  status: TaskStatus;
  startAt: number;
  dailyBudget: number;
  dailySpent: number;
  dailyDay: string;
  countries: string[];
  reports: number;
  leaves: number;
  createdAt: number;
  pauseReason?: string;
  botId?: string;
  premiumOnly?: boolean;
  meta?: TaskMeta;
  held?: number;
  pending?: number;
};

export const tasksCol = () => getDb().collection("tasks");
const compCol = () => getDb().collection("completions");
const DAY = 86_400_000;

export function taskPrice(
  type: TaskType, cfg: AppConfig,
  opts: { premium?: boolean; targeted?: boolean; reward?: number } = {}
) {
  const base = opts.premium ? cfg.tasks[type].premiumReward : cfg.tasks[type].reward;
  const min = round(base + (opts.targeted ? cfg.tasks.targetingFee : 0));
  const reward = opts.reward && opts.reward > min ? round(opts.reward) : min;
  const commission = round((reward * cfg.tasks.commissionPct) / 100);
  return { reward, commission, cost: round(reward + commission), min, recommended: round(min * cfg.tasks.recommendedMult) };
}

export async function getTask(id: string) {
  const s = await tasksCol().doc(id).get();
  return s.exists ? (s.data() as TaskDoc) : null;
}

/* ---------------- membership ---------------- */

export type Mem = { status: "member" | "left" | "error"; fatal: boolean };

export async function membership(chatId: number, userId: number, botId?: string | null): Promise<Mem> {
  try {
    const m = await (await apiFor(botId)).getChatMember(chatId, userId);
    if (["creator", "administrator", "member"].includes(m.status)) return { status: "member", fatal: false };
    if (m.status === "restricted" && (m as { is_member?: boolean }).is_member) return { status: "member", fatal: false };
    return { status: "left", fatal: false };
  } catch (e) {
    const msg = String((e as Error).message || "");
    console.error("getChatMember", chatId, msg);
    return { status: "error", fatal: /chat not found|kicked|forbidden|not enough rights|chat_admin_required/i.test(msg) };
  }
}

/** Bot lost access to the chat: pause the task and tell the owner. */
export async function pauseTaskFatal(taskId: string) {
  const ref = tasksCol().doc(taskId);
  const s = await ref.get();
  if (!s.exists) return;
  const t = s.data() as TaskDoc;
  if (t.status !== "active") return;
  await ref.update({ status: "paused", pauseReason: "bot_lost_access" });
  await sendToUser(t.ownerId, `⏸ Your task "${t.title}" was paused: the bot can no longer access ${t.link}. Add the bot as admin again, then resume it.`);
}

/* ---------------- create / manage ---------------- */

export type NewTask = {
  ownerId: number; type: TaskType; chatId: number; username: string; title: string;
  count: number; countries: string[]; dailyBudget: number; startAt: number;
  botId?: string; premiumOnly?: boolean; link?: string; reward?: number; meta?: TaskMeta;
  /** Paid directly in Telegram Stars: no balance is needed, the Stars value is booked as a deposit and spent at once. */
  paid?: { chargeId: string; stars: number };
};

export async function createTask(p: NewTask) {
  const cfg = await getConfig();
  const price = taskPrice(p.type, cfg, { premium: !!p.premiumOnly, targeted: p.countries.length > 0, reward: p.reward });
  if (p.count < cfg.tasks.minActions || p.count > cfg.tasks.maxActions) throw new Error("bad_count");
  const active = await tasksCol().where("ownerId", "==", p.ownerId).where("status", "==", "active").count().get();
  if (active.data().count >= cfg.tasks.maxActiveTasksPerUser) throw new Error("too_many_tasks");

  const total = round(price.cost * p.count);
  const ref = tasksCol().doc();
  const uref = usersCol().doc(String(p.ownerId));
  const payRef = p.paid ? getDb().collection("payments").doc(p.paid.chargeId) : null;

  await getDb().runTransaction(async (t) => {
    const [us, pay] = await Promise.all([t.get(uref), payRef ? t.get(payRef) : Promise.resolve(null)]);
    if (pay?.exists) throw new Error("duplicate");
    const u = withDefaults(us.data());
    const now = Date.now();
    if (!p.paid && u.balance < total) throw new Error("insufficient_balance");

    const doc: TaskDoc = {
      id: ref.id, ownerId: p.ownerId, type: p.type, chatId: p.chatId, username: p.username,
      title: p.title, link: p.link || `https://t.me/${p.username.replace(/^@/, "")}`,
      reward: price.reward, commission: price.commission, cost: price.cost,
      total: p.count, remaining: p.count, completed: 0, reserved: total, spent: 0, status: "active",
      startAt: p.startAt, dailyBudget: p.dailyBudget, dailySpent: 0, dailyDay: "", countries: p.countries,
      reports: 0, leaves: 0, createdAt: now,
      botId: p.botId ?? "", premiumOnly: !!p.premiumOnly, meta: p.meta ?? {}, held: 0, pending: 0,
    };
    t.set(ref, doc);

    if (p.paid && payRef) {
      t.set(payRef, { userId: p.ownerId, stars: p.paid.stars, total, status: "credited", method: "stars", purpose: "task", taskId: ref.id, createdAt: now });
      t.update(uref, { depositedStars: FieldValue.increment(p.paid.stars) });
      t.set(ledger(p.ownerId).doc(), { amount: total, type: "deposit_stars", meta: { stars: p.paid.stars, chargeId: p.paid.chargeId, forTask: ref.id }, balanceAfter: u.balance + total, createdAt: now });
      t.set(ledger(p.ownerId).doc(), { amount: -total, type: "task_create", meta: { taskId: ref.id, count: p.count, paidWith: "stars" }, balanceAfter: u.balance, createdAt: now + 1 });
    } else {
      const balance = round(u.balance - total);
      t.update(uref, { balance });
      t.set(ledger(p.ownerId).doc(), { amount: -total, type: "task_create", meta: { taskId: ref.id, count: p.count }, balanceAfter: balance, createdAt: now });
    }
  });
  return { id: ref.id, total, reward: price.reward, commission: price.commission, cost: price.cost };
}

export async function myTasks(ownerId: number) {
  const snap = await tasksCol().where("ownerId", "==", ownerId).limit(40).get();
  return snap.docs.map((d) => d.data() as TaskDoc).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
}

export async function setTaskStatus(
  taskId: string,
  actor: { id: number; admin: boolean },
  action: "pause" | "resume" | "cancel"
) {
  const ref = tasksCol().doc(taskId);
  return getDb().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new Error("not_found");
    const task = s.data() as TaskDoc;
    if (task.ownerId !== actor.id && !actor.admin) throw new Error("forbidden");

    if (action === "pause") {
      if (task.status !== "active") throw new Error("bad_state");
      t.update(ref, { status: "paused", pauseReason: actor.admin ? "admin" : "owner" });
      return { status: "paused" as const, refund: 0 };
    }
    if (action === "resume") {
      if (task.status !== "paused" || task.remaining <= 0 || task.reserved < task.cost) throw new Error("bad_state");
      t.update(ref, { status: "active", pauseReason: FieldValue.delete() });
      return { status: "active" as const, refund: 0 };
    }
    if (task.status === "cancelled") throw new Error("bad_state");
    const uref = usersCol().doc(String(task.ownerId));
    const u = withDefaults((await t.get(uref)).data());
    const refund = round(task.reserved);
    t.update(ref, { status: "cancelled", reserved: 0, remaining: 0 });
    if (refund > 0) {
      const balance = round(u.balance + refund);
      t.update(uref, { balance });
      t.set(ledger(task.ownerId).doc(), {
        amount: refund, type: "task_refund", meta: { taskId }, balanceAfter: balance, createdAt: Date.now(),
      });
    }
    return { status: "cancelled" as const, refund };
  });
}

export async function addActions(taskId: string, ownerId: number, n: number) {
  const cfg = await getConfig();
  const ref = tasksCol().doc(taskId);
  const uref = usersCol().doc(String(ownerId));
  return getDb().runTransaction(async (t) => {
    const [ts, us] = await Promise.all([t.get(ref), t.get(uref)]);
    if (!ts.exists) throw new Error("not_found");
    const task = ts.data() as TaskDoc;
    if (task.ownerId !== ownerId || task.status === "cancelled") throw new Error("forbidden");
    if (task.total + n > cfg.tasks.maxActions) throw new Error("bad_count");
    const cost = round(task.cost * n);
    const u = withDefaults(us.data());
    if (u.balance < cost) throw new Error("insufficient_balance");
    const balance = round(u.balance - cost);
    t.update(uref, { balance });
    t.update(ref, {
      remaining: task.remaining + n, total: task.total + n, reserved: round(task.reserved + cost),
      status: task.status === "done" ? "active" : task.status,
    });
    t.set(ledger(ownerId).doc(), {
      amount: -cost, type: "task_extend", meta: { taskId, n }, balanceAfter: balance, createdAt: Date.now(),
    });
    return { cost, balance };
  });
}

/* ---------------- earning side ---------------- */

export async function countActive(type: TaskType) {
  const r = await tasksCol().where("status", "==", "active").where("type", "==", type).count().get();
  return r.data().count;
}

export async function findTasks(user: ReturnType<typeof withDefaults>, type: TaskType): Promise<TaskDoc[]> {
  const snap = await tasksCol().where("status", "==", "active").where("type", "==", type).limit(80).get();
  const now = Date.now();
  const today = dayKey(now);
  const list = snap.docs
    .map((d) => d.data() as TaskDoc)
    .filter(
      (t) =>
        t.ownerId !== user.id && t.remaining > 0 && t.startAt <= now && t.reserved >= t.cost &&
        (!t.premiumOnly || user.isPremium) &&
        (t.countries.length === 0 || (user.countryTrusted && t.countries.includes(user.country || ""))) &&
        (t.dailyBudget === 0 || t.dailyDay !== today || t.dailySpent + t.cost <= t.dailyBudget)
    )
    // higher reward = shown sooner, with some randomness so everyone gets a turn
    .map((t) => ({ t, k: t.reward * (0.75 + Math.random() * 0.5) }))
    .sort((x, y) => y.k - x.k)
    .map((x) => x.t)
    .slice(0, 15);
  if (!list.length) return [];

  const db = getDb();
  const refs = list.flatMap((t) => [
    compCol().doc(`${t.id}_${user.id}`),
    db.collection("reports").doc(`${t.id}_${user.id}`),
    db.collection("proofs").doc(`${t.id}_${user.id}`),
  ]);
  const seen = new Set((await db.getAll(...refs)).filter((s) => s.exists).map((s) => s.id));
  return list.filter((t) => !seen.has(`${t.id}_${user.id}`)).slice(0, 5);
}

type CompleteResult =
  | { ok: true; payout: number; balance: number; title: string; ownerId: number; finished: boolean; commission: number; bonus: number }
  | { ok: false; reason: "gone" | "done" | "unavailable" | "own" };

export async function completeTask(userId: number, taskId: string): Promise<CompleteResult> {
  const cfg = await getConfig();
  const tref = tasksCol().doc(taskId);
  const uref = usersCol().doc(String(userId));
  const cref = compCol().doc(`${taskId}_${userId}`);

  const res = await getDb().runTransaction(async (t): Promise<CompleteResult> => {
    const [ts, us, cs] = await Promise.all([t.get(tref), t.get(uref), t.get(cref)]);
    if (!ts.exists) return { ok: false, reason: "gone" };
    if (cs.exists) return { ok: false, reason: "done" };
    const task = ts.data() as TaskDoc;
    const user = withDefaults(us.data());
    if (task.ownerId === userId) return { ok: false, reason: "own" };

    const now = Date.now();
    const today = dayKey(now);
    const dailySpent = task.dailyDay === today ? task.dailySpent : 0;
    if (
      task.status !== "active" || task.remaining <= 0 || task.startAt > now || task.reserved < task.cost ||
      (task.dailyBudget > 0 && dailySpent + task.cost > task.dailyBudget)
    ) return { ok: false, reason: "unavailable" };

    const lv = levelFor(user.xp, cfg.levels);
    const bonus = round((task.reward * lv.taskBonus) / 100);
    const payout = round(task.reward + bonus);
    const remaining = task.remaining - 1;

    t.update(tref, {
      remaining, completed: FieldValue.increment(1), reserved: round(task.reserved - task.cost),
      spent: round(task.spent + task.cost), dailyDay: today, dailySpent: round(dailySpent + task.cost),
      status: remaining === 0 ? "done" : task.status,
    });
    const balance = round(user.balance + payout);
    t.update(uref, {
      balance, xp: FieldValue.increment(cfg.tasks.xpPerTask),
      tasksDone: FieldValue.increment(1), tasksSinceCaptcha: FieldValue.increment(1),
    });
    t.set(cref, {
      taskId, userId, ownerId: task.ownerId, chatId: task.chatId, botId: task.botId ?? "", title: task.title, reward: task.reward,
      cost: task.cost, commission: task.commission, payout, joinedAt: now, status: "active", ...(RETAINED_TYPES.includes(task.type) ? { nextCheckAt: now + 15 * 60_000 } : {}),
    });
    t.set(ledger(userId).doc(), {
      amount: payout, type: "task_complete", meta: { taskId, bonus }, balanceAfter: balance, createdAt: now,
    });
    t.set(lbDoc(userId), { userId, name: displayName(user), earn: FieldValue.increment(payout) }, { merge: true });
    return { ok: true, payout, balance, title: task.title, ownerId: task.ownerId, finished: remaining === 0, commission: task.commission, bonus };
  });

  if (res.ok) {
    void incStats({ completions: 1, revenue: res.commission - res.bonus });
    if (res.finished) {
      const owner = await usersCol().doc(String(res.ownerId)).get();
      if (owner.exists && withDefaults(owner.data()).notif.tasks) {
        await sendToUser(res.ownerId, `✅ Your task "${res.title}" is complete.`);
      }
    }
  }
  return res;
}

export async function reportTask(userId: number, taskId: string) {
  const cfg = await getConfig();
  const rref = getDb().collection("reports").doc(`${taskId}_${userId}`);
  const tref = tasksCol().doc(taskId);
  const out = await getDb().runTransaction(async (t) => {
    const [rs, ts] = await Promise.all([t.get(rref), t.get(tref)]);
    if (rs.exists || !ts.exists) return null;
    const task = ts.data() as TaskDoc;
    const reports = task.reports + 1;
    const pause = reports >= cfg.tasks.autoPauseReports && task.status === "active";
    t.set(rref, { taskId, userId, at: Date.now() });
    t.update(tref, { reports, ...(pause ? { status: "paused", pauseReason: "reports" } : {}) });
    return { pause, task, reports };
  });
  if (out?.pause) {
    await sendToUser(out.task.ownerId, `⏸ Your task "${out.task.title}" was paused after ${out.reports} reports. Contact support.`);
    await notifyAdmins(`⚠️ Task ${taskId} auto-paused after ${out.reports} reports (${out.task.link}).`);
  }
  return out;
}

/* ---------------- retention (leave within N days) ---------------- */

export async function applyLeave(compId: string) {
  const cfg = await getConfig();
  const cref = compCol().doc(compId);
  const out = await getDb().runTransaction(async (t) => {
    const cs = await t.get(cref);
    if (!cs.exists || !["active", "grace"].includes(cs.data()!.status)) return null;
    const c = cs.data() as { taskId: string; userId: number; payout: number; cost: number; title: string };
    const tref = tasksCol().doc(c.taskId);
    const uref = usersCol().doc(String(c.userId));
    const [ts, us] = await Promise.all([t.get(tref), t.get(uref)]);
    const user = withDefaults(us.data());
    const penalty = Math.min(user.balance, round(c.payout * cfg.tasks.penaltyMultiplier));

    t.update(cref, { status: "left", nextCheckAt: FieldValue.delete(), graceUntil: FieldValue.delete(), leftAt: Date.now(), penalty });
    t.update(uref, { balance: round(user.balance - penalty), penalties: FieldValue.increment(1) });
    if (penalty > 0) {
      t.set(ledger(c.userId).doc(), {
        amount: -penalty, type: "retention_penalty", meta: { taskId: c.taskId },
        balanceAfter: round(user.balance - penalty), createdAt: Date.now(),
      });
    }
    let refilled = false;
    if (ts.exists) {
      const task = ts.data() as TaskDoc;
      const patch: Record<string, unknown> = { leaves: FieldValue.increment(1) };
      if (task.status !== "cancelled") {
        patch.remaining = task.remaining + 1;
        patch.reserved = round(task.reserved + c.cost);
        if (task.status === "done") patch.status = "active";
        refilled = true;
      }
      t.update(tref, patch);
    }
    return { ...c, penalty, refilled };
  });
  if (!out) return;
  void incStats({ revenue: out.penalty - out.cost, penalties: 1, leaves: 1 });
  await sendToUser(
    out.userId,
    `⛔ You didn't rejoin "${out.title}" in time.\n${out.penalty} ${cfg.currency} was taken from your balance. Stay subscribed for ${cfg.tasks.retentionDays} days to keep your rewards.`
  );
}

async function handleCompletion(d: QueryDocumentSnapshot, retentionMs: number) {
  const c = d.data() as { chatId: number; userId: number; taskId: string; joinedAt: number; botId?: string };
  try {
    const m = await membership(c.chatId, c.userId, c.botId);
    if (m.status === "error") {
      if (m.fatal) await pauseTaskFatal(c.taskId);
      await d.ref.update({ nextCheckAt: Date.now() + 6 * 3600_000 });
    } else if (m.status === "left") {
      await startGrace(d.id);
    } else if (Date.now() >= c.joinedAt + retentionMs) {
      await d.ref.update({ status: "retained", nextCheckAt: FieldValue.delete() });
    } else {
      await d.ref.update({ nextCheckAt: Date.now() + DAY });
    }
  } catch (e) {
    console.error("retention item failed", d.id, e);
    await d.ref.update({ nextCheckAt: Date.now() + 3600_000 }).catch(() => {});
  }
}

export async function processRetention(deadline: number) {
  const cfg = await getConfig();
  const retentionMs = cfg.tasks.retentionDays * DAY;
  let processed = 0;
  while (Date.now() < deadline) {
    const snap = await compCol().where("nextCheckAt", "<=", Date.now()).limit(50).get();
    if (snap.empty) return { processed, more: false };
    for (let i = 0; i < snap.docs.length; i += 10) {
      if (Date.now() >= deadline) return { processed, more: true };
      const chunk = snap.docs.slice(i, i + 10);
      await Promise.all(chunk.map((d) => handleCompletion(d, retentionMs)));
      processed += chunk.length;
    }
  }
  return { processed, more: true };
}

/**
 * Real-time leave detection: Telegram tells us (chat_member update) the moment someone leaves a chat where the
 * bot is admin. If they completed a task there inside the retention window, apply the penalty right away.
 */
export async function leaveNow(chatId: number, userId: number) {
  const cfg = await getConfig();
  const snap = await compCol().where("chatId", "==", chatId).where("userId", "==", userId).limit(10).get();
  for (const d of snap.docs) {
    const c = d.data() as { status: string; joinedAt: number };
    if (c.status !== "active") continue;
    if (Date.now() >= c.joinedAt + cfg.tasks.retentionDays * DAY) {
      await d.ref.update({ status: "retained", nextCheckAt: FieldValue.delete() });
      continue;
    }
    await startGrace(d.id);
  }
}

/* ---------- grace period: warn, let them rejoin, cut only if they don't ---------- */

/** First detection of a leave: pause the penalty, tell the worker how to fix it. */
export async function startGrace(compId: string) {
  const cfg = await getConfig();
  const cref = compCol().doc(compId);
  const c = await getDb().runTransaction(async (t) => {
    const s = await t.get(cref);
    if (!s.exists || s.data()!.status !== "active") return null;
    t.update(cref, { status: "grace", graceAt: Date.now(), graceUntil: Date.now() + cfg.tasks.graceHours * 3_600_000, nextCheckAt: FieldValue.delete() });
    return s.data() as { taskId: string; userId: number; payout: number; title: string };
  });
  if (!c) return;
  const task = await getTask(c.taskId);
  const w = leaveWarning({
    title: c.title, payout: c.payout, penalty: round(c.payout * cfg.tasks.penaltyMultiplier), currency: cfg.currency,
    retentionDays: cfg.tasks.retentionDays, graceHours: cfg.tasks.graceHours, link: task?.link ?? "", compId,
  });
  await sendToUser(c.userId, w.text, { parse_mode: "HTML", reply_markup: w.kb, link_preview_options: { is_disabled: true } });
}

/** "Check again" pressed: if they are back in the chat the reward stays and monitoring resumes. */
export async function restoreFromGrace(compId: string, userId: number): Promise<"restored" | "still_left" | "invalid" | "error"> {
  const cref = compCol().doc(compId);
  const s = await cref.get();
  const c = s.data() as { userId: number; status: string; chatId: number; botId?: string } | undefined;
  if (!c || c.userId !== userId || c.status !== "grace") return "invalid";
  const m = await membership(c.chatId, userId, c.botId);
  if (m.status === "error") return "error";
  if (m.status !== "member") return "still_left";
  await cref.update({ status: "active", graceUntil: FieldValue.delete(), nextCheckAt: Date.now() + 3_600_000, rejoinedAt: Date.now() });
  return "restored";
}

/** Telegram says someone (re)joined: if they were in a grace period for that chat, restore them on the spot. */
export async function restoreOnRejoin(chatId: number, userId: number) {
  const snap = await compCol().where("chatId", "==", chatId).where("userId", "==", userId).limit(10).get();
  for (const d of snap.docs) {
    const c = d.data() as { status: string; title: string };
    if (c.status !== "grace") continue;
    await d.ref.update({ status: "active", graceUntil: FieldValue.delete(), nextCheckAt: Date.now() + 3_600_000, rejoinedAt: Date.now() });
    await sendToUser(userId, `✅ Welcome back to ${c.title}. Your reward is safe.`);
  }
}

/** Grace periods that ran out: restore if they quietly came back, otherwise apply the penalty. */
export async function processGrace(deadline: number) {
  const snap = await compCol().where("graceUntil", "<=", Date.now()).limit(50).get();
  let n = 0;
  for (const d of snap.docs) {
    if (Date.now() > deadline) break;
    const c = d.data() as { chatId: number; userId: number; botId?: string; title: string };
    try {
      const m = await membership(c.chatId, c.userId, c.botId);
      if (m.status === "error") { await d.ref.update({ graceUntil: Date.now() + 3_600_000 }); }
      else if (m.status === "member") {
        await d.ref.update({ status: "active", graceUntil: FieldValue.delete(), nextCheckAt: Date.now() + 3_600_000, rejoinedAt: Date.now() });
        await sendToUser(c.userId, `✅ Welcome back to ${c.title}. Your reward is safe.`);
      } else await applyLeave(d.id);
    } catch (e) {
      console.error("grace item failed", d.id, e);
      await d.ref.update({ graceUntil: Date.now() + 3_600_000 }).catch(() => {});
    }
    n++;
  }
  return { processed: n, more: snap.size >= 50 };
}
