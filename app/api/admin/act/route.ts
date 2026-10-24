import { kickWorker } from "@/lib/admin";
import { startBroadcast, validSegment } from "@/lib/broadcast";
import { invalidateConfig } from "@/lib/config";
import { getDb } from "@/lib/firebase";
import { requireAdmin } from "@/lib/http";
import { createPromo, disablePromo } from "@/lib/promo";
import { audit, can } from "@/lib/roles";
import { closeTicket, replyTicket } from "@/lib/support";
import { setTaskStatus } from "@/lib/tasks";
import { credit, getUser, usersCol } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nest(path: string, value: unknown) {
  const out: Record<string, unknown> = {};
  let cur = out;
  const parts = path.split(".");
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else { cur[p] = {}; cur = cur[p] as Record<string, unknown>; }
  });
  return out;
}

export async function POST(req: Request) {
  const g = await requireAdmin(req, { mutate: true });
  if ("res" in g) return g.res;
  const { role, user: me } = g.ctx;
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  const adminId = me.id;
  const db = getDb();
  const done = (message: string) => Response.json({ ok: true, message });
  const bad = (message: string, status = 400) => Response.json({ ok: false, message }, { status });
  const need = (perm: string) => can(role, perm);
  const deny = () => bad("You don't have permission for that.", 403);

  try {
    switch (action) {
      case "ban":
      case "unban": {
        if (!need("users.ban")) return deny();
        const u = await getUser(Number(b.id));
        if (!u) return bad("User not found.");
        const ban = action === "ban";
        const reason = String(b.reason || "").slice(0, 200) || null;
        await usersCol().doc(String(u.id)).update({ banned: ban, banReason: ban ? reason : null });
        await audit(adminId, action, String(u.id), { reason });
        return done(ban ? `Banned ${u.id}.` : `Unbanned ${u.id}.`);
      }

      case "balance": {
        if (!need("balance")) return deny();
        const amount = Number(b.amount);
        const reason = String(b.reason || "").trim().slice(0, 200);
        if (!Number.isFinite(amount) || amount === 0 || !reason) return bad("Enter a non-zero amount and a reason.");
        const u = await getUser(Number(b.id));
        if (!u) return bad("User not found.");
        try {
          const bal = await credit(u.id, amount, "admin_adjust", { by: adminId, reason });
          await audit(adminId, "balance", String(u.id), { amount, reason });
          return done(`Done. New balance: ${bal}`);
        } catch {
          return bad("Failed. The balance can't go below zero.");
        }
      }

      case "task": {
        if (!need("tasks")) return deny();
        const act = String(b.op) as "pause" | "resume" | "cancel";
        if (!["pause", "resume", "cancel"].includes(act)) return bad("Bad action.");
        const r = await setTaskStatus(String(b.id), { id: adminId, admin: true }, act);
        await audit(adminId, `task_${act}`, String(b.id));
        return done(`Task is now ${r.status}${r.refund ? `, refunded ${r.refund}` : ""}.`);
      }

      case "ticket_reply": {
        if (!need("tickets")) return deny();
        const text = String(b.text || "").trim();
        if (!text) return bad("Write a reply first.");
        const ok = await replyTicket(String(b.id), adminId, text);
        if (!ok) return bad("Ticket not found.");
        await audit(adminId, "ticket_reply", String(b.id));
        if (b.close) await closeTicket(String(b.id));
        return done(b.close ? "Replied and closed." : "Reply sent.");
      }
      case "ticket_close": {
        if (!need("tickets")) return deny();
        if (!(await closeTicket(String(b.id)))) return bad("Ticket not found.");
        await audit(adminId, "ticket_close", String(b.id));
        return done("Closed.");
      }

      case "promo_create": {
        if (!need("promo")) return deny();
        const code = String(b.code || "").toUpperCase();
        const reward = Number(b.reward), maxUses = Number(b.maxUses);
        const days = b.days === "" || b.days == null ? null : Number(b.days);
        if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return bad("Code: 3-24 letters, numbers, - or _.");
        if (!(reward > 0) || !(maxUses >= 1)) return bad("Reward and max uses must be positive.");
        if (days !== null && !(days > 0)) return bad("Days must be positive.");
        await createPromo(code, reward, Math.floor(maxUses), days);
        await audit(adminId, "promo_create", code, { reward, maxUses, days });
        return done(`Promo ${code} created.`);
      }
      case "promo_off": {
        if (!need("promo")) return deny();
        await disablePromo(String(b.code));
        await audit(adminId, "promo_off", String(b.code));
        return done("Disabled.");
      }

      case "broadcast": {
        if (!need("broadcast")) return deny();
        const segment = String(b.segment || "");
        const text = String(b.text || "").trim();
        if (!validSegment(segment)) return bad("Invalid segment.");
        if (!text || text.length > 3500) return bad("Message must be 1-3500 characters.");
        const id = await startBroadcast(adminId, segment, text);
        await audit(adminId, "broadcast", id, { segment });
        await kickWorker();
        return done(`Broadcast started (${id}).`);
      }

      case "maintenance": {
        if (!need("config")) return deny();
        await db.collection("config").doc("main").set({ maintenance: !!b.on }, { merge: true });
        invalidateConfig();
        await audit(adminId, "maintenance", String(!!b.on));
        return done(`Maintenance ${b.on ? "on" : "off"}.`);
      }

      case "config_set": {
        if (!need("config")) return deny();
        const path = String(b.path || "");
        if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(path)) return bad("Bad config path.");
        await db.collection("config").doc("main").set(nest(path, b.value), { merge: true });
        invalidateConfig();
        await audit(adminId, "config_set", path, { value: b.value });
        return done(`Saved ${path}. Live within seconds.`);
      }

      case "role_add": {
        if (!need("roles")) return deny();
        const id = Number(b.id);
        if (!id || !["moderator", "finance", "super"].includes(String(b.role))) return bad("Enter a Telegram id and a role.");
        await db.collection("admins").doc(String(id)).set({ role: b.role, addedBy: adminId, at: Date.now() });
        await audit(adminId, "role_add", String(id), { role: b.role });
        return done(`${id} is now ${b.role}.`);
      }
      case "role_remove": {
        if (!need("roles")) return deny();
        const id = Number(b.id);
        if (id === adminId) return bad("You can't remove yourself.");
        await db.collection("admins").doc(String(id)).delete();
        await audit(adminId, "role_remove", String(id));
        return done("Removed.");
      }

      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    console.error("admin act", action, e);
    return bad(String((e as Error).message).slice(0, 200), 500);
  }
}
