import { Api, InlineKeyboard } from 'grammy';
import {
  checkinsOn,
  claimNotification,
  claimWalkSnooze,
  hasMealOn,
  hasWeightOn,
  listOnboardedUsers,
  streak,
  waterOn,
  walkIgnoredTwoDays,
  type User,
} from './db.ts';
import type { Env } from './env.ts';
import { escapeHtml, t, type Lang } from './i18n.ts';
import { getAccount, ownerId } from './openai.ts';
import { completeProfile, userWaterTarget } from './profile.ts';
import { pickRoast, type RoastKind } from './roasts.ts';
import { dueNotifications, dueWaterMinute, localNow, type LocalNow, type NotificationKind } from './schedule.ts';
import { buildWeekSummary } from './stats.ts';

const HTML = { parse_mode: 'HTML' } as const;
const WATER_BUTTONS_ML = [250, 500, 750];
/** Roast when water is below this share of where it should be by now. */
const WATER_BEHIND_SHARE = 0.6;

function walkKeyboard(lang: Lang, date: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn_walked'), `walk:done:${date}`)
    .text(t(lang, 'btn_skip'), `walk:skip:${date}`)
    .row()
    .text(t(lang, 'btn_snooze', { min: 30 }), `walk:snooze:${date}:30`)
    .text(t(lang, 'btn_snooze', { min: 60 }), `walk:snooze:${date}:60`);
}

/** `water:<ml>:<date>` buttons; the date is the local day the water counts for. */
export function waterKeyboard(lang: Lang, date: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const ml of WATER_BUTTONS_ML) kb.text(t(lang, 'btn_water', { ml }), `water:${ml}:${date}`);
  return kb;
}

export async function runNotifications(env: Env, now: Date): Promise<void> {
  const api = new Api(env.TELEGRAM_BOT_TOKEN);
  for (const user of await listOnboardedUsers(env.DB)) {
    try {
      await notifyUser(env, api, user, now);
    } catch (err) {
      console.error('notifications failed for user', user.telegram_id, err);
    }
  }
}

async function notifyUser(env: Env, api: Api, u: User, now: Date): Promise<void> {
  const local = localNow(now, u.timezone);
  const db = env.DB;
  await resendSnoozedWalk(env, api, u, local);
  await alertReauth(env, api, u, local);
  await remindWater(env, api, u, local);
  const due = dueNotifications(completeProfile(u).schedule, local);
  if (due.length === 0) return;
  const checks = await checkinsOn(db, u.telegram_id, local.date);

  for (const kind of due) {
    try {
      if (kind === 'walk' && checks.walk) continue;
      if (kind === 'cola_check' && checks.cola) continue;
      if (kind === 'weigh_in' && (await hasWeightOn(db, u.telegram_id, local.date))) continue;
      if (
        kind === 'no_meals' &&
        ((await hasMealOn(db, u.telegram_id, local.date)) ||
          (u.onboarded_at !== null && localNow(new Date(u.onboarded_at * 1000), u.timezone).date === local.date))
      ) {
        continue;
      }
      // Claim before sending so overlapping ticks never double-send.
      if (!(await claimNotification(db, u.telegram_id, kind, local.date))) continue;
      await send(env, api, u, kind, local);
    } catch (err) {
      console.error('notification failed', u.telegram_id, kind, err);
    }
  }
}

/** Re-sends a snoozed walk reminder once its time has come, unless the walk was already answered. */
async function resendSnoozedWalk(env: Env, api: Api, u: User, local: LocalNow): Promise<void> {
  const minute = u.walk_snooze_minute;
  if (u.walk_snooze_date !== local.date || minute === null || local.minute < minute) return;
  if (!(await claimWalkSnooze(env.DB, u.telegram_id, local.date, minute))) return;
  if ((await checkinsOn(env.DB, u.telegram_id, local.date)).walk) return;
  const roast = escapeHtml(pickRoast(u.language, 'walk_snooze', u.sex ?? 'male'));
  await api.sendMessage(u.chat_id, `${roast}\n\n${t(u.language, 'notif_walk_snoozed')}`, {
    ...HTML,
    reply_markup: walkKeyboard(u.language, local.date),
  });
}

