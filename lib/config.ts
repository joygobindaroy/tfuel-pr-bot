import { getDb } from "./firebase";

export const DEFAULT_CONFIG = {
  brand: "TFUEL",
  currency: "TFUEL",
  maintenance: false,
  vpnMode: "block" as "block" | "limit" | "allow",
  blockScore: 80,
  referralMaxRisk: 50,
  signupBonus: 100,
  daily: { base: 10, streakStep: 2, maxStreak: 7, xp: 5 },
  referralTiers: [
    { minRefs: 0, reward: 50 },
    { minRefs: 10, reward: 75 },
    { minRefs: 50, reward: 100 },
  ],
  // VIP levels: taskBonus/dailyBonus are percentages on top of normal rewards (paid by the platform).
  levels: [
    { name: "Rookie", xp: 0, taskBonus: 0, dailyBonus: 0 },
    { name: "Task Master", xp: 1000, taskBonus: 5, dailyBonus: 10 },
    { name: "Pro", xp: 5000, taskBonus: 10, dailyBonus: 25 },
    { name: "Elite", xp: 20000, taskBonus: 15, dailyBonus: 50 },
  ],
  links: { news: "", support: "", instructions: "", privacy: "" },
  deposit: {
    rate: 100, // TFUEL per 1 Telegram Star
    packages: [50, 100, 250, 500, 1000],
    bonusTiers: [
      { minStars: 250, percent: 5 },
      { minStars: 500, percent: 10 },
      { minStars: 1000, percent: 15 },
    ],
    alertStars: 500,
  },
  usdt: {
    enabled: true,
    rate: 1000, // TFUEL per 1 USDT
    packages: [1, 5, 10, 25, 50],
    bonusTiers: [
      { minUsdt: 25, percent: 5 },
      { minUsdt: 50, percent: 10 },
    ],
    alertUsdt: 25,
  },
  tasks: {
    channel: { reward: 30, premiumReward: 55 }, // paid to the user per subscribe (premiumReward = Premium-only audience)
    group: { reward: 20, premiumReward: 38 },
    targetingFee: 5, // added per unit when countries are restricted
    commissionPct: 20, // added on top of reward, paid by the promoter
    minActions: 10,
    maxActions: 100000,
    retentionDays: 7,
    penaltyMultiplier: 1, // x payout taken back if the user leaves early
    captchaEvery: 10, // captcha after this many completed tasks
    autoPauseReports: 5,
    xpPerTask: 2,
    maxActiveTasksPerUser: 20,
  },
  checks: { minAmount: 1, maxClaims: 1000 },
  network: {
    minMembers: 100,
    maxPerDayDefault: 1,
    releaseAfterHours: 6,
    deleteAfterHours: 24,
    maxBonusPerOwnerPerDay: 50000,
    approvalAbove: 50000, // campaigns costing more need a second super admin
    sponsoredLabel: "📢 Sponsored",
  },
  mandatory: { maxRequired: 3, warnSeconds: 30, cacheMinutes: 3 },
  rateLimit: { windowSec: 10, max: 15 },
  achievements: [
    { id: "first_task", name: "First task", metric: "tasksDone", threshold: 1, reward: 20 },
    { id: "tasks_100", name: "100 tasks", metric: "tasksDone", threshold: 100, reward: 300 },
    { id: "refs_10", name: "10 referrals", metric: "referralCount", threshold: 10, reward: 200 },
    { id: "streak_7", name: "7-day streak", metric: "bestStreak", threshold: 7, reward: 100 },
    { id: "depositor", name: "First 100 Stars", metric: "depositedStars", threshold: 100, reward: 100 },
  ],
};

export type AppConfig = typeof DEFAULT_CONFIG;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

let cache: { at: number; value: AppConfig } | null = null;
export const invalidateConfig = () => { cache = null; };

/** Live config: edit Firestore doc `config/main` (or use /admin config), applies within ~30s. */
export async function getConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  let stored: unknown = {};
  try {
    const snap = await getDb().collection("config").doc("main").get();
    if (snap.exists) stored = snap.data();
  } catch (e) {
    console.error("config read failed", e);
  }
  const value = deepMerge(DEFAULT_CONFIG, stored);
  cache = { at: Date.now(), value };
  return value;
}

export const isAdmin = (id: number) =>
  (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).includes(String(id));
