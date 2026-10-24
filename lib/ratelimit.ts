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
