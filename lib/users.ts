import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase";
import { getConfig } from "./config";
import { lbDoc } from "./leaderboard";
import { incStats } from "./stats";

export type UserState = { step: string; data: Record<string, unknown>; at: number };

export type UserDoc = {
  id: number;
  username: string | null;
  usernameLower: string | null;
  firstName: string;
  languageCode: string | null;
  isPremium: boolean;
  balance: number;
  xp: number;
  banned: boolean;
  banReason: string | null;
  verified: boolean;
  verifiedAt: number | null;
  country: string | null;
  countryTrusted: boolean;
  timezone: string | null;
  ipHash: string | null;
  deviceHash: string | null;
  risk: { score: number; flags: string[] } | null;
  referrerId: number | null;
  referralCount: number;
  dailyStreak: number;
  bestStreak: number;
  lastDailyDay: string | null;
  tasksDone: number;
  tasksSinceCaptcha: number;
  depositedStars: number;
  depositedUsdt: number;
  achievements: string[];
  penalties: number;
  notif: { tasks: boolean; news: boolean; referrals: boolean };
  state: UserState | null;
  captcha: { answer: number; expires: number } | null;
  ticketsDay: string | null;
  ticketsToday: number;
  lastActiveAt: number;
  botId: string | null;
  source: { kind: string; id: string } | null;
  blocked: boolean;
  createdAt: number;
};

export const usersCol = () => getDb().collection("users");
export const ledger = (userId: number) => usersCol().doc(String(userId)).collection("ledger");

export const round = (n: number) => Math.round(n * 100) / 100;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const DEFAULTS = {
  usernameLower: null, banReason: null, bestStreak: 0, tasksDone: 0, tasksSinceCaptcha: 0,
  depositedStars: 0, depositedUsdt: 0, achievements: [] as string[], penalties: 0,
  notif: { tasks: true, news: true, referrals: true }, state: null, captcha: null,
  ticketsDay: null, ticketsToday: 0, lastActiveAt: 0,
  botId: null, source: null, blocked: false,
};

/** Fills fields that older documents may be missing. */
export function withDefaults(d: unknown): UserDoc {
  const u = { ...DEFAULTS, ...(d as object) } as UserDoc;
  u.notif = { ...DEFAULTS.notif, ...(u.notif || {}) };
  return u;
}

export const displayName = (u: Pick<UserDoc, "firstName" | "username" | "id">) =>
  (u.firstName || u.username || `user${String(u.id).slice(-4)}`).slice(0, 14);

export async function getUser(id: number): Promise<UserDoc | null> {
  const s = await usersCol().doc(String(id)).get();
  return s.exists ? withDefaults(s.data()) : null;
}

export async function ensureUser(
  from: { id: number; username?: string; first_name?: string; language_code?: string; is_premium?: boolean },
  refId?: number,
  meta: { botId?: string; source?: { kind: string; id: string } } = {}
): Promise<UserDoc> {
  const ref = usersCol().doc(String(from.id));
  const snap = await ref.get();
  if (snap.exists) {
    const u = withDefaults(snap.data());
    const patch: Record<string, unknown> = {};
    const uname = from.username ?? null;
    if (uname !== u.username) { patch.username = uname; patch.usernameLower = uname ? uname.toLowerCase() : null; }
    if (Date.now() - u.lastActiveAt > 6 * 3600_000) patch.lastActiveAt = Date.now();
    if (!!from.is_premium !== u.isPremium) patch.isPremium = !!from.is_premium;
    if (!u.botId && meta.botId) patch.botId = meta.botId;
    if (u.blocked) patch.blocked = false;
    if (Object.keys(patch).length) { await ref.update(patch); Object.assign(u, patch); }
    return u;
  }

  let referrerId: number | null = null;
  if (refId && refId !== from.id) {
    const r = await usersCol().doc(String(refId)).get();
    if (r.exists) referrerId = refId;
  }
  const doc: UserDoc = {
    ...DEFAULTS,
    id: from.id,
    username: from.username ?? null,
    usernameLower: from.username ? from.username.toLowerCase() : null,
    firstName: from.first_name ?? "",
    languageCode: from.language_code ?? null,
    isPremium: !!from.is_premium,
    balance: 0, xp: 0, banned: false, verified: false, verifiedAt: null,
    country: null, countryTrusted: false, timezone: null, ipHash: null, deviceHash: null,
    risk: null, referrerId, referralCount: 0, dailyStreak: 0, lastDailyDay: null,
    lastActiveAt: Date.now(), createdAt: Date.now(),
    botId: meta.botId ?? null, source: meta.source ?? null,
  };
  try {
    await ref.create(doc);
    void incStats({ newUsers: 1 });
  } catch {
    const again = await ref.get();
    if (again.exists) return withDefaults(again.data());
  }
  return doc;
}

