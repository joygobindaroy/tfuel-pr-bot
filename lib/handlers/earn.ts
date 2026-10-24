import { InlineKeyboard, type Bot, type Context } from "grammy";
import { notifyAchievements } from "../achievements";
import { makeCaptcha } from "../captcha";
import { getConfig } from "../config";
import { L } from "../labels";
import { completeTask, countActive, findTasks, getTask, membership, pauseTaskFatal, reportTask, type TaskType } from "../tasks";
import { fmt, show } from "../ui";
import { getUser, levelFor, usersCol } from "../users";

const verb = (t: TaskType) => (t === "channel" ? "subscribe to the channel" : "join the group");

async function earnMenu(ctx: Context) {
  const [ch, gr] = await Promise.all([countActive("channel"), countActive("group")]);
  const kb = new InlineKeyboard()
    .text(`📢 Channels · ${ch}`, "earn:channel").text(`👥 Groups · ${gr}`, "earn:group");
  await show(ctx, "Choose a task category to earn:", kb);
}

async function sendCaptcha(ctx: Context, type: TaskType) {
  const c = makeCaptcha();
  await usersCol().doc(String(ctx.from!.id)).update({ captcha: { answer: c.answer, expires: Date.now() + 5 * 60_000 } });
  const kb = new InlineKeyboard();
  c.options.forEach((o) => kb.text(String(o), `cap:${o}:${type}`));
  await show(ctx, `🤖 Quick check before more tasks.\n\nSolve: ${c.question}`, kb);
}

async function showTask(ctx: Context, type: TaskType) {
  const cfg = await getConfig();
  const u = await getUser(ctx.from!.id);
  if (!u) return;
  if (u.tasksSinceCaptcha >= cfg.tasks.captchaEvery) return sendCaptcha(ctx, type);

  const tasks = await findTasks(u, type);
  const back = new InlineKeyboard().text("⬅️ Back", "earn:menu");
  if (!tasks.length) {
    await show(ctx, "No tasks available right now. Check back soon.", back);
    return;
  }
  const t = tasks[0];
  const lv = levelFor(u.xp, cfg.levels);
  const reward = Math.round(t.reward * (1 + lv.taskBonus / 100) * 100) / 100;
  const kb = new InlineKeyboard()
    .url(type === "channel" ? "Open channel" : "Open group", t.link).row()
    .text("✅ Check", `tchk:${t.id}`).row()
    .text("⏭ Skip", `earn:${type}`).text("⚠️ Report", `trep:${t.id}`).row()
    .text("⬅️ Back", "earn:menu");
  await show(
    ctx,
    `${type === "channel" ? "📢" : "👥"} ${t.title}\n\nReward: ${fmt(reward)} ${cfg.currency}${lv.taskBonus ? ` (includes ${lv.taskBonus}% level bonus)` : ""}\n\n1. Open the link and ${verb(type)}.\n2. Come back and press Check.\n\nStay for ${cfg.tasks.retentionDays} days. Leaving early costs you a penalty.`,
    kb
  );
}

export function registerEarn(bot: Bot) {
  bot.hears(L.earn, earnMenu);
  bot.callbackQuery("earn:menu", async (ctx) => { await ctx.answerCallbackQuery(); await earnMenu(ctx); });

  bot.callbackQuery(/^earn:(channel|group)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTask(ctx, ctx.match[1] as TaskType);
  });

  bot.callbackQuery(/^cap:(\d+):(channel|group)$/, async (ctx) => {
    const u = await getUser(ctx.from.id);
    const type = ctx.match[2] as TaskType;
    if (!u?.captcha || u.captcha.expires < Date.now()) {
      await ctx.answerCallbackQuery({ text: "Expired. Starting a new check.", show_alert: true });
      return sendCaptcha(ctx, type);
    }
    if (Number(ctx.match[1]) !== u.captcha.answer) {
      await ctx.answerCallbackQuery({ text: "Wrong answer. Try again.", show_alert: true });
      return sendCaptcha(ctx, type);
    }
    await usersCol().doc(String(u.id)).update({ captcha: null, tasksSinceCaptcha: 0 });
    await ctx.answerCallbackQuery({ text: "✅ Correct" });
    await showTask(ctx, type);
  });

  bot.callbackQuery(/^tchk:(\w+)$/, async (ctx) => {
    const task = await getTask(ctx.match[1]);
    if (!task || task.status !== "active") {
      await ctx.answerCallbackQuery({ text: "This task is no longer available.", show_alert: true });
      return showTask(ctx, task?.type ?? "channel");
    }
    const cfg = await getConfig();
    const u = await getUser(ctx.from.id);
    if (u && u.tasksSinceCaptcha >= cfg.tasks.captchaEvery) {
      await ctx.answerCallbackQuery();
      return sendCaptcha(ctx, task.type);
    }
    const m = await membership(task.chatId, ctx.from.id);
    if (m.status === "error") {
      if (m.fatal) await pauseTaskFatal(task.id);
      await ctx.answerCallbackQuery({ text: "Can't verify this task right now. Try another.", show_alert: true });
      return showTask(ctx, task.type);
    }
    if (m.status === "left") {
      await ctx.answerCallbackQuery({ text: "You haven't joined yet. Join first, then press Check.", show_alert: true });
      return;
    }
    const r = await completeTask(ctx.from.id, task.id);
    if (!r.ok) {
      const msg = r.reason === "done" ? "You already completed this task." : "This task is no longer available.";
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
      return showTask(ctx, task.type);
    }
    await ctx.answerCallbackQuery({ text: `+${fmt(r.payout)} ${cfg.currency}` });
    void notifyAchievements(ctx.from.id);
    await showTask(ctx, task.type);
  });

  bot.callbackQuery(/^trep:(\w+)$/, async (ctx) => {
    const task = await getTask(ctx.match[1]);
    await reportTask(ctx.from.id, ctx.match[1]);
    await ctx.answerCallbackQuery({ text: "Reported. Thank you." });
    await showTask(ctx, task?.type ?? "channel");
  });
}
