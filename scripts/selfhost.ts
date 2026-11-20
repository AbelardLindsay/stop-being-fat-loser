// Runs the bot on your own machine or VPS (Linux, macOS, Windows): the Worker runs in the local workerd
// runtime via `wrangler dev` with a local SQLite D1 in .data/. Telegram updates are fetched by long polling
// (no public URL needed) and forwarded to the Worker; the cron is fired every 15 minutes.
// Usage: npm run selfhost   (after scripts/setup.sh selfhost or scripts/setup.ps1 -Mode selfhost)
// Runs under Node type stripping: erasable TypeScript only.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setCommands, telegram } from './telegram.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PERSIST_DIR = '.data';
const CRON = '*/15 * * * *';
const CRON_INTERVAL_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_S = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** KEY=VALUE lines from .dev.vars, the same file wrangler dev reads for secrets. */
function readDevVars(): Record<string, string> {
  if (!existsSync('.dev.vars')) {
    console.error('.dev.vars not found. Run scripts/setup.sh selfhost (or scripts/setup.ps1 -Mode selfhost) first.');
    process.exit(1);
  }
  const vars: Record<string, string> = {};
  for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m?.[1]) vars[m[1]] = m[2] ?? '';
  }
  return vars;
}

const vars = readDevVars();
const token = vars.TELEGRAM_BOT_TOKEN;
const secret = vars.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) {
  console.error('.dev.vars must define TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET.');
  process.exit(1);
}

const worker = spawn(
  'npx',
  ['wrangler', 'dev', '--local', '--persist-to', PERSIST_DIR, '--test-scheduled', '--ip', '127.0.0.1', '--port', String(PORT)],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
worker.on('exit', (code) => {
  console.error(`wrangler dev exited (${code ?? 'signal'})`);
  process.exit(code ?? 1);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    worker.kill();
    process.exit(0);
  });
}

async function waitForWorker(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${ORIGIN}/`);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`Worker did not start on ${ORIGIN}`);
}

/** Fires the scheduled handler on every quarter hour, like the Cloudflare cron trigger. */
function scheduleCron(): void {
  const now = Date.now();
  const next = Math.floor(now / CRON_INTERVAL_MS + 1) * CRON_INTERVAL_MS;
  setTimeout(async () => {
    try {
      await fetch(`${ORIGIN}/__scheduled?cron=${encodeURIComponent(CRON)}`);
    } catch (err) {
      console.error('cron tick failed', err);
    }
    scheduleCron();
  }, next - now);
}

await waitForWorker();
// Polling and a webhook can't coexist: this takes the bot over from any Cloudflare deployment.
await telegram(token, 'deleteWebhook');
await setCommands(token);
scheduleCron();
console.log('Bot is running (long polling). Ctrl+C to stop.');

let offset = 0;
for (;;) {
  try {
    const updates = await telegram<{ update_id: number }[]>(token, 'getUpdates', {
      offset,
      timeout: POLL_TIMEOUT_S,
      allowed_updates: ['message', 'callback_query'],
    });
    for (const update of updates) {
      offset = update.update_id + 1;
      await fetch(`${ORIGIN}/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: JSON.stringify(update),
      });
    }
  } catch (err) {
    console.error('polling failed', err);
    await sleep(5000);
  }
}
