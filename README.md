# Stop Being Fat Loser

A Telegram bot for losing weight, in hard mode. It:

- onboards you: body stats, goal, activity, which meals you actually eat, work, training and sleep schedule;
- computes a daily calorie target (Mifflin–St Jeor) and splits it across only the meals you eat;
- sets high-protein targets for a cut: protein 2.0 g per kg of goal weight (2.2 with 3–5 workouts a week, 2.4 with 6–7), fat 25% of calories, carbs the rest;
- estimates calories and protein/fat/carbs from meal photos (caption them for precision, ✏️ to correct), and keeps a per-day history;
- tracks water (30 ml per kg, 1.5–4 l) with a reminder every 2 hours;
- reminds you to walk, skip the cola, weigh in weekly, and sends a Sunday summary;
- roasts bad meals, desserts, rest-day protein shakes and inactivity — with profanity and fat jokes, in English or Ukrainian.

Two ways to run it, same code:

- **Cloudflare** (recommended): a Worker (webhook + a 15-minute cron) with D1 for storage, on the free plan. No server; keeps working through power outages at home.
- **Self-hosted** on your own Linux/macOS/Windows machine or a VPS: the same Worker runs locally in workerd (`wrangler dev`) with a local SQLite D1 in `.data/`; a small runner long-polls Telegram (no public URL or open port needed) and fires the cron every 15 minutes.

Photo analysis uses OpenAI's **Sign in with ChatGPT with plan usage** on the bot owner's ChatGPT plan (`/connect`). No API key, no paid API.

## Quick setup

You need a bot token from [@BotFather](https://t.me/BotFather) and Node.js ≥ 22.18; for Cloudflare also a free Cloudflare account. The script installs dependencies, asks for the bot token and the allowed Telegram IDs (owner first; leave empty and the bot tells you yours), generates the webhook secret, and sets everything up.

Linux / macOS:

```sh
./scripts/setup.sh cloudflare   # or: ./scripts/setup.sh selfhost
```

Windows (PowerShell):

```powershell
.\scripts\setup.ps1 -Mode cloudflare   # or: -Mode selfhost
```

Then in Telegram: `/start` to set up your profile, and the owner sends `/connect` to sign in with ChatGPT.

### Self-hosted: running it

```sh
npm run selfhost
```

It starts the Worker on `127.0.0.1:8787`, takes the bot over from any webhook (a bot can't use polling and a webhook at once — don't run both deployments with one token), and keeps running until Ctrl+C. Secrets live in `.dev.vars` (git-ignored, owner-only permissions); data lives in `.data/` — back it up. To keep it running on a VPS, use a service manager, e.g. a systemd unit:

```ini
[Unit]
Description=Stop Being Fat Loser bot
After=network-online.target

[Service]
WorkingDirectory=/home/you/stop-being-fat-loser
ExecStart=/usr/bin/npm run selfhost
Restart=always
User=you

[Install]
WantedBy=multi-user.target
```

On Windows, run it from Task Scheduler "At log on" or with a service wrapper such as NSSM. `wrangler dev` is Cloudflare's local runtime, fine for a personal bot but not a hardened production server.

### Cloudflare: manual steps

What `setup.sh cloudflare` does, if you'd rather run it by hand:

1. `npx wrangler login`
2. Deploy with the three secrets. The first deploy creates the `stop-being-fat` D1 database; wrangler may write its `database_id` into `wrangler.jsonc` — don't commit it, the database is found by name. Note the `https://stop-being-fat-loser.<subdomain>.workers.dev` URL:
   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN       # after the first deploy, or use --secrets-file
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # e.g. openssl rand -hex 32
   npx wrangler secret put ALLOWED_TELEGRAM_IDS     # owner first, comma-separated
   npm run deploy
   ```
3. `npm run db:migrate`
4. `TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… WORKER_URL=https://… npm run set-webhook`
5. Users not on the allowlist get `Private bot. Your Telegram ID: N`. Add IDs with `npx wrangler secret put ALLOWED_TELEGRAM_IDS` (applies without redeploying).

### Configuration

Nothing account-specific is committed: no database ID, no Telegram IDs, no tokens. On Cloudflare the three secrets are Worker secrets; self-hosted they live in `.dev.vars`.

| Name | Kind | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | Bot token from @BotFather. Used for the Bot API and to download photos. |
| `TELEGRAM_WEBHOOK_SECRET` | secret | Random string Telegram sends in `X-Telegram-Bot-Api-Secret-Token`; requests without it get 401. |
| `ALLOWED_TELEGRAM_IDS` | secret | Comma-separated Telegram user IDs allowed to use the bot. The first one is the owner, whose ChatGPT plan analyzes everyone's photos. |
| `OPENAI_MODEL` | var (`wrangler.jsonc`) | Vision-capable model slug used for photo analysis. |
| `DB` | D1 binding | Users, meals, water, weights, check-ins, sent reminders, ChatGPT token usage and the owner's ChatGPT tokens. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WORKER_URL` | shell env for `npm run set-webhook` | Same token and secret as above, plus the deployed Worker URL. |

### ChatGPT connection

The owner runs `/connect`. The bot sends a ChatGPT sign-in link; after approving plan usage, the browser lands on an unreachable `http://127.0.0.1:1455/auth/callback?...` page — OpenAI only allows loopback redirects for this flow. The owner copies that page's address back into the chat; the bot deletes the message, exchanges the one-time code (PKCE), verifies the ID token and the plan-usage grant, and stores the tokens in D1. The Worker refreshes them itself, and the cron refreshes them weekly so the 30-day refresh token never lapses. `/disconnect` signs out; other users can't use either command.

Every user's photos run on the owner's ChatGPT plan and count toward its usage limits. If the sign-in expires, the owner gets a daily reminder to `/connect` again.

If photos fail with **"ChatGPT plan limit reached"**, wait or check https://chatgpt.com/settings/usage.

The owner's `/usage` shows the tokens each request actually used (as reported by the API): the last 5 hours (ChatGPT's limit window), each of the last 7 days, and per user. OpenAI doesn't publish the plan limit in tokens, so compare with the percentage on chatgpt.com/settings/usage.

### Reminders

All times are local to the time zone chosen during setup, and are only sent while you're awake:

| Reminder | When |
|---|---|
| Walk | 30 min after work ends on work days; 3 h after waking on days off; or a fixed time set with `/walk 19:30`. Snooze 30 min / 1 h from the reminder |
| Water | Every 2 h after waking, not in the last hour before sleep; stops once the day's target is reached |
| Cola nudge | 15:00 |
| Cola check | 1 h before sleep |
| No meals logged | 2 h before sleep |
| Weigh-in | 15 min after waking on the chosen day |
| Weekly summary | Sunday, 30 min before sleep |

To change the defaults, edit `scheduledMinute` and `waterMinutes` in `src/schedule.ts`.

## Development

```sh
npm test            # unit tests (nutrition, schedule, SSE parser)
npm run typecheck
npm run dev         # local Worker with local D1
```

For local cron testing: put the secrets in `.dev.vars`, run `npm run db:migrate:local`, start `npm run dev`, then trigger a tick:

```sh
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

Reminders go to your real chat, so cron sending only needs the bot token. Receiving button taps still needs a real webhook.

## License

MIT
