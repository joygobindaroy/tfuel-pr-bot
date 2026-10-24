import { validateInitData } from "./telegram-auth";
import { getUser } from "./users";
import { getRole } from "./roles";

/** Auth for Mini App API calls: the page sends Telegram initData in a header. */
export async function authRequest(req: Request) {
  const auth = validateInitData(req.headers.get("x-init-data"), process.env.BOT_TOKEN || "", 24 * 3600);
  if (!auth) return null;
  const user = await getUser(auth.user.id);
  if (!user || user.banned) return null;
  return { user, role: await getRole(user.id) };
}
