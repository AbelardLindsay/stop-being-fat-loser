import { InlineKeyboard } from 'grammy';
import type { PhotoSize } from 'grammy/types';
import type { BotCtx } from './bot.ts';
import {
  dayTotals,
  getMeal,
  insertMeal,
  insertUsage,
  kcalBySlot,
  patchUser,
  updateMealEstimate,
  upsertCheckin,
  type MealRow,
} from './db.ts';
import { t, type MealItem } from './i18n.ts';
import { mealBudgets, remainingPlan, slotForTime, type Macros, type MealSlot } from './nutrition.ts';
import { OpenAiError, ownerId, respondJson, type InputContent, type OpenAiErrorCode } from './openai.ts';
import { userMacroTargets } from './profile.ts';
import { isoWeekdayOf, localNow } from './schedule.ts';

/** Largest side sent to the model; lower it if photo handling exceeds the CPU limit. */
const MAX_PHOTO_SIDE = 1024;
const RANDOM_ROAST_CHANCE = 0.3;
const DAY_END_MINUTE = 1440;

interface MealEstimate {
  is_food: boolean;
  description: string;
  items: MealItem[];
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  health_score: number;
  sugary_drink: boolean;
  dessert: boolean;
  protein_shake: boolean;
  roast: string;
}

const MEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_food',
    'description',
    'items',
    'kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'health_score',
    'sugary_drink',
    'dessert',
    'protein_shake',
    'roast',
  ],
  properties: {
    is_food: { type: 'boolean', description: 'false when there is no food or drink' },
    description: { type: 'string', description: 'short name of the meal' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal'],
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          kcal: { type: 'integer' },
        },
      },
    },
    kcal: { type: 'integer', description: 'total kcal' },
    protein_g: { type: 'number' },
    carbs_g: { type: 'number' },
    fat_g: { type: 'number' },
    health_score: { type: 'integer', description: '1 = junk, 10 = very healthy', minimum: 1, maximum: 10 },
    sugary_drink: { type: 'boolean', description: 'true for cola, soda, sweet juice or energy drinks' },
    dessert: {
      type: 'boolean',
      description:
        'true for desserts and sweets: cake, pastry, candy, chocolate, ice cream, cookies, sweet buns. A protein shake is never a dessert.',
    },
    protein_shake: { type: 'boolean', description: 'true for a protein shake or whey/casein drink' },
    roast: { type: 'string', description: 'one sentence' },
  },
} as const;

const ERROR_KEY: Record<
  OpenAiErrorCode,
  'err_ai_usage_limit' | 'err_ai_reauth' | 'err_ai_missing' | 'err_ai_not_eligible' | 'err_ai_generic'
> = {
  usage_limit: 'err_ai_usage_limit',
  auth_missing: 'err_ai_missing',
  reauth_required: 'err_ai_reauth',
  not_eligible: 'err_ai_not_eligible',
  timeout: 'err_ai_generic',
  unavailable: 'err_ai_generic',
  bad_output: 'err_ai_generic',
  http: 'err_ai_generic',
};

function pickPhoto(sizes: PhotoSize[]): PhotoSize | undefined {
  const bySide = [...sizes].sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height));
  return bySide.filter((p) => Math.max(p.width, p.height) <= MAX_PHOTO_SIDE).at(-1) ?? bySide[0];
}

export const mealKeyboard = (mealId: number): InlineKeyboard =>
  new InlineKeyboard().text('✏️', `meal_edit:${mealId}`).text('🗑', `meal_del:${mealId}`);

