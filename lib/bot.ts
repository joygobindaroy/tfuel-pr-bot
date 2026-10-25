import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { registerAdmin } from "./admin";
import { notifyAchievements } from "./achievements";
import { botIdOf } from "./bots";
import { appUrl, notifyAdmins } from "./botInstance";
import { onChatMember, onMyChatMember, registerOptIn } from "./chats";
import { getConfig, isAdmin } from "./config";
import { logError } from "./errlog";
import { accountText, claimFromLink, registerAccount } from "./handlers/account";
import { actions, labelSet } from "./handlers/actions";
import { chatsChatShared, registerChats } from "./handlers/chats";
import { registerDeposit } from "./handlers/deposit";
import { registerEarn } from "./handlers/earn";
import { promoteChatShared, promoteText, registerPromote } from "./handlers/promote";
import { registerGroupGate } from "./mandatory";
import { netStart } from "./network";
import { creditDeposit } from "./payments";
import { payDraftWithStars, readDraft } from "./taskpay";
import { allow, once } from "./ratelimit";
import { setState } from "./state";
import { incStats } from "./stats";
import { L } from "./labels";
import { fmt, mainMenu, moreMenu, welcomeText } from "./ui";
import { ensureUser, getUser, levelFor } from "./users";

export { mainMenu };

