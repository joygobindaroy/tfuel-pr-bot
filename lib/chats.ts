import { InlineKeyboard, type Api, type Bot, type Context } from "grammy";
import { apiFor } from "./bots";
import { getConfig } from "./config";
import { getDb } from "./firebase";
import { sendToUser } from "./notify";
import { forgetSubscription } from "./mandatory";
import { leaveNow } from "./tasks";
import { getUser, usersCol } from "./users";

export type ChatKind = "channel" | "supergroup" | "group";

export type ChatDoc = {
  id: number;
  type: ChatKind;
  title: string;
  username: string | null;
  inviteLink: string | null;
  memberCount: number;
  botId: string;
  botAdmin: boolean;
  rights: { canPost: boolean; canDelete: boolean; canRestrict: boolean; canInvite: boolean; canPin: boolean };
  addedBy: number | null;
  ownerId: number | null;
  status: "active" | "removed";
  ads: { enabled: boolean; acceptedAt: number | null; acceptedBy: number | null; maxPerDay: number; lastPostAt: number; postsDay: string; postsToday: number };
  mandatory: { enabled: boolean; mode: "delete" | "mute"; required: number[] };
  earned: number;
  tags: string[];
  blacklisted: boolean;
  promptedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export const chatsCol = () => getDb().collection("chats");

const kindOf = (t: string): ChatKind => (t === "channel" ? "channel" : t === "supergroup" ? "supergroup" : "group");

export const withChatDefaults = (d: unknown): ChatDoc => {
  const c = d as ChatDoc;
  return {
    ...c,
    ads: Object.assign({ enabled: false, acceptedAt: null, acceptedBy: null, maxPerDay: 1, lastPostAt: 0, postsDay: "", postsToday: 0 }, c.ads),
    mandatory: Object.assign({ enabled: false, mode: "delete", required: [] }, c.mandatory),
    tags: c.tags || [],
    rights: Object.assign({ canPost: false, canDelete: false, canRestrict: false, canInvite: false, canPin: false }, c.rights),
  };
};

export async function getChat(id: number) {
  const s = await chatsCol().doc(String(id)).get();
  return s.exists ? withChatDefaults(s.data()) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const rightsOf = (m: any) => ({
  canPost: !!m.can_post_messages, canDelete: !!m.can_delete_messages, canRestrict: !!m.can_restrict_members,
  canInvite: !!m.can_invite_users, canPin: !!m.can_pin_messages,
});

/** Creates or refreshes the registry entry for a chat where the bot is (or was just made) an admin. */
export async function registerChat(
  api: Api, botId: string,
  chat: { id: number; type: string; title?: string; username?: string },
  addedBy: number | null
): Promise<ChatDoc | null> {
  if (chat.type === "private") return null;
  let me: any;
  try { me = await api.getChatMember(chat.id, Number((await api.getMe()).id)); } catch { me = null; }
  const botAdmin = me?.status === "administrator";
  const rights = botAdmin ? rightsOf(me) : { canPost: false, canDelete: false, canRestrict: false, canInvite: false, canPin: false };

  let memberCount = 0;
  try { memberCount = await api.getChatMemberCount(chat.id); } catch { /* keep 0 */ }

  let ownerId: number | null = addedBy;
  if (botAdmin) {
    try {
      const admins = await api.getChatAdministrators(chat.id);
      const creator = admins.find((a) => a.status === "creator" && !a.user.is_bot);
      if (creator) ownerId = creator.user.id;
    } catch { /* keep adder */ }
  }

  let inviteLink: string | null = null;
  if (botAdmin && rights.canInvite && !chat.username) {
    try { inviteLink = (await api.createChatInviteLink(chat.id, { name: "TFUEL" })).invite_link; } catch { /* optional */ }
  }

  const cfg = await getConfig();
  const ref = chatsCol().doc(String(chat.id));
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const old = withChatDefaults(snap.data());
    const patch: Record<string, unknown> = {
      title: chat.title || old.title, username: chat.username ?? null, type: kindOf(chat.type), memberCount: memberCount || old.memberCount,
      botId, botAdmin, rights, status: "active", updatedAt: now,
    };
    if (inviteLink) patch.inviteLink = inviteLink;
    if (!old.ownerId || (ownerId && old.ownerId !== ownerId && botAdmin)) patch.ownerId = ownerId ?? old.ownerId;
    await ref.update(patch);
    return withChatDefaults({ ...old, ...patch });
  }
  const doc: ChatDoc = {
    id: chat.id, type: kindOf(chat.type), title: chat.title || String(chat.id), username: chat.username ?? null, inviteLink,
    memberCount, botId, botAdmin, rights, addedBy, ownerId, status: "active",
    ads: { enabled: false, acceptedAt: null, acceptedBy: null, maxPerDay: cfg.network.maxPerDayDefault, lastPostAt: 0, postsDay: "", postsToday: 0 },
    mandatory: { enabled: false, mode: "delete", required: [] },
    earned: 0, tags: [], blacklisted: false, promptedAt: null, createdAt: now, updatedAt: now,
  };
  await ref.set(doc);
  return doc;
}

export async function refreshChat(chatId: number) {
  const c = await getChat(chatId);
  if (!c) return null;
  const api = await apiFor(c.botId);
  try {
    const chat = await api.getChat(chatId);
    return await registerChat(api, c.botId, { id: chatId, type: chat.type, title: "title" in chat ? chat.title : c.title, username: "username" in chat ? chat.username : undefined }, c.ownerId);
  } catch (e) {
    const msg = String((e as Error).message);
    if (/chat not found|kicked|forbidden/i.test(msg)) await chatsCol().doc(String(chatId)).update({ status: "removed", botAdmin: false, updatedAt: Date.now() });
    return null;
  }
}

/** Ask the owner (and whoever added the bot) to opt in to sponsored posts. */
async function promptAds(c: ChatDoc, recipients: (number | null)[]) {
  const cfg = await getConfig();
  const text = `📡 ${c.title} is now connected to ${cfg.brand}.\n\nAllow sponsored posts? You earn bonus ${cfg.currency} when we post in your ${c.type === "channel" ? "channel" : "group"}.\n\nRules:\n• Every post is labeled "Sponsored".\n• At most ${c.ads.maxPerDay} per day.\n• The bot only posts if you say yes.\n• You can turn it off any time in 📡 My Chats.`;
  const kb = new InlineKeyboard().text("✅ Allow", `net:on:${c.id}`).text("Not now", `net:no:${c.id}`);
  for (const uid of new Set(recipients.filter((x): x is number => !!x))) {
    const u = await getUser(uid);
    if (u) await sendToUser(uid, text, { reply_markup: kb });
  }
}

export async function onMyChatMember(ctx: Context) {
  const u = ctx.myChatMember;
  if (!u) return;
  const status = u.new_chat_member.status;
  const chat = u.chat;

  if (chat.type === "private") {
    await usersCol().doc(String(chat.id)).update({ blocked: status === "kicked" }).catch(() => {});
    return;
  }
  if (status === "administrator") {
    const doc = await registerChat(ctx.api, ctx.botId, chat as never, u.from.id);
    if (doc && !doc.ads.enabled && !doc.ads.acceptedAt && !doc.promptedAt) {
      await chatsCol().doc(String(doc.id)).update({ promptedAt: Date.now() });
      await promptAds(doc, [doc.ownerId, u.from.id]);
    }
  } else if (status === "member" || status === "restricted") {
    await chatsCol().doc(String(chat.id)).update({ botAdmin: false, updatedAt: Date.now() }).catch(() => {});
  } else {
    await chatsCol().doc(String(chat.id)).update({ status: "removed", botAdmin: false, updatedAt: Date.now() }).catch(() => {});
  }
}

/** Opt-in buttons from the DM sent by promptAds. Registered before the gates so unverified owners can answer. */
export function registerOptIn(bot: Bot) {
  bot.callbackQuery(/^net:(on|no):(-?\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[2]);
    const c = await getChat(chatId);
    if (!c) return void (await ctx.answerCallbackQuery({ text: "Chat not found.", show_alert: true }));
    const api = await apiFor(c.botId);
    let role = "";
    try { role = (await api.getChatMember(chatId, ctx.from.id)).status; } catch { /* handled below */ }
    if (role !== "creator" && role !== "administrator") {
      return void (await ctx.answerCallbackQuery({ text: "Only an admin of that chat can change this.", show_alert: true }));
    }
    const on = ctx.match[1] === "on";
    const patch: Record<string, unknown> = { "ads.enabled": on, "ads.acceptedAt": on ? Date.now() : null, "ads.acceptedBy": on ? ctx.from.id : null, updatedAt: Date.now() };
    if (on && role === "creator") patch.ownerId = ctx.from.id;
    await chatsCol().doc(String(chatId)).update(patch);
    await ctx.answerCallbackQuery({ text: on ? "Sponsored posts enabled." : "Okay, no sponsored posts." });
    await ctx.editMessageText(on ? `✅ Sponsored posts enabled for ${c.title}. Manage it any time in 📡 My Chats.` : `Sponsored posts stay off for ${c.title}.`).catch(() => {});
  });
}

/** Has this member left the chat? (A restricted user who is no longer a member also counts.) */
export const memberLeft = (m: { status: string; is_member?: boolean }) =>
  m.status === "left" || m.status === "kicked" || (m.status === "restricted" && !m.is_member);

/** Someone joined or left a chat where the bot is admin. We only care about leaving. */
export async function onChatMember(ctx: Context) {
  const u = ctx.chatMember;
  if (!u) return;
  const m = u.new_chat_member as { status: string; is_member?: boolean; user: { id: number; is_bot: boolean } };
  if (!memberLeft(m) || m.user.is_bot) return;
  forgetSubscription(u.chat.id, m.user.id);
  await leaveNow(u.chat.id, m.user.id);
}
