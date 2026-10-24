import { FieldPath } from "firebase-admin/firestore";
import { bot, notifyAdmins } from "./botInstance";
import { getConfig } from "./config";
import { getDb } from "./firebase";
import { levelFor, usersCol, withDefaults, type UserDoc } from "./users";

const col = () => getDb().collection("broadcasts");

function matches(u: UserDoc, seg: string, levels: Parameters<typeof levelFor>[1]) {
  if (seg === "all") return true;
  if (seg === "premium") return u.isPremium;
  if (seg.startsWith("country:")) return u.country === seg.slice(8).toUpperCase();
  if (seg.startsWith("active:")) return Date.now() - u.lastActiveAt <= Number(seg.slice(7)) * 86_400_000;
  if (seg.startsWith("level:")) return levelFor(u.xp, levels).name.toLowerCase() === seg.slice(6).replace(/_/g, " ").toLowerCase();
  return false;
}

export const validSegment = (s: string) =>
  /^(all|premium|country:[A-Za-z]{2}|active:\d{1,3}|level:[A-Za-z_ ]+)$/.test(s);

export async function startBroadcast(adminId: number, segment: string, text: string) {
  const ref = col().doc();
  await ref.set({
    id: ref.id, adminId, segment, text, status: "running", cursor: null, sent: 0, failed: 0, skipped: 0, createdAt: Date.now(),
  });
  return ref.id;
}

export async function runningBroadcast() {
  const s = await col().where("status", "==", "running").limit(1).get();
  return s.empty ? null : s.docs[0].id;
}

/** Sends in batches until the deadline. Returns true when finished. */
export async function runBroadcast(id: string, deadline: number): Promise<boolean> {
  const cfg = await getConfig();
  const ref = col().doc(id);
  const s = await ref.get();
  if (!s.exists) return true;
  const b = s.data() as { segment: string; text: string; cursor: string | null; sent: number; failed: number; skipped: number; adminId: number };
  let { cursor, sent, failed, skipped } = b;

  while (Date.now() < deadline - 3000) {
    let q = usersCol().where("verified", "==", true).orderBy(FieldPath.documentId()).limit(100);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    const targets = snap.docs
      .map((d) => withDefaults(d.data()))
      .filter((u) => !u.banned && matches(u, b.segment, cfg.levels) && u.notif.news);
    skipped += snap.size - targets.length;

    for (let i = 0; i < targets.length; i += 20) {
      const started = Date.now();
      const results = await Promise.all(
        targets.slice(i, i + 20).map((u) => bot.api.sendMessage(u.id, b.text).then(() => true, () => false))
      );
      sent += results.filter(Boolean).length;
      failed += results.filter((r) => !r).length;
      const wait = 1000 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    cursor = snap.docs[snap.docs.length - 1].id;
    await ref.update({ cursor, sent, failed, skipped });
    if (snap.size < 100) {
      await ref.update({ status: "done", finishedAt: Date.now() });
      await notifyAdmins(`📣 Broadcast ${id} finished. Sent ${sent}, failed ${failed}, skipped ${skipped}.`);
      return true;
    }
  }
  await ref.update({ cursor, sent, failed, skipped });
  return false;
}
