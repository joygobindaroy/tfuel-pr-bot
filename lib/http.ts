import { validateAny } from "./telegram-auth";
import { getUser } from "./users";
import { getRole } from "./roles";
import { readSession } from "./session";

/** Auth for dashboard API calls: Telegram initData header (Mini App) or the admin web session cookie. */
export async function authRequest(req: Request) {
  const init = await validateAny(req.headers.get("x-init-data"), 24 * 3600);
  let userId: number | null = init ? init.user.id : null;
  if (!userId) {
    try { userId = readSession(req.headers.get("cookie")); } catch { userId = null; }
  }
  if (!userId) return null;
  const user = await getUser(userId);
  if (!user || user.banned) return null;
  return { user, role: await getRole(user.id) };
}

import type { Role } from "./roles";
import type { UserDoc } from "./users";

/** Guard for admin API routes. State-changing calls must carry the custom header (blocks cross-site forms). */
export async function requireAdmin(
  req: Request,
  opts: { mutate?: boolean } = {}
): Promise<{ ctx: { user: UserDoc; role: Role } } | { res: Response }> {
  if (opts.mutate && (req.headers.get("x-admin-req") !== "1" || !(req.headers.get("content-type") || "").includes("application/json"))) {
    return { res: Response.json({ ok: false, message: "Bad request." }, { status: 400 }) };
  }
  let a;
  try {
    a = await authRequest(req);
  } catch (e) {
    console.error("admin auth failed", e);
    return { res: Response.json({ ok: false, message: "Auth error on the server." }, { status: 500 }) };
  }
  if (!a) return { res: Response.json({ ok: false, message: "Not logged in." }, { status: 401 }) };
  if (!a.role) return { res: Response.json({ ok: false, message: "Not an admin." }, { status: 403 }) };
  return { ctx: { user: a.user, role: a.role } };
}
