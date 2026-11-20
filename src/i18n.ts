import type { Activity, Macros, MealSlot, Pace, Sex } from './nutrition.ts';
import { MEAL_SLOTS } from './nutrition.ts';
import { formatHHMM } from './schedule.ts';
import type { ConnectErrorCode } from './connect.ts';
import type { UsageTotals } from './db.ts';

export type Lang = 'en' | 'uk';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const signed = (n: number, digits = 1): string => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(digits);

type Budgets = Partial<Record<MealSlot, number>>;

export interface MealItem {
  name: string;
  grams: number;
  kcal: number;
}

export interface SummaryParams {
  target: number;
  budgets: Budgets;
  weeks: number;
  goal: number;
  walkWork: number | null;
  walkOff: number;
  weighDay: number;
  macros: Macros;
}

export interface ProfileParams {
  sex: Sex;
  age: number;
  height: number;
  start: number;
  current: number;
  goal: number;
  pace: Pace;
  activity: Activity;
  target: number;
  budgets: Budgets;
  workDays: number[];
  workStart: number | null;
  workEnd: number | null;
  wake: number;
  sleep: number;
  timezone: string;
  weighDay: number;
  chatgpt: { status: 'ok' | 'reauth_required' | 'none'; email: string | null };
  macros: Macros;
  trainingDays: number[];
  walkWork: number | null;
  walkOff: number;
}

export interface TodayParams {
  target: number;
  eaten: number;
  remaining: number;
  perSlot: Budgets;
  meals: { slot: MealSlot; kcal: number; description: string }[];
  walk: string | null;
  cola: string | null;
  macrosEaten: Macros;
  macrosTarget: Macros;
  waterMl: number;
  waterTarget: number;
}

export interface MealResultParams {
  description: string;
  items: MealItem[];
  kcal: number;
  meal: Macros;
  slot: MealSlot;
  eaten: number;
  target: number;
  remaining: number;
  perSlot: Budgets;
  roast: string | null;
  dayMacros: Macros;
  macrosTarget: Macros;
}

export interface MealsHistoryDay {
  isToday: boolean;
  date: string;
  isoWeekday: number;
  meals: { time: number; slot: MealSlot; kcal: number; macros: Macros; description: string }[];
  kcal: number;
  macros: Macros;
}

export interface WeekSummaryParams {
  from: string;
  to: string;
  target: number;
  macrosTarget: Macros;
  loggedDays: number;
  onTargetDays: number;
  avgKcal: number | null;
  avgMacros: Macros | null;
  proteinHitDays: number;
  walks: number;
  colaFree: number;
  weight: number | null;
  weightChange: number | null;
  avgWaterMl: number;
  waterDays: number;
  waterTarget: number;
}

export interface UsageParams {
  model: string;
  window: UsageTotals;
  days: { date: string; isoWeekday: number; totals: UsageTotals }[];
  week: UsageTotals;
  users: { id: number; isOwner: boolean; totals: UsageTotals }[];
}

interface UsageLabels {
  title: string;
  window: string;
  avg: string;
  days: string;
  users: string;
  none: string;
  req: string;
  you: string;
  wd: string[];
  note: string;
}

const kTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const tokenLine = (u: UsageTotals, req: string): string =>
  `${u.requests} ${req} · ${kTokens(u.input)} in / ${kTokens(u.output)} out${u.reasoning > 0 ? ` (${kTokens(u.reasoning)} reasoning)` : ''}`;

function usageText(p: UsageParams, l: UsageLabels): string {
  const lines = [`🤖 <b>${l.title}</b> · <code>${escapeHtml(p.model)}</code>`, `${l.window}: ${tokenLine(p.window, l.req)}`];
  if (p.week.requests === 0) return [...lines, '', l.none].join('\n');
  lines.push(
    `${l.avg}: ${kTokens(p.week.input / p.week.requests)} in / ${kTokens(p.week.output / p.week.requests)} out`,
    '',
    `<b>${l.days}</b>`,
    `<pre>${p.days
      .map((d) => `${l.wd[d.isoWeekday]} ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}  ${tokenLine(d.totals, l.req)}`)
      .join('\n')}</pre>`,
    `<b>${l.users}</b>`,
    ...p.users.map((u) => `• <code>${u.id}</code>${u.isOwner ? ` (${l.you})` : ''} — ${tokenLine(u.totals, l.req)}`),
    '',
    `<i>${l.note}</i>`,
  );
  return lines.join('\n');
}

export interface WeightParams {
  kg: number;
  diffPrev: number | null;
  diffStart: number;
  left: number;
  weeks: number;
  target: number;
}

export interface HistoryDay {
  date: string;
  isoWeekday: number;
  /** null when nothing was logged that day. */
  kcal: number | null;
  macros: Macros | null;
  weight: number | null;
  isToday: boolean;
}

export interface HistoryParams {
  days: HistoryDay[];
  target: number;
  macrosTarget: Macros;
  /** Averages over logged days, excluding today. null when there are none. */
  avgKcal: number | null;
  avgMacros: Macros | null;
  completeDays: number;
  onTargetDays: number;
}

const budgetLines = (budgets: Budgets, names: Record<MealSlot, string>, unit: string): string =>
  MEAL_SLOTS.filter((s) => budgets[s] !== undefined)
    .map((s) => `• ${names[s]}: <b>${budgets[s]}</b> ${unit}`)
    .join('\n');

interface MacroLabels {
  p: string;
  f: string;
  c: string;
  g: string;
}
const MACRO_KEYS = [
  ['p', 'protein'],
  ['f', 'fat'],
  ['c', 'carbs'],
] as const;

/** "P 120/153 g · F 60/51 g · C 150/190 g"; targets are optional. */
function macroLine(l: MacroLabels, eaten: Macros, target?: Macros): string {
  return MACRO_KEYS.map(([k, m]) => `${l[k]} ${Math.round(eaten[m])}${target ? `/${target[m]}` : ''} ${l.g}`).join(
    ' · ',
  );
}

