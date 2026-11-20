import type { Lang } from './i18n.ts';
import type { Activity, MealSlot, Pace, Sex } from './nutrition.ts';
import { addDays } from './schedule.ts';

export type OnboardingStep =
  | 'language'
  | 'sex'
  | 'age'
  | 'height'
  | 'weight'
  | 'goal_weight'
  | 'pace'
  | 'activity'
  | 'meals'
  | 'work_days'
  | 'work_hours'
  | 'training_days'
  | 'sleep_hours'
  | 'timezone'
  | 'weigh_day';

export interface User {
  telegram_id: number;
  chat_id: number;
  language: Lang;
  onboarding_step: OnboardingStep | null;
  sex: Sex | null;
  birth_year: number | null;
  height_cm: number | null;
  start_weight_kg: number | null;
  current_weight_kg: number | null;
  goal_weight_kg: number | null;
  pace: Pace | null;
  activity: Activity | null;
  meals: MealSlot[];
  work_days: number[];
  work_start: number | null;
  work_end: number | null;
  wake: number | null;
  sleep: number | null;
  timezone: string;
  weigh_day: number | null;
  target_kcal: number | null;
  onboarded_at: number | null;
  created_at: number;
  editing_meal_id: number | null;
  editing_message_id: number | null;
  walk_time: number | null;
  walk_snooze_date: string | null;
  walk_snooze_minute: number | null;
  training_days: number[];
}

type UserRow = Omit<User, 'meals' | 'work_days' | 'training_days'> & {
  meals: string;
  work_days: string;
  training_days: string;
};
export type UserPatch = Partial<Omit<User, 'telegram_id' | 'created_at'>>;

export const nowSec = (): number => Math.floor(Date.now() / 1000);

function fromRow(row: UserRow): User {
  return {
    ...row,
    meals: JSON.parse(row.meals),
    work_days: JSON.parse(row.work_days),
    training_days: JSON.parse(row.training_days),
  };
}

export async function getUser(db: D1Database, telegramId: number): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE telegram_id = ?1').bind(telegramId).first<UserRow>();
  return row ? fromRow(row) : null;
}

export async function createUser(db: D1Database, telegramId: number, chatId: number): Promise<User> {
  const row = await db
    .prepare(
      `INSERT INTO users (telegram_id, chat_id, onboarding_step, created_at) VALUES (?1, ?2, 'language', ?3)
       ON CONFLICT(telegram_id) DO UPDATE SET chat_id = excluded.chat_id RETURNING *`,
    )
    .bind(telegramId, chatId, nowSec())
    .first<UserRow>();
  if (!row) throw new Error(`failed to create user ${telegramId}`);
  return fromRow(row);
}

export async function listOnboardedUsers(db: D1Database): Promise<User[]> {
  const { results } = await db.prepare('SELECT * FROM users WHERE onboarding_step IS NULL').all<UserRow>();
  return results.map(fromRow);
}

/** Persists `patch` and applies it to the in-memory `user`. Keys are compile-time column names. */
export async function patchUser(db: D1Database, user: User, patch: UserPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k], i) => `${k} = ?${i + 1}`).join(', ');
  const values = entries.map(([, v]) => (Array.isArray(v) ? JSON.stringify(v) : v));
  await db
    .prepare(`UPDATE users SET ${sets} WHERE telegram_id = ?${entries.length + 1}`)
    .bind(...values, user.telegram_id)
    .run();
  Object.assign(user, patch);
}

// ---------- meals ----------

export interface MealRow {
  id: number;
  telegram_id: number;
  local_date: string;
  slot: MealSlot;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  description: string;
  health_score: number;
  sugary_drink: number;
  photo_file_id: string | null;
  caption: string | null;
  created_at: number;
}

export async function insertMeal(db: D1Database, m: Omit<MealRow, 'id' | 'created_at'>): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO meals (telegram_id, local_date, slot, kcal, protein_g, carbs_g, fat_g, description, health_score, sugary_drink, photo_file_id, caption, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
    )
    .bind(
      m.telegram_id,
      m.local_date,
      m.slot,
      m.kcal,
      m.protein_g,
      m.carbs_g,
      m.fat_g,
      m.description,
      m.health_score,
      m.sugary_drink,
      m.photo_file_id,
      m.caption,
      nowSec(),
    )
    .first<{ id: number }>();
  if (!row) throw new Error('meal insert returned no id');
  return row.id;
}