/** Add (or subtract) balance atomically and write a ledger entry. */
export async function credit(
  userId: number,
  amount: number,
  type: string,
  meta: Record<string, unknown> = {},
  xp = 0
): Promise<number> {
  const ref = usersCol().doc(String(userId));
  return getDb().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new Error("no_user");
    const bal = round(withDefaults(s.data()).balance + amount);
    if (bal < 0) throw new Error("insufficient_balance");
    t.update(ref, { balance: bal, xp: FieldValue.increment(xp) });
    t.set(ledger(userId).doc(), { amount, type, meta, balanceAfter: bal, createdAt: Date.now() });
    return bal;
  });
}

export function levelFor(xp: number, levels: { name: string; xp: number; taskBonus: number; dailyBonus: number }[]) {
  let idx = 0;
  levels.forEach((l, i) => { if (xp >= l.xp) idx = i; });
  const next = levels[idx + 1];
  return { ...levels[idx], nextXp: next ? next.xp : null };
}

export async function claimDaily(userId: number) {
  const cfg = await getConfig();
  const ref = usersCol().doc(String(userId));
  return getDb().runTransaction(async (t) => {
    const s = await t.get(ref);
    const u = withDefaults(s.data());
    const now = Date.now();
    const today = dayKey(now);
    if (u.lastDailyDay === today) {
      const next = new Date(today + "T00:00:00Z").getTime() + 86_400_000;
      return { ok: false as const, nextInMs: next - now };
    }
    const streak =
      u.lastDailyDay === dayKey(now - 86_400_000) ? Math.min(u.dailyStreak + 1, cfg.daily.maxStreak) : 1;
    const lv = levelFor(u.xp, cfg.levels);
    const base = cfg.daily.base + (streak - 1) * cfg.daily.streakStep;
    const reward = round(base * (1 + lv.dailyBonus / 100));
    const bal = round(u.balance + reward);
    t.update(ref, {
      balance: bal,
      xp: FieldValue.increment(cfg.daily.xp),
      dailyStreak: streak,
      bestStreak: Math.max(u.bestStreak, streak),
      lastDailyDay: today,
    });
    t.set(ledger(userId).doc(), {
      amount: reward, type: "daily_bonus", meta: { streak }, balanceAfter: bal, createdAt: now,
    });
    return { ok: true as const, reward, streak, balance: bal, vip: lv.dailyBonus };
  });
}

function tierReward(tiers: { minRefs: number; reward: number }[], refs: number) {
  let reward = tiers[0]?.reward ?? 0;
  for (const t of tiers) if (refs >= t.minRefs) reward = t.reward;
  return reward;
}

/** Marks the user verified, pays the signup bonus and (once) the referrer. */
export async function completeVerification(
  userId: number,
  data: {
    country: string; countryTrusted: boolean; timezone: string | null;
    ipHash: string; deviceHash: string; risk: { score: number; flags: string[] };
  }
) {
  const cfg = await getConfig();
  const ref = usersCol().doc(String(userId));
  return getDb().runTransaction(async (t) => {
    const s = await t.get(ref);
    const u = withDefaults(s.data());
    if (u.verified) return { already: true as const };

    const refSnap = u.referrerId ? await t.get(usersCol().doc(String(u.referrerId))) : null;
    const now = Date.now();
    const bonus = cfg.signupBonus;
    t.update(ref, {
      verified: true, verifiedAt: now, country: data.country, countryTrusted: data.countryTrusted,
      timezone: data.timezone, ipHash: data.ipHash, deviceHash: data.deviceHash, risk: data.risk,
      balance: round(u.balance + bonus),
    });
    t.set(ledger(userId).doc(), {
      amount: bonus, type: "signup_bonus", meta: {}, balanceAfter: round(u.balance + bonus), createdAt: now,
    });

    let referralReward = 0;
    if (refSnap?.exists && data.risk.score < cfg.referralMaxRisk) {
      const r = withDefaults(refSnap.data());
      referralReward = tierReward(cfg.referralTiers, r.referralCount);
      t.update(refSnap.ref, {
        balance: round(r.balance + referralReward),
        referralCount: FieldValue.increment(1),
        xp: FieldValue.increment(10),
      });
      t.set(ledger(r.id).doc(), {
        amount: referralReward, type: "referral_reward", meta: { referred: userId },
        balanceAfter: round(r.balance + referralReward), createdAt: now,
      });
      t.set(lbDoc(r.id), { userId: r.id, name: displayName(r), refs: FieldValue.increment(1) }, { merge: true });
    }
    return { already: false as const, bonus, referralReward };
  });
}

export async function countUsers() {
  const [all, verified] = await Promise.all([
    usersCol().count().get(),
    usersCol().where("verified", "==", true).count().get(),
  ]);
  return { total: all.data().count, verified: verified.data().count };
}
