import crypto from "crypto";
import { allTokens } from "./bots";

export type TgUser = {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

/** Validates Mini App initData (HMAC) so nobody can fake a Telegram id. */
export function validateInitData(
  initData: unknown,
  botToken: string,
  maxAgeSec = 3600
): { user: TgUser } | null {
  if (typeof initData !== "string" || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get("user") || "") as TgUser;
    if (!user?.id) return null;
    return { user };
  } catch {
    return null;
  }
}

/** Mini App initData is signed by whichever bot opened it, so try the primary and every mirror bot. */
export async function validateAny(initData: unknown, maxAgeSec = 3600) {
  for (const t of await allTokens()) {
    const r = validateInitData(initData, t.token, maxAgeSec);
    if (r) return { ...r, botId: t.id };
  }
  return null;
}