export type MealEstimateFields = Pick<
  MealRow,
  'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'description' | 'health_score' | 'sugary_drink'
>;

/** Replaces a meal's estimate after a user correction; only touches the user's own meal. */
export async function updateMealEstimate(
  db: D1Database,
  telegramId: number,
  mealId: number,
  m: MealEstimateFields,
): Promise<void> {
  await db
    .prepare(
      `UPDATE meals SET kcal = ?1, protein_g = ?2, carbs_g = ?3, fat_g = ?4, description = ?5, health_score = ?6, sugary_drink = ?7
       WHERE id = ?8 AND telegram_id = ?9`,
    )
    .bind(m.kcal, m.protein_g, m.carbs_g, m.fat_g, m.description, m.health_score, m.sugary_drink, mealId, telegramId)
    .run();
}

export async function getMeal(db: D1Database, telegramId: number, mealId: number): Promise<MealRow | null> {
  return db.prepare('SELECT * FROM meals WHERE id = ?1 AND telegram_id = ?2').bind(mealId, telegramId).first<MealRow>();
}

export async function kcalBySlot(
  db: D1Database,
  telegramId: number,
  date: string,
): Promise<Partial<Record<MealSlot, number>>> {
  const { results } = await db
    .prepare('SELECT slot, SUM(kcal) AS kcal FROM meals WHERE telegram_id = ?1 AND local_date = ?2 GROUP BY slot')
    .bind(telegramId, date)
    .all<{ slot: MealSlot; kcal: number }>();
  return Object.fromEntries(results.map((r) => [r.slot, r.kcal]));
}

export async function mealsOn(db: D1Database, telegramId: number, date: string): Promise<MealRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM meals WHERE telegram_id = ?1 AND local_date = ?2 ORDER BY id')
    .bind(telegramId, date)
    .all<MealRow>();
  return results;
}

export async function lastMealOn(db: D1Database, telegramId: number, date: string): Promise<MealRow | null> {
  return db
    .prepare('SELECT * FROM meals WHERE telegram_id = ?1 AND local_date = ?2 ORDER BY id DESC LIMIT 1')
    .bind(telegramId, date)
    .first<MealRow>();
}

export async function hasMealOn(db: D1Database, telegramId: number, date: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM meals WHERE telegram_id = ?1 AND local_date = ?2 LIMIT 1')
    .bind(telegramId, date)
    .first();
  return row !== null;
}

/** Deletes only when the meal belongs to `telegramId`. */
export async function deleteMeal(db: D1Database, telegramId: number, mealId: number): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM meals WHERE id = ?1 AND telegram_id = ?2')
    .bind(mealId, telegramId)
    .run();
  return res.meta.changes > 0;
}

