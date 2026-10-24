import { allow } from "@/lib/ratelimit";
import { audit, getRole } from "@/lib/roles";
import { consumeLoginToken, makeSession, sessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await allow(`al:${ip}`, 10, 60))) {
    return Response.json({ ok: false, message: "Too many attempts. Wait a minute." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const uid = await consumeLoginToken(String(body?.token || ""));
  if (!uid) {
    return Response.json({ ok: false, message: "This link expired or was already used. Send /admin login to the bot for a new one." }, { status: 401 });
  }
  if (!(await getRole(uid))) return Response.json({ ok: false, message: "Not an admin." }, { status: 403 });

  await audit(uid, "web_login", "admin_panel");
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(makeSession(uid), 12 * 3600) },
  });
}
