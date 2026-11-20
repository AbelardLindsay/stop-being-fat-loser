import type { Env } from './env.ts';

export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const RESOURCE = 'https://api.openai.com/v1';
/** Refresh this many seconds before the access token expires. */
const EXPIRY_SKEW = 300;
const LOCK_SECONDS = 30;
const LOCK_POLLS = 8;
const REQUEST_TIMEOUT_MS = 25_000;
const KEEPALIVE_AFTER = 7 * 86400;
/** Refresh at most this many idle accounts per cron tick (free plan: 50 subrequests per invocation). */
const KEEPALIVE_BATCH = 5;

const TERMINAL_REFRESH_ERRORS: Record<string, true> = {
  invalid_grant: true,
  invalid_refresh_token: true,
  token_expired: true,
  refresh_token_expired: true,
  refresh_token_invalidated: true,
  refresh_token_reused: true,
};

export type OpenAiErrorCode =
  | 'auth_missing'
  | 'reauth_required'
  | 'usage_limit'
  | 'not_eligible'
  | 'unavailable'
  | 'timeout'
  | 'bad_output'
  | 'http';

export class OpenAiError extends Error {
  constructor(
    message: string,
    public code: OpenAiErrorCode,
    public status?: number,
  ) {
    super(message);
    this.name = 'OpenAiError';
  }
}

/** One Telegram user's own ChatGPT login. */
export interface AccountRow {
  telegram_id: number;
  client_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  email: string | null;
  expires_at: number;
  status: 'ok' | 'reauth_required' | 'signed_out';
  updated_at: number;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];
  const lineBreak = /\r\n|\r|\n/;

  function* takeLine(line: string): Generator<{ event?: string; data: string }> {
    if (line === '') {
      if (data.length > 0) yield event === undefined ? { data: data.join('\n') } : { event, data: data.join('\n') };
      event = undefined;
      data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (let m = lineBreak.exec(buf); m; m = lineBreak.exec(buf)) {
        // A trailing '\r' may be the first half of a CRLF split across chunks.
        if (!done && m[0] === '\r' && m.index === buf.length - 1) break;
        const line = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        yield* takeLine(line);
      }
      if (done) break;
    }
    if (buf !== '') yield* takeLine(buf);
    yield* takeLine('');
  } finally {
    reader.releaseLock();
  }
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export async function getAccount(env: Env, telegramId: number): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM openai_accounts WHERE telegram_id = ?1').bind(telegramId).first<AccountRow>();
}

/**
 * The bot owner: the first ID in ALLOWED_TELEGRAM_IDS. Every user's photos run on the owner's ChatGPT
 * plan, and only the owner can /connect or /disconnect it.
 */
export function ownerId(env: Env): number {
  return Number(env.ALLOWED_TELEGRAM_IDS.split(',')[0]?.trim());
}

/** The account if it can be used for inference; otherwise the error the user should see. */
function requireUsable(row: AccountRow | null): AccountRow {
  if (row?.status === 'reauth_required') throw new OpenAiError('reauth required', 'reauth_required');
  if (!row || row.status !== 'ok' || !row.refresh_token) {
    throw new OpenAiError('no ChatGPT account connected', 'auth_missing');
  }
  return row;
}

const isFresh = (row: AccountRow): row is AccountRow & { access_token: string } =>
  row.access_token !== null && row.expires_at - EXPIRY_SKEW > nowSec();

export async function getAccessToken(env: Env, telegramId: number): Promise<string> {
  const row = requireUsable(await getAccount(env, telegramId));
  return isFresh(row) ? row.access_token : refreshTokens(env, row);
}

/** Refreshes once even if the stored token looks valid (after a 401), unless another invocation already rotated it. */
async function forceRefresh(env: Env, telegramId: number, rejectedToken: string): Promise<string> {
  const row = requireUsable(await getAccount(env, telegramId));
  return isFresh(row) && row.access_token !== rejectedToken ? row.access_token : refreshTokens(env, row);
}

/**
 * Rotates the user's refresh token. Serialized per user through `refreshing_until`: presenting an
 * already-rotated refresh token revokes the whole session (`refresh_token_reused`).
 */
