import { InlineKeyboard, type Bot, type Context } from "grammy";
import { bot as botInstance } from "../botInstance";
import { getConfig } from "../config";
import { getDb } from "../firebase";
import { L } from "../labels";
import { setState } from "../state";
import {
  addActions, createTask, getTask, myTasks, setTaskStatus, taskPrice,
  type NewTask, type TaskDoc, type TaskType,
} from "../tasks";
import { fmt, show } from "../ui";
import { getUser, type UserState } from "../users";

const templates = () => getDb().collection("templates");

type Draft = {
  type: TaskType; chatId: number; username: string; title: string;
  count: number; countries: string[]; dailyBudget: number; startAt: number;
};

const errText = (e: unknown) => {
  const m = String((e as Error).message);
  if (m === "insufficient_balance") return "Not enough balance. Use Deposit to add more.";
  if (m === "too_many_tasks") return "You have too many active tasks.";
  if (m === "bad_count") return "That amount is outside the allowed range.";
  return "Something went wrong. Please try again.";
};

function promoteMenu() {
  return new InlineKeyboard()
    .text("➕ Channel task", "pro:new:channel").text("➕ Group task", "pro:new:group").row()
    .text("📋 My tasks", "pro:list").text("📑 Templates", "pro:tpl");
}

function parseUsername(text: string) {
  const m = text.trim().match(/^(?:https?:\/\/t\.me\/|@)?([A-Za-z][A-Za-z0-9_]{4,31})\/?$/);
  return m ? `@${m[1]}` : null;
}

