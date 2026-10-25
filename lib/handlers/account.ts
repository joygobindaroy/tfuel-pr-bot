import { InlineKeyboard, type Bot, type Context } from "grammy";
import { metricsOf, notifyAchievements } from "../achievements";
import { appUrl } from "../botInstance";
import { cancelCheck, claimCheck, createCheck, myChecks } from "../checks";
import { getConfig } from "../config";
import { L } from "../labels";
import { action } from "./actions";
import { topOf } from "../leaderboard";
import { redeemPromo } from "../promo";
import { setState } from "../state";
import { createTicket } from "../support";
import { fmt, show } from "../ui";
import { claimDaily, countUsers, getUser, ledger, levelFor, usersCol, type UserState } from "../users";

const TYPE_LABEL: Record<string, string> = {
  signup_bonus: "Signup bonus", daily_bonus: "Daily bonus", referral_reward: "Referral",
  task_complete: "Task reward", task_create: "Promotion", task_refund: "Task refund", task_extend: "Task extended",
  retention_penalty: "Left early", deposit_stars: "Deposit ⭐", deposit_usdt: "Deposit USDT",
  achievement: "Achievement", promo: "Promo code", check_create: "Check created", check_claim: "Check received",
  check_refund: "Check refund", admin_adjust: "Adjustment",
};

async function cabinet(ctx: Context) {
  const cfg = await getConfig();
  const u = (await getUser(ctx.from!.id))!;
  const lv = levelFor(u.xp, cfg.levels);
  const xp = lv.nextXp ? `${u.xp}/${lv.nextXp} XP` : `${u.xp} XP (max level)`;
  const perks = lv.taskBonus || lv.dailyBonus ? `\nPerks: +${lv.taskBonus}% task rewards, +${lv.dailyBonus}% daily bonus` : "";
  const kb = new InlineKeyboard().text("💳 Deposit", "go:deposit").text("📜 History", "acc:history").row().text("⚙️ Settings", "acc:settings");
  await show(
    ctx,
    `👤 Your Cabinet\n\nID: ${u.id}\nLevel: ${lv.name} (${xp})${perks}\nBalance: ${fmt(u.balance)} ${cfg.currency}\nCountry: ${u.country ?? "—"}\nTasks done: ${u.tasksDone}\nReferrals: ${u.referralCount}`,
    kb
  );
}

async function settings(ctx: Context) {
  const u = (await getUser(ctx.from!.id))!;
  const on = (b: boolean) => (b ? "🔔 On" : "🔕 Off");
  const kb = new InlineKeyboard()
    .text(`Task updates: ${on(u.notif.tasks)}`, "set:tasks").row()
    .text(`News & broadcasts: ${on(u.notif.news)}`, "set:news").row()
    .text(`Referral alerts: ${on(u.notif.referrals)}`, "set:referrals");
  await show(ctx, "Notification settings.\nAccount safety messages (penalties, payments, support) are always sent.", kb);
}

async function leaderboard(ctx: Context, kind: "earn" | "refs") {
  const rows = await topOf(kind);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((r, i) => `${medals[i] ?? `${i + 1}.`} ${r.name} — ${fmt(r[kind] ?? 0)}`);
  const kb = new InlineKeyboard().text("💰 Top earners", "lb:earn").text("🤝 Top referrers", "lb:refs");
  await show(ctx, `🏆 This week: ${kind === "earn" ? "top earners" : "top referrers"}\n\n${lines.join("\n") || "No activity yet this week."}`, kb);
}

