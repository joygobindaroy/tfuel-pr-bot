import { after } from "next/server";
import { appUrl } from "@/lib/botInstance";
import { runTick } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}` || req.headers.get("x-job-secret") === secret;
}

/** The one scheduler endpoint. Ping it every minute. If work is left over it re-triggers itself. */
async function run(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const r = await runTick(Date.now() + 50_000);
  if (r.more) {
    after(async () => {
      await fetch(`${appUrl()}/api/cron/tick`, { method: "POST", headers: { "x-job-secret": process.env.CRON_SECRET || "" } }).catch(() => {});
    });
  }
  return Response.json(r);
}

export const GET = run;
export const POST = run;
