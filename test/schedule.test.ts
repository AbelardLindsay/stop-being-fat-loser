import { describe, expect, it } from 'vitest';
import { dueNotifications, dueWaterMinute, isAwake, localNow, waterMinutes, type ScheduleProfile } from '../src/schedule.ts';

describe('localNow', () => {
  it('converts to Kyiv local time', () => {
    expect(localNow(new Date('2026-11-20T16:00:00Z'), 'Europe/Kyiv')).toEqual({
      date: '2026-11-20',
      minute: 1080,
      isoWeekday: 5,
    });
  });
  it('rolls over to the next local day', () => {
    expect(localNow(new Date('2026-11-20T22:30:00Z'), 'Europe/Kyiv')).toEqual({
      date: '2026-11-21',
      minute: 30,
      isoWeekday: 6,
    });
  });
});

const office: ScheduleProfile = {
  workDays: [1, 2, 3, 4, 5],
  workStart: 540,
  workEnd: 1080,
  wake: 480,
  sleep: 1380,
  weighDay: 1,
  walkTime: null,
};

describe('dueNotifications', () => {
  it('walk 30 min after work on a work day', () => {
    expect(dueNotifications(office, { minute: 1110, isoWeekday: 5 })).toContain('walk');
    expect(dueNotifications(office, { minute: 1095, isoWeekday: 5 })).not.toContain('walk');
    expect(dueNotifications(office, { minute: 1170, isoWeekday: 5 })).not.toContain('walk');
  });
  it('walk 3 h after waking on a day off', () => {
    expect(dueNotifications(office, { minute: 660, isoWeekday: 6 })).toContain('walk');
  });
  it('weigh-in only on the weigh day', () => {
    expect(dueNotifications(office, { minute: 495, isoWeekday: 1 })).toContain('weigh_in');
    expect(dueNotifications(office, { minute: 495, isoWeekday: 2 })).not.toContain('weigh_in');
  });
  it('cola and no-meal reminders relative to sleep', () => {
    expect(dueNotifications(office, { minute: 1320, isoWeekday: 3 })).toContain('cola_check');
    expect(dueNotifications(office, { minute: 1260, isoWeekday: 3 })).toContain('no_meals');
    expect(dueNotifications(office, { minute: 900, isoWeekday: 3 })).toContain('cola_nudge');
  });
  it('handles sleep past midnight', () => {
    const owl: ScheduleProfile = { ...office, wake: 540, sleep: 60 };
    expect(isAwake(30, owl.wake, owl.sleep)).toBe(true);
    expect(isAwake(180, owl.wake, owl.sleep)).toBe(false);
    expect(dueNotifications(owl, { minute: 0, isoWeekday: 3 })).toContain('cola_check');
  });
  it('never sends a walk scheduled after bedtime', () => {
    const late: ScheduleProfile = { ...office, workEnd: 1365, sleep: 1380 };
    for (let minute = 0; minute < 1440; minute += 15) {
      expect(dueNotifications(late, { minute, isoWeekday: 2 })).not.toContain('walk');
    }
  });
  it('uses a custom walk time on every day', () => {
    const custom: ScheduleProfile = { ...office, walkTime: 1170 };
    expect(dueNotifications(custom, { minute: 1170, isoWeekday: 2 })).toContain('walk');
    expect(dueNotifications(custom, { minute: 1110, isoWeekday: 2 })).not.toContain('walk');
    expect(dueNotifications(custom, { minute: 1170, isoWeekday: 6 })).toContain('walk');
  });
  it('sends the weekly summary on Sunday 30 min before sleep only', () => {
    expect(dueNotifications(office, { minute: 1350, isoWeekday: 7 })).toContain('weekly_summary');
    expect(dueNotifications(office, { minute: 1350, isoWeekday: 6 })).not.toContain('weekly_summary');
  });
  it('reminds about water every 2 h, not in the last hour before sleep', () => {
    expect(waterMinutes(480, 1380)).toEqual([600, 720, 840, 960, 1080, 1200, 1320]);
    expect(dueWaterMinute(office, 610)).toBe(600);
    expect(dueWaterMinute(office, 690)).toBeNull();
    expect(waterMinutes(1200, 300)).toEqual([1320, 0, 120, 240]);
  });
});