export function registerAccount(bot: Bot) {
  action(bot, "cabinet", L.cabinet, cabinet);
  bot.callbackQuery("acc:cabinet", async (ctx) => { await ctx.answerCallbackQuery(); await cabinet(ctx); });

  bot.callbackQuery("acc:history", async (ctx) => {
    await ctx.answerCallbackQuery();
    const cfg = await getConfig();
    const snap = await ledger(ctx.from.id).orderBy("createdAt", "desc").limit(10).get();
    const lines = snap.docs.map((d) => {
      const x = d.data() as { amount: number; type: string; createdAt: number };
      const date = new Date(x.createdAt).toISOString().slice(5, 10);
      return `${date}  ${x.amount > 0 ? "+" : ""}${fmt(x.amount)}  ${TYPE_LABEL[x.type] ?? x.type}`;
    });
    await show(ctx, `📜 Last transactions (${cfg.currency})\n\n${lines.join("\n") || "Nothing yet."}`, new InlineKeyboard().text("⬅️ Back", "acc:cabinet"));
  });

  action(bot, "settings", L.settings, settings);
  bot.callbackQuery("acc:settings", async (ctx) => { await ctx.answerCallbackQuery(); await settings(ctx); });
  bot.callbackQuery(/^set:(tasks|news|referrals)$/, async (ctx) => {
    const k = ctx.match[1];
    const u = (await getUser(ctx.from.id))!;
    await usersCol().doc(String(u.id)).update({ [`notif.${k}`]: !u.notif[k as "tasks"] });
    await ctx.answerCallbackQuery();
    await settings(ctx);
  });

  action(bot, "daily", L.daily, async (ctx) => {
    const cfg = await getConfig();
    const r = await claimDaily(ctx.from!.id);
    if (!r.ok) {
      const h = Math.floor(r.nextInMs / 3_600_000);
      const m = Math.floor((r.nextInMs % 3_600_000) / 60_000);
      return void (await ctx.reply(`You already claimed today. Come back in ${h}h ${m}m.`));
    }
    await ctx.reply(`🎁 +${fmt(r.reward)} ${cfg.currency}${r.vip ? ` (includes ${r.vip}% level bonus)` : ""}\nStreak: ${r.streak}/${cfg.daily.maxStreak} days\nBalance: ${fmt(r.balance)} ${cfg.currency}\n\nClaim every day to grow your streak.`);
    void notifyAchievements(ctx.from!.id);
  });

  action(bot, "refs", L.refs, async (ctx) => {
    const cfg = await getConfig();
    const u = (await getUser(ctx.from!.id))!;
    const link = `https://t.me/${ctx.me.username}?start=ref_${u.id}`;
    const tiers = cfg.referralTiers.map((t) => `• ${t.minRefs}+ referrals: ${t.reward} ${cfg.currency} each`).join("\n");
    await ctx.reply(`🤝 Referral program\n\nYour link:\n${link}\n\nInvited: ${u.referralCount}\n\nReward per verified friend:\n${tiers}`);
  });

  action(bot, "board", L.board, (ctx) => leaderboard(ctx, "earn"));
  bot.callbackQuery(/^lb:(earn|refs)$/, async (ctx) => { await ctx.answerCallbackQuery(); await leaderboard(ctx, ctx.match[1] as "earn" | "refs"); });

  action(bot, "ach", L.ach, async (ctx) => {
    const cfg = await getConfig();
    const u = (await getUser(ctx.from!.id))!;
    const m = metricsOf(u);
    const lines = cfg.achievements.map((a) => {
      const done = u.achievements.includes(a.id);
      return `${done ? "✅" : "🔒"} ${a.name} — ${Math.min(m[a.metric] ?? 0, a.threshold)}/${a.threshold}  (+${a.reward} ${cfg.currency})`;
    });
    await ctx.reply(`🏅 Achievements\n\n${lines.join("\n")}`);
  });

  action(bot, "promo", L.promo, async (ctx) => {
    await setState(ctx.from!.id, "promo");
    await ctx.reply("Send your promo code:");
  });

  action(bot, "stats", L.stats, async (ctx) => {
    const s = await countUsers();
    await ctx.reply(`📊 ${fmt(s.total)} users, ${fmt(s.verified)} verified.`);
  });

  action(bot, "app", L.app, async (ctx) => {
    await ctx.reply("Open your dashboard:", { reply_markup: new InlineKeyboard().webApp("🌐 Open App", `${appUrl()}/app`) });
  });

  action(bot, "links", L.links, async (ctx) => {
    const cfg = await getConfig();
    const kb = new InlineKeyboard();
    const add = (label: string, url: string) => { if (url) kb.url(label, url).row(); };
    add("News", cfg.links.news);
    add("Support chat", cfg.links.support);
    add("Instructions", cfg.links.instructions);
    add("Privacy policy", cfg.links.privacy);
    await ctx.reply("Useful links:", { reply_markup: kb });
  });

  action(bot, "help", L.help, (ctx) =>
    ctx.reply(
      "How it works:\n• Earnings: subscribe or join, press Check, get paid.\n• Promote: spend balance to grow your channel or group.\n• Deposit: add balance with Telegram Stars or USDT.\n• Daily Bonus: claim once a day, build a streak.\n• Checks: send coins to friends with a link.\n• Support: open a ticket if you need help.\n\nLeaving a channel within a few days of subscribing costs a penalty."
    )
  );

  action(bot, "support", L.support, async (ctx) => {
    await setState(ctx.from!.id, "ticket");
    await ctx.reply("Describe your problem in one message. Include payment IDs if it's about a deposit.");
  });

  /* Checks */
  action(bot, "checks", L.checks, async (ctx) => {
    await setState(ctx.from!.id, null);
    const kb = new InlineKeyboard()
      .text("➕ Personal check", "chk:new:1").text("➕ Multi-check", "chk:new:n").row()
      .text("📋 My checks", "chk:list");
    await ctx.reply("Checks let you send coins by link. Whoever opens the link first gets them.\n\nPersonal: one person. Multi: many people, same amount each.", { reply_markup: kb });
  });
  bot.callbackQuery(/^chk:new:(1|n)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx.from.id, ctx.match[1] === "1" ? "check:amount1" : "check:amountn", {});
    await ctx.reply("How much should each person get? Send a number.");
  });
  bot.callbackQuery("chk:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const list = await myChecks(ctx.from.id);
    const kb = new InlineKeyboard();
    list.forEach((c) => kb.text(`${fmt(c.amountEach)} × ${c.claims}/${c.maxClaims} — cancel`, `chk:cancel:${c.id}`).row());
    await show(ctx, list.length ? "Your active checks (tap to cancel and refund the rest):" : "No active checks.", kb);
  });
  bot.callbackQuery(/^chk:cancel:(\w+)$/, async (ctx) => {
    try {
      const refund = await cancelCheck(ctx.from.id, ctx.match[1]);
      await ctx.answerCallbackQuery({ text: `Refunded ${fmt(refund)}.` });
    } catch {
      await ctx.answerCallbackQuery({ text: "Can't cancel this check.", show_alert: true });
    }
  });
}