async function refreshTokens(env: Env, row: AccountRow): Promise<string> {
  const id = row.telegram_id;
  const now = nowSec();
  const lock = await env.DB.prepare(
    'UPDATE openai_accounts SET refreshing_until = ?1 WHERE telegram_id = ?2 AND refreshing_until < ?3',
  )
    .bind(now + LOCK_SECONDS, id, now)
    .run();

  if (lock.meta.changes === 0) {
    for (let i = 0; i < LOCK_POLLS; i++) {
      await scheduler.wait(1000);
      const cur = requireUsable(await getAccount(env, id));
      if (isFresh(cur) && cur.access_token !== row.access_token) return cur.access_token;
    }
    throw new OpenAiError('concurrent refresh did not finish', 'unavailable');
  }

  const releaseLock = () =>
    env.DB.prepare('UPDATE openai_accounts SET refreshing_until = 0 WHERE telegram_id = ?1').bind(id).run();

  if (!row.refresh_token) {
    await releaseLock();
    throw new OpenAiError('no refresh token', 'auth_missing');
  }

  let res: Response;
  let body: Record<string, unknown>;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: row.client_id,
        refresh_token: row.refresh_token,
        resource: RESOURCE,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    await releaseLock();
    throw new OpenAiError(`token refresh failed: ${String(err)}`, 'unavailable');
  }

  if (res.ok && typeof body.access_token === 'string') {
    const at = nowSec();
    await env.DB.prepare(
      `UPDATE openai_accounts SET access_token = ?1, refresh_token = ?2, id_token = COALESCE(?3, id_token),
         expires_at = ?4, refreshing_until = 0, updated_at = ?5 WHERE telegram_id = ?6`,
    )
      .bind(
        body.access_token,
        typeof body.refresh_token === 'string' ? body.refresh_token : row.refresh_token,
        typeof body.id_token === 'string' ? body.id_token : null,
        at + Number(body.expires_in ?? 3600),
        at,
        id,
      )
      .run();
    return body.access_token;
  }

  const code = errorCode(body);
  if (code && TERMINAL_REFRESH_ERRORS[code]) {
    await env.DB.prepare(
      `UPDATE openai_accounts SET status = 'reauth_required', access_token = NULL, refresh_token = NULL,
         refreshing_until = 0, updated_at = ?1 WHERE telegram_id = ?2`,
    )
      .bind(nowSec(), id)
      .run();
    throw new OpenAiError(`refresh rejected: ${code}`, 'reauth_required', res.status);
  }
  await releaseLock();
  throw new OpenAiError(`token refresh HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, 'unavailable', res.status);
}

function mapErrorCode(code: string | undefined, status?: number): OpenAiErrorCode {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return 'usage_limit';
    case 'subscription_sharing_user_not_eligible':
      return 'not_eligible';
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return 'unavailable';
  }
  return status === 503 ? 'unavailable' : 'http';
}

/** OAuth errors carry a string in `error`; API errors carry `{ code }` there. */
export function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined;
  const e = body.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code;
  return undefined;
}

type StreamError = { code?: string; message?: string };

/** Token counts from `response.completed`, as reported by the Responses API. */
export interface Usage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
};

export type InputContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string };

/** Structured-output Responses call billed to `telegramId`'s ChatGPT plan. */
export async function respondJson<T>(
  env: Env,
  telegramId: number,
  req: { instructions: string; content: InputContent[]; schemaName: string; schema: object },
): Promise<{ value: T; usage: Usage | null }> {
  const payload = JSON.stringify({
    model: env.OPENAI_MODEL,
    instructions: req.instructions,
    input: [{ role: 'user', content: req.content }],
    text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.schema } },
    store: false,
    stream: true,
  });
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    let token = await getAccessToken(env, telegramId);
    let res: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: payload,
        signal,
      });
      if (res.status !== 401 || attempt === 1) break;
      await res.body?.cancel();
      token = await forceRefresh(env, telegramId, token);
    }
    if (!res) throw new OpenAiError('no response', 'http');

    if (!res.ok || !res.body) {
      const text = await res.text();
      let code: string | undefined;
      try {
        code = errorCode(JSON.parse(text));
      } catch {
        // non-JSON error body
      }
      throw new OpenAiError(text.slice(0, 300), mapErrorCode(code, res.status), res.status);
    }

    let out = '';
    let completed = false;
    let usage: Usage | null = null;
    for await (const ev of parseSse(res.body)) {
      if (ev.data === '[DONE]') continue;
      let msg: {
        type?: string;
        delta?: string;
        code?: string;
        message?: string;
        error?: StreamError;
        response?: { error?: StreamError; usage?: RawUsage };
      };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        continue;
      }
      const type = msg.type ?? ev.event;
      if (type === 'response.output_text.delta') {
        out += msg.delta ?? '';
      } else if (type === 'response.completed') {
        completed = true;
        const u = msg.response?.usage;
        if (u) {
          usage = {
            input: u.input_tokens ?? 0,
            cached: u.input_tokens_details?.cached_tokens ?? 0,
            output: u.output_tokens ?? 0,
            reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
          };
        }
        break;
      } else if (type === 'response.failed' || type === 'error') {
        const e = msg.response?.error ?? msg.error ?? { code: msg.code, message: msg.message };
        throw new OpenAiError(`${type}: ${e.code ?? ''} ${e.message ?? ''}`.trim(), mapErrorCode(e.code), res.status);
      } else if (type === 'response.incomplete') {
        throw new OpenAiError('response incomplete', 'bad_output');
      }
    }
    if (!completed) throw new OpenAiError('stream ended without response.completed', 'bad_output');

    try {
      return { value: JSON.parse(out) as T, usage };
    } catch {
      throw new OpenAiError(`unparseable output: ${out.slice(0, 300)}`, 'bad_output');
    }
  } catch (err) {
    if (err instanceof OpenAiError) throw err;
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new OpenAiError('request timed out', 'timeout');
    }
    throw new OpenAiError(`request failed: ${String(err)}`, 'unavailable');
  }
}

/** Run from cron: refresh idle accounts weekly so their 30-day refresh tokens never lapse. */
export async function keepAlive(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM openai_accounts WHERE status = 'ok' AND refresh_token IS NOT NULL AND updated_at < ?1
     ORDER BY updated_at LIMIT ?2`,
  )
    .bind(nowSec() - KEEPALIVE_AFTER, KEEPALIVE_BATCH)
    .all<AccountRow>();
  for (const row of results) {
    try {
      await refreshTokens(env, row);
    } catch (err) {
      console.error('keepAlive refresh failed', row.telegram_id, err);
    }
  }
}
