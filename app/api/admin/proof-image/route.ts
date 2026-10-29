import { requireAdmin } from "@/lib/http";
import { fetchPhoto } from "@/lib/media";
import { proofsCol, type ProofDoc } from "@/lib/proofs";
import { can } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams a proof screenshot to an admin. The Telegram file URL contains the bot token, so it never reaches the browser. */
export async function POST(req: Request) {
  const g = await requireAdmin(req, { mutate: true });
  if ("res" in g) return g.res;
  if (!can(g.ctx.role, "tasks")) return new Response("forbidden", { status: 403 });
  const { id } = await req.json().catch(() => ({ id: "" }));
  const s = await proofsCol().doc(String(id)).get();
  if (!s.exists) return new Response("not found", { status: 404 });
  const p = s.data() as ProofDoc;
  try {
    const img = await fetchPhoto(p.fileId, p.botId);
    return new Response(img.bytes, { headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=300" } });
  } catch {
    return new Response("image unavailable", { status: 502 });
  }
}
