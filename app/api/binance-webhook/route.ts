import { settleUsdtOrder } from "@/lib/binance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = () => Response.json({ returnCode: "SUCCESS", returnMessage: null });

/**
 * The webhook body is NOT trusted. We only read the order number from it and
 * ask Binance directly whether that order is paid.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const raw = typeof body?.data === "string" ? JSON.parse(body.data) : body?.data;
    const tradeNo = String(raw?.merchantTradeNo || "");
    if (/^T[a-z0-9]{6,40}$/.test(tradeNo)) await settleUsdtOrder(tradeNo);
  } catch (e) {
    console.error("binance webhook", e);
  }
  return OK();
}
