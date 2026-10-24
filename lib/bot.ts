import { InlineKeyboard } from "grammy";
import { registerAdmin } from "./admin";
import { notifyAchievements } from "./achievements";
import { bot, notifyAdmins, appUrl } from "./botInstance";
import { getConfig, isAdmin } from "./config";
import { registerAccount, accountText, claimFromLink } from "./handlers/account";
import { registerDeposit } from "./handlers/deposit";
import { registerEarn } from "./handlers/earn";
import { registerPromote, promoteText } from "./handlers/promote";
import { L } from "./labels";
import { allow } from "./ratelimit";
import { creditDeposit } from "./payments";
import { incStats } from "./stats";
import { setState } from "./state";
import { fmt, mainMenu } from "./ui";
import { ensureUser, getUser } from "./users";

export { bot, mainMenu };

/* ---------- Payments & admin: registered first so no gate can block them ---------- */

bot.command("paysupport", async (ctx) => {
  const cfg = await getConfig();
  const link = cfg.links.support ? `\n\nSupport: ${cfg.links.support}` : "";
  await ctx.reply(
    `Payment help\n\nAll deposits are final and non-refundable. If your payment went through but your balance did not change, send us the payment ID from your receipt message (Support button).${link}`
  );
});

bot.on("pre_checkout_query", async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const cfg = await getConfig();
  const fail = (msg: string) => ctx.answerPreCheckoutQuery(false, msg);
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
    const r = await creditDeposit(userId, p.total_amount, p.telegram_payment_charge_id, cfg);
    if (r.duplicate) return;
    void incStats({ depositsStars: p.total_amount, tfuelMinted: r.total });
    const bonus = r.bonus > 0 ? ` (includes +${fmt(r.bonus)} bonus)` : "";
    await ctx.reply(
      `✅ Deposit received\n+${fmt(r.total)} ${cfg.currency}${bonus}\nBalance: ${fmt(r.balance)} ${cfg.currency}\n\nPayment ID: ${p.telegram_payment_charge_id}`,
      { reply_markup: mainMenu }
    );
    void notifyAchievements(userId);
    if (p.total_amount >= cfg.deposit.alertStars) await notifyAdmins(`💳 Large deposit: ${p.total_amount} ⭐ from user ${userId}`);
  } catch (e) {
    console.error("payment credit failed", e);
    await notifyAdmins(`⚠️ Payment NOT credited\nUser: ${userId}\nStars: ${p.total_amount}\nCharge ID: ${p.telegram_payment_charge_id}`);
    await ctx.reply(`We received your payment but couldn't credit it yet. Our team has been notified.\nKeep this payment ID: ${p.telegram_payment_charge_id}`).catch(() => {});
  }
});

registerAdmin(bot);

/* ---------- Gates ---------- */

// 1. Private chats only
bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  await next();
});

// 2. Rate limiting
bot.use(async (ctx, next) => {
  const cfg = await getConfig();
  if (!(await allow(`u:${ctx.from!.id}`, cfg.rateLimit.max, cfg.rateLimit.windowSec))) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Slow down a little." }).catch(() => {});
    return;
  }
  await next();
});

// 3. Maintenance mode (admins bypass)
bot.use(async (ctx, next) => {
  const cfg = await getConfig();
  if (cfg.maintenance && !isAdmin(ctx.from!.id)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("🛠 We're updating the bot. Please try again in a few minutes.");
    return;
  }
  await next();
});

// 4. Load or create the user, block banned users, require verification
bot.use(async (ctx, next) => {
  const text = ctx.message?.text ?? "";
  const m = text.match(/^\/start\s+ref_(\d+)$/);
  const user = await ensureUser(ctx.from!, m ? Number(m[1]) : undefined);
  ctx.user = user;

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

// 5. Menu buttons and commands cancel any half-finished input
const labels = new Set(Object.values(L));
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
  await ctx.reply(
    `Welcome to ${cfg.brand}.\nEarn ${cfg.currency} by completing simple tasks, or spend it to promote your channel or group.`,
    { reply_markup: mainMenu }
  );
});

registerEarn(bot);
registerPromote(bot);
registerDeposit(bot);
registerAccount(bot);

// Free-text answers for multi-step flows
bot.on("message:text", async (ctx) => {
  const st = ctx.user.state;
  if (!st || Date.now() - st.at > 30 * 60_000) return;
  if (st.step.startsWith("promote:")) return promoteText(ctx, st);
  return accountText(ctx, st);
});

bot.catch((err) => console.error("bot error", err.error));
