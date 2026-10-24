import crypto from "crypto";
import { getDb } from "./firebase";

export const COOKIE = "adm";
const secret = () => {
  const s = (process.env.SESSION_SECRET || "") + (process.env.BOT_TOKEN || "") + (process.env.HASH_SALT || "");
  if (!s) throw new Error("no session secret configured");
  return s;
};
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("hex");
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function makeSession(userId: number, ttlMs = 12 * 3600_000) {
  const v = `${userId}.${Date.now() + ttlMs}`;
  return `${v}.${sign(v)}`;
}

export function readSession(cookieHeader: string | null): number | null {
  const m = (cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [uid, exp, sig] = m[1].split(".");
  if (!uid || !exp || !sig) return null;
  const expected = sign(`${uid}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(uid) || null;
}

export const sessionCookie = (value: string, maxAgeSec: number) =>
  `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;

/** One-time login link token, valid 5 minutes, stored hashed. */
export async function createLoginToken(userId: number) {
  const token = crypto.randomBytes(32).toString("hex");
  await getDb().collection("admin_tokens").doc(sha(token)).set({
    userId, expires: Date.now() + 5 * 60_000, used: false, createdAt: Date.now(),
  });
  return token;
}

export async function consumeLoginToken(token: string): Promise<number | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const ref = getDb().collection("admin_tokens").doc(sha(token));
  return getDb().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) return null;
    const d = s.data() as { userId: number; expires: number; used: boolean };
    if (d.used || d.expires < Date.now()) return null;
    t.update(ref, { used: true });
    return d.userId;
  });
}
