import { InlineKeyboard, type Bot, type Context } from "grammy";
import { registerChat } from "../chats";
import { getConfig } from "../config";
import { getDb } from "../firebase";
import { L } from "../labels";
import { NOT_ADMIN_HELP, pickerKeyboard } from "../picker";
import { setState } from "../state";
import { quote, saveDraft, type TaskDraft } from "../taskpay";
import {
  addActions, createTask, getTask, myTasks, setTaskStatus, taskPrice,
  type NewTask, type TaskDoc, type TaskType,
} from "../tasks";
import { fmt, mainMenu, show } from "../ui";
import { getUser, type UserState } from "../users";
import { action } from "./actions";

const templates = () => getDb().collection("templates");
type Draft = TaskDraft;

const errText = (e: unknown) => {
  const m = String((e as Error).message);
  if (m === "insufficient_balance") return "Not enough balance. Pay with Stars instead, or open Profile and deposit.";
  if (m === "too_many_tasks") return "You have too many active tasks.";
  if (m === "bad_count") return "That amount is outside the allowed range.";
  return "Something went wrong. Please try again.";
};

function promoteMenu() {
  return new InlineKeyboard()
    .text("📢 Channel", "pro:new:channel").text("👥 Group", "pro:new:group").row()
    .text("📋 My tasks", "pro:list").text("📑 Templates", "pro:tpl");
}

/* ---------- wizard steps (each one stores state and asks the next question) ---------- */

async function toPrice(ctx: Context, d: Record<string, unknown>) {
  const cfg = await getConfig();
  const p = taskPrice(d.type as TaskType, cfg, { premium: !!d.premiumOnly });
  await setState(ctx.from!.id, "promote:price", d);
  const kb = new InlineKeyboard().text(`Minimum ${fmt(p.min)}`, `pro:price:${p.min}`).text(`Recommended ${fmt(p.recommended)}`, `pro:price:${p.recommended}`);
  await ctx.reply(
    `💲 Set the price for 1 ${d.type === "channel" ? "subscription" : "member"}. This is the worker's reward.\n\nMinimum — ${fmt(p.min)} ${cfg.currency}\nRecommended — ${fmt(p.recommended)} ${cfg.currency}\n\nCompletion speed depends on your price: higher rewards are shown first.\nSend a number or tap a button.`,
    { reply_markup: kb }
  );
}

async function toCount(ctx: Context, d: Record<string, unknown>) {
  const cfg = await getConfig();
  const u = await getUser(ctx.from!.id);
  const p = taskPrice(d.type as TaskType, cfg, { premium: !!d.premiumOnly, reward: d.reward as number });
  await setState(ctx.from!.id, "promote:count", d);
  const kb = new InlineKeyboard();
  [10, 20, 50, 100].filter((n) => n >= cfg.tasks.minActions).forEach((n) => kb.text(String(n), `pro:n:${n}`));
  const max = Math.floor((u?.balance ?? 0) / p.cost);
  kb.row();
  if (max >= cfg.tasks.minActions) kb.text(`${fmt(Math.min(max, cfg.tasks.maxActions))} (maximum for your balance)`, `pro:n:${Math.min(max, cfg.tasks.maxActions)}`).row();
  kb.text("⬅️ Back", "pro:menu");
  await show(
    ctx,
    `ℹ️ Task creation commission — ${cfg.tasks.commissionPct}%\n\nPrice per ${d.type === "channel" ? "subscription" : "member"} — ${fmt(p.cost)} ${cfg.currency} (reward ${fmt(p.reward)} + fee)\nYour balance — ${fmt(u?.balance ?? 0)} ${cfg.currency}\n\nEnter the number you want (${cfg.tasks.minActions} to ${fmt(cfg.tasks.maxActions)}) or choose:`,
    kb
  );
}

