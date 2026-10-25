import { webhookFor } from "@/lib/bot";
import { primaryToken } from "@/lib/bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  return webhookFor(primaryToken() || "0:build-placeholder", process.env.WEBHOOK_SECRET)(req);
}