export interface DayTotals {
  local_date: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

/** Per-day sums for days with at least one meal in [from, to], newest first. */
export async function dayTotals(db: D1Database, telegramId: number, from: string, to: string): Promise<DayTotals[]> {
  const { results } = await db
    .prepare(
      `SELECT local_date, SUM(kcal) AS kcal, SUM(protein_g) AS protein_g, SUM(fat_g) AS fat_g, SUM(carbs_g) AS carbs_g
       FROM meals WHERE telegram_id = ?1 AND local_date BETWEEN ?2 AND ?3
       GROUP BY local_date ORDER BY local_date DESC`,
    )
    .bind(telegramId, from, to)
    .all<DayTotals>();
  return results;
}

/** Last weight logged on each date in [from, to]. */
export async function weightsBetween(
  db: D1Database,
  telegramId: number,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT local_date, weight_kg FROM weights WHERE telegram_id = ?1 AND local_date BETWEEN ?2 AND ?3 ORDER BY id`,
    )
    .bind(telegramId, from, to)
    .all<{ local_date: string; weight_kg: number }>();
  return Object.fromEntries(results.map((r) => [r.local_date, r.weight_kg]));
}

// ---------- weights ----------

export async function lastWeight(db: D1Database, telegramId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT weight_kg FROM weights WHERE telegram_id = ?1 ORDER BY id DESC LIMIT 1')
    .bind(telegramId)
    .first<{ weight_kg: number }>();
  return row?.weight_kg ?? null;
}

export async function insertWeight(db: D1Database, telegramId: number, date: string, kg: number): Promise<void> {
  await db
    .prepare('INSERT INTO weights (telegram_id, local_date, weight_kg, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(telegramId, date, kg, nowSec())
    .run();
}

export async function hasWeightOn(db: D1Database, telegramId: number, date: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM weights WHERE telegram_id = ?1 AND local_date = ?2 LIMIT 1')
    .bind(telegramId, date)
    .first();
  return row !== null;
}

/** Latest weight logged before `date`. */
export async function weightBefore(db: D1Database, telegramId: number, date: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT weight_kg FROM weights WHERE telegram_id = ?1 AND local_date < ?2 ORDER BY local_date DESC, id DESC LIMIT 1')
    .bind(telegramId, date)
    .first<{ weight_kg: number }>();
  return row?.weight_kg ?? null;
}

// ---------- water ----------

export async function insertWater(db: D1Database, telegramId: number, date: string, ml: number): Promise<void> {
  await db
    .prepare('INSERT INTO water (telegram_id, local_date, ml, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(telegramId, date, ml, nowSec())
    .run();
}

export async function waterOn(db: D1Database, telegramId: number, date: string): Promise<number> {
  const row = await db
    .prepare('SELECT SUM(ml) AS ml FROM water WHERE telegram_id = ?1 AND local_date = ?2')
    .bind(telegramId, date)
    .first<{ ml: number | null }>();
  return row?.ml ?? 0;
}

/** Total ml per date in [from, to]. */
export async function waterBetween(
  db: D1Database,
  telegramId: number,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      'SELECT local_date, SUM(ml) AS ml FROM water WHERE telegram_id = ?1 AND local_date BETWEEN ?2 AND ?3 GROUP BY local_date',
    )
    .bind(telegramId, from, to)
    .all<{ local_date: string; ml: number }>();
  return Object.fromEntries(results.map((r) => [r.local_date, r.ml]));
}

// ---------- check-ins ----------

export type CheckinKind = 'walk' | 'cola';
export type CheckinValue = 'done' | 'skipped' | 'clean' | 'drank';

export async function upsertCheckin(
  db: D1Database,
  telegramId: number,
  date: string,
  kind: CheckinKind,
  value: CheckinValue,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkins (telegram_id, local_date, kind, value) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(telegram_id, local_date, kind) DO UPDATE SET value = excluded.value`,
    )
    .bind(telegramId, date, kind, value)
    .run();
}

/** Days in [from, to] with a walk done and with no cola. */
export async function checkinCounts(
  db: D1Database,
  telegramId: number,
  from: string,
  to: string,
): Promise<{ walks: number; colaFree: number }> {
  const row = await db
    .prepare(
      `SELECT SUM(kind = 'walk' AND value = 'done') AS walks, SUM(kind = 'cola' AND value = 'clean') AS colaFree
       FROM checkins WHERE telegram_id = ?1 AND local_date BETWEEN ?2 AND ?3`,
    )
    .bind(telegramId, from, to)
    .first<{ walks: number | null; colaFree: number | null }>();
  return { walks: row?.walks ?? 0, colaFree: row?.colaFree ?? 0 };
}

