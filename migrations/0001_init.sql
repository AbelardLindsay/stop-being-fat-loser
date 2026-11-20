CREATE TABLE users (
  telegram_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','uk')),
  tone TEXT NOT NULL DEFAULT 'sarcastic' CHECK (tone IN ('sarcastic','brutal')),
  onboarding_step TEXT,             -- NULL = onboarding complete
  sex TEXT CHECK (sex IN ('male','female')),
  birth_year INTEGER,
  height_cm REAL,
  start_weight_kg REAL,
  current_weight_kg REAL,
  goal_weight_kg REAL,
  pace TEXT CHECK (pace IN ('slow','normal','fast')),
  activity TEXT CHECK (activity IN ('sedentary','light','moderate','active')),
  meals TEXT NOT NULL DEFAULT '[]',      -- JSON MealSlot[]
  work_days TEXT NOT NULL DEFAULT '[]',  -- JSON ISO weekdays 1..7
  work_start INTEGER, work_end INTEGER,  -- minutes of day
  wake INTEGER, sleep INTEGER,           -- minutes of day
  timezone TEXT NOT NULL DEFAULT 'Europe/Kyiv',
  weigh_day INTEGER,                     -- ISO weekday 1..7
  target_kcal INTEGER,
  onboarded_at INTEGER,                  -- unix s
  created_at INTEGER NOT NULL
);
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  local_date TEXT NOT NULL,             -- YYYY-MM-DD in user tz
  slot TEXT NOT NULL CHECK (slot IN ('breakfast','lunch','dinner','snack')),
  kcal INTEGER NOT NULL, protein_g REAL NOT NULL, carbs_g REAL NOT NULL, fat_g REAL NOT NULL,
  description TEXT NOT NULL,
  health_score INTEGER NOT NULL,
  sugary_drink INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX meals_user_date ON meals (telegram_id, local_date);
CREATE TABLE weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL, local_date TEXT NOT NULL, weight_kg REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE checkins (
  telegram_id INTEGER NOT NULL, local_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('walk','cola')),
  value TEXT NOT NULL CHECK (value IN ('done','skipped','clean','drank')),
  PRIMARY KEY (telegram_id, local_date, kind)
);
CREATE TABLE notifications_sent (
  telegram_id INTEGER NOT NULL, kind TEXT NOT NULL, local_date TEXT NOT NULL,
  PRIMARY KEY (telegram_id, kind, local_date)
);
CREATE TABLE openai_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL, ext_agent_host_id TEXT NOT NULL,
  access_token TEXT, refresh_token TEXT, id_token TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  refreshing_until INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','reauth_required')),
  updated_at INTEGER NOT NULL
);
