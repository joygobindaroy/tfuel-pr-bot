import { getDb } from "@/lib/firebase";
import { authRequest } from "@/lib/http";
import { can } from "@/lib/roles";
import { countUsers } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await authRequest(req);
  if (!a?.role) return Response.json({ ok: false }, { status: 403 });
  const db = getDb();
  const role = a.role;
  const out: Record<string, unknown> = { ok: true, role };

  if (can(role, "stats")) {
    const day = new Date().toISOString().slice(0, 10);
    const [users, total, today, daily] = await Promise.all([
      countUsers(),
      db.collection("meta").doc("stats").get(),
      db.collection("stats_daily").doc(day).get(),
      db.collection("stats_daily").orderBy("__name__", "desc").limit(14).get(),
    ]);
    out.users = users;
    out.totals = total.data() ?? {};
    out.today = today.data() ?? {};
    out.daily = daily.docs.map((d) => ({ day: d.id, ...d.data() })).reverse();
  }
  if (can(role, "fraud")) {
    const [risky, leavers, reported] = await Promise.all([
      db.collection("users").orderBy("risk.score", "desc").limit(15).get(),
      db.collection("users").orderBy("penalties", "desc").limit(10).get(),
      db.collection("tasks").where("reports", ">", 0).orderBy("reports", "desc").limit(10).get(),
    ]);
    out.risky = risky.docs.map((d) => {
      const u = d.data();
      return { id: u.id, username: u.username, score: u.risk?.score ?? 0, flags: u.risk?.flags ?? [], country: u.country, banned: u.banned };
    });
    out.leavers = leavers.docs.filter((d) => (d.data().penalties ?? 0) > 0).map((d) => ({ id: d.id, penalties: d.data().penalties }));
    out.reportedTasks = reported.docs.map((d) => ({ id: d.id, title: d.data().title, reports: d.data().reports, status: d.data().status }));
  }
  if (can(role, "tickets")) {
    const t = await db.collection("tickets").where("status", "==", "open").limit(20).get();
    out.tickets = t.docs.map((d) => d.data());
  }
  if (can(role, "audit")) {
    const au = await db.collection("audit").orderBy("at", "desc").limit(20).get();
    out.audit = au.docs.map((d) => d.data());
  }
  return Response.json(out);
}
