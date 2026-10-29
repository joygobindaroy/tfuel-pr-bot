import { InlineKeyboard, type Bot, type Context } from "grammy";
import { notifyAchievements } from "../achievements";
import { makeCaptcha } from "../captcha";
import { getConfig } from "../config";
import { L } from "../labels";
import { action } from "./actions";
import { completeTask, countActive, findTasks, getTask, membership, pauseTaskFatal, PROOF_TYPES, reportTask, restoreFromGrace, type TaskType } from "../tasks";
import { getDb } from "../firebase";
import { setState } from "../state";
import { fmt, show } from "../ui";
import { dayKey, getUser, levelFor, usersCol } from "../users";

export const KIND: Record<TaskType, { icon: string; label: string; unit: string }> = {
  channel: { icon: "📢", label: "Channels", unit: "subscription" },
  group: { icon: "👥", label: "Groups", unit: "member" },
  post: { icon: "👁", label: "Posts", unit: "view" },
  bot: { icon: "🤖", label: "Bots", unit: "start" },
  reaction: { icon: "❤️", label: "Reactions", unit: "reaction" },
};
const TYPES = Object.keys(KIND) as TaskType[];
const TYPE_RE = "(channel|group|post|bot|reaction)";

async function earnMenu(ctx: Context) {
  const counts = await Promise.all(TYPES.map((t) => countActive(t)));
  const kb = new InlineKeyboard();
  TYPES.forEach((t, i) => {
    kb.text(`${KIND[t].icon} ${KIND[t].label} · ${counts[i]}`, `earn:${t}`);
    if (i % 2 === 1) kb.row();
  });
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
  const rewardLine = `Reward: ${fmt(reward)} ${cfg.currency}${lv.taskBonus ? ` (includes ${lv.taskBonus}% level bonus)` : ""}`;
  const kb = new InlineKeyboard();
  let text = "";

  if (type === "channel" || type === "group") {
    kb.url(type === "channel" ? "Open channel" : "Open group", t.link).row().text("✅ Check", `tchk:${t.id}`).row();
    text = `${KIND[type].icon} ${t.title}\n\n${rewardLine}\n\n1. Open the link and ${type === "channel" ? "subscribe to the channel" : "join the group"}.\n2. Come back and press Check.\n\nStay for ${cfg.tasks.retentionDays} days. Leaving early costs you a penalty.`;
  } else if (type === "post") {
    try {
      await ctx.api.forwardMessage(ctx.from!.id, t.meta?.fromChatId as number, t.meta?.messageId as number);
    } catch {
      await getDb().collection("tasks").doc(t.id).update({ status: "paused", pauseReason: "post_unavailable" }).catch(() => {});
      await show(ctx, "That post is no longer available. Tap Skip to see another.", new InlineKeyboard().text("⏭ Skip", `earn:${type}`));
      return;
    }
    await getDb().collection("views").doc(`${t.id}_${ctx.from!.id}`).set({ startedAt: Date.now() });
    ctx.fresh = true;
    kb.text("✅ Done", `tvw:${t.id}`).row();
    text = `👁 View the post above\n\n${rewardLine}\n\nLook at it, then press Done (it works after ${cfg.tasks.viewWaitSeconds} seconds).`;
  } else {
    kb.url(type === "bot" ? "Open bot" : "Open post", t.link).row().text("📸 Submit proof", `tpf:${t.id}`).row();
    text = `${KIND[type].icon} ${t.title}\n\n${rewardLine}\n\n${t.meta?.instruction ? `What to do: ${t.meta.instruction}\n\n` : ""}1. Open the link and do the task.\n2. Press Submit proof and send a screenshot.\n\nThe promoter checks it (it is approved automatically after ${cfg.tasks.proofAutoApproveHours} hours if they don't answer).`;
  }
  kb.text("⏭ Skip", `earn:${type}`).text("⚠️ Report", `trep:${t.id}`).row().text("⬅️ Back", "earn:menu");
  await show(ctx, text, kb);
}

