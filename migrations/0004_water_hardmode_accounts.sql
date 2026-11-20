-- Hard mode only: the roast tone setting is gone.
UPDATE users SET onboarding_step = 'weigh_day' WHERE onboarding_step = 'tone';
ALTER TABLE users DROP COLUMN tone;

-- Water intake log.
CREATE TABLE water (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  ml INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX water_user_date ON water (telegram_id, local_date);

-- Each Telegram user connects their own ChatGPT account (/connect); nobody shares a plan.
CREATE TABLE openai_accounts (
  telegram_id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL,              -- issued by dynamic registration, reused on reconnect
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  email TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  refreshing_until INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','reauth_required','signed_out')),
  updated_at INTEGER NOT NULL
);
-- In-flight /connect attempt: PKCE verifier, state and nonce until the user pastes the callback URL.
CREATE TABLE oauth_pending (
  telegram_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Deployment-wide values, e.g. this Worker's ext_agent_host_id.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Single-user installs logged in with `npm run login`: that login belongs to the first user.
INSERT INTO openai_accounts (telegram_id, client_id, access_token, refresh_token, id_token, expires_at, status, updated_at)
SELECT u.telegram_id, a.client_id, a.access_token, a.refresh_token, a.id_token, a.expires_at, a.status, a.updated_at
FROM openai_auth a, (SELECT telegram_id FROM users ORDER BY created_at LIMIT 1) u;
DROP TABLE openai_auth;
