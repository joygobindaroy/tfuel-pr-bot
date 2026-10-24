import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase";

/** Increments daily and all-time counters. Never throws. */
export async function incStats(fields: Record<string, number>) {
  const inc: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(fields)) if (v) inc[k] = FieldValue.increment(v);
  if (!Object.keys(inc).length) return;
  const db = getDb();
  const day = new Date().toISOString().slice(0, 10);
  try {
    await Promise.all([
      db.collection("stats_daily").doc(day).set(inc, { merge: true }),
      db.collection("meta").doc("stats").set(inc, { merge: true }),
    ]);
  } catch (e) {
    console.error("stats failed", e);
  }
}
