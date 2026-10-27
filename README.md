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
- Mini App: /app (user dashboard). Admin web panel: /admin (send /admin login to the bot for a one-time link; works in any browser). Panel pages: Dashboard (stats, 14-day chart, risk), Users (search, ban, adjust balance, history), Tasks (pause/resume/cancel), Tickets (reply/close), Promo codes, Broadcast (segments), Settings (maintenance + every live config value), Team & audit (roles).

## Live config
`/admin config get [path]` and `/admin config set <path> <json>` edit the Firestore doc `config/main` (applies in about 30s).
Examples: `/admin config set deposit.rate 120`, `/admin config set tasks.channel.reward 40`, `/admin config set vpnMode "limit"`.
All defaults are in `lib/config.ts`.

## Batch 1 additions (mirror bots, chat network, picker, mandatory subscription)
- **Mirror bots:** admin panel > Bots. Paste a BotFather token; it is checked, encrypted (needs `BOT_ENC_KEY`), and its webhook is registered for you. All bots share users, balances and tasks.
- **Webhook (primary):** use the Bots page > "Re-register webhook" after every deploy that changes allowed updates. It sets `allowed_updates` (messages, callbacks, payments, `my_chat_member`).
- **Scheduler:** point cron-job.org at `GET https://<APP_URL>/api/cron/tick` every minute with header `Authorization: Bearer <CRON_SECRET>`. It runs retention checks, network posts and bonuses, deletions, broadcasts, chat refreshes. The System page shows whether it is alive.
- **Chat registry:** whenever a bot is made admin in a group/channel it is recorded (members, rights, owner). Owners get a DM to opt in to sponsored posts, and manage everything in the bot under 📡 My Chats.
- **Promote** now uses Telegram's own chat picker (only chats you admin; offers to add the bot as admin), then an audience step (all users / Premium only).
- **Mandatory subscription:** group owners choose required channels/groups in 📡 My Chats. The bot must be admin with the right to delete messages (and restrict members for mute mode).
- **Network (admin panel):** pick chats or filters, write a post, set the owner bonus (0 = silent, no notification), estimate cost, send a test to yourself, schedule or send. Campaigns over `network.approvalAbove` need a second super admin. Bonuses are paid only if the post is still there after `releaseAfterHours`.
- **Config history:** every Settings change is recorded and can be reverted.
- **Tests:** `npm test` (pure logic) and a GitHub Actions workflow that runs typecheck, tests and build on every push.

## Menu, welcome and leave detection (latest)
- Main keyboard is now 3 rows (Earn, Promote, Deposit, Bonus, Account, More) and is collapsible. Everything else is under **More** (inline menu). Old keyboard labels people still have cached keep working. Press /start once to get the new keyboard.
- **Leave detection is real-time.** When someone who completed a task leaves the channel/group, Telegram sends a `chat_member` update and the penalty and warning message go out at once. Fallback: the first re-check runs 15 minutes after joining, then daily for 7 days.
- Requirements: the bot must be **admin** in that chat, and the webhook must include `chat_member`. After deploying this version open the admin panel, **Bots, Re-register webhook** (once per bot).
- Mandatory subscription: the "is subscribed" result is cached for 3 minutes (`mandatory.cacheMinutes`) and cleared immediately when Telegram reports the person left.

## Cron job in 4 steps (cron-job.org)
1. Copy your secret: Vercel project, Settings, Environment Variables, `CRON_SECRET` (click the eye icon).
2. cron-job.org, **Create cronjob**.
3. URL: `https://YOUR-APP.vercel.app/api/cron?key=YOUR_CRON_SECRET`  Schedule: every 1 minute. Nothing else to fill in.
4. Save. In the admin panel open **System**: it should say "running" within two minutes. **Run now** there tests it by hand.
(The older `/api/cron/tick` path and the `Authorization: Bearer` header still work.)

## Leaving a task chat
When a worker leaves a channel or group inside the retention window, they get a message with **Subscribe again** (link) and **Check again** buttons. If they rejoin (and press Check again, or Telegram reports the join) the reward stays. If `tasks.graceHours` (default 6) pass without them coming back, the penalty is taken and the promoter's task is refilled.

## Why a network post might not arrive
A post goes only to chats that pass every rule: the bot is admin there, the owner is a verified user and turned on sponsored posts (More, My chats), the chat has at least `network.minMembers` members (default 100, lower it in Settings to test), and it has not reached its daily limit. The Network page shows the reason next to every chat and, when you estimate a post, a list of why chats were skipped. A campaign with zero eligible chats is now refused instead of reported as started. "Create and send" delivers the first batch immediately and tells you how many chats really received it; use "Send test" with a chat id to check that the bot can post in one chat.

## Promote payments
The promoter sets the reward per action (minimum and recommended are shown; higher rewards are shown to workers first), picks a count (quick buttons, including the maximum the balance allows), then chooses to pay from balance or directly in Telegram Stars (`tasks.starsDiscountPct` cheaper). A Stars payment becomes a deposit that is spent on the task at once; if the task cannot start, the value is credited to the balance instead.

## Things to know
- Cron: `vercel.json` runs the retention worker once a day. It chains itself while work remains. For busy bots use a Vercel plan with more frequent crons, or ping `/api/cron/retention` (header `x-job-secret: <CRON_SECRET>`) from an external scheduler.
- Retention checks cost one getChatMember per completed task per day for 7 days. Watch Telegram limits as you grow.
- Bot-start tasks are not included: Telegram cannot confirm someone started another bot without that bot's cooperation.
- Binance Pay code follows the public v2 API but was not tested against Binance. Check field names in their current docs and test with a $1 order. The webhook body is never trusted; the order status is always queried from Binance.
- Country is only trusted when no VPN is detected. Country-targeted tasks only go to users with a trusted country.
- Stars you receive sit in the bot's Telegram balance; Telegram's withdrawal rules apply.
- Firestore queries used need no composite indexes. If Firestore ever shows an index link in the logs, open it once to create it.
- Unverified in the sandbox: real Telegram behaviour (chat picker, admin rights prompt, message-exists probe, 429 handling), Firestore at scale, Binance. Test with one small chat first.
- Every group message reaches the webhook once the bot is admin there. Watch Vercel and Firestore usage as groups grow.
