import { getDb } from "./firebase";
import { getConfig } from "./config";
import { ledger, round, usersCol, withDefaults } from "./users";

const checks = () => getDb().collection("checks");

export type CheckDoc = {
  id: string; ownerId: number; amountEach: number; maxClaims: number; claims: number;
  claimedBy: number[]; status: "active" | "cancelled" | "done"; createdAt: number;
};

export async function createCheck(ownerId: number, amountEach: number, maxClaims: number) {
  const cfg = await getConfig();
  if (amountEach < cfg.checks.minAmount || maxClaims < 1 || maxClaims > cfg.checks.maxClaims) throw new Error("bad_input");
  const total = round(amountEach * maxClaims);
  const id = Math.random().toString(36).slice(2, 12);
  const uref = usersCol().doc(String(ownerId));
  await getDb().runTransaction(async (t) => {
    const u = withDefaults((await t.get(uref)).data());
    if (u.balance < total) throw new Error("insufficient_balance");
    const balance = round(u.balance - total);
    t.update(uref, { balance });
    t.set(checks().doc(id), {
      id, ownerId, amountEach, maxClaims, claims: 0, claimedBy: [], status: "active", createdAt: Date.now(),
    } as CheckDoc);
    t.set(ledger(ownerId).doc(), {
      amount: -total, type: "check_create", meta: { id }, balanceAfter: balance, createdAt: Date.now(),
    });
  });
  return { id, total };
}

export async function claimCheck(userId: number, id: string) {
  const cref = checks().doc(id);
  const uref = usersCol().doc(String(userId));
  return getDb().runTransaction(async (t) => {
    const [cs, us] = await Promise.all([t.get(cref), t.get(uref)]);
    if (!cs.exists) return { ok: false as const, reason: "invalid" };
    const c = cs.data() as CheckDoc;
    if (c.status !== "active" || c.claims >= c.maxClaims) return { ok: false as const, reason: "empty" };
    if (c.ownerId === userId) return { ok: false as const, reason: "own" };
    if (c.claimedBy.includes(userId)) return { ok: false as const, reason: "claimed" };
    const u = withDefaults(us.data());
    const balance = round(u.balance + c.amountEach);
    const claims = c.claims + 1;
    t.update(cref, { claims, claimedBy: [...c.claimedBy, userId], status: claims >= c.maxClaims ? "done" : "active" });
    t.update(uref, { balance });
    t.set(ledger(userId).doc(), {
      amount: c.amountEach, type: "check_claim", meta: { id }, balanceAfter: balance, createdAt: Date.now(),
    });
    return { ok: true as const, amount: c.amountEach, ownerId: c.ownerId };
  });
}

export async function myChecks(ownerId: number) {
  const snap = await checks().where("ownerId", "==", ownerId).where("status", "==", "active").limit(10).get();
  return snap.docs.map((d) => d.data() as CheckDoc);
}

export async function cancelCheck(ownerId: number, id: string) {
  const cref = checks().doc(id);
  const uref = usersCol().doc(String(ownerId));
  return getDb().runTransaction(async (t) => {
    const [cs, us] = await Promise.all([t.get(cref), t.get(uref)]);
    if (!cs.exists) throw new Error("not_found");
    const c = cs.data() as CheckDoc;
    if (c.ownerId !== ownerId || c.status !== "active") throw new Error("bad_state");
    const refund = round((c.maxClaims - c.claims) * c.amountEach);
    const balance = round(withDefaults(us.data()).balance + refund);
    t.update(cref, { status: "cancelled" });
    t.update(uref, { balance });
    t.set(ledger(ownerId).doc(), {
      amount: refund, type: "check_refund", meta: { id }, balanceAfter: balance, createdAt: Date.now(),
    });
    return refund;
  });
}
