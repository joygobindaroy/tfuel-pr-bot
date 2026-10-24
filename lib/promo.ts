import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase";
import { ledger, round, usersCol, withDefaults } from "./users";

const promos = () => getDb().collection("promos");

export async function redeemPromo(userId: number, raw: string) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return { ok: false as const, reason: "invalid" };
  const pref = promos().doc(code);
  const rref = getDb().collection("promo_redemptions").doc(`${code}_${userId}`);
  const uref = usersCol().doc(String(userId));
  return getDb().runTransaction(async (t) => {
    const [ps, rs, us] = await Promise.all([t.get(pref), t.get(rref), t.get(uref)]);
    if (!ps.exists) return { ok: false as const, reason: "invalid" };
    const p = ps.data() as { reward: number; maxUses: number; uses: number; expiresAt: number | null; active: boolean };
    if (!p.active || (p.expiresAt && p.expiresAt < Date.now())) return { ok: false as const, reason: "expired" };
    if (rs.exists) return { ok: false as const, reason: "used" };
    if (p.uses >= p.maxUses) return { ok: false as const, reason: "limit" };
    const u = withDefaults(us.data());
    const balance = round(u.balance + p.reward);
    t.update(pref, { uses: FieldValue.increment(1) });
    t.set(rref, { code, userId, at: Date.now() });
    t.update(uref, { balance });
    t.set(ledger(userId).doc(), {
      amount: p.reward, type: "promo", meta: { code }, balanceAfter: balance, createdAt: Date.now(),
    });
    return { ok: true as const, reward: p.reward, balance };
  });
}

export async function createPromo(code: string, reward: number, maxUses: number, days: number | null) {
  const id = code.toUpperCase();
  await promos().doc(id).set({
    reward, maxUses, uses: 0, active: true, createdAt: Date.now(),
    expiresAt: days ? Date.now() + days * 86_400_000 : null,
  });
  return id;
}

export async function disablePromo(code: string) {
  await promos().doc(code.toUpperCase()).update({ active: false });
}