/** Claims a due snoozed walk reminder by clearing it. False when another tick already did. */
export async function claimWalkSnooze(db: D1Database, telegramId: number, date: string, minute: number): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE users SET walk_snooze_date = NULL, walk_snooze_minute = NULL
       WHERE telegram_id = ?1 AND walk_snooze_date = ?2 AND walk_snooze_minute = ?3`,
    )
    .bind(telegramId, date, minute)
    .run();
  return res.meta.changes > 0;
}

export async function checkinsOn(
  db: D1Database,
  telegramId: number,
  date: string,
): Promise<Partial<Record<CheckinKind, CheckinValue>>> {
  const { results } = await db
    .prepare('SELECT kind, value FROM checkins WHERE telegram_id = ?1 AND local_date = ?2')
    .bind(telegramId, date)
    .all<{ kind: CheckinKind; value: CheckinValue }>();
  return Object.fromEntries(results.map((r) => [r.kind, r.value]));
}

/**
 * Consecutive local dates with `kind = value`, counted back from `today`.
 * Today isn't over yet, so a streak still alive through yesterday counts even if today has no entry.
 */
export async function streak(
  db: D1Database,
  telegramId: number,
  kind: CheckinKind,
  value: CheckinValue,
  today: string,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT local_date FROM checkins WHERE telegram_id = ?1 AND kind = ?2 AND value = ?3 AND local_date <= ?4
       ORDER BY local_date DESC LIMIT 1000`,
    )
    .bind(telegramId, kind, value, today)
    .all<{ local_date: string }>();
  let expected = results[0]?.local_date === today ? today : addDays(today, -1);
  let n = 0;
  for (const r of results) {
    if (r.local_date !== expected) break;
    n++;
    expected = addDays(expected, -1);
  }
  return n;
}

// ---------- ChatGPT usage ----------

export interface UsageRecord {
  telegram_id: number;
  local_date: string;
  kind: 'meal' | 'correction';
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
}

export async function insertUsage(db: D1Database, u: UsageRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_usage (telegram_id, local_date, kind, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      u.telegram_id,
      u.local_date,
      u.kind,
      u.model,
      u.input_tokens,
      u.cached_tokens,
      u.output_tokens,
      u.reasoning_tokens,
      nowSec(),
    )
    .run();
}

/** Request count and token sums for one group of ai_usage rows. */
export interface UsageTotals {
  requests: number;
  input: number;
  output: number;
  reasoning: number;
}

const USAGE_SUMS = `COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input,
  COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(reasoning_tokens), 0) AS reasoning`;

export async function usageSince(db: D1Database, sinceUnix: number): Promise<UsageTotals> {
  const row = await db
    .prepare(`SELECT ${USAGE_SUMS} FROM ai_usage WHERE created_at >= ?1`)
    .bind(sinceUnix)
    .first<UsageTotals>();
  return row ?? { requests: 0, input: 0, output: 0, reasoning: 0 };
}

export async function usageByDay(db: D1Database, from: string): Promise<(UsageTotals & { local_date: string })[]> {
  const { results } = await db
    .prepare(`SELECT local_date, ${USAGE_SUMS} FROM ai_usage WHERE local_date >= ?1 GROUP BY local_date ORDER BY local_date DESC`)
    .bind(from)
    .all<UsageTotals & { local_date: string }>();
  return results;
}

export async function usageByUser(db: D1Database, from: string): Promise<(UsageTotals & { telegram_id: number })[]> {
  const { results } = await db
    .prepare(`SELECT telegram_id, ${USAGE_SUMS} FROM ai_usage WHERE local_date >= ?1 GROUP BY telegram_id ORDER BY requests DESC`)
    .bind(from)
    .all<UsageTotals & { telegram_id: number }>();
  return results;
}

// ---------- notifications ----------

/** Claims a (user, kind, date) send slot. Returns false when another tick already claimed it. */
export async function claimNotification(
  db: D1Database,
  telegramId: number,
  kind: string,
  date: string,
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO notifications_sent (telegram_id, kind, local_date) VALUES (?1, ?2, ?3)')
    .bind(telegramId, kind, date)
    .run();
  return res.meta.changes > 0;
}

/** True when walk reminders went out on both of the previous two local dates and neither was walked. */
export async function walkIgnoredTwoDays(db: D1Database, telegramId: number, today: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM notifications_sent WHERE telegram_id = ?1 AND kind = 'walk' AND local_date IN (?2, ?3)) AS sent,
         (SELECT COUNT(*) FROM checkins WHERE telegram_id = ?1 AND kind = 'walk' AND value = 'done' AND local_date IN (?2, ?3)) AS done`,
    )
    .bind(telegramId, addDays(today, -1), addDays(today, -2))
    .first<{ sent: number; done: number }>();
  return row?.sent === 2 && row.done === 0;
}