/** Handles /start chk_<id> (called from the start command). */
export async function claimFromLink(ctx: Context, id: string) {
  const cfg = await getConfig();
  const r = await claimCheck(ctx.from!.id, id);
  if (!r.ok) {
    const msg = { invalid: "This check doesn't exist.", empty: "This check has no coins left.", own: "You can't claim your own check.", claimed: "You already claimed this check." }[r.reason] ?? "Can't claim this check.";
    return void (await ctx.reply(msg));
  }
  await ctx.reply(`🧾 You received ${fmt(r.amount)} ${cfg.currency}.`);
}

/** Text answers for: promo, ticket, check creation. */
export async function accountText(ctx: Context, st: UserState) {
  const text = ctx.message!.text!.trim();
  const uid = ctx.from!.id;
  const cfg = await getConfig();

  if (st.step === "promo") {
    await setState(uid, null);
    const r = await redeemPromo(uid, text);
    if (r.ok) return void (await ctx.reply(`🎟 +${fmt(r.reward)} ${cfg.currency}. Balance: ${fmt(r.balance)}`));
    const msg = { invalid: "That code isn't valid.", expired: "That code has expired.", used: "You already used this code.", limit: "This code has been fully used." }[r.reason] ?? "Can't redeem that code.";
    return void (await ctx.reply(msg));
  }

  if (st.step === "ticket") {
    await setState(uid, null);
    const r = await createTicket(uid, text);
    return void (await ctx.reply(r.ok ? `✅ Ticket #${r.id} sent. We'll reply here.` : "You've reached today's ticket limit. Try again tomorrow."));
  }

  if (st.step.startsWith("check:")) {
    const n = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) return void (await ctx.reply("Send a positive number."));
    const link = (id: string) => `https://t.me/${ctx.me.username}?start=chk_${id}`;
    try {
      if (st.step === "check:amount1") {
        const r = await createCheck(uid, n, 1);
        await setState(uid, null);
        return void (await ctx.reply(`🧾 Check created (${fmt(r.total)} ${cfg.currency} reserved).\nShare this link:\n${link(r.id)}`));
      }
      if (st.step === "check:amountn") {
        await setState(uid, "check:count", { amount: n });
        return void (await ctx.reply(`How many people can claim it? (1 to ${cfg.checks.maxClaims})`));
      }
      if (st.step === "check:count") {
        const r = await createCheck(uid, Number(st.data.amount), Math.floor(n));
        await setState(uid, null);
        return void (await ctx.reply(`🧾 Multi-check created (${fmt(r.total)} ${cfg.currency} reserved).\nShare this link:\n${link(r.id)}`));
      }
    } catch (e) {
      await setState(uid, null);
      const m = String((e as Error).message);
      return void (await ctx.reply(m === "insufficient_balance" ? "Not enough balance." : "Invalid amount or count."));
    }
  }
}
