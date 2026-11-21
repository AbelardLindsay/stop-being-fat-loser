import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import { ConnectError, disconnect, finishConnect, isCallbackUrl, startConnect } from './connect.ts';
import {
  checkinsOn,
  createUser,
  deleteMeal,
  getUser,
  insertWater,
  insertWeight,
  kcalBySlot,
  lastMealOn,
  lastWeight,
  mealsOn,
  patchUser,
  streak,
  upsertCheckin,
  waterOn,
  type User,
} from './db.ts';
import type { Env } from './env.ts';
import { escapeHtml, t, type Lang } from './i18n.ts';
import { handleMealCorrection, handleMealPhoto, startMealEdit } from './meals.ts';
import { waterKeyboard } from './notify.ts';
import { ACTIVITIES, remainingPlan, targetCalories, weeksToGoal, type Macros } from './nutrition.ts';
import {
  activityKeyboard,
  handleOnboardingCallback,
  handleOnboardingText,
  sendStepPrompt,
  toggleDay,
  weekdayKeyboard,
} from './onboarding.ts';
import { getAccount, ownerId } from './openai.ts';
import {
  completeProfile,
  parseDecimal,
  profileParams,
  userMacroTargets,
  userWaterTarget,
  walkTimes,
} from './profile.ts';
import { pickRoast } from './roasts.ts';
import { isAwake, localNow, parseHHMM } from './schedule.ts';
import { buildHistory, buildMealsHistory, buildUsage } from './stats.ts';

export type BotCtx = Context & { env: Env; user: User };

/** /training keyboard: weekday toggles, Done, and a way to change the activity level. */
function trainingKeyboard(lang: Lang, days: number[]): InlineKeyboard {
  return weekdayKeyboard(lang, 'td:', (d) => days.includes(d), true).row().text(t(lang, 'btn_change_activity'), 'act:menu');
}

const HTML = { parse_mode: 'HTML' } as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DEFAULT_DAYS = 7;
const HISTORY_MAX_DAYS = 60;
const SNOOZE_MINUTES = [30, 60];
const WEIGHT_TEXT_RE = /^\s*\d{2,3}(?:[.,]\d+)?\s*$/;

let cached: { bot: Bot<BotCtx>; ready: Promise<void> } | undefined;

function getBot(env: Env): { bot: Bot<BotCtx>; ready: Promise<void> } {
  if (!cached) {
    const bot = new Bot<BotCtx>(env.TELEGRAM_BOT_TOKEN);
    setup(bot, env);
    const ready = bot.init().catch((err: unknown) => {
      cached = undefined;
      throw err;
    });
    cached = { bot, ready };
  }
  return cached;
}

export async function handleUpdate(env: Env, update: Update): Promise<void> {
  try {
    const { bot, ready } = getBot(env);
    await ready;
    await bot.handleUpdate(update);
  } catch (err) {
    // Bot.handleUpdate rethrows middleware errors as BotError instead of calling bot.catch.
    console.error('update failed', err);
  }
}

