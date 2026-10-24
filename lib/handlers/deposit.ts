import { InlineKeyboard, type Bot, type Context } from "grammy";
import { notifyAchievements } from "../achievements";
import { binanceEnabled, createUsdtOrder, settleUsdtOrder } from "../binance";
import { getConfig, type AppConfig } from "../config";
import { L } from "../labels";
import { depositQuote, usdtQuote } from "../payments";
import { fmt, show } from "../ui";

function methodKeyboard(cfg: AppConfig) {
  const kb = new InlineKeyboard().text("⭐ Telegram Stars", "dm:stars");
  if (cfg.usdt.enabled && binanceEnabled()) kb.text("💲 USDT (Binance Pay)", "dm:usdt");
  return kb;
}

function starsKeyboard(cfg: AppConfig) {
  const kb = new InlineKeyboard();
  cfg.deposit.packages.forEach((s, i) => {
    const q = depositQuote(s, cfg);
    kb.text(`⭐ ${s} → ${fmt(q.total)}${q.pct ? ` (+${q.pct}%)` : ""}`, `dep:${s}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text("⬅️ Back", "dm:menu");
}

function usdtKeyboard(cfg: AppConfig) {
  const kb = new InlineKeyboard();
  cfg.usdt.packages.forEach((s, i) => {
    const q = usdtQuote(s, cfg);
    kb.text(`$${s} → ${fmt(q.total)}${q.pct ? ` (+${q.pct}%)` : ""}`, `usd:${s}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text("⬅️ Back", "dm:menu");
}

const TERMS = (cur: string) => `⚠️ Deposits are final and non-refundable. ${cur} is an in-bot balance with no cash value.\n\nBy continuing you accept this.`;

async function menu(ctx: Context) {
  const cfg = await getConfig();
  await show(ctx, "💳 Deposit\n\nChoose a payment method:", methodKeyboard(cfg));
}

export function registerDeposit(bot: Bot) {
  bot.hears(L.deposit, menu);
  bot.callbackQuery("dm:menu", async (ctx) => { await ctx.answerCallbackQuery(); await menu(ctx); });

  bot.callbackQuery("dm:stars", async (ctx) => {
    await ctx.answerCallbackQuery();
    const cfg = await getConfig();
    const bonuses = cfg.deposit.bonusTiers.map((t) => `• ${t.minStars}+ ⭐: +${t.percent}% bonus`).join("\n");
    await show(ctx, `⭐ Telegram Stars\n\nRate: 1 ⭐ = ${fmt(cfg.deposit.rate)} ${cfg.currency}\n${bonuses}\n\nChoose an amount:`, starsKeyboard(cfg));
  });

  bot.callbackQuery(/^dep:(\d+)$/, async (ctx) => {
    const cfg = await getConfig();
    const stars = Number(ctx.match[1]);
    if (!cfg.deposit.packages.includes(stars)) return ctx.answerCallbackQuery({ text: "This amount is no longer available.", show_alert: true });
    const q = depositQuote(stars, cfg);
    await ctx.answerCallbackQuery();
    await ctx.reply(`Deposit ${stars} ⭐ → ${fmt(q.total)} ${cfg.currency}${q.bonus ? ` (+${fmt(q.bonus)} bonus)` : ""}\n\n${TERMS(cfg.currency)}`, {
      reply_markup: new InlineKeyboard().text(`I agree, pay ${stars} ⭐`, `depc:${stars}`).text("Cancel", "depx"),
    });
  });

  bot.callbackQuery(/^depc:(\d+)$/, async (ctx) => {
    const cfg = await getConfig();
    const stars = Number(ctx.match[1]);
    if (!cfg.deposit.packages.includes(stars)) return ctx.answerCallbackQuery({ text: "This amount is no longer available.", show_alert: true });
    const q = depositQuote(stars, cfg);
    await ctx.answerCallbackQuery();
    await ctx.replyWithInvoice(
      `Deposit ${stars} ⭐`,
      `Get ${fmt(q.total)} ${cfg.currency}${q.bonus ? ` including a ${q.pct}% bonus` : ""}. Non-refundable.`,
      `dep:${ctx.from.id}:${stars}`,
      "XTR",
      [{ label: `${fmt(q.total)} ${cfg.currency}`, amount: stars }]
    );
  });

  bot.callbackQuery("depx", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.deleteMessage().catch(() => {}); });

  /* USDT via Binance Pay */
  bot.callbackQuery("dm:usdt", async (ctx) => {
    await ctx.answerCallbackQuery();
    const cfg = await getConfig();
    if (!cfg.usdt.enabled || !binanceEnabled()) return void (await show(ctx, "USDT deposits are not available yet."));
    const bonuses = cfg.usdt.bonusTiers.map((t) => `• $${t.minUsdt}+: +${t.percent}% bonus`).join("\n");
    await show(ctx, `💲 USDT\n\nRate: 1 USDT = ${fmt(cfg.usdt.rate)} ${cfg.currency}\n${bonuses}\n\nChoose an amount:`, usdtKeyboard(cfg));
  });

  bot.callbackQuery(/^usd:(\d+)$/, async (ctx) => {
    const cfg = await getConfig();
    const usdt = Number(ctx.match[1]);
    if (!cfg.usdt.packages.includes(usdt)) return ctx.answerCallbackQuery({ text: "This amount is no longer available.", show_alert: true });
    const q = usdtQuote(usdt, cfg);
    await ctx.answerCallbackQuery();
    await ctx.reply(`Deposit $${usdt} USDT → ${fmt(q.total)} ${cfg.currency}${q.bonus ? ` (+${fmt(q.bonus)} bonus)` : ""}\n\n${TERMS(cfg.currency)}`, {
      reply_markup: new InlineKeyboard().text(`I agree, pay $${usdt}`, `usdc:${usdt}`).text("Cancel", "depx"),
    });
  });

  bot.callbackQuery(/^usdc:(\d+)$/, async (ctx) => {
    const cfg = await getConfig();
    const usdt = Number(ctx.match[1]);
    if (!cfg.usdt.packages.includes(usdt) || !binanceEnabled()) return ctx.answerCallbackQuery({ text: "Not available.", show_alert: true });
    await ctx.answerCallbackQuery({ text: "Creating your payment..." });
    try {
      const o = await createUsdtOrder(ctx.from.id, usdt);
      const kb = new InlineKeyboard();
      if (o.checkoutUrl) kb.url("Pay with Binance", o.checkoutUrl).row();
      kb.text("🔄 I've paid, check", `usdk:${o.tradeNo}`);
      await ctx.reply(`Pay $${usdt} USDT within 1 hour. Your balance updates automatically, or press the check button after paying.\n\nOrder: ${o.tradeNo}`, { reply_markup: kb });
    } catch (e) {
      console.error("usdt order failed", e);
      await ctx.reply("Couldn't create the payment right now. Please try again later.");
    }
  });

  bot.callbackQuery(/^usdk:(\w+)$/, async (ctx) => {
    const r = await settleUsdtOrder(ctx.match[1]);
    const text =
      r.state === "paid" ? (r.already ? "Already credited." : "✅ Payment received.") :
      r.state === "pending" ? "Not paid yet. Finish the payment, then check again." :
      r.state === "closed" ? "This order expired. Create a new one." : "Couldn't check right now. Try again shortly.";
    await ctx.answerCallbackQuery({ text, show_alert: true });
    if (r.state === "paid" && !r.already && r.userId) void notifyAchievements(r.userId);
  });
}
