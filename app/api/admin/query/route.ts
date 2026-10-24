import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/firebase";
import { requireAdmin } from "@/lib/http";
import { can } from "@/lib/roles";
import { tasksCol } from "@/lib/tasks";
import { getUser, ledger, levelFor, usersCol, withDefaults, type UserDoc } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pub = (u: UserDoc, levels: Parameters<typeof levelFor>[1]) => ({
  id: u.id, username: u.username, firstName: u.firstName, balance: u.balance, xp: u.xp,
  level: levelFor(u.xp, levels).name, banned: u.banned, banReason: u.banReason, verified: u.verified,
  country: u.country, countryTrusted: u.countryTrusted, risk: u.risk, tasksDone: u.tasksDone,
  penalties: u.penalties, referralCount: u.referralCount, referrerId: u.referrerId,
  depositedStars: u.depositedStars, depositedUsdt: u.depositedUsdt, isPremium: u.isPremium,
  createdAt: u.createdAt, lastActiveAt: u.lastActiveAt,
});

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ("res" in g) return g.res;
  const { role, user: me } = g.ctx;
  const body = await req.json().catch(() => ({}));
  const type = String(body.type || "");
  const db = getDb();
  const deny = () => Response.json({ ok: false, message: "You don't have permission for that." }, { status: 403 });
  const ok = (data: Record<string, unknown>) => Response.json({ ok: true, ...data });

  try {
    const cfg = await getConfig();
    switch (type) {
      case "me":
        return ok({ role, id: me.id, name: me.firstName });

      case "users": {
        if (!can(role, "users.view")) return deny();
        const q = String(body.q || "").trim().replace(/^@/, "").toLowerCase();
        if (!q) {
          const s = await usersCol().orderBy("createdAt", "desc").limit(25).get();
          return ok({ users: s.docs.map((d) => pub(withDefaults(d.data()), cfg.levels)) });
        }
        if (/^\d+$/.test(q)) {
          const u = await getUser(Number(q));
          return ok({ users: u ? [pub(u, cfg.levels)] : [] });
        }
        const s = await usersCol().where("usernameLower", ">=", q).where("usernameLower", "<", q + "\uf8ff").limit(20).get();
        return ok({ users: s.docs.map((d) => pub(withDefaults(d.data()), cfg.levels)) });
      }

      case "user": {
        if (!can(role, "users.view")) return deny();
        const id = Number(body.id);
        const u = await getUser(id);
        if (!u) return ok({ user: null });
        const hist = await ledger(id).orderBy("createdAt", "desc").limit(15).get();
        return ok({ user: pub(u, cfg.levels), ledger: hist.docs.map((d) => d.data()) });
      }

      case "tasks": {
        if (!can(role, "tasks")) return deny();
        const s = await tasksCol().orderBy("createdAt", "desc").limit(60).get();
        return ok({ tasks: s.docs.map((d) => d.data()), currency: cfg.currency });
      }

      case "tickets": {
        if (!can(role, "tickets")) return deny();
        const s = await db.collection("tickets").where("status", "==", "open").limit(50).get();
        const list = s.docs.map((d) => d.data()).sort((a, b) => a.createdAt - b.createdAt);
        return ok({ tickets: list });
      }

      case "promos": {
        if (!can(role, "promo")) return deny();
        const s = await db.collection("promos").orderBy("createdAt", "desc").limit(30).get();
        return ok({ promos: s.docs.map((d) => ({ code: d.id, ...d.data() })) });
      }

      case "broadcasts": {
        if (!can(role, "broadcast")) return deny();
        const s = await db.collection("broadcasts").orderBy("createdAt", "desc").limit(10).get();
        return ok({ broadcasts: s.docs.map((d) => { const x = d.data(); return { id: d.id, segment: x.segment, text: x.text, status: x.status, sent: x.sent, failed: x.failed, skipped: x.skipped, createdAt: x.createdAt }; }) });
      }

      case "config": {
        if (!can(role, "config")) return deny();
        return ok({ config: cfg });
      }

      case "roles": {
        if (!can(role, "roles")) return deny();
        const s = await db.collection("admins").get();
        const env = (process.env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
        return ok({
          env,
          admins: s.docs.map((d) => ({ id: d.id, ...d.data() })),
        });
      }

      case "audit": {
        if (!can(role, "audit")) return deny();
        const s = await db.collection("audit").orderBy("at", "desc").limit(60).get();
        return ok({ audit: s.docs.map((d) => d.data()) });
      }

      default:
        return Response.json({ ok: false, message: "Unknown query." }, { status: 400 });
    }
  } catch (e) {
    console.error("admin query", type, e);
    return Response.json({ ok: false, message: String((e as Error).message).slice(0, 200) }, { status: 500 });
  }
}
