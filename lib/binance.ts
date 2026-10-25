import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { appUrl } from "./botInstance";
import { sendToUser } from "./notify";
import { getConfig } from "./config";
import { getDb } from "./firebase";
import { usdtQuote } from "./payments";
import { incStats } from "./stats";
import { ledger, round, usersCol, withDefaults } from "./users";

/**
 * Binance Pay (merchant) integration, v2 endpoints.
 * Verify field names against the current Binance Pay docs before going live;
 * this code could not be tested against Binance from here.
 */
const BASE = "https://bpay.binanceapi.com";
const orders = () => getDb().collection("usdt_orders");

export const binanceEnabled = () => !!process.env.BINANCE_PAY_API_KEY && !!process.env.BINANCE_PAY_SECRET;

async function call(path: string, body: unknown) {
  const json = JSON.stringify(body);
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = crypto
    .createHmac("sha512", process.env.BINANCE_PAY_SECRET || "")
    .update(`${ts}\n${nonce}\n${json}\n`)
    .digest("hex")
    .toUpperCase();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "BinancePay-Timestamp": ts,
      "BinancePay-Nonce": nonce,
      "BinancePay-Certificate-SN": process.env.BINANCE_PAY_API_KEY || "",
      "BinancePay-Signature": sig,
    },
    body: json,
    signal: AbortSignal.timeout(8000),
  });
  return (await res.json()) as { status?: string; code?: string; errorMessage?: string; data?: Record<string, unknown> };
}

export async function createUsdtOrder(userId: number, usdt: number) {
  const cfg = await getConfig();
  const q = usdtQuote(usdt, cfg);
  const tradeNo = `T${Date.now().toString(36)}${crypto.randomBytes(5).toString("hex")}`;
  const r = await call("/binancepay/openapi/v2/order", {
    env: { terminalType: "APP" },
    merchantTradeNo: tradeNo,
    orderAmount: usdt,
    currency: "USDT",
    description: `${cfg.brand} deposit`,
    goods: { goodsType: "02", goodsCategory: "Z000", referenceGoodsId: "balance", goodsName: `${cfg.brand} balance` },
    webhookUrl: `${appUrl()}/api/binance-webhook`,
    orderExpireTime: Date.now() + 60 * 60 * 1000,
  });
  if (r.status !== "SUCCESS" || !r.data) throw new Error(`binance: ${r.errorMessage || r.code || "create failed"}`);
  await orders().doc(tradeNo).set({
    tradeNo, userId, usdt, ...q, status: "pending", prepayId: r.data.prepayId ?? null, createdAt: Date.now(),
  });
  return { tradeNo, checkoutUrl: String(r.data.checkoutUrl || r.data.universalUrl || ""), ...q };
}

/** Asks Binance for the order status (never trusts the webhook body) and credits once if PAID. */
export async function settleUsdtOrder(tradeNo: string) {
  const ref = orders().doc(tradeNo);
  const snap = await ref.get();
  if (!snap.exists) return { state: "unknown" as const };
  const o = snap.data() as { userId: number; usdt: number; total: number; bonus: number; status: string };
  if (o.status === "paid") return { state: "paid" as const, already: true };

  const r = await call("/binancepay/openapi/v2/order/query", { merchantTradeNo: tradeNo });
  const status = String(r.data?.status || "");
  if (r.status !== "SUCCESS") return { state: "error" as const };
  if (["EXPIRED", "CANCELED", "ERROR"].includes(status)) {
    await ref.update({ status: status.toLowerCase() });
    return { state: "closed" as const };
  }
  if (status !== "PAID") return { state: "pending" as const };
  const paidAmount = Number(r.data?.orderAmount ?? o.usdt);
  if (String(r.data?.currency || "USDT") !== "USDT" || Math.abs(paidAmount - o.usdt) > 0.000001) {
    await ref.update({ status: "mismatch" });
    return { state: "error" as const };
  }

  const uref = usersCol().doc(String(o.userId));
  const credited = await getDb().runTransaction(async (t) => {
    const [os, us] = await Promise.all([t.get(ref), t.get(uref)]);
    if ((os.data() as { status: string }).status === "paid") return null;
    const u = withDefaults(us.data());
    const balance = round(u.balance + o.total);
    t.update(ref, { status: "paid", paidAt: Date.now() });
    t.update(uref, { balance, depositedUsdt: FieldValue.increment(o.usdt) });
    t.set(ledger(o.userId).doc(), {
      amount: o.total, type: "deposit_usdt", meta: { tradeNo, usdt: o.usdt, bonus: o.bonus },
      balanceAfter: balance, createdAt: Date.now(),
    });
    return balance;
  });
  if (credited === null) return { state: "paid" as const, already: true };

  void incStats({ depositsUsdt: o.usdt, tfuelMinted: o.total });
  const cfg = await getConfig();
  await sendToUser(o.userId, `✅ USDT deposit received\n+${o.total} ${cfg.currency}${o.bonus ? ` (includes +${o.bonus} bonus)` : ""}\nBalance: ${credited} ${cfg.currency}`);
  return { state: "paid" as const, already: false, usdt: o.usdt, userId: o.userId };
}
