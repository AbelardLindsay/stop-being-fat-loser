import { InlineKeyboard } from 'grammy';
import type { BotCtx } from './bot.ts';
import { insertWeight, nowSec, patchUser, type OnboardingStep, type User, type UserPatch } from './db.ts';
import { getAccount, ownerId } from './openai.ts';
import { t, type Lang } from './i18n.ts';
import { MEAL_SLOTS, targetCalories, type Activity, type MealSlot, type Pace, type Sex } from './nutrition.ts';
import { completeProfile, parseDecimal, summaryParams } from './profile.ts';
import { isValidTimeZone, localNow, parseRange } from './schedule.ts';

const STEPS: readonly OnboardingStep[] = [
  'language',
  'sex',
  'age',
  'height',
  'weight',
  'goal_weight',
  'pace',
  'activity',
  'meals',
  'work_days',
  'work_hours',
  'training_days',
  'sleep_hours',
  'timezone',
  'weigh_day',
];

const TIMEZONES = ['Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/London'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const HTML = { parse_mode: 'HTML' } as const;

function nextStep(step: OnboardingStep, workDays: number[]): OnboardingStep | null {
  const after = STEPS.slice(STEPS.indexOf(step) + 1);
  return after.find((s) => s !== 'work_hours' || workDays.length > 0) ?? null;
}

/** Weekdays with `day` toggled, in Mon..Sun order. */
export function toggleDay(days: number[], day: number): number[] {
  return WEEKDAYS.filter((d) => (d === day ? !days.includes(d) : days.includes(d)));
}

export function weekdayKeyboard(lang: Lang, prefix: string, selected: (d: number) => boolean, done: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const d of WEEKDAYS) {
    kb.text(`${selected(d) ? '✅ ' : ''}${t(lang, 'weekday', { d })}`, `${prefix}${d}`);
    if (d === 4) kb.row();
  }
  if (done) kb.row().text(t(lang, 'btn_done'), `${prefix}done`);
  return kb;
}

