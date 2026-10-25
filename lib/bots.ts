import crypto from "crypto";
import { Api } from "grammy";
import { decrypt, encrypt } from "./crypto";
import { getDb } from "./firebase";

export const ALLOWED_UPDATES = ["message", "callback_query", "pre_checkout_query", "my_chat_member", "chat_member"] as const;

export const appUrlEnv = () => (process.env.APP_URL || "").replace(/\/$/, "");
export const botIdOf = (token: string) => token.split(":")[0];
export const primaryToken = () => process.env.BOT_TOKEN || "";
export const primaryBotId = () => botIdOf(primaryToken() || "0:x");

export type BotRec = { id: string; username: string; tokenEnc: string; active: boolean; addedBy: number; createdAt: number };

const botsCol = () => getDb().collection("bots");
const tokenCache = new Map<string, { token: string; at: number }>();
const apis = new Map<string, Api>();

export async function tokenFor(botId?: string | null): Promise<string | null> {
  const id = botId || primaryBotId();
  if (id === primaryBotId()) return primaryToken() || null;
  const hit = tokenCache.get(id);
  if (hit && Date.now() - hit.at < 300_000) return hit.token;
  const s = await botsCol().doc(id).get();
  if (!s.exists) return null;
  const rec = s.data() as BotRec;
  if (!rec.active) return null;
  const token = decrypt(rec.tokenEnc);
  tokenCache.set(id, { token, at: Date.now() });
  return token;
}

/** Telegram API client for a bot (falls back to the primary bot). */
export async function apiFor(botId?: string | null): Promise<Api> {
  const token = (await tokenFor(botId)) || primaryToken();
  const id = botIdOf(token);
  let api = apis.get(id);
  if (!api) { api = new Api(token); apis.set(id, api); }
  return api;
}

let listCache: { at: number; list: { id: string; token: string }[] } | null = null;
/** Primary + active mirror bots (needed to validate Mini App initData from any bot). */
export async function allTokens() {
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.list;
  const list = [{ id: primaryBotId(), token: primaryToken() }];
  try {
    const s = await botsCol().where("active", "==", true).get();
    for (const d of s.docs) {
      const rec = d.data() as BotRec;
      try { list.push({ id: rec.id, token: decrypt(rec.tokenEnc) }); } catch { /* unreadable token: skip */ }
    }
  } catch (e) {
    console.error("allTokens", e);
  }
  listCache = { at: Date.now(), list };
  return list;
}

export const mirrorSecret = (botId: string) =>
  crypto.createHmac("sha256", process.env.WEBHOOK_SECRET || "").update(`bot:${botId}`).digest("hex").slice(0, 48);

export async function registerWebhook(botId: string) {
  const token = await tokenFor(botId);
  if (!token) throw new Error("bot not found");
  const primary = botId === primaryBotId();
  const api = new Api(token);
  await api.setWebhook(`${appUrlEnv()}/api/bot${primary ? "" : `/${botId}`}`, {
    secret_token: primary ? process.env.WEBHOOK_SECRET : mirrorSecret(botId),
    allowed_updates: [...ALLOWED_UPDATES],
    max_connections: 40,
  });
}

export async function addMirrorBot(token: string, addedBy: number) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("That doesn't look like a bot token.");
  const id = botIdOf(token);
  if (id === primaryBotId()) throw new Error("That is the primary bot.");
  const me = await new Api(token).getMe(); // throws if the token is invalid
  const rec: BotRec = { id, username: me.username, tokenEnc: encrypt(token), active: true, addedBy, createdAt: Date.now() };
  await botsCol().doc(id).set(rec);
  tokenCache.delete(id);
  listCache = null;
  await registerWebhook(id);
  return { id, username: me.username };
}

export async function removeMirrorBot(id: string) {
  if (id === primaryBotId()) throw new Error("The primary bot can't be removed here.");
  const token = await tokenFor(id);
  if (token) await new Api(token).deleteWebhook().catch(() => {});
  await botsCol().doc(id).delete();
  tokenCache.delete(id);
  apis.delete(id);
  listCache = null;
}

export async function listBots() {
  const out: { id: string; username: string; primary: boolean; active: boolean; webhook?: Record<string, unknown>; error?: string }[] = [];
  const entries: { id: string; primary: boolean; active: boolean; username?: string }[] = [{ id: primaryBotId(), primary: true, active: true }];
  const s = await botsCol().get();
  for (const d of s.docs) { const r = d.data() as BotRec; entries.push({ id: r.id, primary: false, active: r.active, username: r.username }); }
  for (const e of entries) {
    try {
      const api = await apiFor(e.id);
      const [me, wh] = await Promise.all([e.username ? Promise.resolve({ username: e.username }) : api.getMe(), api.getWebhookInfo()]);
      out.push({ id: e.id, username: me.username, primary: e.primary, active: e.active, webhook: {
        url: wh.url, pending: wh.pending_update_count, lastError: wh.last_error_message ?? null, lastErrorAt: wh.last_error_date ? wh.last_error_date * 1000 : null,
      } });
    } catch (err) {
      out.push({ id: e.id, username: e.username || "?", primary: e.primary, active: e.active, error: String((err as Error).message).slice(0, 120) });
    }
  }
  return out;
}
