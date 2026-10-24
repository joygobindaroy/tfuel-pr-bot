import { validateInitData } from "./telegram-auth";
import { getUser } from "./users";
import { getRole } from "./roles";
import { readSession } from "./session";

/** Auth for dashboard API calls: Telegram initData header (Mini App) or the admin web session cookie. */
export async function authRequest(req: Request) {
  const init = validateInitData(req.headers.get("x-init-data"), process.env.BOT_TOKEN || "", 24 * 3600);
  let userId: number | null = init ? init.user.id : null;
  if (!userId) {
    try { userId = readSession(req.headers.get("cookie")); } catch { userId = null; }
  }
  if (!userId) return null;
  const user = await getUser(userId);
  if (!user || user.banned) return null;
  return { user, role: await getRole(user.id) };
}