function mealsKeyboard(u: User): InlineKeyboard {
  const kb = new InlineKeyboard();
  MEAL_SLOTS.forEach((slot, i) => {
    kb.text(`${u.meals.includes(slot) ? '✅ ' : ''}${t(u.language, 'slot', { slot })}`, `ob:meal:${slot}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.text(t(u.language, 'btn_done'), 'ob:meal:done');
}

function stepPrompt(u: User): { text: string; keyboard?: InlineKeyboard } {
  const lang = u.language;
  switch (u.onboarding_step) {
    case 'language':
      return {
        text: t(lang, 'ob_language'),
        keyboard: new InlineKeyboard().text('🇬🇧 English', 'ob:lang:en').text('🇺🇦 Українська', 'ob:lang:uk'),
      };
    case 'sex':
      return {
        text: t(lang, 'ob_sex'),
        keyboard: new InlineKeyboard().text(t(lang, 'btn_male'), 'ob:sex:male').text(t(lang, 'btn_female'), 'ob:sex:female'),
      };
    case 'age':
      return { text: t(lang, 'ob_age') };
    case 'height':
      return { text: t(lang, 'ob_height') };
    case 'weight':
      return { text: t(lang, 'ob_weight') };
    case 'goal_weight':
      return { text: t(lang, 'ob_goal_weight') };
    case 'pace':
      return {
        text: t(lang, 'ob_pace'),
        keyboard: new InlineKeyboard()
          .text(t(lang, 'btn_pace_slow'), 'ob:pace:slow')
          .row()
          .text(t(lang, 'btn_pace_normal'), 'ob:pace:normal')
          .row()
          .text(t(lang, 'btn_pace_fast'), 'ob:pace:fast'),
      };
    case 'activity':
      return {
        text: t(lang, 'ob_activity'),
        keyboard: new InlineKeyboard()
          .text(t(lang, 'btn_activity_sedentary'), 'ob:act:sedentary')
          .row()
          .text(t(lang, 'btn_activity_light'), 'ob:act:light')
          .row()
          .text(t(lang, 'btn_activity_moderate'), 'ob:act:moderate')
          .row()
          .text(t(lang, 'btn_activity_active'), 'ob:act:active'),
      };
    case 'meals':
      return { text: t(lang, 'ob_meals'), keyboard: mealsKeyboard(u) };
    case 'work_days':
      return {
        text: t(lang, 'ob_work_days'),
        keyboard: weekdayKeyboard(lang, 'ob:wd:', (d) => u.work_days.includes(d), true),
      };
    case 'training_days':
      return {
        text: t(lang, 'ob_training_days'),
        keyboard: weekdayKeyboard(lang, 'ob:td:', (d) => u.training_days.includes(d), true),
      };
    case 'work_hours':
      return { text: t(lang, 'ob_work_hours') };
    case 'sleep_hours':
      return { text: t(lang, 'ob_sleep_hours') };
    case 'timezone': {
      const kb = new InlineKeyboard();
      TIMEZONES.forEach((tz, i) => {
        kb.text(tz, `ob:tz:${tz}`);
        if (i % 2 === 1) kb.row();
      });
      return { text: t(lang, 'ob_timezone'), keyboard: kb };
    }
    case 'weigh_day':
      return { text: t(lang, 'ob_weigh_day'), keyboard: weekdayKeyboard(lang, 'ob:weigh:', () => false, false) };
    case null:
      return { text: t(lang, 'help') };
  }
}

export async function sendStepPrompt(ctx: BotCtx): Promise<void> {
  const { text, keyboard } = stepPrompt(ctx.user);
  await ctx.reply(text, keyboard ? { ...HTML, reply_markup: keyboard } : HTML);
}

/** Stores `patch`, then moves to the next step or finishes onboarding. */
async function advance(ctx: BotCtx, patch: UserPatch): Promise<void> {
  const u = ctx.user;
  const step = u.onboarding_step;
  if (step === null) return;
  const next = nextStep(step, patch.work_days ?? u.work_days);
  if (next !== null) {
    await patchUser(ctx.env.DB, u, { ...patch, onboarding_step: next });
    await sendStepPrompt(ctx);
    return;
  }
  Object.assign(u, patch);
  const profile = completeProfile(u);
  const target = targetCalories(profile);
  await patchUser(ctx.env.DB, u, { ...patch, target_kcal: target, onboarding_step: null, onboarded_at: nowSec() });
  await ctx.reply(t(u.language, 'summary', summaryParams(u, profile, target)), HTML);
  if (u.telegram_id !== ownerId(ctx.env)) return;
  const account = await getAccount(ctx.env, u.telegram_id);
  if (account?.status !== 'ok') await ctx.reply(t(u.language, 'connect_hint'), HTML);
}

/** Removes the inline keyboard from the prompt the user just answered. */
async function closePrompt(ctx: BotCtx): Promise<void> {
  await ctx.editMessageReplyMarkup().catch(() => undefined);
}

const CALLBACK_STEP: Record<string, OnboardingStep> = {
  lang: 'language',
  sex: 'sex',
  pace: 'pace',
  act: 'activity',
  meal: 'meals',
  wd: 'work_days',
  td: 'training_days',
  tz: 'timezone',
  weigh: 'weigh_day',
};

/** Handles `ob:<key>:<value>` buttons. Returns toast text for answerCallbackQuery. */
export async function handleOnboardingCallback(ctx: BotCtx, data: string): Promise<string | undefined> {
  const rest = data.slice('ob:'.length);
  const sep = rest.indexOf(':');
  const key = rest.slice(0, sep);
  const value = rest.slice(sep + 1);
  const u = ctx.user;
  // Stale button from an earlier step or a finished onboarding.
  if (CALLBACK_STEP[key] !== u.onboarding_step) return undefined;

  switch (key) {
    case 'lang':
      if (value !== 'en' && value !== 'uk') return undefined;
      await closePrompt(ctx);
      await advance(ctx, { language: value satisfies Lang });
      return undefined;
    case 'sex':
      if (value !== 'male' && value !== 'female') return undefined;
      await closePrompt(ctx);
      await advance(ctx, { sex: value satisfies Sex });
      return undefined;
    case 'pace':
      if (value !== 'slow' && value !== 'normal' && value !== 'fast') return undefined;
      await closePrompt(ctx);
      await advance(ctx, { pace: value satisfies Pace });
      return undefined;
    case 'act':
      if (value !== 'sedentary' && value !== 'light' && value !== 'moderate' && value !== 'active') return undefined;
      await closePrompt(ctx);
      await advance(ctx, { activity: value satisfies Activity });
      return undefined;
    case 'meal': {
      if (value === 'done') {
        if (!u.meals.some((s) => s !== 'snack')) return t(u.language, 'err_meals');
        await closePrompt(ctx);
        await advance(ctx, {});
        return undefined;
      }
      const slot = MEAL_SLOTS.find((s) => s === value);
      if (!slot) return undefined;
      const meals: MealSlot[] = MEAL_SLOTS.filter((s) => (s === slot ? !u.meals.includes(s) : u.meals.includes(s)));
      await patchUser(ctx.env.DB, u, { meals });
      await ctx.editMessageReplyMarkup({ reply_markup: mealsKeyboard(u) });
      return undefined;
    }
    case 'wd': {
      if (value === 'done') {
        await closePrompt(ctx);
        await advance(ctx, u.work_days.length === 0 ? { work_start: null, work_end: null } : {});
        return undefined;
      }
      const day = Number(value);
      if (!WEEKDAYS.includes(day)) return undefined;
      const workDays = toggleDay(u.work_days, day);
      await patchUser(ctx.env.DB, u, { work_days: workDays });
      await ctx.editMessageReplyMarkup({
        reply_markup: weekdayKeyboard(u.language, 'ob:wd:', (d) => workDays.includes(d), true),
      });
      return undefined;
    }
    case 'td': {
      if (value === 'done') {
        await closePrompt(ctx);
        await advance(ctx, {});
        return undefined;
      }
      const day = Number(value);
      if (!WEEKDAYS.includes(day)) return undefined;
      const trainingDays = toggleDay(u.training_days, day);
      await patchUser(ctx.env.DB, u, { training_days: trainingDays });
      await ctx.editMessageReplyMarkup({
        reply_markup: weekdayKeyboard(u.language, 'ob:td:', (d) => trainingDays.includes(d), true),
      });
      return undefined;
    }
    case 'tz':
      if (!isValidTimeZone(value)) return undefined;
      await closePrompt(ctx);
      await advance(ctx, { timezone: value });
      return undefined;
    case 'weigh': {
      const day = Number(value);
      if (!WEEKDAYS.includes(day)) return undefined;
      await closePrompt(ctx);
      await advance(ctx, { weigh_day: day });
      return undefined;
    }
  }
  return undefined;
}

/** Validates free-text answers for the current step; invalid input gets the error plus the same prompt. */
export async function handleOnboardingText(ctx: BotCtx, text: string): Promise<void> {
  const u = ctx.user;
  const lang = u.language;
  const fail = async (key: 'err_age' | 'err_height' | 'err_weight' | 'err_goal_range' | 'err_goal_not_lower' | 'err_work_hours' | 'err_sleep_hours' | 'err_timezone') => {
    await ctx.reply(t(lang, key), HTML);
    await sendStepPrompt(ctx);
  };

  switch (u.onboarding_step) {
    case 'age': {
      const age = /^\s*\d{1,3}\s*$/.test(text) ? Number(text) : Number.NaN;
      if (!(age >= 14 && age <= 100)) return fail('err_age');
      return advance(ctx, { birth_year: new Date().getUTCFullYear() - age });
    }
    case 'height': {
      const cm = parseDecimal(text);
      if (!(cm >= 120 && cm <= 230)) return fail('err_height');
      return advance(ctx, { height_cm: cm });
    }
    case 'weight': {
      const kg = parseDecimal(text);
      if (!(kg >= 35 && kg <= 350)) return fail('err_weight');
      await insertWeight(ctx.env.DB, u.telegram_id, localNow(new Date(), u.timezone).date, kg);
      return advance(ctx, { start_weight_kg: kg, current_weight_kg: kg });
    }
    case 'goal_weight': {
      const kg = parseDecimal(text);
      if (!(kg >= 35)) return fail('err_goal_range');
      if (u.current_weight_kg !== null && kg >= u.current_weight_kg) return fail('err_goal_not_lower');
      return advance(ctx, { goal_weight_kg: kg });
    }
    case 'work_hours': {
      const range = parseRange(text);
      if (!range || range[0] >= range[1]) return fail('err_work_hours');
      return advance(ctx, { work_start: range[0], work_end: range[1] });
    }
    case 'sleep_hours': {
      const range = parseRange(text);
      if (!range || range[0] === range[1]) return fail('err_sleep_hours');
      return advance(ctx, { wake: range[0], sleep: range[1] });
    }
    case 'timezone': {
      const tz = text.trim();
      if (!isValidTimeZone(tz)) return fail('err_timezone');
      return advance(ctx, { timezone: new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone });
    }
    default:
      // Button steps: repeat the prompt with its keyboard.
      return sendStepPrompt(ctx);
  }
}
