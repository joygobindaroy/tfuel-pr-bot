import { webhookFor } from "@/lib/bot";
import { mirrorSecret, primaryBotId, tokenFor } from "@/lib/bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Webhook for mirror bots: /api/bot/<botId>. Each bot has its own derived secret. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || id === primaryBotId()) return new Response("not found", { status: 404 });
  const token = await tokenFor(id);
  if (!token) return new Response("not found", { status: 404 });
  return webhookFor(token, mirrorSecret(id))(req);
}