async function toCountries(ctx: Context, d: Record<string, unknown>) {
  const cfg = await getConfig();
  await setState(ctx.from!.id, "promote:countries", d);
  await show(
    ctx,
    `🌍 Target countries? Send 2-letter codes like US,BD,IN or choose below.\n(Restricting adds +${cfg.tasks.targetingFee} ${cfg.currency} to the reward per unit.)`,
    new InlineKeyboard().text("All countries", "pro:c:all")
  );
}

async function toDaily(ctx: Context, d: Record<string, unknown>) {
  const cfg = await getConfig();
  await setState(ctx.from!.id, "promote:daily", d);
  await show(ctx, `Daily budget in ${cfg.currency}? Send a number to cap spending per day.`, new InlineKeyboard().text("No limit", "pro:d:0"));
}

async function toStart(ctx: Context, d: Record<string, unknown>) {
  await setState(ctx.from!.id, "promote:start", d);
  await show(ctx, "When should it start? Send a UTC time like 2026-11-01 14:30, or start now.", new InlineKeyboard().text("Start now", "pro:s:now"));
}

async function toConfirm(ctx: Context, d: Draft) {
  const cfg = await getConfig();
  const u = await getUser(ctx.from!.id);
  const q = quote(d, cfg);
  await setState(ctx.from!.id, "promote:confirm", d);
  const when = d.startAt > Date.now() ? new Date(d.startAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "now";
  const kb = new InlineKeyboard();
  if ((u?.balance ?? 0) >= q.total) kb.text(`💰 Pay ${fmt(q.total)} ${cfg.currency} from balance`, "pro:pay:bal").row();
  kb.text(`⭐ Pay ${fmt(q.stars)} Telegram Stars (-${cfg.tasks.starsDiscountPct}%)`, "pro:pay:stars").row()
    .text("💾 Save as template", "pro:savetpl").text("✖ Cancel", "pro:cancel");
  await show(
    ctx,
    `Review your task\n\nType: ${d.type}\nTarget: ${d.title}\nAudience: ${d.premiumOnly ? "Telegram Premium only" : "All users"}\nAmount: ${fmt(d.count)}\nReward each: ${fmt(q.reward)} ${cfg.currency} + ${cfg.tasks.commissionPct}% fee = ${fmt(q.cost)}\nTotal: ${fmt(q.total)} ${cfg.currency}\nCountries: ${d.countries.length ? d.countries.join(", ") : "all"}\nDaily budget: ${d.dailyBudget ? fmt(d.dailyBudget) : "no limit"}\nStarts: ${when}\n\n💳 Choose a payment method:${(u?.balance ?? 0) < q.total ? `\n(Your balance is ${fmt(u?.balance ?? 0)}, so only Stars are available.)` : ""}`,
    kb
  );
}

/* ---------- task management views ---------- */

function taskCard(t: TaskDoc, cur: string) {
  const retained = t.completed ? Math.round((1 - t.leaves / t.completed) * 100) : 100;
  return `📌 ${t.title}\nStatus: ${t.status}${t.pauseReason ? ` (${t.pauseReason})` : ""}${t.premiumOnly ? "\nAudience: Premium only" : ""}\nReward each: ${fmt(t.reward)} ${cur}\nDone: ${t.completed}/${t.total}  Left to do: ${t.remaining}\nSpent: ${fmt(t.spent)} ${cur}  In escrow: ${fmt(t.reserved)} ${cur}\nRetention: ${retained}%  (left early: ${t.leaves}, auto-refilled)\nReports: ${t.reports}\nDaily: ${t.dailyBudget ? `${fmt(t.dailySpent)}/${fmt(t.dailyBudget)} today` : "no limit"}\nCountries: ${t.countries.length ? t.countries.join(", ") : "all"}`;
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

async function taskAction(ctx: Context, id: string, act: "pause" | "resume" | "cancel") {
  try {
    const r = await setTaskStatus(id, { id: ctx.from!.id, admin: false }, act);
    await ctx.answerCallbackQuery({ text: act === "cancel" ? `Cancelled. Refunded ${fmt(r.refund)}.` : `Task ${r.status}.` });
  } catch {
    await ctx.answerCallbackQuery({ text: "Can't do that right now.", show_alert: true });
  }
  await taskView(ctx, id);
}

const stateOf = async (ctx: Context) => (await getUser(ctx.from!.id))?.state ?? null;

export function registerPromote(bot: Bot) {
  const open = async (ctx: Context) => {
    await setState(ctx.from!.id, null);
    const [cfg, u] = await Promise.all([getConfig(), getUser(ctx.from!.id)]);
    await show(ctx, `What do you want to promote?\n\nBalance: ${fmt(u?.balance ?? 0)} ${cfg.currency}`, promoteMenu());
  };
  action(bot, "promote", L.promote, open);
  bot.callbackQuery("pro:menu", async (ctx) => { await ctx.answerCallbackQuery(); await open(ctx); });

  bot.callbackQuery(/^pro:new:(channel|group)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const type = ctx.match[1] as TaskType;
    await setState(ctx.from.id, "promote:pick", { type });
    await ctx.reply(`Choose a ${type === "channel" ? "channel" : "group"} to promote (the bot must be an admin).`, { reply_markup: pickerKeyboard(type, "promote") });
  });

  bot.callbackQuery(/^pro:aud:(all|prem)$/, async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:audience") return void (await ctx.answerCallbackQuery({ text: "Session expired. Start again.", show_alert: true }));
    await ctx.answerCallbackQuery();
    const premiumOnly = ctx.match[1] === "prem";
    await show(ctx, `Audience: ${premiumOnly ? "Telegram Premium only" : "All users"}.`);
    await toPrice(ctx, { ...st.data, premiumOnly });
  });

  /* quick-answer buttons for each step */
  bot.callbackQuery(/^pro:price:([\d.]+)$/, async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:price") return void (await ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true }));
    await ctx.answerCallbackQuery();
    await toCount(ctx, { ...st.data, reward: Number(ctx.match[1]) });
  });
  bot.callbackQuery(/^pro:n:(\d+)$/, async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:count") return void (await ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true }));
    await ctx.answerCallbackQuery();
    await toCountries(ctx, { ...st.data, count: Number(ctx.match[1]) });
  });
  bot.callbackQuery("pro:c:all", async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:countries") return void (await ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true }));
    await ctx.answerCallbackQuery();
    await toDaily(ctx, { ...st.data, countries: [] });
  });
  bot.callbackQuery("pro:d:0", async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:daily") return void (await ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true }));
    await ctx.answerCallbackQuery();
    await toStart(ctx, { ...st.data, dailyBudget: 0 });
  });
  bot.callbackQuery("pro:s:now", async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:start") return void (await ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true }));
    await ctx.answerCallbackQuery();
    await toConfirm(ctx, { ...st.data, startAt: 0 } as unknown as Draft);
  });

  bot.callbackQuery("pro:cancel", async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    await open(ctx);
  });

  /* payment: balance or Telegram Stars, right now */
  bot.callbackQuery("pro:pay:bal", async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:confirm") return void (await ctx.answerCallbackQuery({ text: "Session expired. Start again.", show_alert: true }));
    const d = st.data as unknown as Draft;
    try {
      const r = await createTask({ ownerId: ctx.from.id, ...d, botId: ctx.botId } as NewTask);
      await setState(ctx.from.id, null);
      await ctx.answerCallbackQuery({ text: "Task created." });
      await show(ctx, `✅ Task created and ${d.startAt > Date.now() ? "scheduled" : "live"}.\nCharged: ${fmt(r.total)} from your balance.`, new InlineKeyboard().text("📋 My tasks", "pro:list"));
    } catch (e) {
      await ctx.answerCallbackQuery({ text: errText(e), show_alert: true });
    }
  });

  bot.callbackQuery("pro:pay:stars", async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:confirm") return void (await ctx.answerCallbackQuery({ text: "Session expired. Start again.", show_alert: true }));
    const d = st.data as unknown as Draft;
    const cfg = await getConfig();
    const q = quote(d, cfg);
    const id = await saveDraft(ctx.from.id, ctx.botId, d, q.total, q.stars);
    await ctx.answerCallbackQuery();
    await ctx.replyWithInvoice(
      `Promote ${d.title}`.slice(0, 32),
      `${fmt(d.count)} × ${fmt(q.reward)} ${cfg.currency} reward. Non-refundable. Your task starts right after payment.`,
      `tsk:${id}`,
      "XTR",
      [{ label: `${fmt(d.count)} ${d.type === "channel" ? "subscriptions" : "members"}`, amount: q.stars }]
    );
  });

  bot.callbackQuery("pro:savetpl", async (ctx) => {
    const st = await stateOf(ctx);
    if (st?.step !== "promote:confirm") return ctx.answerCallbackQuery({ text: "Session expired.", show_alert: true });
    const d = st.data as unknown as Draft;
    const count = await templates().where("ownerId", "==", ctx.from.id).count().get();
    if (count.data().count >= 10) return ctx.answerCallbackQuery({ text: "Template limit reached (10).", show_alert: true });
    const ref = templates().doc();
    await ref.set({ id: ref.id, ownerId: ctx.from.id, name: `${d.type}: ${d.title}`.slice(0, 40), ...d, startAt: 0, createdAt: Date.now() });
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
    const cfg = await getConfig();
    const d = s.data() as Partial<Draft>;
    const type = d.type as TaskType;
    const min = taskPrice(type, cfg, { premium: !!d.premiumOnly }).min;
    const draft: Draft = {
      type, chatId: d.chatId as number, username: d.username ?? "", title: d.title ?? "", link: d.link ?? "",
      premiumOnly: !!d.premiumOnly, reward: Math.max(d.reward ?? 0, min), count: d.count ?? 0, countries: d.countries ?? [], dailyBudget: d.dailyBudget ?? 0, startAt: 0,
    };
    await toConfirm(ctx, draft);
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
    list.forEach((t) => kb.text(`${t.status === "active" ? "🟢" : t.status === "paused" ? "⏸" : t.status === "done" ? "✅" : "⚫"} ${t.title.slice(0, 22)} ${t.completed}/${t.total}`, `pro:t:${t.id}`).row());
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

  bot.hears("I'm not an admin", async (ctx) => {
    await setState(ctx.from!.id, null);
    await ctx.reply(NOT_ADMIN_HELP, { reply_markup: mainMenu });
  });
}

/** The user picked a chat with Telegram's chat picker. */
export async function promoteChatShared(ctx: Context, st: UserState) {
  const uid = ctx.from!.id;
  const cfg = await getConfig();
  const type = st.data.type as TaskType;
  const chatId = ctx.message!.chat_shared!.chat_id;
  try {
    const info = await ctx.api.getChat(chatId);
    const okType = type === "channel" ? info.type === "channel" : info.type === "supergroup" || info.type === "group";
    if (!okType) return void (await ctx.reply(`That is not a ${type}. Choose again.`, { reply_markup: mainMenu }));
    const me = await ctx.api.getChatMember(chatId, ctx.me.id);
    if (me.status !== "administrator") return void (await ctx.reply("I'm not an admin there yet. Add me as an admin, then try again.", { reply_markup: mainMenu }));
    const you = await ctx.api.getChatMember(chatId, uid);
    if (you.status !== "creator" && you.status !== "administrator") return void (await ctx.reply("Only an admin of that chat can promote it.", { reply_markup: mainMenu }));

    const doc = await registerChat(ctx.api, ctx.botId, { id: chatId, type: info.type, title: "title" in info ? info.title : undefined, username: "username" in info ? info.username : undefined }, uid);
    const username = doc?.username ?? "";
    let link = username ? `https://t.me/${username}` : doc?.inviteLink ?? "";
    if (!link) {
      try { link = (await ctx.api.createChatInviteLink(chatId, { name: "TFUEL task" })).invite_link; } catch { /* handled below */ }
    }
    if (!link) return void (await ctx.reply("This chat is private and I can't create an invite link. Make it public, or give me the “Invite users” right.", { reply_markup: mainMenu }));

    const title = doc?.title ?? ("title" in info ? info.title : String(chatId));
    await setState(uid, "promote:audience", { type, chatId, username, title, link });
    await ctx.reply(`You shared ${title}.`, { reply_markup: mainMenu });
    const all = taskPrice(type, cfg), prem = taskPrice(type, cfg, { premium: true });
    const kb = new InlineKeyboard().text("1 · All users", "pro:aud:all").text("2 · Premium only", "pro:aud:prem");
    await ctx.reply(
      `Task audience\nCurrent: no restrictions\n\nChoose who can access the task:\n\n1️⃣ All users\nBroad reach. Minimum reward: ${fmt(all.min)} ${cfg.currency}.\n\n2️⃣ Telegram Premium only\nA higher-quality audience. Minimum reward: ${fmt(prem.min)} ${cfg.currency}.`,
      { reply_markup: kb }
    );
  } catch (e) {
    console.error("promote chat_shared", e);
    await ctx.reply("I couldn't read that chat. Make sure I'm an admin there and try again.", { reply_markup: mainMenu });
  }
}

/** Text answers for the promote wizard. */
export async function promoteText(ctx: Context, st: UserState) {
  const text = ctx.message!.text!.trim();
  const uid = ctx.from!.id;
  const cfg = await getConfig();
  const d = st.data as Record<string, unknown>;
  const num = (s: string) => Number(s.replace(/,/g, ""));

  if (st.step === "promote:price") {
    const p = taskPrice(d.type as TaskType, cfg, { premium: !!d.premiumOnly });
    const n = num(text);
    if (!Number.isFinite(n) || n < p.min) return void (await ctx.reply(`The minimum is ${fmt(p.min)} ${cfg.currency}. Send that or more.`));
    return void (await toCount(ctx, { ...d, reward: n }));
  }

  if (st.step === "promote:count") {
    const n = Math.floor(num(text));
    if (!Number.isFinite(n) || n < cfg.tasks.minActions || n > cfg.tasks.maxActions)
      return void (await ctx.reply(`Send a number between ${cfg.tasks.minActions} and ${fmt(cfg.tasks.maxActions)}.`));
    return void (await toCountries(ctx, { ...d, count: n }));
  }

  if (st.step === "promote:countries") {
    const countries = /^all$/i.test(text) ? [] : text.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) return void (await ctx.reply("Use 2-letter codes like US,BD or type: all"));
    return void (await toDaily(ctx, { ...d, countries }));
  }

  if (st.step === "promote:daily") {
    const n = num(text);
    if (!Number.isFinite(n) || n < 0) return void (await ctx.reply("Send a number, or 0 for no limit."));
    return void (await toStart(ctx, { ...d, dailyBudget: n }));
  }

  if (st.step === "promote:start") {
    let startAt = 0;
    if (!/^now$/i.test(text)) {
      const t = Date.parse(text.replace(" ", "T") + ":00Z");
      if (!Number.isFinite(t) || t < Date.now() || t > Date.now() + 60 * 86_400_000)
        return void (await ctx.reply("Use: now, or a future UTC time like 2026-11-01 14:30 (within 60 days)."));
      startAt = t;
    }
    return void (await toConfirm(ctx, { ...d, startAt } as unknown as Draft));
  }

  if (st.step === "promote:add") {
    const n = Math.floor(num(text));
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