function setup(bot: Bot<BotCtx>, env: Env): void {
  const allowed = env.ALLOWED_TELEGRAM_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from) return;
    if (!allowed.includes(String(from.id))) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      else if (ctx.chat) await ctx.reply(t('en', 'private_bot', { id: from.id }), HTML);
      return;
    }
    ctx.env = env;
    ctx.user = (await getUser(env.DB, from.id)) ?? (await createUser(env.DB, from.id, ctx.chat?.id ?? from.id));
    await next();
  });

  bot.command('start', async (ctx) => {
    if (ctx.user.onboarding_step !== null) await sendStepPrompt(ctx);
    else await ctx.reply(t(ctx.user.language, 'help'), HTML);
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    let toast: string | undefined;
    try {
      if (data.startsWith('ob:')) toast = await handleOnboardingCallback(ctx, data);
      else if (data.startsWith('walk:') || data.startsWith('cola:')) toast = await handleCheckin(ctx, data);
      else if (data.startsWith('meal_del:')) await handleMealDelete(ctx, Number(data.slice('meal_del:'.length)));
      else if (data.startsWith('meal_edit:')) await startMealEdit(ctx, Number(data.slice('meal_edit:'.length)));
      else if (data.startsWith('td:')) await handleTrainingToggle(ctx, data.slice('td:'.length));
      else if (data.startsWith('act:')) await handleActivityButton(ctx, data.slice('act:'.length));
      else if (data.startsWith('water:')) toast = await handleWaterButton(ctx, data);
    } finally {
      await ctx.answerCallbackQuery(toast === undefined ? undefined : { text: toast }).catch(() => undefined);
    }
  });

  // The owner's ChatGPT sign-in powers everyone's photos; only the owner manages it, at any point.
  bot.command('connect', async (ctx) => {
    if (ctx.user.telegram_id !== ownerId(env)) return void (await ctx.reply(t(ctx.user.language, 'connect_owner_only'), HTML));
    const url = await startConnect(env, ctx.user.telegram_id);
    await ctx.reply(t(ctx.user.language, 'connect_start'), {
      ...HTML,
      reply_markup: new InlineKeyboard().url(t(ctx.user.language, 'btn_connect'), url),
      link_preview_options: { is_disabled: true },
    });
  });
  bot.command('disconnect', async (ctx) => {
    if (ctx.user.telegram_id !== ownerId(env)) return void (await ctx.reply(t(ctx.user.language, 'connect_owner_only'), HTML));
    const done = await disconnect(env, ctx.user.telegram_id);
    await ctx.reply(t(ctx.user.language, done ? 'disconnect_ok' : 'disconnect_none'), HTML);
  });
  bot.on('message:text', async (ctx, next) => {
    if (!isCallbackUrl(ctx.message.text) || ctx.user.telegram_id !== ownerId(env)) return next();
    // The pasted URL carries a one-time auth code; don't leave it in the chat.
    await ctx.deleteMessage().catch(() => undefined);
    try {
      const { email } = await finishConnect(env, ctx.user.telegram_id, ctx.message.text);
      await ctx.reply(t(ctx.user.language, 'connect_ok', { email }), HTML);
    } catch (err) {
      if (!(err instanceof ConnectError)) throw err;
      console.error('connect failed', ctx.user.telegram_id, err.code, err.message);
      await ctx.reply(t(ctx.user.language, 'connect_err', { code: err.code }), HTML);
    }
  });
  // Until onboarding is done, messages answer the current step.
  bot.use(async (ctx, next) => {
    const step = ctx.user.onboarding_step;
    if (step === null) return next();
    if (!ctx.message) return;
    if (ctx.message.photo) await ctx.reply(t(ctx.user.language, 'finish_setup_first'));
    else if (ctx.message.text !== undefined) await handleOnboardingText(ctx, ctx.message.text);
    else await sendStepPrompt(ctx);
  });

  // After ✏️, the next plain text is the correction; a command or photo cancels the edit.
  bot.use(async (ctx, next) => {
    if (ctx.user.editing_meal_id === null || !ctx.message) return next();
    const text = ctx.message.text;
    if (text !== undefined && !text.startsWith('/')) return handleMealCorrection(ctx, text);
    await patchUser(env.DB, ctx.user, { editing_meal_id: null, editing_message_id: null });
    await next();
  });

  bot.command('today', sendToday);
  bot.command('meals', async (ctx) => {
    const today = localNow(new Date(), ctx.user.timezone).date;
    const days = await buildMealsHistory(env.DB, ctx.user, today);
    await ctx.reply(t(ctx.user.language, 'meals_history', { days }), HTML);
  });
  bot.command('history', async (ctx) => {
    const requested = Number.parseInt(ctx.match, 10);
    const n = requested > 0 ? Math.min(requested, HISTORY_MAX_DAYS) : HISTORY_DEFAULT_DAYS;
    const today = localNow(new Date(), ctx.user.timezone).date;
    await ctx.reply(t(ctx.user.language, 'history', await buildHistory(env.DB, ctx.user, n, today)), HTML);
  });
  bot.command('walk', setWalkTime);
  bot.command('training', (ctx) => {
    const lang = ctx.user.language;
    if (ctx.user.activity === 'sedentary') {
      return ctx.reply(t(lang, 'training_sedentary'), { ...HTML, reply_markup: activityKeyboard(lang, 'act:') });
    }
    return ctx.reply(t(lang, 'training_prompt'), { reply_markup: trainingKeyboard(lang, ctx.user.training_days) });
  });
  bot.command('weight', async (ctx) => {
    const kg = parseDecimal(ctx.match);
    if (kg >= 35 && kg <= 350) await logWeight(ctx, kg);
    else await ctx.reply(t(ctx.user.language, 'err_weight'), HTML);
  });
  bot.command('undo', undoLastMeal);
  bot.command('water', logWater);
  bot.command('profile', async (ctx) => {
    const u = ctx.user;
    const p = completeProfile(u);
    const account = await getAccount(env, ownerId(env));
    const chatgpt = {
      status: account?.status === 'ok' || account?.status === 'reauth_required' ? account.status : ('none' as const),
      email: account?.email ?? null,
    };
    await ctx.reply(t(u.language, 'profile', profileParams(u, p, u.target_kcal ?? targetCalories(p), chatgpt)), HTML);
  });
  bot.command('usage', async (ctx) => {
    const u = ctx.user;
    if (u.telegram_id !== ownerId(env)) {
      await ctx.reply(t(u.language, 'usage_owner_only'), HTML);
      return;
    }
    const today = localNow(new Date(), u.timezone).date;
    await ctx.reply(t(u.language, 'usage', await buildUsage(env.DB, env.OPENAI_MODEL, u.telegram_id, today)), HTML);
  });
  bot.command('lang', async (ctx) => {
    await patchUser(env.DB, ctx.user, { language: ctx.user.language === 'en' ? 'uk' : 'en' });
    await ctx.reply(t(ctx.user.language, 'lang_set'), HTML);
  });
  bot.command('reset', async (ctx) => {
    await patchUser(env.DB, ctx.user, { onboarding_step: 'language' });
    await ctx.reply(t(ctx.user.language, 'reset_started'), HTML);
    await sendStepPrompt(ctx);
  });
  bot.command('help', (ctx) => ctx.reply(t(ctx.user.language, 'help'), HTML));

  bot.on('message:text', async (ctx, next) => {
    const kg = WEIGHT_TEXT_RE.test(ctx.message.text) ? parseDecimal(ctx.message.text) : Number.NaN;
    if (kg >= 35 && kg <= 350) await logWeight(ctx, kg);
    else await next();
  });
  bot.on('message:photo', handleMealPhoto);
  bot.on('message:document', async (ctx, next) => {
    if (ctx.message.document.mime_type?.startsWith('image/')) await ctx.reply(t(ctx.user.language, 'send_as_photo'));
    else await next();
  });
  bot.on('message', (ctx) => ctx.reply(t(ctx.user.language, 'help'), HTML));
}

