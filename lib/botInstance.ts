import { Bot } from "grammy";

// Placeholder keeps `next build` working when env vars are absent.
export const bot = new Bot(process.env.BOT_TOKEN || "0:build-placeholder");

export async function notifyAdmins(text: string) {
  const targets = process.env.ADMIN_ALERT_CHAT_ID
    ? [process.env.ADMIN_ALERT_CHAT_ID]
    : (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  await Promise.all(targets.map((id) => bot.api.sendMessage(id, text).catch(() => {})));
}

export const appUrl = () => (process.env.APP_URL || "").replace(/\/$/, "");

let cachedUsername: string | null = null;
export async function botUsername() {
  if (!cachedUsername) cachedUsername = (await bot.api.getMe()).username;
  return cachedUsername;
}
