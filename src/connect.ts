// Per-user "Sign in with ChatGPT" from Telegram. OpenAI only redirects to a loopback address, so the
// user's browser ends on an unreachable http://127.0.0.1 page whose URL they paste back into the chat.
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import type { Env } from './env.ts';
import { errorCode, getAccount, nowSec, RESOURCE, TOKEN_URL } from './openai.ts';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';
const DYNAMIC_CLIENT = 'dynamic_agent_client';
const APP_NAME = 'Stop Being Fat Loser';
export const REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
/** A started /connect is valid this long. */
const PENDING_TTL = 15 * 60;

export type ConnectErrorCode =
  | 'no_pending'
  | 'state_mismatch'
  | 'denied'
  | 'bad_callback'
  | 'exchange_failed'
  | 'bad_id_token'
  | 'no_plan_usage'
  | 'wrong_account';

export class ConnectError extends Error {
  constructor(
    message: string,
    public code: ConnectErrorCode,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

interface PendingRow {
  state: string;
  nonce: string;
  verifier: string;
  client_id: string;
  created_at: number;
}

const randomToken = (bytes: number): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');

/** This Worker's stable `ext_agent_host_id`, created on first use. Shared by every user of this deployment. */
async function hostId(env: Env): Promise<string> {
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ext_agent_host_id', ?1)")
    .bind(`urn:uuid:${crypto.randomUUID()}`)
    .run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ext_agent_host_id'").first<{
    value: string;
  }>();
  if (!row) throw new Error('ext_agent_host_id missing');
  return row.value;
}

/** Starts a sign-in for `telegramId` and returns the authorize URL to open. */
export async function startConnect(env: Env, telegramId: number): Promise<string> {
  const account = await getAccount(env, telegramId);
  const clientId = account?.client_id ?? DYNAMIC_CLIENT;
  const state = randomToken(16);
  const nonce = randomToken(16);
  const verifier = randomToken(32);
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');

  await env.DB.prepare(
    `INSERT INTO oauth_pending (telegram_id, state, nonce, verifier, client_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(telegram_id) DO UPDATE SET state = excluded.state, nonce = excluded.nonce, verifier = excluded.verifier,
       client_id = excluded.client_id, created_at = excluded.created_at`,
  )
    .bind(telegramId, state, nonce, verifier, clientId, nowSec())
    .run();

  const params = new URLSearchParams({ client_id: clientId });
  if (clientId === DYNAMIC_CLIENT) params.set('agent_name_hint', APP_NAME);
  params.set('ext_agent_host_id', await hostId(env));
  if (account?.id_token) params.set('id_token_hint', account.id_token);
  if (account?.email) params.set('login_hint', account.email);
  params.set('response_type', 'code');
  params.set('redirect_uri', REDIRECT_URI);
  params.set('scope', SCOPE);
  params.set('resource', RESOURCE);
  params.set('state', state);
  params.set('nonce', nonce);
  params.set('code_challenge_method', 'S256');
  params.set('code_challenge', challenge);
  return `${AUTHORIZE_URL}?${params}`;
}

/** True for text that looks like the pasted loopback callback URL. */
export function isCallbackUrl(text: string): boolean {
  return text.trim().startsWith('http://127.0.0.1') && text.includes('/auth/callback');
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  scope?: string;
}

function isTokenResponse(v: unknown): v is TokenResponse {
  return (
    !!v &&
    typeof v === 'object' &&
    'access_token' in v &&
    typeof v.access_token === 'string' &&
    'refresh_token' in v &&
    typeof v.refresh_token === 'string' &&
    'id_token' in v &&
    typeof v.id_token === 'string' &&
    'expires_in' in v &&
    typeof v.expires_in === 'number'
  );
}

/**
 * Completes a sign-in from the pasted callback URL: validates state, exchanges the code with PKCE,
 * verifies the ID token and the plan-usage grant, then stores the user's own credentials.
 */
export async function finishConnect(env: Env, telegramId: number, pasted: string): Promise<{ email: string | null }> {
  const pending = await env.DB.prepare('SELECT * FROM oauth_pending WHERE telegram_id = ?1')
    .bind(telegramId)
    .first<PendingRow>();
  if (!pending || pending.created_at < nowSec() - PENDING_TTL) throw new ConnectError('no live /connect', 'no_pending');

  let params: URLSearchParams;
  try {
    params = new URL(pasted.trim()).searchParams;
  } catch {
    throw new ConnectError('not a URL', 'bad_callback');
  }
  if (params.get('state') !== pending.state) throw new ConnectError('state mismatch', 'state_mismatch');
  // Single use: a replayed URL must not exchange again.
  await env.DB.prepare('DELETE FROM oauth_pending WHERE telegram_id = ?1').bind(telegramId).run();

  const error = params.get('error');
  if (error) throw new ConnectError(`authorization failed: ${error}`, error === 'access_denied' ? 'denied' : 'bad_callback');
  const code = params.get('code');
  if (!code) throw new ConnectError('callback has no code', 'bad_callback');

  // New registration: the callback carries the issued client_id. Reauthorization: keep the saved one.
  const callbackClient = params.get('client_id');
  let clientId: string;
  if (pending.client_id === DYNAMIC_CLIENT) {
    if (!callbackClient) throw new ConnectError('registration incomplete: no client_id', 'bad_callback');
    clientId = callbackClient;
  } else {
    if (callbackClient && callbackClient !== pending.client_id) throw new ConnectError('client_id changed', 'wrong_account');
    clientId = pending.client_id;
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    }),
  });
  const tokens: unknown = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !isTokenResponse(tokens)) {
    throw new ConnectError(`token exchange HTTP ${tokenRes.status}: ${errorCode(tokens) ?? ''}`, 'exchange_failed');
  }

  let sub: string;
  let email: string | null;
  try {
    const discovery: unknown = await (await fetch(`${ISSUER}/.well-known/openid-configuration`)).json();
    if (!discovery || typeof discovery !== 'object' || !('jwks_uri' in discovery) || typeof discovery.jwks_uri !== 'string') {
      throw new Error('no jwks_uri');
    }
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(discovery.jwks_uri)), {
      issuer: ISSUER,
      audience: clientId,
    });
    if (payload.nonce !== pending.nonce || !payload.sub) throw new Error('nonce or sub mismatch');
    sub = payload.sub;
    email = typeof payload.email === 'string' ? payload.email : null;
  } catch (err) {
    throw new ConnectError(`id_token rejected: ${String(err)}`, 'bad_id_token');
  }

  if (!(tokens.scope ?? '').split(' ').includes(PLAN_USAGE_SCOPE)) {
    throw new ConnectError('plan usage not granted', 'no_plan_usage');
  }

  // A reconnect must be the same ChatGPT account as the saved registration.
  const existing = await getAccount(env, telegramId);
  if (existing?.id_token && existing.client_id === clientId && decodeJwt(existing.id_token).sub !== sub) {
    throw new ConnectError('different ChatGPT account', 'wrong_account');
  }

  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO openai_accounts (telegram_id, client_id, access_token, refresh_token, id_token, email, expires_at, refreshing_until, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 'ok', ?8)
     ON CONFLICT(telegram_id) DO UPDATE SET client_id = excluded.client_id, access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, id_token = excluded.id_token, email = excluded.email,
       expires_at = excluded.expires_at, refreshing_until = 0, status = 'ok', updated_at = excluded.updated_at`,
  )
    .bind(telegramId, clientId, tokens.access_token, tokens.refresh_token, tokens.id_token, email, now + tokens.expires_in, now)
    .run();
  return { email };
}

/** Signs out: drops the tokens but keeps the client registration and ID token hint for a later /connect. */
export async function disconnect(env: Env, telegramId: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE openai_accounts SET status = 'signed_out', access_token = NULL, refresh_token = NULL, refreshing_until = 0,
       updated_at = ?1 WHERE telegram_id = ?2 AND status != 'signed_out'`,
  )
    .bind(nowSec(), telegramId)
    .run();
  return res.meta.changes > 0;
}
