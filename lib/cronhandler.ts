import { after } from "next/server";
import { appUrl } from "./botInstance";
import { isCronAuthorized } from "./cronauth";
import { runTick } from "./jobs";

/** One scheduler endpoint. If work is left over it re-triggers itself so a backlog clears quickly. */
export async function cronHandler(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const r = await runTick(Date.now() + 50_000);
  if (r.more) {
    after(async () => {
      await fetch(`${appUrl()}/api/cron`, { method: "POST", headers: { "x-job-secret": process.env.CRON_SECRET || "" } }).catch(() => {});
    });
  }
  return Response.json(r);
}