async function summary(ctx: Context, d: Draft) {
  const cfg = await getConfig();
  const p = taskPrice(d.type, cfg);
  const total = Math.round(p.cost * d.count * 100) / 100;
  const when = d.startAt > Date.now() ? new Date(d.startAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "now";
  const kb = new InlineKeyboard()
    .text(`✅ Create (${fmt(total)} ${cfg.currency})`, "pro:ok").row()
    .text("💾 Save as template", "pro:savetpl").text("✖ Cancel", "pro:cancel");
  await show(
    ctx,
    `Review your task\n\nType: ${d.type}\nTarget: ${d.username}\nAmount: ${fmt(d.count)}\nPrice each: ${fmt(p.cost)} ${cfg.currency} (reward ${fmt(p.reward)} + ${cfg.tasks.commissionPct}% fee)\nTotal: ${fmt(total)} ${cfg.currency}\nCountries: ${d.countries.length ? d.countries.join(", ") : "all"}\nDaily budget: ${d.dailyBudget ? fmt(d.dailyBudget) : "no limit"}\nStarts: ${when}`,
    kb
  );
}

function taskCard(t: TaskDoc, cur: string) {
  const retained = t.completed ? Math.round((1 - t.leaves / t.completed) * 100) : 100;
  return `📌 ${t.title}\nStatus: ${t.status}${t.pauseReason ? ` (${t.pauseReason})` : ""}\nDone: ${t.completed}/${t.total}  Left to do: ${t.remaining}\nSpent: ${fmt(t.spent)} ${cur}  In escrow: ${fmt(t.reserved)} ${cur}\nRetention: ${retained}%  (left early: ${t.leaves}, auto-refilled)\nReports: ${t.reports}\nDaily: ${t.dailyBudget ? `${fmt(t.dailySpent)}/${fmt(t.dailyBudget)} today` : "no limit"}\nCountries: ${t.countries.length ? t.countries.join(", ") : "all"}`;
}

async function taskView(ctx: Context, id: string) {
  const cfg = await getConfig();
  const t = await getTask(id);
  if (!t || t.ownerId !== ctx.from!.id) return show(ctx, "Task not found.");
  const kb = new InlineKeyboard();
  if (t.status === "active") kb.text("⏸ Pause", `pro:pause:${id}`);
  if (t.status === "paused") kb.text("▶️ Resume", `pro:resume:${id}`);
  if (t.status !== "cancelled") kb.text("➕ Add more", `pro:add:${id}`).row().text("🛑 Cancel & refund", `pro:cancelt:${id}`);
  kb.row().text("⬅️ Back", "pro:list");
  await show(ctx, taskCard(t, cfg.currency), kb);
}

async function taskAction(ctx: Context, id: string, action: "pause" | "resume" | "cancel") {
  try {
    const r = await setTaskStatus(id, { id: ctx.from!.id, admin: false }, action);
    await ctx.answerCallbackQuery({ text: action === "cancel" ? `Cancelled. Refunded ${fmt(r.refund)}.` : `Task ${r.status}.` });
  } catch {
    await ctx.answerCallbackQuery({ text: "Can't do that right now.", show_alert: true });
  }
  await taskView(ctx, id);
}

export function registerPromote(bot: Bot) {
  const open = async (ctx: Context) => {
    await setState(ctx.from!.id, null);
    const [cfg, u] = await Promise.all([getConfig(), getUser(ctx.from!.id)]);
    await show(ctx, `What do you want to promote?\n\nBalance: ${fmt(u?.balance ?? 0)} ${cfg.currency}`, promoteMenu());
  };
  bot.hears(L.promote, open);
  bot.callbackQuery("pro:menu", async (ctx) => { await ctx.answerCallbackQuery(); await open(ctx); });

  bot.callbackQuery(/^pro:new:(channel|group)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const cfg = await getConfig();
    const type = ctx.match[1] as TaskType;
    await setState(ctx.from.id, "promote:target", { type });
    const p = taskPrice(type, cfg);
    await ctx.reply(
      `Send the public @username (or t.me link) of your ${type}.\n\n1. Add this bot as an admin there first (no special permissions needed).\n2. You must be an admin of it yourself.\n\nPrice: ${fmt(p.cost)} ${cfg.currency} per ${type === "channel" ? "subscriber" : "member"}.`
    );
  });

  bot.callbackQuery("pro:cancel", async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    await open(ctx);
  });

  bot.callbackQuery("pro:ok", async (ctx) => {
    const st = (await getUser(ctx.from.id))?.state;
    if (st?.step !== "promote:confirm") return ctx.answerCallbackQuery({ text: "Session expired. Start again.", show_alert: true });
    const d = st.data as unknown as Draft;
    try {
      const r = await createTask({ ownerId: ctx.from.id, ...d } as NewTask);
      await setState(ctx.from.id, null);
      await ctx.answerCallbackQuery({ text: "Task created." });
      await show(ctx, `✅ Task created and ${d.startAt > Date.now() ? "scheduled" : "live"}.\nCharged: ${fmt(r.total)}.`, new InlineKeyboard().text("📋 My tasks", "pro:list"));
    } catch (e) {
      await ctx.answerCallbackQuery({ text: errText(e), show_alert: true });
    }
  });

  bot.callbackQuery("pro:savetpl", async (ctx) => {
    const st = (await getUser(ctx.from.id))?.state;
    if (st?.step !== "promote:confirm") return ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true });
    const d = st.data as unknown as Draft;
    const count = await templates().where("ownerId", "==", ctx.from.id).count().get();
    if (count.data().count >= 10) return ctx.answerCallbackQuery({ text: "Template limit reached (10).", show_alert: true });
    const ref = templates().doc();
    await ref.set({ id: ref.id, ownerId: ctx.from.id, name: `${d.type}: ${d.username}`, ...d, startAt: 0, createdAt: Date.now() });
    await ctx.answerCallbackQuery({ text: "Template saved." });
  });

  bot.callbackQuery("pro:tpl", async (ctx) => {
    await ctx.answerCallbackQuery();
    const snap = await templates().where("ownerId", "==", ctx.from.id).limit(10).get();
    const kb = new InlineKeyboard();
    snap.docs.forEach((d) => kb.text(String(d.data().name), `pro:usetpl:${d.id}`).text("🗑", `pro:deltpl:${d.id}`).row());
    kb.text("⬅️ Back", "pro:menu");
    await show(ctx, snap.empty ? "No templates yet. Save one from the review screen when creating a task." : "Your templates. Tap one to reuse it:", kb);
  });

  bot.callbackQuery(/^pro:usetpl:(\w+)$/, async (ctx) => {
    const s = await templates().doc(ctx.match[1]).get();
    if (!s.exists || s.data()!.ownerId !== ctx.from.id) return ctx.answerCallbackQuery({ text: "Not found.", show_alert: true });
    await ctx.answerCallbackQuery();
    const d = s.data() as Draft & { name: string };
    const draft: Draft = { type: d.type, chatId: d.chatId, username: d.username, title: d.title, count: d.count, countries: d.countries, dailyBudget: d.dailyBudget, startAt: 0 };
    await setState(ctx.from.id, "promote:confirm", draft);
    await summary(ctx, draft);
  });

  bot.callbackQuery(/^pro:deltpl:(\w+)$/, async (ctx) => {
    const ref = templates().doc(ctx.match[1]);
    const s = await ref.get();
    if (s.exists && s.data()!.ownerId === ctx.from.id) await ref.delete();
    await ctx.answerCallbackQuery({ text: "Deleted." });
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery("pro:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const list = await myTasks(ctx.from.id);
    const kb = new InlineKeyboard();
    list.forEach((t) => kb.text(`${t.status === "active" ? "🟢" : t.status === "paused" ? "⏸" : t.status === "done" ? "✅" : "⚫"} ${t.username} ${t.completed}/${t.total}`, `pro:t:${t.id}`).row());
    kb.text("⬅️ Back", "pro:menu");
    await show(ctx, list.length ? "Your tasks:" : "You have no tasks yet.", kb);
  });

  bot.callbackQuery(/^pro:t:(\w+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await taskView(ctx, ctx.match[1]); });
  bot.callbackQuery(/^pro:pause:(\w+)$/, (ctx) => taskAction(ctx, ctx.match[1], "pause"));
  bot.callbackQuery(/^pro:resume:(\w+)$/, (ctx) => taskAction(ctx, ctx.match[1], "resume"));
  bot.callbackQuery(/^pro:cancelt:(\w+)$/, (ctx) => taskAction(ctx, ctx.match[1], "cancel"));

  bot.callbackQuery(/^pro:add:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx.from.id, "promote:add", { id: ctx.match[1] });
    await ctx.reply("How many more do you want to add? Send a number.");
  });
}

