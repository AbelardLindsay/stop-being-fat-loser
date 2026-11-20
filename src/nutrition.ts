export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active';
export type Pace = 'slow' | 'normal' | 'fast';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

export const PACE_KG: Record<Pace, number> = { slow: 0.25, normal: 0.5, fast: 0.75 };

const KCAL_PER_KG_FAT = 7700;
const MAX_DEFICIT_SHARE = 0.25;
const FLOOR: Record<Sex, number> = { male: 1500, female: 1200 };

export const MEAL_WEIGHTS: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};

/** Minutes of day, start inclusive, end exclusive. Snack has no window. */
export const SLOT_WINDOWS: Record<Exclude<MealSlot, 'snack'>, readonly [number, number]> = {
  breakfast: [300, 660],
  lunch: [660, 960],
  dinner: [960, 1320],
};

const round10 = (x: number): number => Math.round(x / 10) * 10;

export function targetCalories(p: {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  pace: Pace;
}): number {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * ACTIVITY_FACTOR[p.activity];
  const deficit = Math.min((PACE_KG[p.pace] * KCAL_PER_KG_FAT) / 7, MAX_DEFICIT_SHARE * tdee);
  return round10(Math.max(tdee - deficit, FLOOR[p.sex]));
}

/** Split `total` across `slots` by MEAL_WEIGHTS normalized over those slots only. */
function split(total: number, slots: readonly MealSlot[]): Partial<Record<MealSlot, number>> {
  const sum = slots.reduce((acc, s) => acc + MEAL_WEIGHTS[s], 0);
  const out: Partial<Record<MealSlot, number>> = {};
  if (sum === 0) return out;
  for (const s of slots) out[s] = round10((total * MEAL_WEIGHTS[s]) / sum);
  return out;
}

export function mealBudgets(target: number, meals: readonly MealSlot[]): Partial<Record<MealSlot, number>> {
  return split(target, MEAL_SLOTS.filter((s) => meals.includes(s)));
}

export function slotForTime(minute: number, meals: readonly MealSlot[]): MealSlot {
  for (const [slot, [start, end]] of Object.entries(SLOT_WINDOWS) as [MealSlot, readonly [number, number]][]) {
    if (minute >= start && minute < end) return meals.includes(slot) ? slot : 'snack';
  }
  return 'snack';
}

export function remainingPlan(
  target: number,
  meals: readonly MealSlot[],
  eatenBySlot: Partial<Record<MealSlot, number>>,
  nowMinute: number,
): { eaten: number; remaining: number; perSlot: Partial<Record<MealSlot, number>> } {
  const eaten = MEAL_SLOTS.reduce((acc, s) => acc + (eatenBySlot[s] ?? 0), 0);
  const remaining = target - eaten;
  const upcoming = MEAL_SLOTS.filter(
    (s) =>
      meals.includes(s) &&
      !eatenBySlot[s] &&
      (s === 'snack' || SLOT_WINDOWS[s][1] > nowMinute),
  );
  return { eaten, remaining, perSlot: split(Math.max(remaining, 0), upcoming) };
}

export function weeksToGoal(current: number, goal: number, pace: Pace): number {
  return Math.ceil((current - goal) / PACE_KG[pace]);
}

/** Grams of protein, fat and carbs. */
export interface Macros {
  protein: number;
  fat: number;
  carbs: number;
}

/** Higher with more training: more protein preserves muscle in a deficit. */
const PROTEIN_G_PER_GOAL_KG: Record<Activity, number> = { sedentary: 2.0, light: 2.0, moderate: 2.2, active: 2.4 };
const FAT_KCAL_SHARE = 0.25;

/** High-protein cut: protein by activity per kg of goal weight, fat 25% of kcal, carbs fill the rest. */
export function macroTargets(targetKcal: number, goalKg: number, activity: Activity): Macros {
  const protein = Math.round(PROTEIN_G_PER_GOAL_KG[activity] * goalKg);
  const fatKcal = FAT_KCAL_SHARE * targetKcal;
  return {
    protein,
    fat: Math.round(fatKcal / 9),
    carbs: Math.max(0, Math.round((targetKcal - protein * 4 - fatKcal) / 4)),
  };
}

const WATER_ML_PER_KG = 30;
const WATER_MIN_ML = 1500;
const WATER_MAX_ML = 4000;

/** Daily water: 30 ml per kg of current weight, rounded to 100 ml, within 1.5–4 l. */
export function waterTargetMl(weightKg: number): number {
  return Math.min(WATER_MAX_ML, Math.max(WATER_MIN_ML, Math.round((WATER_ML_PER_KG * weightKg) / 100) * 100));
}
