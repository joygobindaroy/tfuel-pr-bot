import { InlineKeyboard, type Bot, type Context } from "grammy";
import { apiFor } from "../bots";
import { chatsCol, getChat, refreshChat, registerChat, withChatDefaults, type ChatDoc } from "../chats";
import { getConfig } from "../config";
import { L } from "../labels";
import { bustMandatoryCache } from "../mandatory";
import { NOT_ADMIN_HELP, pickerKeyboard } from "../picker";
import { setState } from "../state";
import { fmt, mainMenu, show } from "../ui";
import type { UserState } from "../users";

const icon = (c: ChatDoc) => (c.type === "channel" ? "📢" : "👥");

async function list(ctx: Context) {
  const snap = await chatsCol().where("ownerId", "==", ctx.from!.id).limit(40).get();
  const chats = snap.docs.map((d) => withChatDefaults(d.data())).filter((c) => c.status === "active");
  const kb = new InlineKeyboard();
  chats.forEach((c) => kb.text(`${icon(c)} ${c.title.slice(0, 26)} · ${fmt(c.memberCount)}${c.ads.enabled ? " · ads on" : ""}`, `ch:v:${c.id}`).row());
  kb.text("➕ Add a channel", "ch:add:channel").text("➕ Add a group", "ch:add:group");
  await show(
    ctx,
    chats.length
      ? "📡 Your chats\n\nChats where this bot is an admin and you are the owner. Turn on sponsored posts to earn bonuses, or require subscriptions in your group."
      : "📡 You have no chats here yet.\n\nAdd the bot as an admin of your channel or group, or tap a button below to connect one.",
    kb
  );
}

async function detail(ctx: Context, id: number) {
  const cfg = await getConfig();
  const c = await getChat(id);
  if (!c || c.ownerId !== ctx.from!.id) return show(ctx, "Chat not found.");
  const miss: string[] = [];
  if (!c.botAdmin) miss.push("the bot is not an admin here");
  if (c.type === "channel" && !c.rights.canPost) miss.push("the bot can't post messages");
  if (c.type !== "channel" && c.mandatory.enabled && !c.rights.canDelete) miss.push("the bot can't delete messages");
  const kb = new InlineKeyboard()
    .text(c.ads.enabled ? "🔕 Turn sponsored posts off" : "🔔 Turn sponsored posts on", `ch:ads:${id}`).row()
    .text("1/day", `ch:max:${id}:1`).text("2/day", `ch:max:${id}:2`).text("3/day", `ch:max:${id}:3`).row();
  if (c.type !== "channel") kb.text("🔒 Mandatory subscription", `ch:ms:${id}`).row();
  kb.text("🔄 Refresh", `ch:ref:${id}`).text("⬅️ Back", "ch:list");
  await show(
    ctx,
    `${icon(c)} ${c.title}\n${c.username ? "@" + c.username : "private"} · ${fmt(c.memberCount)} members\n\nSponsored posts: ${c.ads.enabled ? "on" : "off"} (up to ${c.ads.maxPerDay}/day)\nEarned from posts: ${fmt(c.earned)} ${cfg.currency}${miss.length ? `\n\n⚠️ Fix: ${miss.join("; ")}.` : ""}`,
    kb
  );
}

async function msView(ctx: Context, id: number) {
  const c = await getChat(id);
  if (!c || c.ownerId !== ctx.from!.id) return show(ctx, "Chat not found.");
  const cfg = await getConfig();
  const names: string[] = [];
  for (const rid of c.mandatory.required) names.push((await getChat(rid))?.title ?? String(rid));
  const kb = new InlineKeyboard()
    .text(c.mandatory.enabled ? "⏸ Turn off" : "▶️ Turn on", `ch:mst:${id}`)
    .text(c.mandatory.mode === "delete" ? "Mode: delete message" : "Mode: mute user", `ch:msm:${id}`).row();
  if (c.mandatory.required.length < cfg.mandatory.maxRequired) kb.text("➕ Add required channel", `ch:msa:${id}:channel`).text("➕ Add required group", `ch:msa:${id}:group`).row();
  c.mandatory.required.forEach((rid, i) => kb.text(`✖ ${names[i].slice(0, 28)}`, `ch:msr:${id}:${i}`).row());
  kb.text("⬅️ Back", `ch:v:${id}`);
  await show(
    ctx,
    `🔒 Mandatory subscription for ${c.title}\n\nMembers must join these before they can write here (up to ${cfg.mandatory.maxRequired}). The bot needs the right to delete messages${c.mandatory.mode === "mute" ? " and restrict members" : ""}.\n\nStatus: ${c.mandatory.enabled ? "on" : "off"}\nRequired: ${names.length ? names.join(", ") : "none yet"}`,
    kb
  );
}

