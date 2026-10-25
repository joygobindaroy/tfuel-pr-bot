import type { Bot, Context } from "grammy";
import { after } from "next/server";
import { appUrl } from "./botInstance";
import { startBroadcast, validSegment } from "./broadcast";
import { getConfig, invalidateConfig } from "./config";
import { getDb } from "./firebase";
import { createPromo, disablePromo } from "./promo";
import { createLoginToken } from "./session";
import { audit, can, getRole, type Role } from "./roles";
import { closeTicket, openTickets, replyTicket } from "./support";
import { setTaskStatus } from "./tasks";
import { credit, countUsers, getUser, levelFor, usersCol, type UserDoc } from "./users";

const HELP: [string, string, string][] = [
  ["users.view", "login", "/admin login   (one-time link to the web panel, any browser)"],
  ["stats", "stats", "/admin stats"],
  ["users.view", "user", "/admin user <id|@username>"],
  ["users.ban", "ban", "/admin ban <id> [reason]   |   /admin unban <id>"],
  ["balance", "balance", "/admin balance <id> <+/-amount> <reason>"],
  ["tasks", "task", "/admin task <taskId> pause|resume|cancel   |   /admin reports"],
  ["fraud", "fraud", "/admin fraud"],
  ["tickets", "tickets", "/admin tickets   |   /admin reply <id> <text>   |   /admin close <id>"],
  ["promo", "promo", "/admin promo create <CODE> <reward> <maxUses> [days]   |   /admin promo off <CODE>"],
  ["broadcast", "broadcast", "/admin broadcast <segment> <text>\n   segments: all, premium, country:XX, active:7, level:task_master"],
  ["config", "config", "/admin config get [path]   |   /admin config set <path> <json>   |   /admin maintenance on|off"],
  ["roles", "role", "/admin role add <id> moderator|finance|super   |   /admin role remove <id>"],
  ["audit", "audit", "/admin audit [n]"],
];

const isNum = (s?: string) => !!s && /^-?\d+(\.\d+)?$/.test(s);
const clip = (s: string) => (s.length > 3800 ? s.slice(0, 3800) + "\n…" : s);

async function findUser(q: string): Promise<UserDoc | null> {
  if (/^\d+$/.test(q)) return getUser(Number(q));
  const s = await usersCol().where("usernameLower", "==", q.replace(/^@/, "").toLowerCase()).limit(1).get();
  return s.empty ? null : getUser(Number(s.docs[0].id));
}

function userCard(u: UserDoc, levels: Parameters<typeof levelFor>[1]) {
  return `👤 ${u.id} ${u.username ? "@" + u.username : ""} ${u.firstName}
Balance: ${u.balance}  XP: ${u.xp} (${levelFor(u.xp, levels).name})
Verified: ${u.verified}  Banned: ${u.banned}${u.banReason ? ` (${u.banReason})` : ""}
Country: ${u.country ?? "—"} ${u.countryTrusted ? "" : "(untrusted)"}  Risk: ${u.risk?.score ?? "—"} ${u.risk?.flags?.join(",") ?? ""}
Tasks done: ${u.tasksDone}  Penalties: ${u.penalties}  Referrals: ${u.referralCount}  Referrer: ${u.referrerId ?? "—"}
Deposited: ${u.depositedStars}⭐ / ${u.depositedUsdt} USDT
Created: ${new Date(u.createdAt).toISOString().slice(0, 10)}`;
}

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

export async function kickWorker() {
  const run = () =>
    fetch(`${appUrl()}/api/cron/tick`, {
      method: "POST",
      headers: { "x-job-secret": process.env.CRON_SECRET || "" },
      signal: AbortSignal.timeout(2500),
    }).catch(() => {});
  try { after(run); } catch { await run(); }
}

