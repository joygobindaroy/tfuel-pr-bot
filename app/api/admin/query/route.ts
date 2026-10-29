import { listBots } from "@/lib/bots";
import { proofsCol } from "@/lib/proofs";
import { estimate, whyNot, type BonusRule, type TargetSpec } from "@/lib/network";
import { chatsCol, withChatDefaults } from "@/lib/chats";
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

      case "chats": {
        if (!can(role, "network")) return deny();
        const s = await chatsCol().orderBy("memberCount", "desc").limit(400).get();
        const term = String(body.q || "").trim().toLowerCase();
        const list = s.docs.map((d) => withChatDefaults(d.data())).filter((c) => !term || c.title.toLowerCase().includes(term) || String(c.id).includes(term) || (c.username || "").toLowerCase().includes(term) || String(c.ownerId).includes(term));
        return ok({
          chats: list.slice(0, 250).map((c) => ({
            id: c.id, type: c.type, title: c.title, username: c.username, memberCount: c.memberCount, ownerId: c.ownerId,
            status: c.status, botAdmin: c.botAdmin, blocker: whyNot(c, { mode: "all" }, cfg), adsEnabled: c.ads.enabled, maxPerDay: c.ads.maxPerDay, postsToday: c.ads.postsDay === new Date().toISOString().slice(0, 10) ? c.ads.postsToday : 0,
            earned: c.earned, tags: c.tags, blacklisted: c.blacklisted, canPost: c.rights.canPost, mandatory: c.mandatory.enabled, botId: c.botId,
          })),
          total: list.length, minMembers: cfg.network.minMembers, approvalAbove: cfg.network.approvalAbove, currency: cfg.currency,
        });
      }

      case "campaigns": {
        if (!can(role, "network")) return deny();
        const s = await db.collection("net_campaigns").orderBy("createdAt", "desc").limit(15).get();
        return ok({
          campaigns: s.docs.map((d) => { const x = d.data(); return { id: d.id, title: x.title, text: x.text, lastErrors: x.lastErrors ?? [], status: x.status, createdBy: x.createdBy, createdAt: x.createdAt, scheduledAt: x.scheduledAt, totals: x.totals, bonus: x.bonus, queued: (x.queue || []).length }; }),
        });
      }

      case "net_estimate": {
        if (!can(role, "network")) return deny();
        const r = await estimate(body.target as TargetSpec, body.bonus as BonusRule);
        return ok({ ...r, needsApproval: r.totalBonus > cfg.network.approvalAbove });
      }

      case "disputes": {
        if (!can(role, "tasks")) return deny();
        const [d, pending] = await Promise.all([
          proofsCol().where("status", "==", "disputed").limit(50).get(),
          proofsCol().where("status", "==", "pending").count().get(),
        ]);
        const list = d.docs.map((x) => x.data());
        const owners = [...new Set(list.map((p) => p.ownerId))];
        const docs = owners.length ? await db.getAll(...owners.map((id) => usersCol().doc(String(id)))) : [];
        const stats = new Map(docs.map((o) => [Number(o.id), { approved: o.data()?.proofsApproved ?? 0, rejected: o.data()?.proofsRejected ?? 0 }]));
        return ok({
          pending: pending.data().count,
          disputes: list.map((p) => ({
            id: p.id, title: p.title, type: p.type, userId: p.userId, ownerId: p.ownerId, reason: p.reason, reward: p.reward,
            submittedAt: p.submittedAt, disputedAt: p.disputedAt, owner: stats.get(p.ownerId) ?? { approved: 0, rejected: 0 },
          })),
        });
      }

      case "bots": {
        if (!can(role, "bots")) return deny();
        return ok({ bots: await listBots() });
      }

      case "config_history": {
        if (!can(role, "config")) return deny();
        const s = await db.collection("config_history").orderBy("at", "desc").limit(30).get();
        return ok({ history: s.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }

      case "system": {
        if (!can(role, "system")) return deny();
        const [errors, tick] = await Promise.all([
          db.collection("errors").orderBy("lastAt", "desc").limit(40).get(),
          db.collection("meta").doc("tick").get(),
        ]);
        return ok({ errors: errors.docs.map((d) => ({ id: d.id, ...d.data() })), tick: tick.data() ?? null });
      }

      default:
        return Response.json({ ok: false, message: "Unknown query." }, { status: 400 });
    }
  } catch (e) {
    console.error("admin query", type, e);
    return Response.json({ ok: false, message: String((e as Error).message).slice(0, 200) }, { status: 500 });
  }
}