/** Monospace day rows for /history: "Fri 20.11  1650 ✅ P120 F60 C150 ⚖98.5". */
function historyRows(p: HistoryParams, weekdays: string[], l: MacroLabels): string {
  const rows = p.days.map((d) => {
    const day = `${weekdays[d.isoWeekday]} ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`;
    const weight = d.weight === null ? '' : ` ⚖${d.weight.toFixed(1)}`;
    if (d.kcal === null || d.macros === null) return `${day}      —${weight}`;
    const mark = d.isToday ? '⏳' : d.kcal <= p.target ? '✅' : '⚠️';
    const m = d.macros;
    return `${day} ${String(Math.round(d.kcal)).padStart(5)} ${mark} ${l.p}${Math.round(m.protein)} ${l.f}${Math.round(m.fat)} ${l.c}${Math.round(m.carbs)}${weight}`;
  });
  return `<pre>${rows.join('\n')}</pre>`;
}

const EN_MACRO: MacroLabels = { p: 'P', f: 'F', c: 'C', g: 'g' };
const UK_MACRO: MacroLabels = { p: 'Б', f: 'Ж', c: 'В', g: 'г' };

const ddmm = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

interface ListLabels {
  today: string;
  yesterday: string;
  kcal: string;
  empty: string;
  slot: Record<MealSlot, string>;
  wd: string[];
  macro: MacroLabels;
}

function mealsHistoryText(days: MealsHistoryDay[], l: ListLabels): string {
  return days
    .map((d) => {
      const head = `<b>${d.isToday ? l.today : l.yesterday}, ${l.wd[d.isoWeekday]} ${ddmm(d.date)}</b> — ${d.kcal} ${l.kcal} · ${macroLine(l.macro, d.macros)}`;
      const rows = d.meals.map(
        (m) =>
          `• ${formatHHMM(m.time)} ${l.slot[m.slot]} — ${m.kcal} ${l.kcal} · ${l.macro.p}${Math.round(m.macros.protein)} ${l.macro.f}${Math.round(m.macros.fat)} ${l.macro.c}${Math.round(m.macros.carbs)} — ${escapeHtml(m.description)}`,
      );
      return [head, ...(rows.length > 0 ? rows : [l.empty])].join('\n');
    })
    .join('\n\n');
}

// ---------- English ----------

const EN_SLOT: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const EN_WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EN_WD_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const EN_PACE: Record<Pace, string> = { slow: 'slow (0.25 kg/week)', normal: 'normal (0.5 kg/week)', fast: 'fast (0.75 kg/week)' };
const EN_ACTIVITY: Record<Activity, string> = {
  sedentary: 'sedentary',
  light: 'light',
  moderate: 'moderate',
  active: 'active',
};
const EN_HELP = [
  '<b>How it works</b>',
  'Send a photo of everything you eat or drink — I estimate calories and track the day.',
  'Add a caption to be precise, e.g. <i>protein shake, 2 scoops whey + 300 ml milk</i>.',
  'Wrong estimate? Tap ✏️ under it and tell me what it really was.',
  '',
  '/today — today’s calories, protein/fat/carbs and what’s left',
  '/meals — what you ate today and yesterday',
  '/history — last 7 days (or /history 30)',
  '/weight 82.5 — log weight (or just send the number)',
  '/undo — delete today’s last meal',
  '/walk 19:30 — set the walk reminder time (/walk auto to reset)',
  '/training — set training days (protein shakes are fine on those)',
  '/water 500 — log water (reminders every 2 h)',
  '/profile — your stats and schedule',
  '/connect — bot owner: sign in with ChatGPT (powers everyone’s photos)',
  '/disconnect — bot owner: sign out of ChatGPT',
  '/lang — switch language',
  '/reset — redo setup (history is kept)',
  '/help — this message',
].join('\n');

const CONNECT_ERR_EN: Record<ConnectErrorCode, string> = {
  no_pending: 'No sign-in in progress, or it expired. Send /connect again.',
  state_mismatch: 'That address is from an older /connect link. Use the newest link, or send /connect again.',
  denied: 'You declined ChatGPT access. Send /connect to try again.',
  bad_callback: 'That isn’t the full <code>127.0.0.1</code> address. Copy the whole address bar, or send /connect for a new link.',
  exchange_failed: 'ChatGPT rejected the sign-in (the code is single-use and expires fast). Send /connect and try again.',
  bad_id_token: 'Couldn’t verify the ChatGPT sign-in. Send /connect and try again.',
  no_plan_usage: 'ChatGPT plan usage wasn’t approved. Send /connect and approve it on the consent screen.',
  wrong_account: 'That’s a different ChatGPT account than the one registered for you here. Sign in with the same account.',
};

