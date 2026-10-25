import { InlineKeyboard, type Bot, type Context } from "grammy";
import { apiFor } from "./bots";
import { getChat, withChatDefaults, type ChatDoc } from "./chats";
import { getConfig } from "./config";
import { getDb } from "./firebase";
import { logError } from "./errlog";
import { membership } from "./tasks";

/** Per-instance caches keep the hot path (every group message) off Firestore and the Telegram API. */
const cfgCache = new Map<number, { at: number; chat: ChatDoc | null }>();
const subOk = new Map<string, number>();
const adminOk = new Map<string, number>();
const reqChats = new Map<number, { at: number; chat: ChatDoc | null }>();
const warnedAt = new Map<string, number>();

export function bustMandatoryCache(chatId: number) { cfgCache.delete(chatId); }

/** Someone left a chat: forget that they were a subscriber so the next message is re-checked. */
export function forgetSubscription(chatId: number, userId: number) { subOk.delete(`${chatId}:${userId}`); }

async function groupConfig(chatId: number): Promise<ChatDoc | null> {
  const hit = cfgCache.get(chatId);
  if (hit && Date.now() - hit.at < 60_000) return hit.chat;
  const c = await getChat(chatId);
  const active = c && c.status === "active" && c.botAdmin && c.mandatory.enabled && c.mandatory.required.length > 0 ? c : null;
  cfgCache.set(chatId, { at: Date.now(), chat: active });
  return active;
}

async function requiredChat(id: number): Promise<ChatDoc | null> {
  const hit = reqChats.get(id);
  if (hit && Date.now() - hit.at < 300_000) return hit.chat;
  const c = await getChat(id);
  reqChats.set(id, { at: Date.now(), chat: c });
  return c;
}

/** Which required chats is the user missing? Errors (bot lost access) count as "fine" so nobody is locked out by our fault. */
export async function missingChats(userId: number, required: number[], fresh = false): Promise<ChatDoc[]> {
  const cfg = await getConfig();
  const ttl = cfg.mandatory.cacheMinutes * 60_000;
  const missing: ChatDoc[] = [];
  for (const rid of required) {
    const key = `${rid}:${userId}`;
    if (!fresh && (subOk.get(key) ?? 0) > Date.now()) continue;
    const rc = await requiredChat(rid);
    if (!rc) continue;
    const m = await membership(rid, userId, rc.botId);
    if (m.status === "member") subOk.set(key, Date.now() + ttl);
    else if (m.status === "left") missing.push(rc);
  }
  return missing;
}

async function isAdmin(ctx: Context, chatId: number, userId: number) {
  const key = `${chatId}:${userId}`;
  if ((adminOk.get(key) ?? 0) > Date.now()) return true;
  try {
    const m = await ctx.api.getChatMember(chatId, userId);
    if (m.status === "creator" || m.status === "administrator") { adminOk.set(key, Date.now() + 600_000); return true; }
  } catch { /* treat as non-admin */ }
  return false;
}

const joinLink = (c: ChatDoc) => (c.username ? `https://t.me/${c.username}` : c.inviteLink);

async function scheduleDelete(botId: string, chatId: number, messageId: number, seconds: number) {
  await getDb().collection("scheduled_deletes").add({ botId, chatId, messageId, at: Date.now() + seconds * 1000 });
}

async function handleGroupMessage(ctx: Context) {
  const chat = ctx.chat!;
  const from = ctx.from;
  const msg = ctx.message!;
  if (!from || from.is_bot || msg.sender_chat) return;
  const hasContent = msg.text || msg.caption || msg.photo || msg.video || msg.document || msg.sticker || msg.voice || msg.audio || msg.animation || msg.video_note || msg.poll;
  if (!hasContent) return;

  const gc = await groupConfig(chat.id);
  if (!gc) return;
  const missing = await missingChats(from.id, gc.mandatory.required);
  if (missing.length === 0) return;
  if (await isAdmin(ctx, chat.id, from.id)) return;

  const cfg = await getConfig();
  if (gc.mandatory.mode === "mute") {
    await ctx.api.restrictChatMember(chat.id, from.id, { can_send_messages: false }).catch(() => {});
  }
  await ctx.api.deleteMessage(chat.id, msg.message_id).catch(() => {});

  const wk = `${chat.id}:${from.id}`;
  if (Date.now() - (warnedAt.get(wk) ?? 0) < 60_000) return;
  warnedAt.set(wk, Date.now());
  if (warnedAt.size > 5000) warnedAt.clear();

  const kb = new InlineKeyboard();
  for (const m of missing) { const l = joinLink(m); if (l) kb.url(`Join ${m.title}`.slice(0, 40), l).row(); }
  kb.text("✅ I've subscribed", `ms:chk:${chat.id}:${from.id}`);
  const name = from.first_name || "there";
  const sent = await ctx.api.sendMessage(
    chat.id,
    `⚠️ ${name}, to write in this group you need to join:\n${missing.map((m) => `• ${m.title}`).join("\n")}\n\nThen press the button below.`,
    { reply_markup: kb }
  ).catch(() => null);
  if (sent) await scheduleDelete(ctx.botId, chat.id, sent.message_id, cfg.mandatory.warnSeconds * 4);
}

export function registerGroupGate(bot: Bot) {
  bot.on("message", async (ctx, next) => {
    const t = ctx.chat.type;
    if (t === "private") return next();
    if (t === "group" || t === "supergroup") {
      try { await handleGroupMessage(ctx); } catch (e) { await logError("group-gate", e); }
    }
  });

  bot.callbackQuery(/^ms:chk:(-?\d+):(\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);
    if (ctx.from.id !== userId) return void (await ctx.answerCallbackQuery({ text: "This button isn't for you.", show_alert: true }));
    const gc = await getChat(chatId);
    if (!gc) return void (await ctx.answerCallbackQuery());
    const missing = await missingChats(userId, gc.mandatory.required, true);
    if (missing.length > 0) {
      return void (await ctx.answerCallbackQuery({ text: `You haven't joined ${missing[0].title} yet.`, show_alert: true }));
    }
    try {
      const info = await ctx.api.getChat(chatId);
      const perms = "permissions" in info && info.permissions ? info.permissions : { can_send_messages: true };
      if (gc.mandatory.mode === "mute") await ctx.api.restrictChatMember(chatId, userId, perms);
    } catch { /* maybe never muted */ }
    await ctx.answerCallbackQuery({ text: "✅ Thanks! You can write now." });
    await ctx.deleteMessage().catch(() => {});
  });
}

export { withChatDefaults };
