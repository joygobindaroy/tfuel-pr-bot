import type { Api } from "grammy";
import { apiFor } from "./bots";
import { usersCol } from "./users";

type Extra = Parameters<Api["sendMessage"]>[2];

/** Sends a private message through the bot the user started (falls back to the primary bot). Never throws. */
export async function sendToUser(userId: number, text: string, extra?: Extra) {
  try {
    const s = await usersCol().doc(String(userId)).get();
    const api = await apiFor(s.exists ? (s.data() as { botId?: string | null }).botId : null);
    return await api.sendMessage(userId, text, extra);
  } catch {
    return null;
  }
}