const en = {
  private_bot: (p: { id: number }) => `Private bot. Your Telegram ID: <code>${p.id}</code>`,
  ob_language: 'Choose your language / Оберіть мову',
  ob_sex: 'Sex? (the calorie formula needs it)',
  btn_male: '♂ Male',
  btn_female: '♀ Female',
  ob_age: 'How old are you?',
  err_age: 'Send a whole number from 14 to 100.',
  ob_height: 'Height in cm?',
  err_height: 'Send a number from 120 to 230.',
  ob_weight: 'Current weight in kg? (e.g. 92.4)',
  err_weight: 'Send a number from 35 to 350.',
  ob_goal_weight: 'Goal weight in kg?',
  err_goal_range: 'Send a number from 35 up to your current weight.',
  err_goal_not_lower: 'The goal must be below your current weight — this bot is for losing.',
  ob_pace: 'How fast do you want to lose?',
  btn_pace_slow: '🐢 Slow — 0.25 kg/week',
  btn_pace_normal: '🚶 Normal — 0.5 kg/week',
  btn_pace_fast: '🏃 Fast — 0.75 kg/week',
  ob_activity: 'Activity level?',
  btn_activity_sedentary: 'Desk job, no workouts',
  btn_activity_light: '1–3 workouts per week',
  btn_activity_moderate: '3–5 workouts per week',
  btn_activity_active: '6–7 workouts per week',
  ob_meals: 'Which meals do you actually eat? Tap to toggle, then Done.',
  err_meals: 'Pick at least one of breakfast, lunch or dinner.',
  btn_done: 'Done ✔',
  ob_work_days: 'Which days do you work? Tap to toggle, then Done (none is fine).',
  ob_work_hours: 'Work hours? Send like <code>09:00-18:00</code>',
  err_work_hours: 'Send start and end like <code>09:00-18:00</code>; start must be before end.',
  ob_sleep_hours: 'When do you wake up and go to sleep? Send like <code>08:00-23:00</code>',
  err_sleep_hours: 'Send wake and sleep times like <code>08:00-23:00</code>; they must differ.',
  ob_timezone: 'Your time zone? Tap one or type an IANA name like <code>America/New_York</code>.',
  err_timezone: 'Unknown time zone. Type an IANA name like <code>Europe/Kyiv</code>.',
  ob_weigh_day: 'Which day do you weigh in each week?',
  finish_setup_first: 'Finish setup first.',
  slot: (p: { slot: MealSlot }) => EN_SLOT[p.slot],
  weekday: (p: { d: number }) => EN_WD[p.d] ?? '',
  summary: (p: SummaryParams) =>
    [
      `✅ <b>Setup done.</b> Daily target: <b>${p.target} kcal</b>`,
      macroLine(EN_MACRO, p.macros),
      budgetLines(p.budgets, EN_SLOT, 'kcal'),
      '',
      `Goal ${p.goal.toFixed(1)} kg in about <b>${p.weeks} weeks</b>.`,
      p.walkWork === null
        ? `🚶 Walk reminder: ${formatHHMM(p.walkOff)}`
        : `🚶 Walk reminder: ${formatHHMM(p.walkWork)} on work days, ${formatHHMM(p.walkOff)} on days off`,
      `⚖️ Weigh-in: every ${EN_WD_LONG[p.weighDay]}`,
      '',
      EN_HELP,
    ].join('\n'),
  help: EN_HELP,
  today: (p: TodayParams) => {
    const lines = [`<b>Today:</b> ${p.eaten} / ${p.target} kcal`, macroLine(EN_MACRO, p.macrosEaten, p.macrosTarget)];
    if (p.remaining >= 0) {
      lines.push(`Left: <b>${p.remaining}</b> kcal`);
      const plan = budgetLines(p.perSlot, EN_SLOT, 'kcal');
      if (plan) lines.push(plan);
    } else {
      lines.push(`⚠️ Over by <b>${-p.remaining}</b> kcal`);
    }
    lines.push('');
    if (p.meals.length === 0) lines.push('No meals logged yet. Send a photo.');
    for (const m of p.meals) lines.push(`• ${EN_SLOT[m.slot]} — ${m.kcal} kcal — ${escapeHtml(m.description)}`);
    lines.push('');
    lines.push(`🚶 Walk: ${p.walk === 'done' ? 'done' : p.walk === 'skipped' ? 'skipped' : '—'}`);
    lines.push(`🥤 Cola: ${p.cola === 'clean' ? 'none' : p.cola === 'drank' ? 'yes' : '—'}`);
    lines.push(`💧 Water: ${p.waterMl} / ${p.waterTarget} ml`);
    return lines.join('\n');
  },
  profile: (p: ProfileParams) =>
    [
      '<b>Profile</b>',
      `${p.sex === 'male' ? 'Male' : 'Female'}, ${p.age} y, ${p.height} cm`,
      `Weight: ${p.current.toFixed(1)} kg (start ${p.start.toFixed(1)}, goal ${p.goal.toFixed(1)})`,
      `Pace: ${EN_PACE[p.pace]}; activity: ${EN_ACTIVITY[p.activity]}`,
      `Target: <b>${p.target} kcal</b>`,
      macroLine(EN_MACRO, p.macros),
      budgetLines(p.budgets, EN_SLOT, 'kcal'),
      '',
      p.workDays.length > 0 && p.workStart !== null && p.workEnd !== null
        ? `Work: ${p.workDays.map((d) => EN_WD[d]).join(', ')} ${formatHHMM(p.workStart)}–${formatHHMM(p.workEnd)}`
        : 'Work: no fixed days',
      `Awake: ${formatHHMM(p.wake)}–${formatHHMM(p.sleep)} (${escapeHtml(p.timezone)})`,
      `Weigh-in: ${EN_WD_LONG[p.weighDay]}`,
      p.walkWork === null
        ? `Walk: ${formatHHMM(p.walkOff)}`
        : `Walk: ${formatHHMM(p.walkWork)} on work days, ${formatHHMM(p.walkOff)} on days off`,
      `Training: ${p.trainingDays.length > 0 ? p.trainingDays.map((d) => EN_WD[d]).join(', ') : 'none'}`,
      p.chatgpt.status === 'ok'
        ? `ChatGPT: connected${p.chatgpt.email ? ` (${escapeHtml(p.chatgpt.email)})` : ''}`
        : p.chatgpt.status === 'reauth_required'
          ? 'ChatGPT: expired — /connect'
          : 'ChatGPT: not connected — /connect',
    ].join('\n'),
  weight_reply: (p: WeightParams) =>
    [
      `⚖️ <b>${p.kg.toFixed(1)} kg</b>`,
      p.diffPrev === null ? null : `Since last: ${signed(p.diffPrev)} kg`,
      `Since start: ${signed(p.diffStart)} kg`,
      p.left > 0 ? `Left to goal: ${p.left.toFixed(1)} kg (~${p.weeks} weeks)` : null,
      `New daily target: <b>${p.target} kcal</b>`,
    ]
      .filter((l) => l !== null)
      .join('\n'),
  weight_goal_reached: (p: { goal: number }) =>
    `🏆 Goal of ${p.goal.toFixed(1)} kg reached. Respect. Send /reset to set a new goal.`,
  undo_done: (p: { description: string; remaining: number }) =>
    `🗑 Deleted: ${escapeHtml(p.description)}\nLeft today: <b>${p.remaining}</b> kcal`,
  undo_nothing: 'Nothing to undo today.',
  lang_set: 'Language: English 🇬🇧',
  reset_started: 'Let’s redo your setup. History stays.',
  send_as_photo: 'Send it as a photo, not a file.',
  analyzing: '🔎 Analyzing…',
  not_food: '🤨 That doesn’t look like food. Nothing logged.',
  meal_result: (p: MealResultParams) => {
    const lines = [`🍽 <b>${escapeHtml(p.description)}</b>`];
    for (const i of p.items) lines.push(`• ${escapeHtml(i.name)} — ${Math.round(i.grams)} g — ${i.kcal} kcal`);
    lines.push(
      '',
      `<b>${p.kcal} kcal</b> · ${macroLine(EN_MACRO, p.meal)}`,
      `Logged as: ${EN_SLOT[p.slot]}`,
      `Today: ${p.eaten} / ${p.target} kcal`,
      macroLine(EN_MACRO, p.dayMacros, p.macrosTarget),
    );
    if (p.remaining >= 0) {
      lines.push(`Left: <b>${p.remaining}</b> kcal`);
      const plan = budgetLines(p.perSlot, EN_SLOT, 'kcal');
      if (plan) lines.push(plan);
    } else {
      lines.push(`⚠️ Over by <b>${-p.remaining}</b> kcal`);
    }
    if (p.roast) lines.push('', `<i>${escapeHtml(p.roast)}</i>`);
    return lines.join('\n');
  },
  history: (p: HistoryParams) =>
    [
      `<b>Last ${p.days.length} days</b> · target ${p.target} kcal`,
      macroLine(EN_MACRO, p.macrosTarget),
      historyRows(p, EN_WD, EN_MACRO),
      p.avgKcal === null || p.avgMacros === null
        ? 'No complete logged days yet.'
        : [
            `Average per logged day: <b>${Math.round(p.avgKcal)} kcal</b> · ${macroLine(EN_MACRO, p.avgMacros)}`,
            `On target: <b>${p.onTargetDays}</b> of ${p.completeDays} logged days`,
          ].join('\n'),
    ].join('\n'),
  meals_history: (p: { days: MealsHistoryDay[] }) =>
    mealsHistoryText(p.days, {
      today: 'Today',
      yesterday: 'Yesterday',
      kcal: 'kcal',
      empty: 'Nothing logged.',
      slot: EN_SLOT,
      wd: EN_WD,
      macro: EN_MACRO,
    }),
  week_summary: (p: WeekSummaryParams) =>
    [
      `📊 <b>Week ${ddmm(p.from)}–${ddmm(p.to)}</b>`,
      p.avgKcal === null || p.avgMacros === null
        ? '🍽 Nothing logged this week.'
        : [
            `🍽 Avg <b>${Math.round(p.avgKcal)} kcal</b>/day (target ${p.target}) · on target <b>${p.onTargetDays}</b>/${p.loggedDays} logged days`,
            `Avg ${macroLine(EN_MACRO, p.avgMacros)}`,
            `Target ${macroLine(EN_MACRO, p.macrosTarget)}`,
            `💪 Protein target hit: <b>${p.proteinHitDays}</b>/${p.loggedDays} days`,
          ].join('\n'),
      `🚶 Walks: <b>${p.walks}</b>/7 · 🥤 Cola-free: <b>${p.colaFree}</b>/7`,
      `💧 Water: avg <b>${Math.round(p.avgWaterMl)}</b> ml/day · target hit <b>${p.waterDays}</b>/7 (target ${p.waterTarget} ml)`,
      p.weight === null
        ? '⚖️ No weigh-in this week.'
        : `⚖️ ${p.weight.toFixed(1)} kg${p.weightChange === null ? '' : ` (${signed(p.weightChange)} kg this week)`}`,
    ].join('\n'),
  week_good: 'Solid week. Keep it boring and repeat it.',
  meal_deleted: '🗑 Deleted.',
  edit_prompt: '✏️ What’s wrong? Describe it, e.g. <i>it’s a protein shake, 2 scoops whey + 300 ml milk</i>. I’ll re-check the photo with your text.',
  edit_gone: 'That meal no longer exists.',
  meal_edited_below: '✏️ Corrected — see the new estimate below.',
  err_ai_usage_limit: 'ChatGPT plan limit reached, try later. Usage: https://chatgpt.com/settings/usage',
  err_ai_reauth: 'The bot’s ChatGPT sign-in expired — the bot owner needs to send /connect.',
  err_ai_missing: 'ChatGPT isn’t connected yet — the bot owner needs to send /connect.',
  err_ai_not_eligible: 'ChatGPT plan usage is not available for this account.',
  err_ai_generic: 'Couldn’t analyze that, send it again.',
  walk_result: (p: { done: boolean; streak: number }) =>
    p.done ? `✅ Walked. Streak: <b>${p.streak}</b> 🔥` : '😴 Skipped.',
  cola_result: (p: { clean: boolean; streak: number }) =>
    p.clean ? `✅ Cola-free. Streak: <b>${p.streak}</b> 🔥` : '🥤 Logged.',
  notif_walk: (p: { streak: number }) =>
    `🚶 30-minute walk time.${p.streak > 0 ? ` Streak: <b>${p.streak}</b> 🔥` : ''}`,
  notif_walk_snoozed: '⏰ Snooze is over. 30-minute walk. Now.',
  btn_walked: '🚶 Walked',
  btn_skip: '😴 Skip',
  btn_snooze: (p: { min: number }) => (p.min < 60 ? `⏰ ${p.min} min` : `⏰ ${p.min / 60} h`),
  walk_snoozed: (p: { minute: number }) => `⏰ Snoozed until <b>${formatHHMM(p.minute)}</b>.`,
  snooze_too_late: 'Too late to snooze past bedtime. Walk now or skip.',
  snooze_stale: 'That reminder is from another day.',
  walk_current: (p: { walkWork: number | null; walkOff: number; custom: boolean }) =>
    [
      p.walkWork === null
        ? `🚶 Walk reminder: <b>${formatHHMM(p.walkOff)}</b>`
        : `🚶 Walk reminder: <b>${formatHHMM(p.walkWork)}</b> on work days, <b>${formatHHMM(p.walkOff)}</b> on days off`,
      p.custom ? 'Set by you. <code>/walk auto</code> goes back to after-work timing.' : 'Change it: <code>/walk 19:30</code>',
    ].join('\n'),
  walk_usage: 'Send <code>/walk 19:30</code> to set the time, or <code>/walk auto</code> for 30 min after work.',
  walk_not_awake: 'That’s outside your waking hours — I’d never send it.',
  ob_training_days: 'Which days do you train? Tap to toggle, then Done. Protein shakes are fine on those days (none is fine).',
  training_prompt: 'Training days — tap to toggle, then Done.',
  training_saved: (p: { days: number[] }) =>
    `💪 Training days: <b>${p.days.length > 0 ? p.days.map((d) => EN_WD[d]).join(', ') : 'none'}</b>`,
  cola_streak: (p: { streak: number }) => `Cola-free streak: <b>${p.streak}</b>`,
  notif_cola_check: 'Cola today?',
  btn_cola_none: '✅ None',
  btn_cola_yes: '🥤 Yes',
  notif_weigh_in: '⚖️ Weigh-in day: after the toilet, before food. Send the number.',
  notif_no_meals: 'Send photos of what you ate today.',
  water_status: (p: { ml: number; target: number }) =>
    `💧 Water today: <b>${p.ml}</b> / ${p.target} ml${p.ml >= p.target ? ' ✅' : ''}`,
  btn_water: (p: { ml: number }) => `+${p.ml} ml`,
  water_logged: (p: { ml: number }) => `💧 +${p.ml} ml`,
  water_usage: 'Send <code>/water 500</code> to log 500 ml, or tap a button.',
  connect_hint: '🔗 One more step: send /connect and sign in with ChatGPT so I can read meal photos — yours and everyone else’s.',
  connect_start: [
    '🔗 <b>Sign in with your ChatGPT</b>',
    '1. Tap the button and approve ChatGPT plan usage.',
    '2. Your browser ends on a page that won’t load (<code>127.0.0.1</code>). That’s expected.',
    '3. Copy that page’s full address and send it here.',
    '',
    'The link works for 15 minutes. Every user’s photos run on this one ChatGPT plan.',
  ].join('\n'),
  btn_connect: 'Sign in with ChatGPT',
  connect_ok: (p: { email: string | null }) =>
    `✅ ChatGPT connected${p.email ? ` as <b>${escapeHtml(p.email)}</b>` : ''}. Send a meal photo.`,
  connect_err: (p: { code: ConnectErrorCode }) => CONNECT_ERR_EN[p.code],
  disconnect_ok: 'Signed out of ChatGPT. /connect to sign in again.',
  disconnect_none: 'No ChatGPT account connected.',
  connect_owner_only: 'Only the bot owner manages the ChatGPT connection.',
  usage: (p: UsageParams) =>
    usageText(p, {
      title: 'ChatGPT usage',
      window: 'Last 5 h',
      avg: 'Avg per request (7 d)',
      days: 'Last 7 days',
      users: 'By user (7 d)',
      none: 'No requests in the last 7 days.',
      req: 'req',
      you: 'you',
      wd: EN_WD,
      note: 'Token counts as reported by the API. The ChatGPT plan limit itself isn’t exposed — compare with chatgpt.com/settings/usage.',
    }),
  usage_owner_only: 'Only the bot owner can see usage.',
};

