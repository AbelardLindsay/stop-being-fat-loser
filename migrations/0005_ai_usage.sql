-- Token usage reported by each ChatGPT request, for the owner's /usage.
CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,          -- who sent the photo/correction
  local_date TEXT NOT NULL,              -- YYYY-MM-DD in that user's tz
  kind TEXT NOT NULL CHECK (kind IN ('meal','correction')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ai_usage_date ON ai_usage (local_date);
CREATE INDEX ai_usage_created ON ai_usage (created_at);
