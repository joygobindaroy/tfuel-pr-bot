import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase";
import { notifyAdmins } from "./botInstance";

let lastAlert = 0;

/** Groups identical errors into one document with a counter. Never throws. */
export async function logError(where: string, err: unknown) {
  try {
    const e = err as Error;
    const msg = String(e?.message || err).slice(0, 300);
    const id = crypto.createHash("sha1").update(`${where}|${msg}`).digest("hex").slice(0, 20);
    await getDb().collection("errors").doc(id).set(
      { where, message: msg, stack: String(e?.stack || "").slice(0, 1200), count: FieldValue.increment(1), lastAt: Date.now() },
      { merge: true }
    );
    if (Date.now() - lastAlert > 10 * 60_000) {
      lastAlert = Date.now();
      await notifyAdmins(`⚠️ Error in ${where}: ${msg.slice(0, 200)}`);
    }
  } catch { /* logging must never break the request */ }
}
