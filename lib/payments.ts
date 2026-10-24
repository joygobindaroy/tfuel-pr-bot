import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase";
import type { AppConfig } from "./config";
import { ledger, usersCol, withDefaults, round } from "./users";

export function depositQuote(stars: number, cfg: AppConfig) {
  const base = stars * cfg.deposit.rate;
  let pct = 0;
  for (const t of cfg.deposit.bonusTiers) if (stars >= t.minStars) pct = Math.max(pct, t.percent);
  const bonus = Math.floor((base * pct) / 100);
  return { base, bonus, pct, total: base + bonus };
}

export function usdtQuote(usdt: number, cfg: AppConfig) {
  const base = round(usdt * cfg.usdt.rate);
  let pct = 0;
  for (const t of cfg.usdt.bonusTiers) if (usdt >= t.minUsdt) pct = Math.max(pct, t.percent);
  const bonus = Math.floor((base * pct) / 100);
  return { base, bonus, pct, total: round(base + bonus) };
}

/** Credits a Stars payment exactly once (charge id = document id). */
export async function creditDeposit(userId: number, stars: number, chargeId: string, cfg: AppConfig) {
  const db = getDb();
  const payRef = db.collection("payments").doc(chargeId);
  const userRef = usersCol().doc(String(userId));
  const q = depositQuote(stars, cfg);

  return db.runTransaction(async (t) => {
    const [pay, user] = await Promise.all([t.get(payRef), t.get(userRef)]);
    if (pay.exists) return { duplicate: true as const };
    const now = Date.now();
    if (!user.exists) {
      t.set(payRef, { userId, stars, ...q, rate: cfg.deposit.rate, status: "orphan", createdAt: now });
      throw new Error("user_missing");
    }
    const balance = round(withDefaults(user.data()).balance + q.total);
    t.update(userRef, { balance, depositedStars: FieldValue.increment(stars) });
    t.set(payRef, { userId, stars, ...q, rate: cfg.deposit.rate, status: "credited", method: "stars", createdAt: now });
    t.set(ledger(userId).doc(), {
      amount: q.total, type: "deposit_stars",
      meta: { stars, chargeId, bonus: q.bonus, bonusPercent: q.pct }, balanceAfter: balance, createdAt: now,
    });
    return { duplicate: false as const, ...q, balance };
  });
}
