import { describe, expect, it } from 'vitest';
import {
  macroTargets,
  mealBudgets,
  remainingPlan,
  slotForTime,
  targetCalories,
  waterTargetMl,
  weeksToGoal,
} from '../src/nutrition.ts';

describe('targetCalories', () => {
  it('male sedentary normal pace', () => {
    expect(
      targetCalories({ sex: 'male', age: 30, heightCm: 180, weightKg: 100, activity: 'sedentary', pace: 'normal' }),
    ).toBe(1830);
  });
  it('female light slow pace', () => {
    expect(
      targetCalories({ sex: 'female', age: 30, heightCm: 165, weightKg: 80, activity: 'light', pace: 'slow' }),
    ).toBe(1820);
  });
  it('clamps to the female floor', () => {
    expect(
      targetCalories({ sex: 'female', age: 25, heightCm: 155, weightKg: 55, activity: 'sedentary', pace: 'fast' }),
    ).toBe(1200);
  });
});

describe('meal split', () => {
  it('budgets only the selected slots', () => {
    expect(mealBudgets(1830, ['lunch', 'dinner', 'snack'])).toEqual({ lunch: 850, dinner: 730, snack: 240 });
  });
  it('splits the remainder across upcoming slots', () => {
    expect(remainingPlan(1830, ['lunch', 'dinner', 'snack'], { lunch: 900 }, 1020)).toEqual({
      eaten: 900,
      remaining: 930,
      perSlot: { dinner: 700, snack: 230 },
    });
  });
  it('maps an unselected window to snack', () => {
    expect(slotForTime(630, ['lunch', 'dinner'])).toBe('snack');
  });
  it('computes weeks to goal', () => {
    expect(weeksToGoal(100, 85, 'normal')).toBe(30);
  });
  it('sets high-protein macros that grow with training', () => {
    expect(macroTargets(1830, 85, 'sedentary')).toEqual({ protein: 170, fat: 51, carbs: 173 });
    expect(macroTargets(2000, 85, 'active')).toEqual({ protein: 204, fat: 56, carbs: 171 });
  });
  it('sets a water target from weight within 1.5–4 l', () => {
    expect(waterTargetMl(100)).toBe(3000);
    expect(waterTargetMl(40)).toBe(1500);
    expect(waterTargetMl(150)).toBe(4000);
  });
});