/** One fully wired bot (handlers + gates) for a given token. Primary and mirror bots share all behaviour. */
export function createBot(token: string): Bot {
  const botId = botIdOf(token);
  const bot = new Bot(token);

  // Every update: tag the bot, drop duplicate deliveries.
  bot.use(async (ctx, next) => {
    ctx.botId = botId;
    if (!(await once(`upd:${botId}:${ctx.update.update_id}`))) return;
    await next();
  });

  // Chat registry + group moderation + opt-in answers run before the private-chat gates.
  bot.on("my_chat_member", (ctx) => onMyChatMember(ctx).catch((e) => logError("my_chat_member", e)));
  bot.on("chat_member", (ctx) => onChatMember(ctx).catch((e) => logError("chat_member", e)));
  registerGroupGate(bot);
  registerOptIn(bot);

  /* ---------- Payments & admin: no gate may block them ---------- */

  bot.command("paysupport", async (ctx) => {
    const cfg = await getConfig();
    const link = cfg.links.support ? `\n\nSupport: ${cfg.links.support}` : "";
    await ctx.reply(`Payment help\n\nAll deposits are final and non-refundable. If your payment went through but your balance did not change, send us the payment ID from your receipt message (Support button).${link}`);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const cfg = await getConfig();
    const fail = (msg: string) => ctx.answerPreCheckoutQuery(false, msg);
    if (q.invoice_payload.startsWith("tsk:")) {
      const d = await readDraft(q.invoice_payload.slice(4));
      if (!d || q.currency !== "XTR" || d.ownerId !== q.from.id || d.status !== "open" || d.expiresAt < Date.now() || d.stars !== q.total_amount) {
        return fail("This order expired. Please create the task again.");
      }
      return ctx.answerPreCheckoutQuery(true);
    }
    const m = q.invoice_payload.match(/^dep:(\d+):(\d+)$/);
    if (!m || q.currency !== "XTR") return fail("Invalid payment.");
    const uid = Number(m[1]);
    const stars = Number(m[2]);
    if (uid !== q.from.id || q.total_amount !== stars || !cfg.deposit.packages.includes(stars)) {
      return fail("This payment is no longer valid. Please start again.");
    }
    const u = await getUser(uid);
    if (!u || u.banned || !u.verified) return fail("Your account can't make deposits.");
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const p = ctx.message.successful_payment;
    const userId = ctx.from.id;
    try {
      if (p.currency !== "XTR") throw new Error("unexpected currency");
      const cfg = await getConfig();
      if (p.invoice_payload.startsWith("tsk:")) {
        const r = await payDraftWithStars(p.invoice_payload.slice(4), userId, p.telegram_payment_charge_id, p.total_amount);
        await setState(userId, null);
        void incStats({ depositsStars: p.total_amount });
        if (r.ok && r.duplicate) return;
        if (r.ok) {
          await ctx.reply(`✅ Payment received. Your task is live.\nPaid: ${p.total_amount} ⭐ (worth ${fmt(r.total)} ${cfg.currency})\n\nPayment ID: ${p.telegram_payment_charge_id}`, {
            reply_markup: new InlineKeyboard().text("📋 My tasks", "pro:list"),
          });
        } else {
          await ctx.reply(`We received your payment but couldn't start the task, so ${r.reason === "credited" ? `${fmt(r.total)} ${cfg.currency} were added to your balance instead` : "our team has been notified"}. You can create the task again from your balance.\n\nPayment ID: ${p.telegram_payment_charge_id}`);
          await notifyAdmins(`ℹ️ Task payment fallback for user ${userId}: ${p.total_amount} ⭐ credited as balance (${r.reason}).`);
        }
        return;
      }
      const r = await creditDeposit(userId, p.total_amount, p.telegram_payment_charge_id, cfg);
      if (r.duplicate) return;
      void incStats({ depositsStars: p.total_amount, tfuelMinted: r.total });
      const bonus = r.bonus > 0 ? ` (includes +${fmt(r.bonus)} bonus)` : "";
      await ctx.reply(`✅ Deposit received\n+${fmt(r.total)} ${cfg.currency}${bonus}\nBalance: ${fmt(r.balance)} ${cfg.currency}\n\nPayment ID: ${p.telegram_payment_charge_id}`, { reply_markup: mainMenu });
      void notifyAchievements(userId);
      if (p.total_amount >= cfg.deposit.alertStars) await notifyAdmins(`💳 Large deposit: ${p.total_amount} ⭐ from user ${userId}`);
    } catch (e) {
      await logError("payment-credit", e);
      await notifyAdmins(`⚠️ Payment NOT credited\nUser: ${userId}\nStars: ${p.total_amount}\nCharge ID: ${p.telegram_payment_charge_id}`);
      await ctx.reply(`We received your payment but couldn't credit it yet. Our team has been notified.\nKeep this payment ID: ${p.telegram_payment_charge_id}`).catch(() => {});
    }
  });

  registerAdmin(bot);

  /* ---------- Gates (private chats) ---------- */

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    await next();
  });

  bot.use(async (ctx, next) => {
    const cfg = await getConfig();
    if (!(await allow(`u:${ctx.from!.id}`, cfg.rateLimit.max, cfg.rateLimit.windowSec))) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Slow down a little." }).catch(() => {});
      return;
    }
    await next();
  });

  bot.use(async (ctx, next) => {
    const cfg = await getConfig();
    if (cfg.maintenance && !isAdmin(ctx.from!.id)) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      await ctx.reply("🛠 We're updating the bot. Please try again in a few minutes.");
      return;
    }
    await next();
  });

  bot.use(async (ctx, next) => {
    const text = ctx.message?.text ?? "";
    const ref = text.match(/^\/start\s+ref_(\d+)$/);
    const net = text.match(/^\/start\s+net_(\w+)$/);
    const user = await ensureUser(ctx.from!, ref ? Number(ref[1]) : undefined, {
      botId, source: net ? { kind: "net", id: net[1] } : undefined,
    });
    ctx.user = user;
    if (net && Date.now() - user.createdAt < 5000) void netStart(net[1]);

    if (user.banned) {
      await ctx.reply("Your account is restricted. Contact support if you think this is a mistake.");
      return;
    }
    if (!user.verified) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      const kb = new InlineKeyboard().webApp("Verify now", `${appUrl()}/verify`);
      await ctx.reply("Before you start, we need to verify your connection. It takes a few seconds.", { reply_markup: kb });
      return;
    }
    await next();
  });

  const labels = labelSet();
  bot.use(async (ctx, next) => {
    const t = ctx.message?.text;
    if (t && ctx.user.state && (labels.has(t) || t.startsWith("/"))) {
      await setState(ctx.from!.id, null);
      ctx.user.state = null;
    }
    await next();
  });

  /* ---------- Commands & features ---------- */

  bot.command("start", async (ctx) => {
    const cfg = await getConfig();
    const payload = String(ctx.match ?? "");
    if (payload.startsWith("chk_")) await claimFromLink(ctx, payload.slice(4));
    const u = (await getUser(ctx.from!.id)) ?? ctx.user;
    await ctx.reply(welcomeText(cfg, u, levelFor(u.xp, cfg.levels).name), { parse_mode: "HTML", reply_markup: mainMenu });
  });

  bot.hears(L.more, (ctx) => ctx.reply("More", { reply_markup: moreMenu() }));
  bot.callbackQuery(/^go:(\w+)$/, async (ctx) => {
    const fn = actions.get(ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!fn) return;
    ctx.fresh = true;
    await fn(ctx);
  });

  registerEarn(bot);
  registerPromote(bot);
  registerDeposit(bot);
  registerAccount(bot);
  registerChats(bot);

  bot.on("message:chat_shared", async (ctx) => {
    const st = ctx.user.state;
    if (!st) return;
    if (st.step === "promote:pick") return promoteChatShared(ctx, st);
    if (st.step === "chats:add" || st.step === "ms:add") return chatsChatShared(ctx, st);
  });

  bot.on("message:text", async (ctx) => {
    const st = ctx.user.state;
    if (!st || Date.now() - st.at > 30 * 60_000) return;
    if (st.step.startsWith("promote:")) return promoteText(ctx, st);
    return accountText(ctx, st);
  });

  bot.catch((err) => { void logError("bot", err.error); });
  return bot;
}

/* ---------- instance + webhook cache (one warm lambda reuses these) ---------- */

const bots = new Map<string, Bot>();
export function getBot(token: string) {
  const id = botIdOf(token);
  let b = bots.get(id);
  if (!b) { b = createBot(token); bots.set(id, b); }
  return b;
}

const hooks = new Map<string, (req: Request) => Promise<Response>>();
export function webhookFor(token: string, secret?: string) {
  const id = botIdOf(token);
  let h = hooks.get(id);
  if (!h) { h = webhookCallback(getBot(token), "std/http", { secretToken: secret }); hooks.set(id, h); }
  return h;
}
