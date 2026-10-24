import { after } from "next/server";
import { runBroadcast, runningBroadcast } from "@/lib/broadcast";
import { appUrl } from "@/lib/botInstance";
import { processRetention } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.headers.get("x-job-secret") === secret
  );
}

/** Daily cron + self-chaining worker: retention checks and broadcast batches. */
async function run(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const deadline = Date.now() + 50_000;

  const ret = await processRetention(deadline - 15_000);
  let moreBroadcast = false;
  const bid = await runningBroadcast();
  if (bid) moreBroadcast = !(await runBroadcast(bid, deadline));

  const more = ret.more || moreBroadcast;
  if (more) {
    after(async () => {
      await fetch(`${appUrl()}/api/cron/retention`, {
        method: "POST",
        headers: { "x-job-secret": process.env.CRON_SECRET || "" },
      }).catch(() => {});
    });
  }
  return Response.json({ processed: ret.processed, more });
}

export const GET = run;
export const POST = run;
