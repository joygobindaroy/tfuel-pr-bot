import { apiFor, appUrlEnv } from "./bots";

export const appUrl = appUrlEnv;

/** Alerts go out through the primary bot to ADMIN_ALERT_CHAT_ID (or every id in ADMIN_IDS). */
export async function notifyAdmins(text: string) {
  const targets = process.env.ADMIN_ALERT_CHAT_ID
    ? [process.env.ADMIN_ALERT_CHAT_ID]
    : (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const api = await apiFor();
  await Promise.all(targets.map((id) => api.sendMessage(id, text).catch(() => {})));
}

const names = new Map<string, string>();
export async function botUsername(botId?: string | null) {
  const api = await apiFor(botId);
  const key = String(botId || "primary");
  let n = names.get(key);
  if (!n) { n = (await api.getMe()).username; names.set(key, n); }
  return n;
}
