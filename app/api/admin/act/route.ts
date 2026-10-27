import { kickWorker } from "@/lib/admin";
import { addMirrorBot, apiFor, registerWebhook, removeMirrorBot } from "@/lib/bots";
import { botUsername } from "@/lib/botInstance";
import { backfillFromTasks, chatsCol } from "@/lib/chats";
import { runTick } from "@/lib/jobs";
import { approveCampaign, cancelCampaign, createCampaign, runCampaign, testPost, type NewCampaign } from "@/lib/network";
import { runBroadcast } from "@/lib/broadcast";
import { FieldValue } from "firebase-admin/firestore";
import { getConfig } from "@/lib/config";
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
export const maxDuration = 60;

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
        const finished = await runBroadcast(id, Date.now() + 25_000);
        const snap = await db.collection("broadcasts").doc(id).get();
        const x = snap.data() as { sent: number; failed: number; skipped: number };
        if (!finished) await kickWorker();
        if (x.sent === 0 && finished) return bad(`Nobody received it (failed ${x.failed}, skipped ${x.skipped}). Check the audience and that users have not turned off broadcasts.`);
        return done(`Sent to ${x.sent} user(s)${x.failed ? `, ${x.failed} failed` : ""}${finished ? "." : ". The rest continues in the background (the scheduler must be running)."}`);
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
        const stored = (await db.collection("config").doc("main").get()).data() ?? {};
        const before = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), stored);
        await db.collection("config").doc("main").set(nest(path, b.value), { merge: true });
        await db.collection("config_history").add({ path, before: before === undefined ? null : before, hadValue: before !== undefined, after: b.value, by: adminId, at: Date.now() });
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

      case "config_rollback": {
        if (!need("config")) return deny();
        const h = await db.collection("config_history").doc(String(b.id)).get();
        if (!h.exists) return bad("History entry not found.");
        const e = h.data() as { path: string; before: unknown; hadValue: boolean; after: unknown };
        if (e.hadValue) await db.collection("config").doc("main").set(nest(e.path, e.before), { merge: true });
        else await db.collection("config").doc("main").update({ [e.path]: FieldValue.delete() });
        await db.collection("config_history").add({ path: e.path, before: e.after, hadValue: true, after: e.hadValue ? e.before : null, by: adminId, at: Date.now(), rollbackOf: h.id });
        invalidateConfig();
        await audit(adminId, "config_rollback", e.path);
        return done(`Rolled back ${e.path}.`);
      }

      case "net_create": {
        if (!need("network")) return deny();
        const c = b.campaign as NewCampaign;
        if (!c) return bad("Missing campaign.");
        let r;
        try { r = await createCampaign(adminId, c); } catch (e) { return bad((e as Error).message); }
        await audit(adminId, "net_create", r.id, { status: r.status, count: r.count, totalBonus: r.totalBonus });
        if (r.status === "pending_approval") return done(`Created for ${r.count} chats. It costs ${r.totalBonus}, so another super admin must approve it before it sends.`);
        if (r.status === "scheduled") return done("Scheduled. The scheduler (cron) must be running for it to send at that time.");
        // Send right now instead of waiting for the scheduler, so the result you see is real.
        await runCampaign(r.id, Date.now() + 25_000);
        const snap = await db.collection("net_campaigns").doc(r.id).get();
        const x = snap.data() as { totals: { sent: number; failed: number }; queue: number[]; lastErrors?: { error: string }[] };
        if (x.totals.sent === 0) return bad(`Nothing was delivered. ${x.lastErrors?.[0]?.error ?? "Telegram refused every post."}`);
        const left = x.queue.length;
        return done(`Delivered to ${x.totals.sent} chat(s)${x.totals.failed ? `, ${x.totals.failed} failed` : ""}${left ? `. ${left} more are queued for the scheduler.` : "."}`);
      }
      case "net_approve": {
        if (!need("network")) return deny();
        try { await approveCampaign(String(b.id), adminId); } catch (e) { return bad((e as Error).message); }
        await audit(adminId, "net_approve", String(b.id));
        await kickWorker();
        return done("Approved. Sending has started.");
      }
      case "net_cancel": {
        if (!need("network")) return deny();
        await cancelCampaign(String(b.id));
        await audit(adminId, "net_cancel", String(b.id));
        return done("Campaign cancelled.");
      }
      case "net_test": {
        if (!need("network")) return deny();
        const c = b.campaign as NewCampaign;
        const cfg = await getConfig();
        const api = await apiFor();
        const user = await botUsername();
        const markup = { inline_keyboard: c.buttons.map((x) => [{ text: x.text, url: x.url === "{BOT}" ? `https://t.me/${user}` : x.url }]) };
        const text = `${cfg.network.sponsoredLabel}\n\n${c.text}`;
        try {
          if (c.photoUrl) await api.sendPhoto(adminId, c.photoUrl, { caption: text.slice(0, 1024), reply_markup: markup });
          else await api.sendMessage(adminId, text, { reply_markup: markup, link_preview_options: { is_disabled: true } });
        } catch (e) { return bad(`Test failed: ${(e as Error).message}. Start the bot in a private chat first.`); }
        return done("Test message sent to your Telegram.");
      }
      case "net_test_chat": {
        if (!need("network")) return deny();
        const c = b.campaign as NewCampaign;
        const chatId = Number(b.chatId);
        if (!c?.text || !chatId) return bad("Write the message and enter a chat id.");
        try { await testPost(chatId, c); } catch (e) { return bad(`Telegram said: ${(e as Error).message}`); }
        await audit(adminId, "net_test_chat", String(chatId));
        return done("Test post delivered to that chat.");
      }
      case "chat_flag": {
        if (!need("network")) return deny();
        const patch: Record<string, unknown> = {};
        if (typeof b.blacklisted === "boolean") patch.blacklisted = b.blacklisted;
        if (Array.isArray(b.tags)) patch.tags = b.tags.map((x: unknown) => String(x).slice(0, 20)).slice(0, 10);
        if (typeof b.adsEnabled === "boolean") patch["ads.enabled"] = b.adsEnabled;
        if (!Object.keys(patch).length) return bad("Nothing to change.");
        await chatsCol().doc(String(b.id)).update(patch);
        await audit(adminId, "chat_flag", String(b.id), patch);
        return done("Saved.");
      }

      case "chats_backfill": {
        if (!need("network")) return deny();
        const r = await backfillFromTasks();
        await audit(adminId, "chats_backfill", "tasks", r);
        return done(`Imported ${r.added} chat(s), ${r.skipped} already known, ${r.failed} could not be read (of ${r.total}).`);
      }
      case "tick_run": {
        if (!need("system")) return deny();
        const r = await runTick(Date.now() + 30_000);
        return done(`Tick finished in ${r.ms} ms${r.more ? " (more work is waiting)" : ""}.`);
      }

      case "bot_add": {
        if (!need("bots")) return deny();
        try {
          const r = await addMirrorBot(String(b.token || "").trim(), adminId);
          await audit(adminId, "bot_add", r.id, { username: r.username });
          return done(`Added @${r.username} and registered its webhook.`);
        } catch (e) { return bad((e as Error).message); }
      }
      case "bot_remove": {
        if (!need("bots")) return deny();
        try { await removeMirrorBot(String(b.id)); } catch (e) { return bad((e as Error).message); }
        await audit(adminId, "bot_remove", String(b.id));
        return done("Bot removed.");
      }
      case "bot_webhook": {
        if (!need("bots")) return deny();
        try { await registerWebhook(String(b.id)); } catch (e) { return bad((e as Error).message); }
        await audit(adminId, "bot_webhook", String(b.id));
        return done("Webhook registered.");
      }
      case "error_clear": {
        if (!need("system")) return deny();
        if (b.id) await db.collection("errors").doc(String(b.id)).delete();
        else { const s = await db.collection("errors").limit(200).get(); await Promise.all(s.docs.map((d) => d.ref.delete())); }
        return done("Cleared.");
      }

      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    console.error("admin act", action, e);
    return bad(String((e as Error).message).slice(0, 200), 500);
  }
}
