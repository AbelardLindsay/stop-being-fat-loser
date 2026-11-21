import type { User } from './db.ts';
import type { ProfileParams, SummaryParams } from './i18n.ts';
import {
  macroTargets,
  mealBudgets,
  waterTargetMl,
  weeksToGoal,
  type Activity,
  type Macros,
  type Pace,
  type Sex,
} from './nutrition.ts';
import { isoWeekdayOf, scheduledMinute, type ScheduleProfile } from './schedule.ts';

/** Every column onboarding fills, narrowed to non-null. */
export interface Profile {
  sex: Sex;
  age: number;
  heightCm: number;
  startKg: number;
  weightKg: number;
  goalKg: number;
  pace: Pace;
  activity: Activity;
  schedule: ScheduleProfile;
}

export function completeProfile(u: User): Profile {
  const {
    sex,
    birth_year,
    height_cm,
    start_weight_kg,
    current_weight_kg,
    goal_weight_kg,
    pace,
    activity,
    wake,
    sleep,
    weigh_day,
  } = u;
  if (
    sex === null ||
    birth_year === null ||
    height_cm === null ||
    start_weight_kg === null ||
    current_weight_kg === null ||
    goal_weight_kg === null ||
    pace === null ||
    activity === null ||
    wake === null ||
    sleep === null ||
    weigh_day === null
  ) {
    throw new Error(`user ${u.telegram_id} has an incomplete profile`);
  }
  return {
    sex,
    age: new Date().getUTCFullYear() - birth_year,
    heightCm: height_cm,
    startKg: start_weight_kg,
    weightKg: current_weight_kg,
    goalKg: goal_weight_kg,
    pace,
    activity,
    schedule: {
      workDays: u.work_days,
      workStart: u.work_start,
      workEnd: u.work_end,
      wake,
      sleep,
      weighDay: weigh_day,
      walkTime: u.walk_time,
    },
  };
}

/** Walk reminder minute on a work day (null when there's one time for every day) and on a day off. */
export function walkTimes(s: ScheduleProfile): { walkWork: number | null; walkOff: number } {
  if (s.walkTime !== null) return { walkWork: null, walkOff: s.walkTime };
  const workDay = s.workDays[0];
  const offDay = [1, 2, 3, 4, 5, 6, 7].find((d) => !s.workDays.includes(d));
  const offSchedule = offDay === undefined ? { ...s, workDays: [] } : s;
  return {
    walkWork: workDay === undefined ? null : scheduledMinute('walk', s, workDay),
    walkOff: scheduledMinute('walk', offSchedule, offDay ?? 1) ?? 0,
  };
}

export function summaryParams(u: User, p: Profile, target: number): SummaryParams {
  return {
    target,
    budgets: mealBudgets(target, u.meals),
    weeks: weeksToGoal(p.weightKg, p.goalKg, p.pace),
    goal: p.goalKg,
    weighDay: p.schedule.weighDay,
    macros: macroTargets(target, p.goalKg, p.activity),
    ...walkTimes(p.schedule),
  };
}

export function profileParams(
  u: User,
  p: Profile,
  target: number,
  chatgpt: ProfileParams['chatgpt'],
): ProfileParams {
  return {
    sex: p.sex,
    age: p.age,
    height: p.heightCm,
    start: p.startKg,
    current: p.weightKg,
    goal: p.goalKg,
    pace: p.pace,
    activity: p.activity,
    target,
    budgets: mealBudgets(target, u.meals),
    workDays: u.work_days,
    workStart: u.work_start,
    workEnd: u.work_end,
    wake: p.schedule.wake,
    sleep: p.schedule.sleep,
    timezone: u.timezone,
    weighDay: p.schedule.weighDay,
    chatgpt,
    macros: macroTargets(target, p.goalKg, p.activity),
    trainingDays: u.training_days,
    ...walkTimes(p.schedule),
  };
}

/** Daily protein/fat/carbs targets from the stored calorie target and goal weight. */
export function userMacroTargets(u: User): Macros {
  return macroTargets(u.target_kcal ?? 0, u.goal_weight_kg ?? 0, u.activity ?? 'sedentary');
}

/** Daily water target for local `date`: base by sex, more on the user's training days. */
export function userWaterTarget(u: User, date: string): number {
  return waterTargetMl(u.sex ?? 'male', u.training_days.includes(isoWeekdayOf(date)));
}

/** Parses "82.5" or "82,5"; NaN for anything else. */
export function parseDecimal(text: string): number {
  const s = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}
