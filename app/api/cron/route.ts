import { cronHandler } from "@/lib/cronhandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// https://YOUR-DOMAIN/api/cron?key=YOUR_CRON_SECRET
export const GET = cronHandler;
export const POST = cronHandler;
