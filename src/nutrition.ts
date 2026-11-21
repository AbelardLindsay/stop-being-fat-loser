export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active';
export type Pace = 'slow' | 'normal' | 'fast';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const ACTIVITIES: readonly Activity[] = ['sedentary', 'light', 'moderate', 'active'];

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

/** 1.6 g/kg is enough without training in a deficit; up to 2.2 g/kg preserves muscle with hard training. */
const PROTEIN_G_PER_GOAL_KG: Record<Activity, number> = { sedentary: 1.6, light: 1.8, moderate: 2.0, active: 2.2 };
const FAT_KCAL_SHARE = 0.25;
const FAT_MIN_G_PER_GOAL_KG = 0.6;
const FAT_MAX_G_PER_GOAL_KG = 1.0;

/** Cut macros: protein 1.6–2.2 g/kg of goal weight by activity; fat 25% of kcal kept within 0.6–1.0 g/kg of goal weight; carbs fill the rest. */
export function macroTargets(targetKcal: number, goalKg: number, activity: Activity): Macros {
  const protein = Math.round(PROTEIN_G_PER_GOAL_KG[activity] * goalKg);
  const fat = Math.min(FAT_MAX_G_PER_GOAL_KG * goalKg, Math.max(FAT_MIN_G_PER_GOAL_KG * goalKg, (FAT_KCAL_SHARE * targetKcal) / 9));
  return {
    protein,
    fat: Math.round(fat),
    carbs: Math.max(0, Math.round((targetKcal - protein * 4 - fat * 9) / 4)),
  };
}

/** Drinking water: EFSA adequate total intake (2.5 l men, 2.0 l women) minus ~20% that comes from food. */
const WATER_BASE_ML: Record<Sex, number> = { male: 2000, female: 1600 };
const WATER_TRAINING_EXTRA_ML = 500;

/** Daily water target; training days add 500 ml for sweat losses. */
export function waterTargetMl(sex: Sex, trainingDay: boolean): number {
  return WATER_BASE_ML[sex] + (trainingDay ? WATER_TRAINING_EXTRA_ML : 0);
}