export function registerAdmin(bot: Bot) {
  bot.command("admin", async (ctx: Context) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    const role = await getRole(ctx.from.id);
    if (!role) return;
    const text = String(ctx.match ?? "").trim();
    const [cmd = "help", ...rest] = text.split(/\s+/);
    const a = rest;
    const adminId = ctx.from.id;
    const need = (perm: string) => {
      if (can(role as Role, perm)) return true;
      void ctx.reply("You don't have permission for that.");
      return false;
    };
    const cfg = await getConfig();

    switch (cmd) {
      case "help": {
        const lines = HELP.filter(([perm]) => can(role, perm)).map(([, , usage]) => usage);
        return void (await ctx.reply(`Admin (${role})\n\n${lines.join("\n\n")}`));
      }

      case "login": {
        const token = await createLoginToken(adminId);
        await audit(adminId, "login_link", "web");
        return void (await ctx.reply(`🔐 Admin panel login (valid 5 minutes, works once):\n${appUrl()}/admin?token=${token}\n\nDon't share this link.`, { link_preview_options: { is_disabled: true } }));
      }

      case "stats": {
        if (!need("stats")) return;
        const day = new Date().toISOString().slice(0, 10);
        const [u, tot, today] = await Promise.all([
          countUsers(), getDb().collection("meta").doc("stats").get(), getDb().collection("stats_daily").doc(day).get(),
        ]);
        const fmtObj = (o: object | undefined) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n") || "—";
        return void (await ctx.reply(clip(`📊 Users: ${u.total} (${u.verified} verified)\n\nToday:\n${fmtObj(today.data())}\n\nAll time:\n${fmtObj(tot.data())}`)));
      }

      case "user":
      case "find": {
        if (!need("users.view")) return;
        const u = a[0] ? await findUser(a[0]) : null;
        return void (await ctx.reply(u ? userCard(u, cfg.levels) : "User not found."));
      }

      case "ban":
      case "unban": {
        if (!need("users.ban")) return;
        const u = a[0] ? await findUser(a[0]) : null;
        if (!u) return void (await ctx.reply("User not found."));
        const ban = cmd === "ban";
        await usersCol().doc(String(u.id)).update({ banned: ban, banReason: ban ? a.slice(1).join(" ") || null : null });
        await audit(adminId, cmd, String(u.id), { reason: a.slice(1).join(" ") });
        return void (await ctx.reply(`${ban ? "Banned" : "Unbanned"} ${u.id}.`));
      }

      case "balance": {
        if (!need("balance")) return;
        const u = a[0] ? await findUser(a[0]) : null;
        const amount = Number(a[1]);
        if (!u || !isNum(a[1]) || !a[2]) return void (await ctx.reply("Usage: /admin balance <id> <+/-amount> <reason>"));
        try {
          const bal = await credit(u.id, amount, "admin_adjust", { by: adminId, reason: a.slice(2).join(" ") });
          await audit(adminId, "balance", String(u.id), { amount, reason: a.slice(2).join(" ") });
          return void (await ctx.reply(`Done. New balance: ${bal}`));
        } catch {
          return void (await ctx.reply("Failed (insufficient balance?)."));
        }
      }

      case "task": {
        if (!need("tasks")) return;
        const action = a[1] as "pause" | "resume" | "cancel";
        if (!a[0] || !["pause", "resume", "cancel"].includes(action)) return void (await ctx.reply("Usage: /admin task <id> pause|resume|cancel"));
        try {
          const r = await setTaskStatus(a[0], { id: adminId, admin: true }, action);
          await audit(adminId, `task_${action}`, a[0]);
          return void (await ctx.reply(`Task ${a[0]} is now ${r.status}${r.refund ? `, refunded ${r.refund}` : ""}.`));
        } catch (e) {
          return void (await ctx.reply(`Failed: ${(e as Error).message}`));
        }
      }

      case "reports": {
        if (!need("tasks")) return;
        const s = await getDb().collection("tasks").where("reports", ">", 0).orderBy("reports", "desc").limit(10).get();
        const lines = s.docs.map((d) => `${d.id} · ${d.data().link} · ${d.data().reports} reports · ${d.data().status}`);
        return void (await ctx.reply(lines.join("\n") || "No reported tasks."));
      }

      case "fraud": {
        if (!need("fraud")) return;
        const [risky, leavers] = await Promise.all([
          usersCol().orderBy("risk.score", "desc").limit(10).get(),
          usersCol().orderBy("penalties", "desc").limit(5).get(),
        ]);
        const r = risky.docs.map((d) => { const x = d.data(); return `${x.id} score ${x.risk?.score ?? 0} ${x.risk?.flags?.join(",") ?? ""} ${x.country ?? ""}${x.banned ? " [banned]" : ""}`; });
        const l = leavers.docs.filter((d) => (d.data().penalties ?? 0) > 0).map((d) => `${d.id} left early ${d.data().penalties}×`);
        return void (await ctx.reply(clip(`🚩 Highest risk\n${r.join("\n") || "—"}\n\n🚪 Frequent leavers\n${l.join("\n") || "—"}`)));
      }

      case "tickets": {
        if (!need("tickets")) return;
        const t = await openTickets();
        return void (await ctx.reply(clip(t.map((x) => `#${x.id} · user ${x.userId}\n${x.text.slice(0, 200)}`).join("\n\n") || "No open tickets.")));
      }
      case "reply": {
        if (!need("tickets")) return;
        const ok = a[0] && a[1] ? await replyTicket(a[0], adminId, a.slice(1).join(" ")) : false;
        if (ok) await audit(adminId, "ticket_reply", a[0]);
        return void (await ctx.reply(ok ? "Sent." : "Usage: /admin reply <id> <text> (check the id)."));
      }
      case "close": {
        if (!need("tickets")) return;
        const ok = a[0] ? await closeTicket(a[0]) : false;
        return void (await ctx.reply(ok ? "Closed." : "Ticket not found."));
      }

      case "promo": {
        if (!need("promo")) return;
        if (a[0] === "create" && a[1] && isNum(a[2]) && isNum(a[3])) {
          const id = await createPromo(a[1], Number(a[2]), Number(a[3]), isNum(a[4]) ? Number(a[4]) : null);
          await audit(adminId, "promo_create", id, { reward: a[2], maxUses: a[3], days: a[4] });
          return void (await ctx.reply(`Promo ${id} created.`));
        }
        if (a[0] === "off" && a[1]) {
          await disablePromo(a[1]).catch(() => {});
          await audit(adminId, "promo_off", a[1]);
          return void (await ctx.reply("Disabled."));
        }
        return void (await ctx.reply("Usage: /admin promo create <CODE> <reward> <maxUses> [days] | promo off <CODE>"));
      }

      case "broadcast": {
        if (!need("broadcast")) return;
        const seg = a[0] ?? "";
        const msg = text.replace(/^broadcast\s+\S+\s*/, "");
        if (!validSegment(seg) || !msg) return void (await ctx.reply("Usage: /admin broadcast <segment> <text>\nSegments: all, premium, country:XX, active:7, level:task_master"));
        const id = await startBroadcast(adminId, seg, msg);
        await audit(adminId, "broadcast", id, { segment: seg });
        await ctx.reply(`📣 Broadcast ${id} started for "${seg}". I'll message you when it finishes.`);
        return void (await kickWorker());
      }

      case "maintenance": {
        if (!need("config")) return;
        if (!["on", "off"].includes(a[0])) return void (await ctx.reply("Usage: /admin maintenance on|off"));
        await getDb().collection("config").doc("main").set({ maintenance: a[0] === "on" }, { merge: true });
        invalidateConfig();
        await audit(adminId, "maintenance", a[0]);
        return void (await ctx.reply(`Maintenance ${a[0]}.`));
      }

      case "config": {
        if (!need("config")) return;
        if (a[0] === "get") {
          let v: unknown = cfg;
          for (const k of (a[1] ?? "").split(".").filter(Boolean)) v = (v as Record<string, unknown> | undefined)?.[k];
          return void (await ctx.reply(clip(JSON.stringify(v, null, 1) ?? "undefined")));
        }
        if (a[0] === "set" && a[1] && a.length >= 3) {
          const raw = a.slice(2).join(" ");
          let value: unknown;
          try { value = JSON.parse(raw); } catch { value = raw; }
          if (a[1].split(".")[0] === "maintenance" && typeof value !== "boolean") return void (await ctx.reply("maintenance must be true or false."));
          await getDb().collection("config").doc("main").set(nest(a[1], value), { merge: true });
          invalidateConfig();
          await audit(adminId, "config_set", a[1], { value });
          return void (await ctx.reply(`Set ${a[1]} = ${JSON.stringify(value)} (live within seconds).`));
        }
        return void (await ctx.reply("Usage: /admin config get [path] | config set <path> <json>"));
      }

      case "role": {
        if (!need("roles")) return;
        const id = Number(a[1]);
        if (a[0] === "add" && id && ["moderator", "finance", "super"].includes(a[2])) {
          await getDb().collection("admins").doc(String(id)).set({ role: a[2], addedBy: adminId, at: Date.now() });
          await audit(adminId, "role_add", String(id), { role: a[2] });
          return void (await ctx.reply(`${id} is now ${a[2]}.`));
        }
        if (a[0] === "remove" && id) {
          await getDb().collection("admins").doc(String(id)).delete();
          await audit(adminId, "role_remove", String(id));
          return void (await ctx.reply("Removed."));
        }
        return void (await ctx.reply("Usage: /admin role add <id> moderator|finance|super | role remove <id>"));
      }

      case "audit": {
        if (!need("audit")) return;
        const n = Math.min(Number(a[0]) || 15, 30);
        const s = await getDb().collection("audit").orderBy("at", "desc").limit(n).get();
        const lines = s.docs.map((d) => { const x = d.data(); return `${new Date(x.at).toISOString().slice(5, 16)} ${x.adminId} ${x.action} ${x.target}`; });
        return void (await ctx.reply(clip(lines.join("\n") || "Empty.")));
      }

      default:
        return void (await ctx.reply("Unknown command. Try /admin help"));
    }
  });
}
