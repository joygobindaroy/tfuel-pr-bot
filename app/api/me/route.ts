import { getConfig } from "@/lib/config";
import { appUrl, botUsername } from "@/lib/botInstance";
import { topOf } from "@/lib/leaderboard";
import { metricsOf } from "@/lib/achievements";
import { myTasks } from "@/lib/tasks";
import { authRequest } from "@/lib/http";
import { ledger, levelFor } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await authRequest(req);
  if (!a) return Response.json({ ok: false }, { status: 401 });
  const u = a.user;
  const cfg = await getConfig();
  const lv = levelFor(u.xp, cfg.levels);
  const m = metricsOf(u);

  const [hist, tasks, earn, refs, uname] = await Promise.all([
    ledger(u.id).orderBy("createdAt", "desc").limit(20).get(),
    myTasks(u.id),
    topOf("earn"),
    topOf("refs"),
    botUsername(),
  ]);

  return Response.json({
    ok: true,
    currency: cfg.currency,
    isAdmin: !!a.role,
    user: {
      id: u.id, name: u.firstName, balance: u.balance, xp: u.xp, country: u.country,
      level: lv.name, nextXp: lv.nextXp, referrals: u.referralCount, streak: u.dailyStreak,
      tasksDone: u.tasksDone, penalties: u.penalties,
    },
    referralLink: `https://t.me/${uname}?start=ref_${u.id}`,
    appUrl: appUrl(),
    history: hist.docs.map((d) => d.data()),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, total: t.total, completed: t.completed,
      remaining: t.remaining, spent: t.spent, leaves: t.leaves, reports: t.reports,
    })),
    achievements: cfg.achievements.map((x) => ({
      id: x.id, name: x.name, reward: x.reward, threshold: x.threshold,
      progress: Math.min(m[x.metric] ?? 0, x.threshold), done: u.achievements.includes(x.id),
    })),
    leaderboard: { earn, refs },
  });
}
