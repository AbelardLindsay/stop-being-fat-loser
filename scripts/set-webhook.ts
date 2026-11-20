// Points Telegram at the deployed Worker and registers the command menu (English default + Ukrainian).
// Usage: TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… WORKER_URL=https://… node scripts/set-webhook.ts
// Runs under Node type stripping: erasable TypeScript only.
import { setCommands, telegram } from './telegram.ts';

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const workerUrl = process.env.WORKER_URL?.replace(/\/+$/, '');
if (!token || !secret || !workerUrl) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and WORKER_URL.');
  process.exit(1);
}

await telegram(token, 'setWebhook', {
  url: `${workerUrl}/telegram`,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});
await setCommands(token);
console.log(`Webhook set to ${workerUrl}/telegram; command menu registered.`);