type Messages = typeof en;

// ---------- Ukrainian ----------

const UK_SLOT: Record<MealSlot, string> = { breakfast: 'Сніданок', lunch: 'Обід', dinner: 'Вечеря', snack: 'Перекус' };
const UK_WD = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const UK_WD_LONG = ['', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];
const UK_PACE: Record<Pace, string> = { slow: 'повільний (0,25 кг/тиж)', normal: 'нормальний (0,5 кг/тиж)', fast: 'швидкий (0,75 кг/тиж)' };
const UK_ACTIVITY: Record<Activity, string> = {
  sedentary: 'сидячий',
  light: 'легка',
  moderate: 'помірна',
  active: 'висока',
};
const CONNECT_ERR_UK: Record<ConnectErrorCode, string> = {
  no_pending: 'Вхід не розпочато або посилання протухло. Надішли /connect ще раз.',
  state_mismatch: 'Ця адреса від старого посилання /connect. Візьми найновіше або надішли /connect знову.',
  denied: 'Ти не дозволив(ла) доступ до ChatGPT. Надішли /connect, щоб спробувати ще раз.',
  bad_callback: 'Це не повна адреса <code>127.0.0.1</code>. Скопіюй увесь рядок адреси або надішли /connect по нове посилання.',
  exchange_failed: 'ChatGPT не прийняв вхід (код одноразовий і швидко спливає). Надішли /connect і спробуй ще раз.',
  bad_id_token: 'Не вдалося перевірити вхід у ChatGPT. Надішли /connect і спробуй ще раз.',
  no_plan_usage: 'Використання плану ChatGPT не дозволено. Надішли /connect і підтверди його на екрані згоди.',
  wrong_account: 'Це інший акаунт ChatGPT, ніж той, що вже привʼязаний до тебе тут. Увійди тим самим акаунтом.',
};
const UK_HELP = [
  '<b>Як це працює</b>',
  'Надсилай фото всього, що їси чи пʼєш — я оцінюю калорії й рахую день.',
  'Додай підпис для точності, напр. <i>протеїновий шейк, 2 скупи + 300 мл молока</i>.',
  'Оцінка неправильна? Натисни ✏️ під нею і напиши, що це було насправді.',
  '',
  '/today — калорії, БЖВ за сьогодні і скільки лишилось',
  '/meals — що ти їв(ла) сьогодні й учора',
  '/history — останні 7 днів (або /history 30)',
  '/weight 82.5 — записати вагу (або просто надішли число)',
  '/undo — видалити останню їжу за сьогодні',
  '/walk 19:30 — час нагадування про прогулянку (/walk auto — як було)',
  '/training — дні тренувань (у ці дні протеїновий шейк — норм)',
  '/water 500 — записати воду (нагадування кожні 2 год)',
  '/profile — твої дані й розклад',
  '/connect — для власника бота: увійти в ChatGPT (фото всіх користувачів)',
  '/disconnect — для власника бота: вийти з ChatGPT',
  '/lang — змінити мову',
  '/reset — пройти налаштування заново (історія лишається)',
  '/help — ця підказка',
].join('\n');

