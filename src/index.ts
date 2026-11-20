import type { Update } from 'grammy/types';
import { handleUpdate } from './bot.ts';
import type { Env } from './env.ts';
import { runNotifications } from './notify.ts';
import { keepAlive } from './openai.ts';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('not found', { status: 404 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    let update: Update;
    try {
      update = await request.json<Update>();
    } catch {
      return new Response('bad request', { status: 400 });
    }
    // Answer Telegram immediately; photo analysis runs inside the 30 s waitUntil budget.
    ctx.waitUntil(handleUpdate(env, update));
    return new Response('ok');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        runNotifications(env, new Date(event.scheduledTime)),
        keepAlive(env).catch((err: unknown) => console.error('openai keepAlive failed', err)),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
