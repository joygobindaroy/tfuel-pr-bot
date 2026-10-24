import { sessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie("", 0) },
  });
}