async function downloadImage(ctx: BotCtx, fileId: string): Promise<string> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error('getFile returned no file_path');
  const res = await fetch(`https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error(`photo download HTTP ${res.status}`);
  return `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

interface MealRequest {
  photoFileId: string | null;
  caption: string | null;
  date: string;
  slot: MealSlot;
  /** Minute of day for "upcoming slots"; end of day when editing a past meal. */
  minute: number;
  /** The meal being re-estimated: its numbers are excluded from "eaten so far" and the row is updated. */
  replacing?: MealRow;
  correction?: string;
}

/**
 * Estimates a meal with the model, saves it (insert or correction update) and renders the result into
 * the status message via `edit`. Returns false when nothing was saved.
 */
async function estimateAndSave(
  ctx: BotCtx,
  req: MealRequest,
  edit: (text: string, other?: { reply_markup?: InlineKeyboard }) => Promise<unknown>,
): Promise<boolean> {
  const u = ctx.user;
  const lang = u.language;
  const env = ctx.env;
  try {
    const [image, eatenBySlot, [daySoFar]] = await Promise.all([
      req.photoFileId ? downloadImage(ctx, req.photoFileId) : Promise.resolve(null),
      kcalBySlot(env.DB, u.telegram_id, req.date),
      dayTotals(env.DB, u.telegram_id, req.date, req.date),
    ]);
    const old = req.replacing;
    if (old) eatenBySlot[old.slot] = (eatenBySlot[old.slot] ?? 0) - old.kcal;
    const macrosSoFar: Macros = {
      protein: (daySoFar?.protein_g ?? 0) - (old?.protein_g ?? 0),
      fat: (daySoFar?.fat_g ?? 0) - (old?.fat_g ?? 0),
      carbs: (daySoFar?.carbs_g ?? 0) - (old?.carbs_g ?? 0),
    };
    const macrosTarget = userMacroTargets(u);
    const trainingDay = u.training_days.includes(isoWeekdayOf(req.date));
    const target = u.target_kcal ?? 0;
    const before = remainingPlan(target, u.meals, eatenBySlot, req.minute);
    const slotBudget = mealBudgets(target, u.meals)[req.slot];

    const context = [
      `User caption: ${req.caption || '(none)'}`,
      old && req.correction
        ? `Previous estimate: ${old.description}, ${old.kcal} kcal, protein ${Math.round(old.protein_g)} g, fat ${Math.round(old.fat_g)} g, carbs ${Math.round(old.carbs_g)} g.\nUser correction: ${req.correction}\nRe-estimate the whole meal with the correction applied.`
        : null,
      image ? null : 'No photo: estimate from the text alone.',
      `Meal slot: ${req.slot}`,
      `Budget for this slot: ${slotBudget === undefined ? 'none (unplanned meal)' : `${slotBudget} kcal`}`,
      `Daily target: ${target} kcal; eaten so far that day: ${before.eaten} kcal; left: ${before.remaining} kcal`,
      `Protein/fat/carbs so far that day: ${Math.round(macrosSoFar.protein)}/${Math.round(macrosSoFar.fat)}/${Math.round(macrosSoFar.carbs)} g of ${macrosTarget.protein}/${macrosTarget.fat}/${macrosTarget.carbs} g`,
    ].filter((l) => l !== null);
    const content: InputContent[] = [{ type: 'input_text', text: context.join('\n') }];
    if (image) content.push({ type: 'input_image', image_url: image });

    const { value: estimate, usage } = await respondJson<MealEstimate>(env, ownerId(env), {
      instructions: [
        'You estimate the nutrition of a meal for a calorie-tracking bot from a photo and/or the user’s text.',
        'The user’s caption and correction are authoritative: when they name the food, brand, ingredients or amounts (e.g. "protein shake, 2 scoops whey + 300 ml milk"), trust them over what the photo seems to show, and use the photo only for what the text leaves open.',
        'Otherwise estimate portion sizes and calories conservatively; when unsure, round calories up.',
        `Answer \`description\`, item names and \`roast\` in ${lang === 'uk' ? 'Ukrainian' : 'English'}.`,
        'Roast style: a foul-mouthed drill sergeant roasting a consenting adult who asked for it: heavy profanity (natural Ukrainian мат when answering in Ukrainian — idiomatic, not translated from English), brutal fat jokes, mocking their gut, chins and lack of sex appeal because of their eating.',
        `The user is ${u.sex === 'female' ? 'a woman' : 'a man'}: use matching grammatical gender, and phrase sex jokes for that gender (for a man: nobody gives it to you / you don't get laid; never imply he is on the receiving end).`,
        'Desserts and sweets always earn a roast aimed squarely at the dessert and the sweet tooth behind it.',
        trainingDay
          ? 'Today is a training day: a protein shake is fine and supports the protein target; do not treat it as a dessert or roast it for being a shake.'
          : 'Today is not a training day: a protein shake is unearned extra calories; roast it like a dessert.',
        `Account for the meal slot (${req.slot}), its budget, the kcal left that day and protein/fat/carbs progress when judging and roasting (low protein or excess fat count as bad choices).`,
      ].join('\n'),
      content,
      schemaName: 'meal_estimate',
      schema: MEAL_SCHEMA,
    });
    if (usage) {
      await insertUsage(env.DB, {
        telegram_id: u.telegram_id,
        local_date: req.date,
        kind: old ? 'correction' : 'meal',
        model: env.OPENAI_MODEL,
        input_tokens: usage.input,
        cached_tokens: usage.cached,
        output_tokens: usage.output,
        reasoning_tokens: usage.reasoning,
      });
    }

    if (!estimate.is_food) {
      await edit(t(lang, 'not_food'));
      return false;
    }

    const fields = {
      kcal: Math.round(estimate.kcal),
      protein_g: estimate.protein_g,
      carbs_g: estimate.carbs_g,
      fat_g: estimate.fat_g,
      description: estimate.description,
      health_score: Math.round(estimate.health_score),
      sugary_drink: estimate.sugary_drink ? 1 : 0,
    };
    let mealId: number;
    if (old) {
      await updateMealEstimate(env.DB, u.telegram_id, old.id, fields);
      mealId = old.id;
    } else {
      mealId = await insertMeal(env.DB, {
        telegram_id: u.telegram_id,
        local_date: req.date,
        slot: req.slot,
        ...fields,
        photo_file_id: req.photoFileId,
        caption: req.caption,
      });
    }
    if (estimate.sugary_drink) await upsertCheckin(env.DB, u.telegram_id, req.date, 'cola', 'drank');

    const after = remainingPlan(
      target,
      u.meals,
      { ...eatenBySlot, [req.slot]: (eatenBySlot[req.slot] ?? 0) + fields.kcal },
      req.minute,
    );
    // "Occasionally judge": always for bad choices, desserts and rest-day shakes, otherwise at random.
    const roast =
      estimate.health_score <= 4 ||
      estimate.sugary_drink ||
      estimate.dessert ||
      (estimate.protein_shake && !trainingDay) ||
      after.eaten > target ||
      Math.random() < RANDOM_ROAST_CHANCE
        ? estimate.roast
        : null;

    await edit(
      t(lang, 'meal_result', {
        description: estimate.description,
        items: estimate.items,
        kcal: fields.kcal,
        meal: { protein: estimate.protein_g, fat: estimate.fat_g, carbs: estimate.carbs_g },
        slot: req.slot,
        eaten: after.eaten,
        target,
        remaining: after.remaining,
        perSlot: after.perSlot,
        roast,
        dayMacros: {
          protein: macrosSoFar.protein + estimate.protein_g,
          fat: macrosSoFar.fat + estimate.fat_g,
          carbs: macrosSoFar.carbs + estimate.carbs_g,
        },
        macrosTarget,
      }),
      { reply_markup: mealKeyboard(mealId) },
    );
    return true;
  } catch (err) {
    if (err instanceof OpenAiError) {
      console.error('meal analysis failed', err.code, err.status, err.message);
      await edit(t(lang, ERROR_KEY[err.code]));
      return false;
    }
    console.error('meal estimate failed', err);
    await edit(t(lang, 'err_ai_generic'));
    return false;
  }
}

/** Sends a status message and returns an editor for it. */
async function statusMessage(ctx: BotCtx) {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return null;
  const status = await ctx.reply(t(ctx.user.language, 'analyzing'));
  return (text: string, other?: { reply_markup?: InlineKeyboard }) =>
    ctx.api.editMessageText(chatId, status.message_id, text, { parse_mode: 'HTML', ...other });
}

export async function handleMealPhoto(ctx: BotCtx): Promise<void> {
  const photo = pickPhoto(ctx.message?.photo ?? []);
  if (!photo) return;
  const edit = await statusMessage(ctx);
  if (!edit) return;
  const now = localNow(new Date(), ctx.user.timezone);
  await estimateAndSave(
    ctx,
    {
      photoFileId: photo.file_id,
      caption: ctx.message?.caption?.trim() || null,
      date: now.date,
      slot: slotForTime(now.minute, ctx.user.meals),
      minute: now.minute,
    },
    edit,
  );
}

/** `meal_edit:<id>`: the next text message becomes a correction for this meal. */
export async function startMealEdit(ctx: BotCtx, mealId: number): Promise<void> {
  if (!Number.isInteger(mealId) || !(await getMeal(ctx.env.DB, ctx.user.telegram_id, mealId))) return;
  await patchUser(ctx.env.DB, ctx.user, {
    editing_meal_id: mealId,
    editing_message_id: ctx.callbackQuery?.message?.message_id ?? null,
  });
  await ctx.reply(t(ctx.user.language, 'edit_prompt'), { parse_mode: 'HTML' });
}

/** Re-estimates the meal being edited from the user's correction text. */
export async function handleMealCorrection(ctx: BotCtx, text: string): Promise<void> {
  const u = ctx.user;
  const mealId = u.editing_meal_id;
  const oldMessageId = u.editing_message_id;
  await patchUser(ctx.env.DB, u, { editing_meal_id: null, editing_message_id: null });
  const meal = mealId === null ? null : await getMeal(ctx.env.DB, u.telegram_id, mealId);
  if (!meal) {
    await ctx.reply(t(u.language, 'edit_gone'));
    return;
  }
  const edit = await statusMessage(ctx);
  if (!edit) return;
  const now = localNow(new Date(), u.timezone);
  const saved = await estimateAndSave(
    ctx,
    {
      photoFileId: meal.photo_file_id,
      caption: meal.caption,
      date: meal.local_date,
      slot: meal.slot,
      minute: meal.local_date === now.date ? now.minute : DAY_END_MINUTE,
      replacing: meal,
      correction: text.trim(),
    },
    edit,
  );
  const chatId = ctx.chat?.id;
  if (saved && oldMessageId !== null && chatId !== undefined) {
    await ctx.api
      .editMessageText(chatId, oldMessageId, t(u.language, 'meal_edited_below'), { parse_mode: 'HTML' })
      .catch(() => undefined);
  }
}