async function sendToday(ctx: BotCtx): Promise<void> {
  const u = ctx.user;
  const now = localNow(new Date(), u.timezone);
  const [bySlot, meals, checks, waterMl] = await Promise.all([
    kcalBySlot(ctx.env.DB, u.telegram_id, now.date),
    mealsOn(ctx.env.DB, u.telegram_id, now.date),
    checkinsOn(ctx.env.DB, u.telegram_id, now.date),
    waterOn(ctx.env.DB, u.telegram_id, now.date),
  ]);
  const target = u.target_kcal ?? 0;
  const plan = remainingPlan(target, u.meals, bySlot, now.minute);
  await ctx.reply(
    t(u.language, 'today', {
      target,
      ...plan,
      meals: meals.map((m) => ({ slot: m.slot, kcal: m.kcal, description: m.description })),
      walk: checks.walk ?? null,
      cola: checks.cola ?? null,
      macrosEaten: meals.reduce<Macros>(
        (acc, m) => ({ protein: acc.protein + m.protein_g, fat: acc.fat + m.fat_g, carbs: acc.carbs + m.carbs_g }),
        { protein: 0, fat: 0, carbs: 0 },
      ),
      macrosTarget: userMacroTargets(u),
      waterMl,
      waterTarget: userWaterTarget(u),
    }),
    HTML,
  );
}

const WATER_MIN_ML = 50;
const WATER_MAX_ML = 3000;

/** `/water` shows today's water with quick-add buttons; `/water 500` logs 500 ml first. */
async function logWater(ctx: BotCtx & { match: string }): Promise<void> {
  const u = ctx.user;
  const today = localNow(new Date(), u.timezone).date;
  const arg = ctx.match.trim();
  if (arg !== '') {
    const ml = Number(arg);
    if (!Number.isInteger(ml) || ml < WATER_MIN_ML || ml > WATER_MAX_ML) {
      await ctx.reply(t(u.language, 'water_usage'), HTML);
      return;
    }
    await insertWater(ctx.env.DB, u.telegram_id, today, ml);
  }
  const ml = await waterOn(ctx.env.DB, u.telegram_id, today);
  await ctx.reply(t(u.language, 'water_status', { ml, target: userWaterTarget(u) }), {
    ...HTML,
    reply_markup: waterKeyboard(u.language, today),
  });
}

