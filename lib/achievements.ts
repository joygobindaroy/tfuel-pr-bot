import { FieldValue } from "firebase-admin/firestore";
import { sendToUser } from "./notify";
import { getConfig } from "./config";
import { getDb } from "./firebase";
import { ledger, round, usersCol, withDefaults } from "./users";

export function metricsOf(u: ReturnType<typeof withDefaults>): Record<string, number> {
  return {
    tasksDone: u.tasksDone, referralCount: u.referralCount, bestStreak: u.bestStreak,
    depositedStars: u.depositedStars, depositedUsdt: u.depositedUsdt,
  };
}

/** Grants any newly reached achievements and pays their rewards. Never throws. */
export async function notifyAchievements(userId: number) {
  try {
    const cfg = await getConfig();
    const uref = usersCol().doc(String(userId));
    const out = await getDb().runTransaction(async (t) => {
      const s = await t.get(uref);
      if (!s.exists) return null;
      const u = withDefaults(s.data());
      const m = metricsOf(u);
      const newly = cfg.achievements.filter((a) => !u.achievements.includes(a.id) && (m[a.metric] ?? 0) >= a.threshold);
      if (!newly.length) return null;
      const sum = newly.reduce((x, a) => x + a.reward, 0);
      const balance = round(u.balance + sum);
      t.update(uref, { balance, achievements: FieldValue.arrayUnion(...newly.map((a) => a.id)) });
      newly.forEach((a) =>
        t.set(ledger(userId).doc(), {
          amount: a.reward, type: "achievement", meta: { id: a.id }, balanceAfter: balance, createdAt: Date.now(),
        })
      );
      return { newly, sum, notify: u.notif.tasks };
    });
    if (out?.notify) {
      const lines = out.newly.map((a) => `🏅 ${a.name}: +${a.reward} ${cfg.currency}`).join("\n");
      await sendToUser(userId, `Achievement unlocked!\n${lines}`);
    }
  } catch (e) {
    console.error("achievements failed", e);
  }
}
