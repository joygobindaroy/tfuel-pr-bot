import { cronHandler } from "@/lib/cronhandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Old path, kept so existing schedulers keep working.
export const GET = cronHandler;
export const POST = cronHandler;