/** `water:<ml>:<date>`: logs water for the reminder's day and refreshes the progress in place. */
async function handleWaterButton(ctx: BotCtx, data: string): Promise<string | undefined> {
  const [, rawMl, date = ''] = data.split(':');
  const ml = Number(rawMl);
  if (!DATE_RE.test(date) || !Number.isInteger(ml) || ml < WATER_MIN_ML || ml > WATER_MAX_ML) return undefined;
  const u = ctx.user;
  await insertWater(ctx.env.DB, u.telegram_id, date, ml);
  const total = await waterOn(ctx.env.DB, u.telegram_id, date);
  await ctx.editMessageText(t(u.language, 'water_status', { ml: total, target: userWaterTarget(u) }), {
    ...HTML,
    reply_markup: waterKeyboard(u.language, date),
  });
  return t(u.language, 'water_logged', { ml });
}

/** `/walk` shows the walk time, `/walk 19:30` sets a fixed one, `/walk auto` restores after-work timing. */
async function setWalkTime(ctx: BotCtx & { match: string }): Promise<void> {
  const u = ctx.user;
  const arg = ctx.match.trim().toLowerCase();
  const schedule = completeProfile(u).schedule;
  if (arg === 'auto') {
    await patchUser(ctx.env.DB, u, { walk_time: null });
  } else if (arg !== '') {
    const minute = parseHHMM(arg);
    if (minute === null) {
      await ctx.reply(t(u.language, 'walk_usage'), HTML);
      return;
    }
    if (!isAwake(minute, schedule.wake, schedule.sleep)) {
      await ctx.reply(t(u.language, 'walk_not_awake'), HTML);
      return;
    }
    await patchUser(ctx.env.DB, u, { walk_time: minute });
  }
  const times = walkTimes(completeProfile(u).schedule);
  await ctx.reply(t(u.language, 'walk_current', { ...times, custom: u.walk_time !== null }), HTML);
}

/** `td:<1-7>` toggles a training day on the /training keyboard; `td:done` closes it. */
async function handleTrainingToggle(ctx: BotCtx, value: string): Promise<void> {
  const u = ctx.user;
  if (u.activity === 'sedentary') {
    await ctx.editMessageText(t(u.language, 'training_sedentary'), { ...HTML, reply_markup: activityKeyboard(u.language, 'act:') });
    return;
  }
  if (value === 'done') {
    await ctx.editMessageText(t(u.language, 'training_saved', { days: u.training_days }), HTML);
    return;
  }
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 7) return;
  const trainingDays = toggleDay(u.training_days, day);
  await patchUser(ctx.env.DB, u, { training_days: trainingDays });
  await ctx.editMessageReplyMarkup({ reply_markup: trainingKeyboard(u.language, trainingDays) });
}

/** `act:menu` shows the activity picker; `act:<activity>` saves it, recomputes the calorie target, and offers training days when they apply. */
async function handleActivityButton(ctx: BotCtx, value: string): Promise<void> {
  const u = ctx.user;
  const lang = u.language;
  // Stale button: completeProfile would throw on an incomplete profile.
  if (u.onboarding_step !== null) return;
  if (value === 'menu') {
    await ctx.editMessageText(t(lang, 'ob_activity'), { reply_markup: activityKeyboard(lang, 'act:') });
    return;
  }
  const activity = ACTIVITIES.find((a) => a === value);
  if (!activity) return;
  const target = targetCalories({ ...completeProfile(u), activity });
  await patchUser(ctx.env.DB, u, activity === 'sedentary' ? { activity, training_days: [], target_kcal: target } : { activity, target_kcal: target });
  await ctx.editMessageText(t(lang, 'activity_saved', { activity, target, macros: userMacroTargets(u) }), HTML);
  if (activity !== 'sedentary') {
    await ctx.reply(t(lang, 'training_prompt'), { reply_markup: trainingKeyboard(lang, u.training_days) });
  }
}