/** Once per local day, tells the owner that the shared ChatGPT sign-in expired and needs /connect. */
async function alertReauth(env: Env, api: Api, u: User, local: LocalNow): Promise<void> {
  if (u.telegram_id !== ownerId(env)) return;
  if ((await getAccount(env, u.telegram_id))?.status !== 'reauth_required') return;
  if (!(await claimNotification(env.DB, u.telegram_id, 'openai_reauth', local.date))) return;
  await api.sendMessage(u.chat_id, t(u.language, 'err_ai_reauth'), HTML);
}

/** Every 2 h while awake, until today's water target is reached; roasts when far behind pace. */
async function remindWater(env: Env, api: Api, u: User, local: LocalNow): Promise<void> {
  const schedule = completeProfile(u).schedule;
  const minute = dueWaterMinute(schedule, local.minute);
  if (minute === null) return;
  const target = userWaterTarget(u, local.date);
  const ml = await waterOn(env.DB, u.telegram_id, local.date);
  if (ml >= target) return;
  if (!(await claimNotification(env.DB, u.telegram_id, `water_${minute}`, local.date))) return;
  const awake = (schedule.sleep - schedule.wake + 1440) % 1440;
  const elapsed = (minute - schedule.wake + 1440) % 1440;
  const behind = ml < WATER_BEHIND_SHARE * target * (elapsed / awake);
  const lead = behind ? `${escapeHtml(pickRoast(u.language, 'water_low', u.sex ?? 'male'))}\n\n` : '';
  await api.sendMessage(u.chat_id, lead + t(u.language, 'water_status', { ml, target }), {
    ...HTML,
    reply_markup: waterKeyboard(u.language, local.date),
  });
}

async function send(env: Env, api: Api, u: User, kind: NotificationKind, local: LocalNow): Promise<void> {
  const db = env.DB;
  const lang = u.language;
  const roast = (k: RoastKind) => escapeHtml(pickRoast(lang, k, u.sex ?? 'male'));

  switch (kind) {
    case 'walk': {
      const n = await streak(db, u.telegram_id, 'walk', 'done', local.date);
      const lead = (await walkIgnoredTwoDays(db, u.telegram_id, local.date)) ? `${roast('inactivity')}\n\n` : '';
      await api.sendMessage(u.chat_id, lead + t(lang, 'notif_walk', { streak: n }), {
        ...HTML,
        reply_markup: walkKeyboard(lang, local.date),
      });
      return;
    }
    case 'cola_nudge': {
      const n = await streak(db, u.telegram_id, 'cola', 'clean', local.date);
      await api.sendMessage(u.chat_id, `${roast('cola_nudge')}\n\n${t(lang, 'cola_streak', { streak: n })}`, HTML);
      return;
    }
    case 'cola_check':
      await api.sendMessage(u.chat_id, t(lang, 'notif_cola_check'), {
        ...HTML,
        reply_markup: new InlineKeyboard()
          .text(t(lang, 'btn_cola_none'), `cola:clean:${local.date}`)
          .text(t(lang, 'btn_cola_yes'), `cola:drank:${local.date}`),
      });
      return;
    case 'weigh_in':
      await api.sendMessage(u.chat_id, t(lang, 'notif_weigh_in'), HTML);
      return;
    case 'no_meals':
      await api.sendMessage(u.chat_id, `${roast('no_meals')}\n\n${t(lang, 'notif_no_meals')}`, HTML);
      return;
    case 'weekly_summary': {
      const { params, bad } = await buildWeekSummary(db, u, local.date);
      const verdict = bad ? roast('week_bad') : t(lang, 'week_good');
      await api.sendMessage(u.chat_id, `${t(lang, 'week_summary', params)}\n\n${verdict}`, HTML);
      return;
    }
  }
}
