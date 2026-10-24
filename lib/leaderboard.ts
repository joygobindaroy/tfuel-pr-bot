import { getDb } from "./firebase";

export function weekKey(ms = Date.now()) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}W${String(wk).padStart(2, "0")}`;
}

export const lbDoc = (userId: number) =>
  getDb().collection(`lb_${weekKey()}`).doc(String(userId));

export async function topOf(kind: "earn" | "refs", limit = 10) {
  const snap = await getDb().collection(`lb_${weekKey()}`).orderBy(kind, "desc").limit(limit).get();
  return snap.docs
    .map((d) => d.data() as { userId: number; name: string; earn?: number; refs?: number })
    .filter((r) => (r[kind] ?? 0) > 0);
}