async function undoLastMeal(ctx: BotCtx): Promise<void> {
  const u = ctx.user;
  const now = localNow(new Date(), u.timezone);
  const meal = await lastMealOn(ctx.env.DB, u.telegram_id, now.date);
  if (!meal || !(await deleteMeal(ctx.env.DB, u.telegram_id, meal.id))) {
    await ctx.reply(t(u.language, 'undo_nothing'));
    return;
  }
  const plan = remainingPlan(u.target_kcal ?? 0, u.meals, await kcalBySlot(ctx.env.DB, u.telegram_id, now.date), now.minute);
  await ctx.reply(t(u.language, 'undo_done', { description: meal.description, remaining: plan.remaining }), HTML);
}

async function logWeight(ctx: BotCtx, kg: number): Promise<void> {
  const u = ctx.user;
  const profile = completeProfile(u);
  const prev = await lastWeight(ctx.env.DB, u.telegram_id);
  await insertWeight(ctx.env.DB, u.telegram_id, localNow(new Date(), u.timezone).date, kg);
  const target = targetCalories({ ...profile, weightKg: kg });
  await patchUser(ctx.env.DB, u, { current_weight_kg: kg, target_kcal: target });

  const left = kg - profile.goalKg;
  const lines = [
    t(u.language, 'weight_reply', {
      kg,
      diffPrev: prev === null ? null : kg - prev,
      diffStart: kg - profile.startKg,
      left,
      weeks: left > 0 ? weeksToGoal(kg, profile.goalKg, profile.pace) : 0,
      target,
    }),
  ];
  if (prev !== null && kg > prev) lines.push('', escapeHtml(pickRoast(u.language, 'weight_up', profile.sex)));
  if (left <= 0) lines.push('', t(u.language, 'weight_goal_reached', { goal: profile.goalKg }));
  await ctx.reply(lines.join('\n'), HTML);
}

async function handleMealDelete(ctx: BotCtx, mealId: number): Promise<void> {
  if (!Number.isInteger(mealId)) return;
  if (await deleteMeal(ctx.env.DB, ctx.user.telegram_id, mealId)) {
    await ctx.editMessageText(t(ctx.user.language, 'meal_deleted'), HTML);
  }
}

/**
 * `walk:done|skip:<date>`, `walk:snooze:<date>:<minutes>` and `cola:clean|drank:<date>`; the date is the
 * local day the reminder was for. Returns toast text for answerCallbackQuery.
 */
async function handleCheckin(ctx: BotCtx, data: string): Promise<string | undefined> {
  const [kind, action, date = '', extra] = data.split(':');
  if (!DATE_RE.test(date)) return undefined;
  const u = ctx.user;
  const lang = u.language;
  const sex = u.sex ?? 'male';
  const db = ctx.env.DB;
  const now = localNow(new Date(), u.timezone);
  let result: string;

  if (kind === 'walk' && action === 'snooze') {
    const minutes = Number(extra);
    if (!SNOOZE_MINUTES.includes(minutes)) return undefined;
    if (date !== now.date) return t(lang, 'snooze_stale');
    const at = now.minute + minutes;
    const { wake, sleep } = completeProfile(u).schedule;
    if (at >= 1440 || !isAwake(at, wake, sleep)) return t(lang, 'snooze_too_late');
    await patchUser(db, u, { walk_snooze_date: date, walk_snooze_minute: at });
    result = `${t(lang, 'walk_snoozed', { minute: at })}\n${escapeHtml(pickRoast(lang, 'walk_snooze', sex))}`;
  } else if (kind === 'walk' && (action === 'done' || action === 'skip')) {
    await upsertCheckin(db, u.telegram_id, date, 'walk', action === 'done' ? 'done' : 'skipped');
    const n = await streak(db, u.telegram_id, 'walk', 'done', now.date);
    result = t(lang, 'walk_result', { done: action === 'done', streak: n });
  } else if (kind === 'cola' && (action === 'clean' || action === 'drank')) {
    await upsertCheckin(db, u.telegram_id, date, 'cola', action);
    const n = await streak(db, u.telegram_id, 'cola', 'clean', now.date);
    result = t(lang, 'cola_result', { clean: action === 'clean', streak: n });
    if (action === 'drank') result += `\n${escapeHtml(pickRoast(lang, 'cola_drank', sex))}`;
  } else {
    return undefined;
  }

  const original = ctx.callbackQuery?.message?.text;
  // Editing without reply_markup removes the buttons.
  await ctx.editMessageText(original ? `${escapeHtml(original)}\n\n${result}` : result, HTML);
  return undefined;
}