/** Text answers for the promote wizard. */
export async function promoteText(ctx: Context, st: UserState) {
  const text = ctx.message!.text!.trim();
  const uid = ctx.from!.id;
  const cfg = await getConfig();
  const d = st.data as Record<string, unknown>;

  if (st.step === "promote:target") {
    const username = parseUsername(text);
    if (!username) return void (await ctx.reply("Send a valid public @username or t.me link."));
    const type = d.type as TaskType;
    try {
      const chat = await botInstance.api.getChat(username);
      const okType = type === "channel" ? chat.type === "channel" : chat.type === "supergroup" || chat.type === "group";
      if (!okType) return void (await ctx.reply(`That is not a ${type}. Send the right link.`));
      const me = await botInstance.api.getChatMember(chat.id, ctx.me.id);
      if (me.status !== "administrator") return void (await ctx.reply("Add this bot as an admin there first, then send the link again."));
      const you = await botInstance.api.getChatMember(chat.id, uid);
      if (you.status !== "creator" && you.status !== "administrator") return void (await ctx.reply("Only an admin of that chat can promote it."));
      const title = "title" in chat && chat.title ? chat.title : username;
      await setState(uid, "promote:count", { type, chatId: chat.id, username, title });
      const p = taskPrice(type, cfg);
      return void (await ctx.reply(`Found: ${title}\n\nHow many ${type === "channel" ? "subscribers" : "members"} do you want? (${cfg.tasks.minActions} to ${fmt(cfg.tasks.maxActions)})\nPrice: ${fmt(p.cost)} each.`));
    } catch {
      return void (await ctx.reply("I couldn't find that chat, or the bot isn't an admin there. Check and try again."));
    }
  }

  if (st.step === "promote:count") {
    const n = Math.floor(Number(text.replace(/,/g, "")));
    if (!Number.isFinite(n) || n < cfg.tasks.minActions || n > cfg.tasks.maxActions)
      return void (await ctx.reply(`Send a number between ${cfg.tasks.minActions} and ${fmt(cfg.tasks.maxActions)}.`));
    await setState(uid, "promote:countries", { ...d, count: n });
    return void (await ctx.reply("Target countries? Send 2-letter codes like US,BD,IN or type: all"));
  }

  if (st.step === "promote:countries") {
    const countries = /^all$/i.test(text) ? [] : text.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) return void (await ctx.reply("Use 2-letter codes like US,BD or type: all"));
    await setState(uid, "promote:daily", { ...d, countries });
    return void (await ctx.reply(`Daily budget in ${cfg.currency}? Send a number, or 0 for no limit.`));
  }

  if (st.step === "promote:daily") {
    const n = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return void (await ctx.reply("Send a number, or 0 for no limit."));
    await setState(uid, "promote:start", { ...d, dailyBudget: n });
    return void (await ctx.reply("When should it start? Type: now\nor a UTC time like: 2026-11-01 14:30"));
  }

  if (st.step === "promote:start") {
    let startAt = 0;
    if (!/^now$/i.test(text)) {
      const t = Date.parse(text.replace(" ", "T") + ":00Z");
      if (!Number.isFinite(t) || t < Date.now() || t > Date.now() + 60 * 86_400_000)
        return void (await ctx.reply("Use: now, or a future UTC time like 2026-11-01 14:30 (within 60 days)."));
      startAt = t;
    }
    const draft = { ...d, startAt } as unknown as Draft;
    await setState(uid, "promote:confirm", draft);
    return void (await summary(ctx, draft));
  }

  if (st.step === "promote:add") {
    const n = Math.floor(Number(text.replace(/,/g, "")));
    if (!Number.isFinite(n) || n < 1) return void (await ctx.reply("Send a positive number."));
    try {
      const r = await addActions(String(d.id), uid, n);
      await setState(uid, null);
      return void (await ctx.reply(`✅ Added ${fmt(n)}. Charged ${fmt(r.cost)} ${cfg.currency}.`));
    } catch (e) {
      await setState(uid, null);
      return void (await ctx.reply(errText(e)));
    }
  }
}
