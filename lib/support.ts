import { FieldValue } from "firebase-admin/firestore";
import { notifyAdmins } from "./botInstance";
import { sendToUser } from "./notify";
import { getDb } from "./firebase";
import { dayKey, usersCol, withDefaults } from "./users";

const tickets = () => getDb().collection("tickets");

export async function createTicket(userId: number, text: string) {
  const uref = usersCol().doc(String(userId));
  const u = withDefaults((await uref.get()).data());
  const today = dayKey(Date.now());
  const used = u.ticketsDay === today ? u.ticketsToday : 0;
  if (used >= 3) return { ok: false as const, reason: "limit" };

  const id = Math.random().toString(36).slice(2, 8);
  await tickets().doc(id).create({
    id, userId, text: text.slice(0, 1500), status: "open", createdAt: Date.now(), replies: [],
  });
  await uref.update({ ticketsDay: today, ticketsToday: used + 1 });
  await notifyAdmins(`🆘 New ticket #${id} from ${userId}:\n${text.slice(0, 500)}\n\nReply: /admin reply ${id} <text>`);
  return { ok: true as const, id };
}

export async function openTickets(limit = 15) {
  const snap = await tickets().where("status", "==", "open").limit(50).get();
  return snap.docs
    .map((d) => d.data() as { id: string; userId: number; text: string; createdAt: number })
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);
}

export async function replyTicket(id: string, adminId: number, text: string) {
  const ref = tickets().doc(id);
  const s = await ref.get();
  if (!s.exists) return false;
  const t = s.data() as { userId: number };
  await ref.update({ replies: FieldValue.arrayUnion({ by: adminId, text, at: Date.now() }) });
  await sendToUser(t.userId, `💬 Support reply (#${id}):\n${text}`);
  return true;
}

export async function closeTicket(id: string) {
  const ref = tickets().doc(id);
  if (!(await ref.get()).exists) return false;
  await ref.update({ status: "closed", closedAt: Date.now() });
  return true;
}
