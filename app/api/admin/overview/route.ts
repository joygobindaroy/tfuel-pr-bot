import { getDb } from "@/lib/firebase";
import { requireAdmin } from "@/lib/http";
import { can } from "@/lib/roles";
import { countUsers } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ("res" in g) return g.res;
  const { role } = g.ctx;
  const db = getDb();
  const out: Record<string, unknown> = { ok: true, role };
  const errors: string[] = [];
  const section = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { console.error("admin section", name, e); errors.push(`${name}: ${String((e as Error).message).slice(0, 160)}`); }
  };

  if (can(role, "stats")) {
    await section("stats", async () => {
      const day = new Date().toISOString().slice(0, 10);
      // Day documents are named YYYY-MM-DD, so we fetch the last 14 by id. (Ordering by document id descending needs a custom index.)
      const ids = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10));
      const [users, total, days] = await Promise.all([
        countUsers(),
        db.collection("meta").doc("stats").get(),
        db.getAll(...ids.map((id) => db.collection("stats_daily").doc(id))),
      ]);
      out.users = users; out.totals = total.data() ?? {};
      out.daily = days.map((d, i) => ({ day: ids[i], ...(d.data() ?? {}) }));
      out.today = out.daily ? (out.daily as { day: string }[]).find((x) => x.day === day) ?? {} : {};
    });
  }
  if (can(role, "fraud")) {
    await section("attention", async () => {
      const [tickets, reported, banned, risky] = await Promise.all([
        db.collection("tickets").where("status", "==", "open").count().get(),
        db.collection("tasks").where("reports", ">", 0).count().get(),
        db.collection("users").where("banned", "==", true).count().get(),
        db.collection("users").orderBy("risk.score", "desc").limit(8).get(),
      ]);
      out.attention = { openTickets: tickets.data().count, reportedTasks: reported.data().count, banned: banned.data().count };
      out.risky = risky.docs.map((d) => {
        const u = d.data();
        return { id: u.id, username: u.username, score: u.risk?.score ?? 0, flags: u.risk?.flags ?? [], country: u.country, banned: u.banned };
      }).filter((u) => u.score > 0);
    });
  }
  out.errors = errors;
  return Response.json(out);
}
