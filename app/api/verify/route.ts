import { mainMenu } from "@/lib/ui";
import { sendToUser } from "@/lib/notify";
import { netStart } from "@/lib/network";
import { notifyAchievements } from "@/lib/achievements";
import { allow } from "@/lib/ratelimit";
import { incStats } from "@/lib/stats";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/firebase";
import { assess, checkIp, saltHash } from "@/lib/risk";
import { validateAny } from "@/lib/telegram-auth";
import { completeVerification, getUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const reply = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status });

export async function POST(req: Request) {
  const ipForLimit = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await allow(`v:${ipForLimit}`, 12, 60))) {
    return reply({ ok: false, reason: "rate", message: "Too many attempts. Wait a minute and try again." }, 429);
  }
  const body = await req.json().catch(() => null);
  const auth = await validateAny(body?.initData);
  if (!auth) {
    return reply({ ok: false, reason: "invalid", message: "Session expired. Close this page and press Verify again in the bot." }, 401);
  }

  const id = auth.user.id;
  const user = await getUser(id);
  if (!user) {
    return reply({ ok: false, reason: "start", message: "Send /start to the bot first, then verify." }, 400);
  }
  if (user.banned) {
    return reply({ ok: false, reason: "banned", message: "Your account is restricted." }, 403);
  }
  if (user.verified) return reply({ ok: true, country: user.country });

  const cfg = await getConfig();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";
  const headerCountry = req.headers.get("x-vercel-ip-country");

  const deviceHash = saltHash(String(body?.device || ""));
  const ipHash = saltHash(ip);
  const timezone = typeof body?.tz === "string" ? body.tz.slice(0, 64) : null;

  const [info, dup] = await Promise.all([
    checkIp(ip),
    getDb().collection("users").where("deviceHash", "==", deviceHash).limit(3).get(),
  ]);
  const duplicateDevices = dup.docs.filter((d) => d.id !== String(id)).length;
  const result = assess(info, { headerCountry, duplicateDevices }, cfg);

  if (result.blocked) {
    await getDb().collection("users").doc(String(id)).update({
      lastVerifyAttempt: { at: Date.now(), score: result.score, flags: result.flags },
    });
    const vpn = result.anonymized;
    return reply({
      ok: false,
      reason: vpn ? "vpn" : "risk",
      message: vpn
        ? "VPN or proxy detected. Turn it off, then try again."
        : "We couldn't verify this connection. Try again on a different network, or contact support.",
    });
  }

  const country = result.anonymized ? "XX" : headerCountry || info.country || "XX";
  const done = await completeVerification(id, {
    country,
    countryTrusted: !result.anonymized,
    timezone,
    ipHash,
    deviceHash,
    risk: { score: result.score, flags: result.flags },
  });

  if (!done.already) {
    void incStats({ verified: 1, tfuelMinted: done.bonus + done.referralReward });
    try {
      if (user.source?.kind === "net") void netStart(user.source.id, true);
      await sendToUser(id, `✅ Verified. Welcome bonus: +${done.bonus} ${cfg.currency}.`, { reply_markup: mainMenu });
      if (done.referralReward > 0 && user.referrerId) {
        const referrer = await getUser(user.referrerId);
        if (referrer?.notif.referrals) {
          await sendToUser(user.referrerId, `🤝 A friend you invited just verified. +${done.referralReward} ${cfg.currency}.`);
        }
        void notifyAchievements(user.referrerId);
      }
    } catch (e) {
      console.error("notify failed", e);
    }
  }
  return reply({ ok: true, country });
}