async function isChatAdmin(ctx: Context, chatId: number, userId: number) {
  try { const m = await ctx.api.getChatMember(chatId, userId); return m.status === "creator" || m.status === "administrator"; } catch { return false; }
}

export function registerChats(bot: Bot) {
  bot.hears(L.chats, async (ctx) => { await setState(ctx.from!.id, null); await list(ctx); });
  bot.callbackQuery("ch:list", async (ctx) => { await ctx.answerCallbackQuery(); await list(ctx); });
  bot.callbackQuery(/^ch:v:(-?\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await detail(ctx, Number(ctx.match[1])); });

  bot.callbackQuery(/^ch:ads:(-?\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const c = await getChat(id);
    if (!c || c.ownerId !== ctx.from.id) return void (await ctx.answerCallbackQuery({ text: "Not allowed.", show_alert: true }));
    const on = !c.ads.enabled;
    await chatsCol().doc(String(id)).update({ "ads.enabled": on, "ads.acceptedAt": on ? Date.now() : null, "ads.acceptedBy": on ? ctx.from.id : null });
    await ctx.answerCallbackQuery({ text: on ? "Sponsored posts on." : "Sponsored posts off." });
    await detail(ctx, id);
  });
  bot.callbackQuery(/^ch:max:(-?\d+):([123])$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const c = await getChat(id);
    if (!c || c.ownerId !== ctx.from.id) return void (await ctx.answerCallbackQuery({ text: "Not allowed.", show_alert: true }));
    await chatsCol().doc(String(id)).update({ "ads.maxPerDay": Number(ctx.match[2]) });
    await ctx.answerCallbackQuery({ text: "Saved." });
    await detail(ctx, id);
  });
  bot.callbackQuery(/^ch:ref:(-?\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Refreshing…" });
    await refreshChat(Number(ctx.match[1]));
    await detail(ctx, Number(ctx.match[1]));
  });

  /* add / connect a chat with Telegram's picker */
  bot.callbackQuery(/^ch:add:(channel|group)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx.from.id, "chats:add", { kind: ctx.match[1] });
    await ctx.reply("Choose the chat to connect (the bot must be an admin):", { reply_markup: pickerKeyboard(ctx.match[1] as "channel" | "group", "register") });
  });

  /* mandatory subscription */
  bot.callbackQuery(/^ch:ms:(-?\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await msView(ctx, Number(ctx.match[1])); });
  bot.callbackQuery(/^ch:mst:(-?\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const c = await getChat(id);
    if (!c || c.ownerId !== ctx.from.id) return void (await ctx.answerCallbackQuery({ text: "Not allowed.", show_alert: true }));
    if (!c.mandatory.enabled && (!c.botAdmin || !c.rights.canDelete)) return void (await ctx.answerCallbackQuery({ text: "Give the bot admin rights to delete messages first.", show_alert: true }));
    if (!c.mandatory.enabled && c.mandatory.required.length === 0) return void (await ctx.answerCallbackQuery({ text: "Add at least one required channel first.", show_alert: true }));
    await chatsCol().doc(String(id)).update({ "mandatory.enabled": !c.mandatory.enabled });
    bustMandatoryCache(id);
    await ctx.answerCallbackQuery({ text: !c.mandatory.enabled ? "Turned on." : "Turned off." });
    await msView(ctx, id);
  });
  bot.callbackQuery(/^ch:msm:(-?\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const c = await getChat(id);
    if (!c || c.ownerId !== ctx.from.id) return void (await ctx.answerCallbackQuery({ text: "Not allowed.", show_alert: true }));
    const mode = c.mandatory.mode === "delete" ? "mute" : "delete";
    if (mode === "mute" && !c.rights.canRestrict) return void (await ctx.answerCallbackQuery({ text: "Give the bot the right to restrict members first.", show_alert: true }));
    await chatsCol().doc(String(id)).update({ "mandatory.mode": mode });
    bustMandatoryCache(id);
    await ctx.answerCallbackQuery({ text: `Mode: ${mode}.` });
    await msView(ctx, id);
  });
  bot.callbackQuery(/^ch:msa:(-?\d+):(channel|group)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx.from.id, "ms:add", { chatId: Number(ctx.match[1]) });
    await ctx.reply("Choose the channel or group members must join (the bot must be an admin there):", { reply_markup: pickerKeyboard(ctx.match[2] as "channel" | "group", "required") });
  });
  bot.callbackQuery(/^ch:msr:(-?\d+):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const c = await getChat(id);
    if (!c || c.ownerId !== ctx.from.id) return void (await ctx.answerCallbackQuery({ text: "Not allowed.", show_alert: true }));
    const req = c.mandatory.required.filter((_, i) => i !== Number(ctx.match[2]));
    await chatsCol().doc(String(id)).update({ "mandatory.required": req, ...(req.length === 0 ? { "mandatory.enabled": false } : {}) });
    bustMandatoryCache(id);
    await ctx.answerCallbackQuery({ text: "Removed." });
    await msView(ctx, id);
  });

  bot.hears("I'm not an admin", async (ctx) => {
    await setState(ctx.from!.id, null);
    await ctx.reply(NOT_ADMIN_HELP, { reply_markup: mainMenu });
  });
  bot.hears("⬅️ Back", async (ctx) => {
    await setState(ctx.from!.id, null);
    await ctx.reply("Main menu.", { reply_markup: mainMenu });
  });
}

