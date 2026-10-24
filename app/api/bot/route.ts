import { webhookCallback } from "grammy";
import { bot } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = webhookCallback(bot, "std/http", {
  secretToken: process.env.WEBHOOK_SECRET,
});
