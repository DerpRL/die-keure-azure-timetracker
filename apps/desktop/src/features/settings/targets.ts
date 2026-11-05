/**
 * Editing helpers for `WorkTargets`, mirroring crates/att-core/src/targets.rs and holidays.rs so
 * the draft is shaped exactly as Rust writes it. Display only: the engine computes progress.
 */
import type { TargetException, TargetExceptionKind, WorkTargets } from '../../ipc/contract';
import { formatMinutes } from '../../utils/duration';

/** Swift weekday numbers (1 = Sunday … 7 = Saturday) in the Monday-first order Settings shows. */
export const WEEKDAYS_MONDAY_FIRST = [2, 3, 4, 5, 6, 7, 1] as const;

export const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Sunday',
  2: 'Monday',
  3: 'Tuesday',
  4: 'Wednesday',
  5: 'Thursday',
  6: 'Friday',
  7: 'Saturday',
};

export const EXCEPTION_KINDS: readonly TargetExceptionKind[] = [
  'Full-day leave',
  'Half-day leave',
  'Replacement holiday',
  'Custom target',
];

/** `MAX_DAILY_MINUTES`: a day's target is 0 to 24 hours. */
export const MAX_DAILY_MINUTES = 24 * 60;

/** The steppers and arrow keys move a target by a quarter hour. */
export const TARGET_STEP_MINUTES = 15;

/** `WorkTargets::minutes`: regular minutes for a Swift weekday. */
export function targetMinutes(targets: WorkTargets, weekday: number): number {
  if (weekday < 1 || weekday > 7) return 0;
  return targets.minutesByWeekday[weekday - 1] ?? 0;
}

/** `WorkTargets::set_minutes`: sets one weekday's regular minutes. */
export function setTargetMinutes(targets: WorkTargets, minutes: number, weekday: number): WorkTargets {
  if (weekday < 1 || weekday > 7) return targets;
  const schedule = [1, 2, 3, 4, 5, 6, 7].map((day) => targetMinutes(targets, day));
  schedule[weekday - 1] = minutes;
  return { ...targets, minutesByWeekday: schedule };
}

/** `WorkTargets::weekly_target_minutes`. */
export function weeklyTargetMinutes(targets: WorkTargets): number {
  return targets.minutesByWeekday.reduce((total, value) => total + value, 0);
}

export interface TargetPreset {
  id: string;
  label: string;
  /** Minutes per weekday, Sunday first (`minutesByWeekday`). */
  minutesByWeekday: readonly number[];
}

/** Schedules Settings fills in with one press: the 1.14 preset and the 2.x default. */
export const TARGET_PRESETS: readonly TargetPreset[] = [
  { id: 'fourDays', label: 'Mon–Thu 8h, Fri 6h', minutesByWeekday: [0, 480, 480, 480, 480, 360, 0] },
  { id: 'fiveDays', label: '5 × 7h 36m', minutesByWeekday: [0, 456, 456, 456, 456, 456, 0] },
];

export function applyPreset(targets: WorkTargets, preset: TargetPreset): WorkTargets {
  return { ...targets, minutesByWeekday: [...preset.minutesByWeekday] };
}

/** Whether the weekly schedule is exactly a preset's. */
export function matchesPreset(targets: WorkTargets, preset: TargetPreset): boolean {
  return preset.minutesByWeekday.every((minutes, index) => targets.minutesByWeekday[index] === minutes);
}

export function usesBelgianHolidays(targets: WorkTargets): boolean {
  return targets.belgianHolidaysEnabled ?? true;
}

/** `formatMinutes` for decimal hours (date exceptions), rounded to the nearest minute. */
export function formatHours(hours: number): string {
  return formatMinutes(hours * 60);
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function dateKey({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toUtc({ year, month, day }: CivilDate): Date {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date;
}

function fromUtc(date: Date): CivilDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addDays(date: CivilDate, days: number): CivilDate {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtc(utc);
}

/** Swift weekday number of a civil date (1 = Sunday). */
export function weekdayOf(date: CivilDate): number {
  return toUtc(date).getUTCDay() + 1;
}

export interface BelgianHoliday {
  date: CivilDate;
  name: string;
}

/** `BelgianHoliday::all`: the ten federal holidays of `year`, sorted by date (Meeus computus). */
export function belgianHolidays(year: number): BelgianHoliday[] {
  if (year < 1583 || year > 9999) return [];
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter: CivilDate = {
    year,
    month: Math.floor((h + l - 7 * m + 114) / 31),
    day: ((h + l - 7 * m + 114) % 31) + 1,
  };
  const day = (month: number, dayOfMonth: number): CivilDate => ({ year, month, day: dayOfMonth });
  const holidays: BelgianHoliday[] = [
    { date: day(1, 1), name: 'New Year’s Day' },
    { date: day(5, 1), name: 'Labour Day' },
    { date: day(7, 21), name: 'Belgian National Day' },
    { date: day(8, 15), name: 'Assumption' },
    { date: day(11, 1), name: 'All Saints’ Day' },
    { date: day(11, 11), name: 'Armistice Day' },
    { date: day(12, 25), name: 'Christmas Day' },
    { date: addDays(easter, 1), name: 'Easter Monday' },
    { date: addDays(easter, 39), name: 'Ascension Day' },
    { date: addDays(easter, 50), name: 'Whit Monday' },
  ];
  // Stable sort, so a fixed holiday stays before a movable one on the same date.
  return holidays.sort((x, y) => dateKey(x.date).localeCompare(dateKey(y.date)));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 1 January", as the 1.14 holiday list; `short`: "Mon 1 Jan". */
export function formatHolidayDate(date: CivilDate, style: 'long' | 'short' = 'long'): string {
  const month = MONTHS[date.month - 1] ?? '';
  return `${SHORT_WEEKDAYS[weekdayOf(date) - 1] ?? ''} ${date.day} ${style === 'short' ? month.slice(0, 3) : month}`;
}

/** Every day from `start` through `end` (inclusive), at most 367 days, like 1.14. */
export function daysBetween(start: CivilDate, end: CivilDate): CivilDate[] {
  const from = toUtc(start).getTime();
  const to = toUtc(end).getTime();
  if (to < from || to - from >= 367 * 86_400_000) return [];
  const days: CivilDate[] = [];
  for (let current = start; toUtc(current).getTime() <= to; current = addDays(current, 1)) days.push(current);
  return days;
}

/** "Add / replace dates": replaces exceptions on the same days, then appends the new ones. */
export function addExceptions(targets: WorkTargets, additions: readonly TargetException[]): WorkTargets {
  const keys = new Set(additions.map((item) => item.id));
  const kept = (targets.dateExceptions ?? []).filter((item) => !keys.has(item.id));
  return { ...targets, dateExceptions: [...kept, ...additions] };
}

export function removeException(targets: WorkTargets, id: string): WorkTargets {
  return { ...targets, dateExceptions: (targets.dateExceptions ?? []).filter((item) => item.id !== id) };
}
