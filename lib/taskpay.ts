import { FieldValue } from "firebase-admin/firestore";
import type { AppConfig } from "./config";
import { getDb } from "./firebase";
import { createTask, taskPrice, type TaskType } from "./tasks";
import { ledger, round, usersCol, withDefaults } from "./users";

export type TaskDraft = {
  type: TaskType; chatId: number; username: string; title: string; link: string;
  premiumOnly: boolean; reward: number; count: number; countries: string[]; dailyBudget: number; startAt: number;
};

/** Stars needed to pay a TFUEL total directly (cheaper than paying from balance by starsDiscountPct). */
export const starsFor = (total: number, cfg: AppConfig) =>
  Math.max(1, Math.ceil((total * (1 - cfg.tasks.starsDiscountPct / 100)) / cfg.deposit.rate));

export function quote(d: TaskDraft, cfg: AppConfig) {
  const p = taskPrice(d.type, cfg, { premium: d.premiumOnly, targeted: d.countries.length > 0, reward: d.reward });
  const total = round(p.cost * d.count);
  return { ...p, total, stars: starsFor(total, cfg) };
}

const drafts = () => getDb().collection("task_drafts");

type DraftDoc = { id: string; ownerId: number; botId: string; draft: TaskDraft; total: number; stars: number; status: string; expiresAt: number };

export async function saveDraft(ownerId: number, botId: string, draft: TaskDraft, total: number, stars: number) {
  const id = Math.random().toString(36).slice(2, 12);
  await drafts().doc(id).set({ id, ownerId, botId, draft, total, stars, status: "open", expiresAt: Date.now() + 30 * 60_000, createdAt: Date.now() });
  return id;
}

export async function readDraft(id: string) {
  const s = await drafts().doc(id).get();
  return s.exists ? (s.data() as DraftDoc) : null;
}

/** Stars landed for a task draft: create the task. If that is impossible, the Stars value goes to the balance instead. */
export async function payDraftWithStars(draftId: string, userId: number, chargeId: string, stars: number) {
  const dr = await readDraft(draftId);
  if (!dr || dr.ownerId !== userId) return { ok: false as const, reason: "missing" as const };
  if (dr.status !== "open") return { ok: true as const, duplicate: true as const };
  try {
    const r = await createTask({ ownerId: userId, ...dr.draft, botId: dr.botId, paid: { chargeId, stars } });
    await drafts().doc(draftId).update({ status: "paid", taskId: r.id });
    return { ok: true as const, duplicate: false as const, taskId: r.id, total: r.total, stars };
  } catch (e) {
    if (String((e as Error).message) === "duplicate") return { ok: true as const, duplicate: true as const };
    await creditStarsValue(userId, chargeId, stars, dr.total);
    await drafts().doc(draftId).update({ status: "fallback_credited" });
    return { ok: false as const, reason: "credited" as const, total: dr.total, error: String((e as Error).message) };
  }
}

async function creditStarsValue(userId: number, chargeId: string, stars: number, total: number) {
  const payRef = getDb().collection("payments").doc(chargeId);
  const uref = usersCol().doc(String(userId));
  await getDb().runTransaction(async (t) => {
    const [p, u] = await Promise.all([t.get(payRef), t.get(uref)]);
    if (p.exists) return;
    const bal = round(withDefaults(u.data()).balance + total);
    t.update(uref, { balance: bal, depositedStars: FieldValue.increment(stars) });
    t.set(payRef, { userId, stars, total, status: "credited", method: "stars", purpose: "task_fallback", createdAt: Date.now() });
    t.set(ledger(userId).doc(), { amount: total, type: "deposit_stars", meta: { stars, chargeId, fallback: true }, balanceAfter: bal, createdAt: Date.now() });
  });
}
