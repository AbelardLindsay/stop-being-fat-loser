const DAY = 1440;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface LocalNow {
  date: string;
  minute: number;
  isoWeekday: number;
}

export function localNow(date: Date, tz: string): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    isoWeekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Shifts a YYYY-MM-DD calendar date by `n` days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (Mon = 1 … Sun = 7) of a YYYY-MM-DD calendar date. */
export function isoWeekdayOf(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function parseRange(s: string): [number, number] | null {
  const m = /^\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*$/.exec(s);
  if (!m) return null;
  const start = parseHHMM(m[1]!);
  const end = parseHHMM(m[2]!);
  return start === null || end === null ? null : [start, end];
}

export function formatHHMM(minute: number): string {
  const m = ((minute % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** True when `minute` is in [wake, sleep), wrapping past midnight when sleep < wake. */
export function isAwake(minute: number, wake: number, sleep: number): boolean {
  return wake < sleep ? minute >= wake && minute < sleep : minute >= wake || minute < sleep;
}

export type NotificationKind = 'walk' | 'cola_nudge' | 'cola_check' | 'weigh_in' | 'no_meals' | 'weekly_summary';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'walk',
  'cola_nudge',
  'cola_check',
  'weigh_in',
  'no_meals',
  'weekly_summary',
];

export interface ScheduleProfile {
  workDays: number[];
  workStart: number | null;
  workEnd: number | null;
  wake: number;
  sleep: number;
  weighDay: number;
  /** User-set walk minute; null = 30 min after work on work days, 3 h after waking otherwise. */
  walkTime: number | null;
}

/** 21:00: the weekly summary goes out on Sunday evening. */
const WEEKLY_SUMMARY_MINUTE = 1260;

/** Single source of reminder timing. Returns minute of day, or null when the kind doesn't run that day. */
export function scheduledMinute(kind: NotificationKind, p: ScheduleProfile, isoWeekday: number): number | null {
  let s: number;
  switch (kind) {
    case 'walk':
      if (p.walkTime !== null) s = p.walkTime;
      else s = p.workDays.includes(isoWeekday) && p.workEnd !== null ? p.workEnd + 30 : p.wake + 180;
      break;
    case 'cola_nudge':
      s = 900;
      break;
    case 'cola_check':
      s = p.sleep - 60;
      break;
    case 'no_meals':
      s = p.sleep - 120;
      break;
    case 'weigh_in':
      if (isoWeekday !== p.weighDay) return null;
      s = p.wake + 15;
      break;
    case 'weekly_summary':
      if (isoWeekday !== 7) return null;
      // 21:00, or 30 min before an earlier bedtime; a bedtime past midnight never pulls it to the start of Sunday.
      s =
        isAwake(WEEKLY_SUMMARY_MINUTE, p.wake, p.sleep) && (p.sleep < p.wake || p.sleep - 30 >= WEEKLY_SUMMARY_MINUTE)
          ? WEEKLY_SUMMARY_MINUTE
          : p.sleep - 30;
      break;
  }
  return ((s % DAY) + DAY) % DAY;
}

const WATER_INTERVAL = 120;
/** No water reminder in the last hour before sleep. */
const WATER_QUIET_BEFORE_SLEEP = 60;

/** Water reminders: every 2 h after waking, the last one at least 1 h before sleep. */
export function waterMinutes(wake: number, sleep: number): number[] {
  const awake = (((sleep - wake) % DAY) + DAY) % DAY;
  const out: number[] = [];
  for (let offset = WATER_INTERVAL; offset <= awake - WATER_QUIET_BEFORE_SLEEP; offset += WATER_INTERVAL) {
    out.push((wake + offset) % DAY);
  }
  return out;
}

/** The water reminder minute due now (same 60-minute window as other reminders), or null. */
export function dueWaterMinute(p: ScheduleProfile, minute: number): number | null {
  return waterMinutes(p.wake, p.sleep).find((s) => s <= minute && minute < s + 60) ?? null;
}

export function dueNotifications(p: ScheduleProfile, now: { minute: number; isoWeekday: number }): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((kind) => {
    const s = scheduledMinute(kind, p, now.isoWeekday);
    return s !== null && isAwake(s, p.wake, p.sleep) && s <= now.minute && now.minute < s + 60;
  });
}
