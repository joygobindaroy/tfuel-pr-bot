import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { bot, notifyAdmins } from "./botInstance";
import { getConfig, type AppConfig } from "./config";
import { getDb } from "./firebase";
import { lbDoc } from "./leaderboard";
import { incStats } from "./stats";
import { dayKey, displayName, ledger, levelFor, round, usersCol, withDefaults } from "./users";

export type TaskType = "channel" | "group";
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
};

export const tasksCol = () => getDb().collection("tasks");
const compCol = () => getDb().collection("completions");
const DAY = 86_400_000;

export function taskPrice(type: TaskType, cfg: AppConfig) {
  const reward = cfg.tasks[type].reward;
  const commission = round((reward * cfg.tasks.commissionPct) / 100);
  return { reward, commission, cost: round(reward + commission) };
}

export async function getTask(id: string) {
  const s = await tasksCol().doc(id).get();
  return s.exists ? (s.data() as TaskDoc) : null;
}

/* ---------------- membership ---------------- */

export type Mem = { status: "member" | "left" | "error"; fatal: boolean };

export async function membership(chatId: number, userId: number): Promise<Mem> {
  try {
    const m = await bot.api.getChatMember(chatId, userId);
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
  await bot.api
    .sendMessage(t.ownerId, `⏸ Your task "${t.title}" was paused: the bot can no longer access ${t.link}. Add the bot as admin again, then resume it.`)
    .catch(() => {});
}

/* ---------------- create / manage ---------------- */

export type NewTask = {
  ownerId: number; type: TaskType; chatId: number; username: string; title: string;
  count: number; countries: string[]; dailyBudget: number; startAt: number;
};

export async function createTask(p: NewTask) {
  const cfg = await getConfig();
  const price = taskPrice(p.type, cfg);
  if (p.count < cfg.tasks.minActions || p.count > cfg.tasks.maxActions) throw new Error("bad_count");
  const active = await tasksCol().where("ownerId", "==", p.ownerId).where("status", "==", "active").count().get();
  if (active.data().count >= cfg.tasks.maxActiveTasksPerUser) throw new Error("too_many_tasks");

  const total = round(price.cost * p.count);
  const ref = tasksCol().doc();
  const uref = usersCol().doc(String(p.ownerId));
  await getDb().runTransaction(async (t) => {
    const u = withDefaults((await t.get(uref)).data());
    if (u.balance < total) throw new Error("insufficient_balance");
    const balance = round(u.balance - total);
    t.update(uref, { balance });
    const doc: TaskDoc = {
      id: ref.id, ownerId: p.ownerId, type: p.type, chatId: p.chatId, username: p.username,
      title: p.title, link: `https://t.me/${p.username.replace(/^@/, "")}`, ...price,
      total: p.count, remaining: p.count, completed: 0, reserved: total, spent: 0, status: "active",
      startAt: p.startAt, dailyBudget: p.dailyBudget, dailySpent: 0, dailyDay: "", countries: p.countries,
      reports: 0, leaves: 0, createdAt: Date.now(),
    };
    t.set(ref, doc);
    t.set(ledger(p.ownerId).doc(), {
      amount: -total, type: "task_create", meta: { taskId: ref.id, count: p.count }, balanceAfter: balance, createdAt: Date.now(),
    });
  });
  return { id: ref.id, total, ...price };
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
        (t.countries.length === 0 || (user.countryTrusted && t.countries.includes(user.country || ""))) &&
        (t.dailyBudget === 0 || t.dailyDay !== today || t.dailySpent + t.cost <= t.dailyBudget)
    )
    .sort(() => Math.random() - 0.5)
    .slice(0, 15);
  if (!list.length) return [];

  const db = getDb();
  const refs = list.flatMap((t) => [
    compCol().doc(`${t.id}_${user.id}`),
    db.collection("reports").doc(`${t.id}_${user.id}`),
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
      taskId, userId, ownerId: task.ownerId, chatId: task.chatId, title: task.title, reward: task.reward,
      cost: task.cost, commission: task.commission, payout, joinedAt: now, status: "active", nextCheckAt: now + DAY,
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
        await bot.api.sendMessage(res.ownerId, `✅ Your task "${res.title}" is complete.`).catch(() => {});
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
    await bot.api.sendMessage(out.task.ownerId, `⏸ Your task "${out.task.title}" was paused after ${out.reports} reports. Contact support.`).catch(() => {});
    await notifyAdmins(`⚠️ Task ${taskId} auto-paused after ${out.reports} reports (${out.task.link}).`);
  }
  return out;
}

/* ---------------- retention (leave within N days) ---------------- */

async function applyLeave(compId: string) {
  const cfg = await getConfig();
  const cref = compCol().doc(compId);
  const out = await getDb().runTransaction(async (t) => {
    const cs = await t.get(cref);
    if (!cs.exists || cs.data()!.status !== "active") return null;
    const c = cs.data() as { taskId: string; userId: number; payout: number; cost: number; title: string };
    const tref = tasksCol().doc(c.taskId);
    const uref = usersCol().doc(String(c.userId));
    const [ts, us] = await Promise.all([t.get(tref), t.get(uref)]);
    const user = withDefaults(us.data());
    const penalty = Math.min(user.balance, round(c.payout * cfg.tasks.penaltyMultiplier));

    t.update(cref, { status: "left", nextCheckAt: FieldValue.delete(), leftAt: Date.now(), penalty });
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
  await bot.api
    .sendMessage(
      out.userId,
      `⚠️ You left "${out.title}" before ${cfg.tasks.retentionDays} days. Penalty: -${out.penalty} ${cfg.currency}. Stay subscribed to keep your rewards.`
    )
    .catch(() => {});
}

async function handleCompletion(d: QueryDocumentSnapshot, retentionMs: number) {
  const c = d.data() as { chatId: number; userId: number; taskId: string; joinedAt: number };
  try {
    const m = await membership(c.chatId, c.userId);
    if (m.status === "error") {
      if (m.fatal) await pauseTaskFatal(c.taskId);
      await d.ref.update({ nextCheckAt: Date.now() + 6 * 3600_000 });
    } else if (m.status === "left") {
      await applyLeave(d.id);
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
