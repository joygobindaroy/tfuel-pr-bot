# TFUEL bot (complete)

Next.js (Vercel) + grammY webhook + Firestore. One project: bot, Mini App dashboard, verification page, admin dashboard.

## Setup
1. Create the bot in @BotFather. Copy the token.
2. Firebase: create a project, enable Firestore, create a service account key. Deploy `firestore.rules` (blocks all client access).
3. Put the service account `.json` in this folder and run `npm run make-env`. It builds `.env.local` (and generates the secrets).
   Delete the `.json` and `.env.local` before uploading to GitHub.
4. Push to GitHub, import into Vercel, paste the contents of `.env.local` into Settings > Environment Variables.
5. After the first deploy, set `APP_URL` to your Vercel URL, redeploy, then register the webhook once:
   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<APP_URL>/api/bot&secret_token=<WEBHOOK_SECRET>`
6. Message the bot: /start, Verify. Your Telegram id must be in `ADMIN_IDS` to use /admin.

## Environment variables
Required: BOT_TOKEN, WEBHOOK_SECRET, ADMIN_IDS, APP_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, HASH_SALT, CRON_SECRET.
Strongly recommended: IPQS_API_KEY (VPN detection; without it every user gets an "ip check unavailable" flag).
Optional: UPSTASH_REDIS_REST_URL / TOKEN (rate limiting across instances), BINANCE_PAY_API_KEY / SECRET (USDT), ADMIN_ALERT_CHAT_ID.

## Features
- Verification (Mini App): IP country, VPN/proxy/Tor check, hashed device signature, initData HMAC check. VPN = blocked by default.
- Earnings: channel and group tasks, verified with getChatMember, paid instantly. Captcha every N tasks. Report button (auto-pause at N reports).
- Promote: wizard (target, amount, countries, daily budget, start now or scheduled), templates, pause/resume/cancel (unspent budget refunded), add more, analytics.
- Auto-publish with commission: price = reward + commission %, charged up front into the task's escrow.
- Retention guarantee: users are re-checked daily for 7 days. Leaving early = penalty + message, and the promoter's task is auto-refilled.
- Level (VIP) bonuses, daily bonus with streak, referral tiers, achievements, promo codes, weekly leaderboard, checks (personal/multi), transaction history, notification settings, support tickets.
- Deposits: Telegram Stars, USDT via Binance Pay. Deposit bonus tiers. No refunds. /paysupport included.
- Safety: rate limiting, ban, maintenance mode, idempotent payments, ledger of every balance change.
- Admin (/admin help): roles (super, moderator, finance), audit log, live config, maintenance, segmented broadcast, user search, fraud list, ticket handling, promo codes, balance adjust.
- Mini App: /app (user dashboard), /admin (admin dashboard). Add them in BotFather as the menu button if you like.

## Live config
`/admin config get [path]` and `/admin config set <path> <json>` edit the Firestore doc `config/main` (applies in about 30s).
Examples: `/admin config set deposit.rate 120`, `/admin config set tasks.channel.reward 40`, `/admin config set vpnMode "limit"`.
All defaults are in `lib/config.ts`.

## Things to know
- Cron: `vercel.json` runs the retention worker once a day. It chains itself while work remains. For busy bots use a Vercel plan with more frequent crons, or ping `/api/cron/retention` (header `x-job-secret: <CRON_SECRET>`) from an external scheduler.
- Retention checks cost one getChatMember per completed task per day for 7 days. Watch Telegram limits as you grow.
- Bot-start tasks are not included: Telegram cannot confirm someone started another bot without that bot's cooperation.
- Binance Pay code follows the public v2 API but was not tested against Binance. Check field names in their current docs and test with a $1 order. The webhook body is never trusted; the order status is always queried from Binance.
- Country is only trusted when no VPN is detected. Country-targeted tasks only go to users with a trusted country.
- Stars you receive sit in the bot's Telegram balance; Telegram's withdrawal rules apply.
- Firestore queries used need no composite indexes. If Firestore ever shows an index link in the logs, open it once to create it.
- Multi-bot (mirror bots) is not built in yet.
