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
  it('sets protein by activity, fat within 0.6–1.0 g/kg, carbs the rest', () => {
    expect(macroTargets(1830, 85, 'sedentary')).toEqual({ protein: 136, fat: 51, carbs: 207 });
    expect(macroTargets(2000, 85, 'active')).toEqual({ protein: 187, fat: 56, carbs: 188 });
    expect(macroTargets(3000, 60, 'moderate')).toEqual({ protein: 120, fat: 60, carbs: 495 });
  });
  it('sets a water target by sex, higher on training days', () => {
    expect(waterTargetMl('male', false)).toBe(2000);
    expect(waterTargetMl('male', true)).toBe(2500);
    expect(waterTargetMl('female', false)).toBe(1600);
    expect(waterTargetMl('female', true)).toBe(2100);
  });
});