/** `chat_shared` arrived while the user was connecting a chat or picking a required chat. */
export async function chatsChatShared(ctx: Context, st: UserState) {
  const uid = ctx.from!.id;
  const shared = ctx.message!.chat_shared!;
  const chatId = shared.chat_id;
  const api = ctx.api;
  try {
    const info = await api.getChat(chatId);
    const me = await api.getChatMember(chatId, ctx.me.id);
    if (me.status !== "administrator") return void (await ctx.reply("I'm not an admin there yet. Add me as an admin, then choose the chat again.", { reply_markup: mainMenu }));
    if (!(await isChatAdmin(ctx, chatId, uid))) return void (await ctx.reply("Only an admin of that chat can connect it.", { reply_markup: mainMenu }));
    const doc = await registerChat(api, ctx.botId, { id: chatId, type: info.type, title: "title" in info ? info.title : undefined, username: "username" in info ? info.username : undefined }, uid);
    await setState(uid, null);
    if (!doc) return;

    if (st.step === "ms:add") {
      const target = await getChat(Number(st.data.chatId));
      if (!target || target.ownerId !== uid) return void (await ctx.reply("That group isn't yours.", { reply_markup: mainMenu }));
      if (doc.id === target.id) return void (await ctx.reply("A group can't require itself.", { reply_markup: mainMenu }));
      const cfg = await getConfig();
      const req = [...new Set([...target.mandatory.required, doc.id])].slice(0, cfg.mandatory.maxRequired);
      await chatsCol().doc(String(target.id)).update({ "mandatory.required": req });
      bustMandatoryCache(target.id);
      await ctx.reply(`✅ Added ${doc.title}.`, { reply_markup: mainMenu });
      return void (await msView(ctx, target.id));
    }
    await ctx.reply(`✅ Connected ${doc.title}.`, { reply_markup: mainMenu });
    await detail(ctx, doc.id);
  } catch (e) {
    console.error("chat_shared", e);
    await ctx.reply("I couldn't read that chat. Make sure I'm an admin there and try again.", { reply_markup: mainMenu });
  }
}

export { apiFor };
