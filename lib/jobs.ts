import { runBroadcast, runningBroadcast } from "./broadcast";
import { chatsCol, refreshChat } from "./chats";
import { logError } from "./errlog";
import { getDb } from "./firebase";
import { deleteDue, releaseBonuses, runCampaign, runningCampaigns, runScheduledDeletes, startDue } from "./network";
import { processGrace, processRetention } from "./tasks";

/**
 * One tick = every time-based job, each with its own time slice.
 * Call it every minute from cron-job.org (or Vercel Pro cron): GET /api/cron/tick with
 * header "Authorization: Bearer <CRON_SECRET>".
 */
export async function runTick(deadline: number) {
  const started = Date.now();
  const results: Record<string, unknown> = {};
  let more = false;
  const job = async (name: string, ms: number, fn: (until: number) => Promise<unknown>) => {
    const until = Math.min(deadline, Date.now() + ms);
    if (Date.now() >= deadline - 1000) { more = true; return; }
    try { results[name] = await fn(until); } catch (e) { results[name] = "error"; await logError(`tick:${name}`, e); }
  };

  await job("scheduled_deletes", 4000, (u) => runScheduledDeletes(u));
  await job("network_start", 3000, () => startDue());
  await job("network_send", 14000, async (u) => {
    for (const id of await runningCampaigns()) { if (!(await runCampaign(id, u))) more = true; }
  });
  await job("network_release", 6000, async (u) => { const r = await releaseBonuses(u); if (r.more) more = true; return r; });
  await job("network_delete", 4000, (u) => deleteDue(u));
  await job("grace", 6000, async (u) => { const r = await processGrace(u); if (r.more) more = true; return r; });
  await job("retention", 12000, async (u) => { const r = await processRetention(u); if (r.more) more = true; return r; });
  await job("broadcast", 8000, async (u) => {
    const id = await runningBroadcast();
    if (id && !(await runBroadcast(id, u))) more = true;
  });
  await job("chat_refresh", 4000, async (u) => {
    const s = await chatsCol().orderBy("updatedAt", "asc").limit(10).get();
    let n = 0;
    for (const d of s.docs) {
      if (Date.now() > u) break;
      if (d.data().status !== "active") continue;
      await refreshChat(Number(d.id));
      n++;
    }
    return n;
  });

  const summary = { at: Date.now(), ms: Date.now() - started, more, results };
  await getDb().collection("meta").doc("tick").set(summary).catch(() => {});
  return summary;
}
