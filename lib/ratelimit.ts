const mem = new Map<string, { n: number; reset: number }>();

/** Returns true when the request is allowed. Uses Upstash Redis if configured, else per-instance memory. */
export async function allow(key: string, max: number, windowSec: number): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, windowSec, "NX"]]),
        signal: AbortSignal.timeout(1500),
      });
      const data = (await res.json()) as { result: number }[];
      return Number(data?.[0]?.result ?? 0) <= max;
    } catch {
      return true; // fail open
    }
  }
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.reset < now) {
    mem.set(key, { n: 1, reset: now + windowSec * 1000 });
    if (mem.size > 5000) for (const [k, v] of mem) if (v.reset < now) mem.delete(k);
    return true;
  }
  e.n += 1;
  return e.n <= max;
}

const seen = new Map<string, number>();

/** True the first time a key is seen within ttlSec (used to drop duplicate webhook deliveries). */
export async function once(key: string, ttlSec = 3600): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(`${url}/set/${encodeURIComponent(key)}/1/EX/${ttlSec}/NX`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500),
      });
      const j = (await res.json()) as { result: string | null };
      return j.result === "OK";
    } catch { return true; }
  }
  const now = Date.now();
  if (seen.has(key) && (seen.get(key) as number) > now) return false;
  seen.set(key, now + ttlSec * 1000);
  if (seen.size > 5000) for (const [k, v] of seen) if (v < now) seen.delete(k);
  return true;
}