export function registerEarn(bot: Bot) {
  action(bot, "earn", L.earn, earnMenu);
  bot.callbackQuery("earn:menu", async (ctx) => { await ctx.answerCallbackQuery(); await earnMenu(ctx); });

  bot.callbackQuery(new RegExp(`^earn:${TYPE_RE}$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTask(ctx, ctx.match[1] as TaskType);
  });

  bot.callbackQuery(new RegExp(`^cap:(\\d+):${TYPE_RE}$`), async (ctx) => {
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
    const m = await membership(task.chatId, ctx.from.id, task.botId);
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

  /* post views: forwarded post, then Done after a few seconds */
  bot.callbackQuery(/^tvw:(\w+)$/, async (ctx) => {
    const task = await getTask(ctx.match[1]);
    if (!task || task.status !== "active") {
      await ctx.answerCallbackQuery({ text: "This task is no longer available.", show_alert: true });
      return showTask(ctx, "post");
    }
    const cfg = await getConfig();
    const view = await getDb().collection("views").doc(`${task.id}_${ctx.from.id}`).get();
    const waited = view.exists ? Date.now() - (view.data()!.startedAt as number) : 0;
    if (!view.exists || waited < cfg.tasks.viewWaitSeconds * 1000) {
      return void (await ctx.answerCallbackQuery({ text: `Look at the post first. Wait ${cfg.tasks.viewWaitSeconds} seconds, then press Done.`, show_alert: true }));
    }
    const capRef = getDb().collection("view_caps").doc(`${ctx.from.id}_${dayKey(Date.now())}`);
    const used = ((await capRef.get()).data()?.n as number) || 0;
    if (used >= cfg.tasks.viewDailyCap) return void (await ctx.answerCallbackQuery({ text: "You've reached today's limit for post views. Come back tomorrow.", show_alert: true }));
    const r = await completeTask(ctx.from.id, task.id);
    if (!r.ok) {
      await ctx.answerCallbackQuery({ text: r.reason === "done" ? "You already viewed this post." : "This task is no longer available.", show_alert: true });
      return showTask(ctx, "post");
    }
    await capRef.set({ n: used + 1 }, { merge: true });
    await ctx.answerCallbackQuery({ text: `+${fmt(r.payout)} ${cfg.currency}` });
    void notifyAchievements(ctx.from.id);
    await showTask(ctx, "post");
  });

  /* bot starts and reactions: screenshot proof */
  bot.callbackQuery(/^tpf:(\w+)$/, async (ctx) => {
    const task = await getTask(ctx.match[1]);
    if (!task || task.status !== "active" || !PROOF_TYPES.includes(task.type)) {
      return void (await ctx.answerCallbackQuery({ text: "This task is no longer available.", show_alert: true }));
    }
    if ((await getDb().collection("proofs").doc(`${task.id}_${ctx.from.id}`).get()).exists) {
      return void (await ctx.answerCallbackQuery({ text: "You already sent a proof for this task.", show_alert: true }));
    }
    await ctx.answerCallbackQuery();
    await setState(ctx.from.id, "proof:wait", { taskId: task.id });
    await ctx.reply("📸 Send your screenshot now, as a photo.\nIt must clearly show that you completed the task.\n\nSend /cancel to stop.");
  });

  /* "Check again" from the leave warning */
  bot.callbackQuery(/^lv:(\w+)$/, async (ctx) => {
    const r = await restoreFromGrace(ctx.match[1], ctx.from.id);
    if (r === "restored") {
      await ctx.answerCallbackQuery({ text: "✅ Welcome back! Your reward is safe." });
      await ctx.editMessageText("✅ You're subscribed again. Your reward is safe. Stay for the full period to keep it.").catch(() => {});
    } else if (r === "still_left") {
      await ctx.answerCallbackQuery({ text: "You haven't joined yet. Tap Subscribe again, join, then press Check again.", show_alert: true });
    } else if (r === "error") {
      await ctx.answerCallbackQuery({ text: "Can't check right now. Try again in a minute.", show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: "This request is no longer active.", show_alert: true });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    }
  });

  bot.callbackQuery(/^trep:(\w+)$/, async (ctx) => {
    const task = await getTask(ctx.match[1]);
    await reportTask(ctx.from.id, ctx.match[1]);
    await ctx.answerCallbackQuery({ text: "Reported. Thank you." });
    await showTask(ctx, task?.type ?? "channel");
  });
}