const uk: Messages = {
  private_bot: (p) => `Приватний бот. Твій Telegram ID: <code>${p.id}</code>`,
  ob_language: en.ob_language,
  ob_sex: 'Стать? (потрібна для формули калорій)',
  btn_male: '♂ Чоловік',
  btn_female: '♀ Жінка',
  ob_age: 'Скільки тобі років?',
  err_age: 'Надішли ціле число від 14 до 100.',
  ob_height: 'Зріст у см?',
  err_height: 'Надішли число від 120 до 230.',
  ob_weight: 'Поточна вага в кг? (наприклад 92,4)',
  err_weight: 'Надішли число від 35 до 350.',
  ob_goal_weight: 'Цільова вага в кг?',
  err_goal_range: 'Надішли число від 35 до твоєї поточної ваги.',
  err_goal_not_lower: 'Ціль має бути нижчою за поточну вагу — цей бот для схуднення.',
  ob_pace: 'Як швидко хочеш худнути?',
  btn_pace_slow: '🐢 Повільно — 0,25 кг/тиж',
  btn_pace_normal: '🚶 Нормально — 0,5 кг/тиж',
  btn_pace_fast: '🏃 Швидко — 0,75 кг/тиж',
  ob_activity: 'Рівень активності?',
  btn_activity_sedentary: 'Сидяча робота, без тренувань',
  btn_activity_light: '1–3 тренування на тиждень',
  btn_activity_moderate: '3–5 тренувань на тиждень',
  btn_activity_active: '6–7 тренувань на тиждень',
  ob_meals: 'Які прийоми їжі в тебе реально бувають? Натискай, щоб обрати, потім «Готово».',
  err_meals: 'Обери хоча б один: сніданок, обід або вечерю.',
  btn_done: 'Готово ✔',
  ob_work_days: 'У які дні працюєш? Натискай, щоб обрати, потім «Готово» (можна жодного).',
  ob_work_hours: 'Робочі години? Надішли як <code>09:00-18:00</code>',
  err_work_hours: 'Надішли початок і кінець як <code>09:00-18:00</code>; початок має бути раніше.',
  ob_sleep_hours: 'Коли прокидаєшся і лягаєш спати? Надішли як <code>08:00-23:00</code>',
  err_sleep_hours: 'Надішли час підйому і сну як <code>08:00-23:00</code>; вони мають відрізнятися.',
  ob_timezone: 'Твій часовий пояс? Обери або напиши назву IANA, наприклад <code>America/New_York</code>.',
  err_timezone: 'Невідомий часовий пояс. Напиши назву IANA, наприклад <code>Europe/Kyiv</code>.',
  ob_weigh_day: 'У який день тижня зважуєшся?',
  finish_setup_first: 'Спершу заверши налаштування.',
  slot: (p) => UK_SLOT[p.slot],
  weekday: (p) => UK_WD[p.d] ?? '',
  summary: (p) =>
    [
      `✅ <b>Готово.</b> Денна норма: <b>${p.target} ккал</b>`,
      macroLine(UK_MACRO, p.macros),
      budgetLines(p.budgets, UK_SLOT, 'ккал'),
      '',
      `Ціль ${p.goal.toFixed(1)} кг приблизно за <b>${p.weeks} тиж.</b>`,
      p.walkWork === null
        ? `🚶 Нагадування про прогулянку: ${formatHHMM(p.walkOff)}`
        : `🚶 Нагадування про прогулянку: ${formatHHMM(p.walkWork)} у робочі дні, ${formatHHMM(p.walkOff)} у вихідні`,
      `⚖️ Зважування: щотижня, ${UK_WD_LONG[p.weighDay]}`,
      '',
      UK_HELP,
    ].join('\n'),
  help: UK_HELP,
  today: (p) => {
    const lines = [`<b>Сьогодні:</b> ${p.eaten} / ${p.target} ккал`, macroLine(UK_MACRO, p.macrosEaten, p.macrosTarget)];
    if (p.remaining >= 0) {
      lines.push(`Лишилось: <b>${p.remaining}</b> ккал`);
      const plan = budgetLines(p.perSlot, UK_SLOT, 'ккал');
      if (plan) lines.push(plan);
    } else {
      lines.push(`⚠️ Перебір на <b>${-p.remaining}</b> ккал`);
    }
    lines.push('');
    if (p.meals.length === 0) lines.push('Ще нічого не записано. Надішли фото.');
    for (const m of p.meals) lines.push(`• ${UK_SLOT[m.slot]} — ${m.kcal} ккал — ${escapeHtml(m.description)}`);
    lines.push('');
    lines.push(`🚶 Прогулянка: ${p.walk === 'done' ? 'є' : p.walk === 'skipped' ? 'пропущено' : '—'}`);
    lines.push(`🥤 Кола: ${p.cola === 'clean' ? 'ні' : p.cola === 'drank' ? 'так' : '—'}`);
    lines.push(`💧 Вода: ${p.waterMl} / ${p.waterTarget} мл`);
    return lines.join('\n');
  },
  profile: (p) =>
    [
      '<b>Профіль</b>',
      `${p.sex === 'male' ? 'Чоловік' : 'Жінка'}, ${p.age} р., ${p.height} см`,
      `Вага: ${p.current.toFixed(1)} кг (старт ${p.start.toFixed(1)}, ціль ${p.goal.toFixed(1)})`,
      `Темп: ${UK_PACE[p.pace]}; активність: ${UK_ACTIVITY[p.activity]}`,
      `Норма: <b>${p.target} ккал</b>`,
      macroLine(UK_MACRO, p.macros),
      budgetLines(p.budgets, UK_SLOT, 'ккал'),
      '',
      p.workDays.length > 0 && p.workStart !== null && p.workEnd !== null
        ? `Робота: ${p.workDays.map((d) => UK_WD[d]).join(', ')} ${formatHHMM(p.workStart)}–${formatHHMM(p.workEnd)}`
        : 'Робота: без фіксованих днів',
      `Не спиш: ${formatHHMM(p.wake)}–${formatHHMM(p.sleep)} (${escapeHtml(p.timezone)})`,
      `Зважування: ${UK_WD_LONG[p.weighDay]}`,
      p.walkWork === null
        ? `Прогулянка: ${formatHHMM(p.walkOff)}`
        : `Прогулянка: ${formatHHMM(p.walkWork)} у робочі дні, ${formatHHMM(p.walkOff)} у вихідні`,
      `Тренування: ${p.trainingDays.length > 0 ? p.trainingDays.map((d) => UK_WD[d]).join(', ') : 'немає'}`,
      p.chatgpt.status === 'ok'
        ? `ChatGPT: підключено${p.chatgpt.email ? ` (${escapeHtml(p.chatgpt.email)})` : ''}`
        : p.chatgpt.status === 'reauth_required'
          ? 'ChatGPT: вхід протух — /connect'
          : 'ChatGPT: не підключено — /connect',
    ].join('\n'),
  weight_reply: (p) =>
    [
      `⚖️ <b>${p.kg.toFixed(1)} кг</b>`,
      p.diffPrev === null ? null : `Від минулого разу: ${signed(p.diffPrev)} кг`,
      `Від старту: ${signed(p.diffStart)} кг`,
      p.left > 0 ? `До цілі: ${p.left.toFixed(1)} кг (~${p.weeks} тиж.)` : null,
      `Нова денна норма: <b>${p.target} ккал</b>`,
    ]
      .filter((l) => l !== null)
      .join('\n'),
  weight_goal_reached: (p) =>
    `🏆 Ціль ${p.goal.toFixed(1)} кг досягнуто. Поважаю. Надішли /reset, щоб поставити нову.`,
  undo_done: (p) => `🗑 Видалено: ${escapeHtml(p.description)}\nЛишилось на сьогодні: <b>${p.remaining}</b> ккал`,
  undo_nothing: 'Сьогодні нічого видаляти.',
  lang_set: 'Мова: українська 🇺🇦',
  reset_started: 'Пройдемо налаштування заново. Історія лишається.',
  send_as_photo: 'Надішли це як фото, а не файлом.',
  analyzing: '🔎 Аналізую…',
  not_food: '🤨 Це не схоже на їжу. Нічого не записано.',
  meal_result: (p) => {
    const lines = [`🍽 <b>${escapeHtml(p.description)}</b>`];
    for (const i of p.items) lines.push(`• ${escapeHtml(i.name)} — ${Math.round(i.grams)} г — ${i.kcal} ккал`);
    lines.push(
      '',
      `<b>${p.kcal} ккал</b> · ${macroLine(UK_MACRO, p.meal)}`,
      `Записано як: ${UK_SLOT[p.slot]}`,
      `Сьогодні: ${p.eaten} / ${p.target} ккал`,
      macroLine(UK_MACRO, p.dayMacros, p.macrosTarget),
    );
    if (p.remaining >= 0) {
      lines.push(`Лишилось: <b>${p.remaining}</b> ккал`);
      const plan = budgetLines(p.perSlot, UK_SLOT, 'ккал');
      if (plan) lines.push(plan);
    } else {
      lines.push(`⚠️ Перебір на <b>${-p.remaining}</b> ккал`);
    }
    if (p.roast) lines.push('', `<i>${escapeHtml(p.roast)}</i>`);
    return lines.join('\n');
  },
  history: (p) =>
    [
      `<b>Останні ${p.days.length} дн.</b> · норма ${p.target} ккал`,
      macroLine(UK_MACRO, p.macrosTarget),
      historyRows(p, UK_WD, UK_MACRO),
      p.avgKcal === null || p.avgMacros === null
        ? 'Ще немає повних записаних днів.'
        : [
            `У середньому за записаний день: <b>${Math.round(p.avgKcal)} ккал</b> · ${macroLine(UK_MACRO, p.avgMacros)}`,
            `У межах норми: <b>${p.onTargetDays}</b> з ${p.completeDays} записаних днів`,
          ].join('\n'),
    ].join('\n'),
  meals_history: (p) =>
    mealsHistoryText(p.days, {
      today: 'Сьогодні',
      yesterday: 'Учора',
      kcal: 'ккал',
      empty: 'Нічого не записано.',
      slot: UK_SLOT,
      wd: UK_WD,
      macro: UK_MACRO,
    }),
  week_summary: (p) =>
    [
      `📊 <b>Тиждень ${ddmm(p.from)}–${ddmm(p.to)}</b>`,
      p.avgKcal === null || p.avgMacros === null
        ? '🍽 За тиждень нічого не записано.'
        : [
            `🍽 У середньому <b>${Math.round(p.avgKcal)} ккал</b>/день (норма ${p.target}) · у межах норми <b>${p.onTargetDays}</b>/${p.loggedDays} записаних днів`,
            `У середньому ${macroLine(UK_MACRO, p.avgMacros)}`,
            `Норма ${macroLine(UK_MACRO, p.macrosTarget)}`,
            `💪 Норму білка виконано: <b>${p.proteinHitDays}</b>/${p.loggedDays} днів`,
          ].join('\n'),
      `🚶 Прогулянки: <b>${p.walks}</b>/7 · 🥤 Без коли: <b>${p.colaFree}</b>/7`,
      `💧 Вода: у середньому <b>${Math.round(p.avgWaterMl)}</b> мл/день · норма виконана <b>${p.waterDays}</b>/7 (норма ${p.waterTarget} мл)`,
      p.weight === null
        ? '⚖️ Цього тижня без зважування.'
        : `⚖️ ${p.weight.toFixed(1)} кг${p.weightChange === null ? '' : ` (${signed(p.weightChange)} кг за тиждень)`}`,
    ].join('\n'),
  week_good: 'Нормальний тиждень. Нудно і стабільно — повтори.',
  meal_deleted: '🗑 Видалено.',
  edit_prompt: '✏️ Що не так? Опиши, напр. <i>це протеїновий шейк, 2 скупи + 300 мл молока</i>. Я перевірю фото ще раз з твоїм текстом.',
  edit_gone: 'Цього прийому їжі вже немає.',
  meal_edited_below: '✏️ Виправлено — нова оцінка нижче.',
  err_ai_usage_limit: 'Ліміт плану ChatGPT вичерпано, спробуй пізніше. Використання: https://chatgpt.com/settings/usage',
  err_ai_reauth: 'Вхід бота в ChatGPT протух — власник бота має надіслати /connect.',
  err_ai_missing: 'ChatGPT ще не підключено — власник бота має надіслати /connect.',
  err_ai_not_eligible: 'Використання плану ChatGPT недоступне для цього акаунта.',
  err_ai_generic: 'Не вдалося проаналізувати, надішли ще раз.',
  walk_result: (p) => (p.done ? `✅ Прогулянку зараховано. Серія: <b>${p.streak}</b> 🔥` : '😴 Пропущено.'),
  cola_result: (p) => (p.clean ? `✅ Без коли. Серія: <b>${p.streak}</b> 🔥` : '🥤 Записано.'),
  notif_walk: (p) => `🚶 Час для 30-хвилинної прогулянки.${p.streak > 0 ? ` Серія: <b>${p.streak}</b> 🔥` : ''}`,
  notif_walk_snoozed: '⏰ Відкладати більше нікуди. 30 хвилин ходьби. Зараз.',
  btn_walked: '🚶 Прогулянка була',
  btn_skip: '😴 Пропустити',
  btn_snooze: (p) => (p.min < 60 ? `⏰ ${p.min} хв` : `⏰ ${p.min / 60} год`),
  walk_snoozed: (p) => `⏰ Відкладено до <b>${formatHHMM(p.minute)}</b>.`,
  snooze_too_late: 'Пізно відкладати — далі вже сон. Гуляй зараз або пропусти.',
  snooze_stale: 'Це нагадування за інший день.',
  walk_current: (p) =>
    [
      p.walkWork === null
        ? `🚶 Нагадування про прогулянку: <b>${formatHHMM(p.walkOff)}</b>`
        : `🚶 Нагадування про прогулянку: <b>${formatHHMM(p.walkWork)}</b> у робочі дні, <b>${formatHHMM(p.walkOff)}</b> у вихідні`,
      p.custom ? 'Встановлено тобою. <code>/walk auto</code> — знову після роботи.' : 'Змінити: <code>/walk 19:30</code>',
    ].join('\n'),
  walk_usage: 'Надішли <code>/walk 19:30</code>, щоб задати час, або <code>/walk auto</code> — за 30 хв після роботи.',
  walk_not_awake: 'Це поза часом, коли ти не спиш, — я б його ніколи не надіслав.',
  ob_training_days: 'У які дні тренуєшся? Натискай, щоб обрати, потім «Готово». У ці дні протеїновий шейк — норм (можна жодного).',
  training_prompt: 'Дні тренувань — натискай, щоб обрати, потім «Готово».',
  training_saved: (p) => `💪 Дні тренувань: <b>${p.days.length > 0 ? p.days.map((d) => UK_WD[d]).join(', ') : 'немає'}</b>`,
  cola_streak: (p) => `Днів без коли поспіль: <b>${p.streak}</b>`,
  notif_cola_check: 'Кола сьогодні була?',
  btn_cola_none: '✅ Ні',
  btn_cola_yes: '🥤 Так',
  notif_weigh_in: '⚖️ День зважування: після туалету, до їжі. Надішли число.',
  notif_no_meals: 'Надсилай фото всього, що сьогодні їси.',
  water_status: (p) => `💧 Вода сьогодні: <b>${p.ml}</b> / ${p.target} мл${p.ml >= p.target ? ' ✅' : ''}`,
  btn_water: (p) => `+${p.ml} мл`,
  water_logged: (p) => `💧 +${p.ml} мл`,
  water_usage: 'Надішли <code>/water 500</code>, щоб записати 500 мл, або тисни кнопку.',
  connect_hint: '🔗 Ще один крок: надішли /connect і увійди в ChatGPT, щоб я міг читати фото їжі — твої й усіх інших.',
  connect_start: [
    '🔗 <b>Вхід через твій ChatGPT</b>',
    '1. Тисни кнопку й дозволь використання плану ChatGPT.',
    '2. Браузер відкриє сторінку, що не завантажиться (<code>127.0.0.1</code>). Так і має бути.',
    '3. Скопіюй повну адресу цієї сторінки й надішли сюди.',
    '',
    'Посилання діє 15 хвилин. Фото всіх користувачів ідуть через цей один план ChatGPT.',
  ].join('\n'),
  btn_connect: 'Увійти через ChatGPT',
  connect_ok: (p) => `✅ ChatGPT підключено${p.email ? `: <b>${escapeHtml(p.email)}</b>` : ''}. Надсилай фото їжі.`,
  connect_err: (p) => CONNECT_ERR_UK[p.code],
  disconnect_ok: 'Ти вийшов(ла) з ChatGPT. /connect — щоб увійти знову.',
  disconnect_none: 'ChatGPT не підключено.',
  connect_owner_only: 'Підключенням ChatGPT керує лише власник бота.',
  usage: (p) =>
    usageText(p, {
      title: 'Використання ChatGPT',
      window: 'Останні 5 год',
      avg: 'У середньому на запит (7 дн.)',
      days: 'Останні 7 днів',
      users: 'По користувачах (7 дн.)',
      none: 'За останні 7 днів запитів не було.',
      req: 'запит.',
      you: 'ти',
      wd: UK_WD,
      note: 'Токени — як їх повертає API. Сам ліміт плану ChatGPT не відомий — порівнюй з chatgpt.com/settings/usage.',
    }),
  usage_owner_only: 'Використання бачить лише власник бота.',
};

export const messages = { en, uk } satisfies Record<Lang, Messages>;

type Key = keyof Messages;
type Args<K extends Key> = Messages[K] extends (p: infer P) => string ? [params: P] : [];

export function t<K extends Key>(lang: Lang, key: K, ...args: Args<K>): string {
  const m: unknown = messages[lang][key];
  return typeof m === 'function' ? m(args[0]) : String(m);
}
