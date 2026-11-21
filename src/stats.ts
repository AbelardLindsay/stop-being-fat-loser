import {
  checkinCounts,
  dayTotals,
  usageByDay,
  usageByUser,
  usageSince,
  mealsOn,
  waterBetween,
  weightBefore,
  weightsBetween,
  type DayTotals,
  type User,
  type UsageTotals,
} from './db.ts';
import type { HistoryDay, HistoryParams, MealsHistoryDay, UsageParams, WeekSummaryParams } from './i18n.ts';
import { nowSec } from './openai.ts';
import { waterTargetMl, type Macros } from './nutrition.ts';
import { userMacroTargets, userWaterTarget } from './profile.ts';
import { addDays, isoWeekdayOf, localNow } from './schedule.ts';

/** A day counts as protein-hit at 90% of the target. */
const PROTEIN_HIT_SHARE = 0.9;

const macrosOf = (d: DayTotals): Macros => ({ protein: d.protein_g, fat: d.fat_g, carbs: d.carbs_g });

function averages(days: DayTotals[]): { kcal: number; macros: Macros } | null {
  if (days.length === 0) return null;
  const avg = (pick: (d: DayTotals) => number) => days.reduce((sum, d) => sum + pick(d), 0) / days.length;
  return {
    kcal: avg((d) => d.kcal),
    macros: { protein: avg((d) => d.protein_g), fat: avg((d) => d.fat_g), carbs: avg((d) => d.carbs_g) },
  };
}

/** Last `n` local days, newest first. Today is listed but left out of the averages because it isn't over. */
export async function buildHistory(db: D1Database, u: User, n: number, today: string): Promise<HistoryParams> {
  const from = addDays(today, -(n - 1));
  const [totals, weights] = await Promise.all([
    dayTotals(db, u.telegram_id, from, today),
    weightsBetween(db, u.telegram_id, from, today),
  ]);
  const byDate = Object.fromEntries(totals.map((d) => [d.local_date, d]));
  const days: HistoryDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, -i);
    const d = byDate[date];
    days.push({
      date,
      isoWeekday: isoWeekdayOf(date),
      kcal: d?.kcal ?? null,
      macros: d ? macrosOf(d) : null,
      weight: weights[date] ?? null,
      isToday: i === 0,
    });
  }
  const target = u.target_kcal ?? 0;
  const complete = totals.filter((d) => d.local_date !== today);
  const avg = averages(complete);
  return {
    days,
    target,
    macrosTarget: userMacroTargets(u),
    avgKcal: avg?.kcal ?? null,
    avgMacros: avg?.macros ?? null,
    completeDays: complete.length,
    onTargetDays: complete.filter((d) => d.kcal <= target).length,
  };
}

/** Today's and yesterday's meals, each with its eating time and the day's totals. */
export async function buildMealsHistory(db: D1Database, u: User, today: string): Promise<MealsHistoryDay[]> {
  const dates = [today, addDays(today, -1)];
  const perDay = await Promise.all(dates.map((date) => mealsOn(db, u.telegram_id, date)));
  return dates.map((date, i) => {
    const meals = perDay[i] ?? [];
    return {
      isToday: i === 0,
      date,
      isoWeekday: isoWeekdayOf(date),
      meals: meals.map((m) => ({
        time: localNow(new Date(m.created_at * 1000), u.timezone).minute,
        slot: m.slot,
        kcal: m.kcal,
        macros: { protein: m.protein_g, fat: m.fat_g, carbs: m.carbs_g },
        description: m.description,
      })),
      kcal: meals.reduce((sum, m) => sum + m.kcal, 0),
      macros: meals.reduce<Macros>(
        (acc, m) => ({ protein: acc.protein + m.protein_g, fat: acc.fat + m.fat_g, carbs: acc.carbs + m.carbs_g }),
        { protein: 0, fat: 0, carbs: 0 },
      ),
    };
  });
}

/**
 * The 7 days ending `today` (Mon–Sun when sent on Sunday). `bad` drives the roast: few logged days,
 * mostly over target, under 4 walks, water target missed on most days, or weight going up.
 */
export async function buildWeekSummary(
  db: D1Database,
  u: User,
  today: string,
): Promise<{ params: WeekSummaryParams; bad: boolean }> {
  const from = addDays(today, -6);
  const [totals, weights, before, checks, water] = await Promise.all([
    dayTotals(db, u.telegram_id, from, today),
    weightsBetween(db, u.telegram_id, from, today),
    weightBefore(db, u.telegram_id, from),
    checkinCounts(db, u.telegram_id, from, today),
    waterBetween(db, u.telegram_id, from, today),
  ]);
  const waterDays = Object.entries(water).filter(([date, ml]) => ml >= userWaterTarget(u, date)).length;
  const target = u.target_kcal ?? 0;
  const macrosTarget = userMacroTargets(u);
  const avg = averages(totals);
  const lastDate = Object.keys(weights).sort().at(-1);
  const weight = lastDate === undefined ? null : (weights[lastDate] ?? null);
  const weightChange = weight !== null && before !== null ? weight - before : null;
  const onTargetDays = totals.filter((d) => d.kcal <= target).length;
  const params: WeekSummaryParams = {
    from,
    to: today,
    target,
    macrosTarget,
    loggedDays: totals.length,
    onTargetDays,
    avgKcal: avg?.kcal ?? null,
    avgMacros: avg?.macros ?? null,
    proteinHitDays: totals.filter((d) => d.protein_g >= PROTEIN_HIT_SHARE * macrosTarget.protein).length,
    walks: checks.walks,
    colaFree: checks.colaFree,
    weight,
    weightChange,
    avgWaterMl: Object.values(water).reduce((sum, ml) => sum + ml, 0) / 7,
    waterDays,
    waterTarget: waterTargetMl(u.sex ?? 'male', false),
    waterTargetTraining: u.training_days.length > 0 ? waterTargetMl(u.sex ?? 'male', true) : null,
  };
  const bad =
    totals.length < 5 ||
    onTargetDays < 0.7 * totals.length ||
    checks.walks < 4 ||
    waterDays < 4 ||
    (weightChange ?? 0) > 0;
  return { params, bad };
}

/** ChatGPT's plan limit is a rolling 5-hour window. */
const LIMIT_WINDOW_SECONDS = 5 * 3600;

/** Owner's /usage: the last 5 hours, each of the last 7 local days, and per-user totals. */
export async function buildUsage(db: D1Database, model: string, owner: number, today: string): Promise<UsageParams> {
  const from = addDays(today, -6);
  const [window, byDay, byUser] = await Promise.all([
    usageSince(db, nowSec() - LIMIT_WINDOW_SECONDS),
    usageByDay(db, from),
    usageByUser(db, from),
  ]);
  const totals = ({ requests, input, output, reasoning }: UsageTotals) => ({ requests, input, output, reasoning });
  return {
    model,
    window,
    days: byDay.map((d) => ({ date: d.local_date, isoWeekday: isoWeekdayOf(d.local_date), totals: totals(d) })),
    week: byDay.reduce<UsageTotals>(
      (acc, d) => ({
        requests: acc.requests + d.requests,
        input: acc.input + d.input,
        output: acc.output + d.output,
        reasoning: acc.reasoning + d.reasoning,
      }),
      { requests: 0, input: 0, output: 0, reasoning: 0 },
    ),
    users: byUser.map((u) => ({ id: u.telegram_id, isOwner: u.telegram_id === owner, totals: totals(u) })),
  };
}
