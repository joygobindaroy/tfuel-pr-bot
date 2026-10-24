import crypto from "crypto";
import type { AppConfig } from "./config";

export const saltHash = (v: string) =>
  crypto.createHash("sha256").update((process.env.HASH_SALT || "") + v).digest("hex");

export type IpInfo = {
  ok: boolean;
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  bot: boolean;
  fraudScore: number;
  country: string | null;
  mobile: boolean;
};

const EMPTY: IpInfo = {
  ok: false, vpn: false, proxy: false, tor: false, bot: false,
  fraudScore: 0, country: null, mobile: false,
};

export async function checkIp(ip: string): Promise<IpInfo> {
  const key = process.env.IPQS_API_KEY;
  if (!key || !ip || ip === "127.0.0.1" || ip === "::1") return EMPTY;
  try {
    const url = `https://ipqualityscore.com/api/json/ip/${key}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true&fast=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const d = await res.json();
    if (!d?.success) return EMPTY;
    return {
      ok: true,
      vpn: !!d.vpn,
      proxy: !!d.proxy,
      tor: !!d.tor || !!d.active_tor,
      bot: !!d.bot_status,
      fraudScore: Number(d.fraud_score) || 0,
      country: d.country_code || null,
      mobile: !!d.mobile,
    };
  } catch (e) {
    console.error("ip check failed", e);
    return EMPTY;
  }
}

export type Assessment = {
  score: number;
  flags: string[];
  anonymized: boolean;
  blocked: boolean;
};

export function assess(
  info: IpInfo,
  ctx: { headerCountry: string | null; duplicateDevices: number },
  cfg: AppConfig
): Assessment {
  let score = 0;
  const flags: string[] = [];
  const anonymized = info.vpn || info.proxy || info.tor;

  if (anonymized) { score += 60; flags.push(info.tor ? "tor" : info.vpn ? "vpn" : "proxy"); }
  if (info.fraudScore >= 85) { score += 25; flags.push("fraud_score_high"); }
  else if (info.fraudScore >= 75) { score += 10; flags.push("fraud_score_medium"); }
  if (info.bot) { score += 20; flags.push("bot"); }
  if (info.country && ctx.headerCountry && info.country !== ctx.headerCountry) {
    score += 15; flags.push("country_mismatch");
  }
  if (ctx.duplicateDevices >= 1) { score += 25; flags.push("duplicate_device"); }
  if (!info.ok) { score += 10; flags.push("ip_check_unavailable"); }

  score = Math.min(100, score);
  const blocked =
    (anonymized && cfg.vpnMode === "block") || score >= cfg.blockScore;
  return { score, flags, anonymized, blocked };
}
