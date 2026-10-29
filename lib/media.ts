import { InputFile, type Api } from "grammy";
import { apiFor, primaryBotId, tokenFor } from "./bots";
import { usersCol } from "./users";

type PhotoExtra = Parameters<Api["sendPhoto"]>[2];

/** Telegram file ids only work for the bot that received the file, so across mirror bots we re-upload the image. */
export async function sendPhotoToUser(userId: number, fileId: string, srcBotId: string | null, caption: string, extra?: PhotoExtra) {
  const s = await usersCol().doc(String(userId)).get();
  const destBot = s.exists ? (s.data() as { botId?: string | null }).botId ?? null : null;
  const dest = await apiFor(destBot);
  if ((destBot || primaryBotId()) === (srcBotId || primaryBotId())) return dest.sendPhoto(userId, fileId, { caption, ...extra });
  const src = await apiFor(srcBotId);
  const token = await tokenFor(srcBotId);
  const f = await src.getFile(fileId);
  return dest.sendPhoto(userId, new InputFile(new URL(`https://api.telegram.org/file/bot${token}/${f.file_path}`)), { caption, ...extra });
}

/** Image bytes for the admin panel (the Telegram file URL contains the bot token, so it must never reach the browser). */
export async function fetchPhoto(fileId: string, botId: string | null) {
  const src = await apiFor(botId);
  const token = await tokenFor(botId);
  const f = await src.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
  return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") || "image/jpeg" };
}
