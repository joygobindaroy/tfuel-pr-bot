import crypto from "crypto";

const digest = (s: string) => crypto.createHash("sha256").update(s).digest();
const same = (a: string, b: string) => crypto.timingSafeEqual(digest(a), digest(b));

/**
 * The scheduler secret can arrive three ways, so any cron service works:
 *   https://domain/api/cron?key=SECRET        (simplest, no headers)
 *   Authorization: Bearer SECRET              (Vercel cron)
 *   x-job-secret: SECRET                      (our own follow-up calls)
 */
export function isCronAuthorized(req: Request, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  let key: string | null = null;
  try { key = new URL(req.url).searchParams.get("key"); } catch { /* ignore */ }
  return [bearer, req.headers.get("x-job-secret"), key].some((c) => !!c && same(c, secret));
}
