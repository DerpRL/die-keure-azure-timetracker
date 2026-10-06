/**
 * Inline checks with the same rules, bounds and messages as Rust: `Configuration::validate`
 * (crates/att-core/src/config.rs), the `is_valid` of awareness, day review and targets, and
 * `Endpoint::seven_pace` / `Endpoint::azure` (crates/att-net/src/endpoint.rs). The engine stays
 * authoritative: Save still shows whatever it rejects with.
 */
import type {
  Cadences,
  Configuration,
  DayReviewPreferences,
  QuietHours,
  TargetException,
  WorkAwarenessPreferences,
  WorkTargets,
} from '../../ipc/contract';
import type { SettingsSectionId } from './sections';

export interface Bounds {
  min: number;
  max: number;
  step?: number;
}

/** `WorkAwarenessPreferences::MINUTES`. */
export const AWARENESS_MINUTES: Bounds = { min: 1, max: 120 };
/** `DayReviewPreferences::is_valid` (steps from the 1.14 steppers). */
export const LONG_SESSION_MINUTES: Bounds = { min: 30, max: 720, step: 30 };
export const GAP_MINUTES: Bounds = { min: 5, max: 180, step: 5 };
/** `TargetException::is_valid` and the per-weekday hours. */
export const TARGET_HOURS: Bounds = { min: 0, max: 24 };
/** `FigmaPreferences` (1.14 steppers). */
export const FIGMA_DISMISSAL_MINUTES: Bounds = { min: 0, max: 120 };
export const FIGMA_HISTORY_DAYS: Bounds = { min: 1, max: 365 };
/** `Cadences::PROBE` … `Cadences::UPDATE_CHECK`. */
export const CADENCE_BOUNDS: Record<keyof Cadences, Bounds> = {
  probeSeconds: { min: 1, max: 10 },
  calendarSeconds: { min: 15, max: 300 },
  progressSeconds: { min: 60, max: 3600 },
  updateCheckSeconds: { min: 60, max: 86_400 },
};
/** `POLL_CHOICES`: the 7pace refresh intervals Settings offers (seconds). */
export const POLL_CHOICES = [30, 60, 120, 300] as const;
/** Ticket numbers are positive 32-bit integers. */
export const MAX_TICKET = 2_147_483_647;
const MINUTES_PER_DAY = 24 * 60;

export const MESSAGES = {
  awareness: 'Choose idle and forgotten-timer thresholds between 1 and 120 minutes.',
  dayReview:
    'Day review needs a finish time after the workday start, at least one selected day, and valid gap/long-entry thresholds.',
  targets: 'Each daily target must be between 0 and 24 hours. Use 0 for a day off.',
  defaultTicket: 'Enter a valid default meeting ticket number, or leave it empty.',
  cadences: 'Choose polling intervals within the ranges shown in Settings.',
  quietHours: 'Choose quiet hours between 00:00 and 23:59.',
  sevenPaceUrl: 'Use your 7pace workspace URL: https://your-organization.timehub.7pace.com',
  organization: 'Enter the organization name from dev.azure.com/your-organization.',
} as const;

export type IssueField = keyof typeof MESSAGES;

export interface SettingsIssue {
  field: IssueField;
  section: SettingsSectionId;
  message: string;
}

const within = (value: number, { min, max }: Bounds) => Number.isFinite(value) && value >= min && value <= max;
const isInteger = (value: number) => Number.isInteger(value);

export function awarenessValid(preferences: WorkAwarenessPreferences): boolean {
  return (
    isInteger(preferences.idleMinutes) &&
    isInteger(preferences.forgottenMinutes) &&
    within(preferences.idleMinutes, AWARENESS_MINUTES) &&
    within(preferences.forgottenMinutes, AWARENESS_MINUTES)
  );
}

export interface DayReviewProblems {
  /** Start or finish outside the day, or finish not after start. */
  times: boolean;
  weekdays: boolean;
  longSession: boolean;
  gap: boolean;
}

export function dayReviewProblems(preferences: DayReviewPreferences): DayReviewProblems {
  const minute = (value: number) => isInteger(value) && value >= 0 && value < MINUTES_PER_DAY;
  return {
    times:
      !minute(preferences.startMinute) ||
      !minute(preferences.finishMinute) ||
      preferences.startMinute >= preferences.finishMinute,
    weekdays: preferences.weekdays.length === 0 || !preferences.weekdays.every((day) => day >= 1 && day <= 7),
    longSession: !within(preferences.longSessionMinutes, LONG_SESSION_MINUTES),
    gap: !within(preferences.gapMinutes, GAP_MINUTES),
  };
}

export function dayReviewValid(preferences: DayReviewPreferences): boolean {
  return !Object.values(dayReviewProblems(preferences)).some(Boolean);
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `TargetException::date`: a canonical, existing `yyyy-MM-dd` date in years 1–9999. */
export function exceptionDateValid(id: string): boolean {
  const match = DATE_KEY.exec(id);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year === 0 || month < 1 || month > 12 || day < 1) return false;
  const length = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= (month === 2 ? (leap ? 29 : 28) : length);
}

export function exceptionValid(exception: TargetException): boolean {
  return exceptionDateValid(exception.id) && within(exception.hours, TARGET_HOURS);
}

export function targetsValid(targets: WorkTargets): boolean {
  const exceptions = targets.dateExceptions ?? [];
  const unique = new Set(exceptions.map((item) => item.id));
  if (!exceptions.every(exceptionValid) || unique.size !== exceptions.length) return false;
  if (targets.hoursByWeekday) {
    return targets.hoursByWeekday.length === 7 && targets.hoursByWeekday.every((hours) => within(hours, TARGET_HOURS));
  }
  return within(targets.weeklyHours, { min: 1, max: 168 }) && within(targets.dailyHours, { min: 0.1, max: 24 });
}

export function defaultTicketValid(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  if (!/^[+-]?\d+$/.test(trimmed)) return false;
  const id = Number(trimmed);
  return id > 0 && id <= MAX_TICKET;
}

export function cadencesValid(cadences: Cadences): boolean {
  return (Object.keys(CADENCE_BOUNDS) as Array<keyof Cadences>).every(
    (key) => isInteger(cadences[key]) && within(cadences[key], CADENCE_BOUNDS[key]),
  );
}

export function quietHoursValid(quietHours: QuietHours): boolean {
  return quietHours.startMinute < MINUTES_PER_DAY && quietHours.endMinute < MINUTES_PER_DAY;
}

const SEVEN_PACE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.timehub\.7pace\.com$/;

/** `Endpoint::seven_pace`: `https://<organization>.timehub.7pace.com`, optionally with `/`. */
export function sevenPaceUrlValid(text: string): boolean {
  const match = /^https:\/\/([^/?#@]*)(\/?)$/.exec(text.trim());
  if (!match) return false;
  const authority = match[1] ?? '';
  const portMatch = /^(.*?)(?::(\d*))?$/.exec(authority);
  const host = (portMatch?.[1] ?? '').toLowerCase();
  const port = portMatch?.[2];
  const portOk = port === undefined || port === '' || Number(port) === 443;
  return portOk && SEVEN_PACE_HOST.test(host);
}

/** `Endpoint::azure`: the organization name from dev.azure.com/<organization>. */
export function organizationValid(text: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(text.trim());
}

export interface Secrets {
  azurePat: string;
  sevenPaceToken: string;
}

/**
 * Every problem Save would run into, in the order Rust checks them (`saveSettings` in 1.14 also
 * checked the workspace URL, the organization and the endpoints of new credentials).
 */
export function validateConfiguration(
  configuration: Configuration,
  secrets: Secrets = { azurePat: '', sevenPaceToken: '' },
): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const add = (field: IssueField, section: SettingsSectionId) => issues.push({ field, section, message: MESSAGES[field] });
  if (!awarenessValid(configuration.awareness)) add('awareness', 'awareness');
  if (!dayReviewValid(configuration.dayReview)) add('dayReview', 'dayReview');
  if (!targetsValid(configuration.targets)) add('targets', 'targets');
  if (!defaultTicketValid(configuration.meetings.defaultTicket)) add('defaultTicket', 'meetings');
  if (!cadencesValid(configuration.cadences)) add('cadences', 'advanced');
  if (!quietHoursValid(configuration.quietHours)) add('quietHours', 'notifications');
  const url = configuration.sevenPaceUrl.trim();
  const tokenNeedsUrl = secrets.sevenPaceToken.trim() !== '' && configuration.sevenPaceAuthMode !== 'mobilePIN';
  if ((url !== '' || tokenNeedsUrl) && !sevenPaceUrlValid(url)) add('sevenPaceUrl', 'connection');
  const organization = configuration.organization.trim();
  if ((organization !== '' || secrets.azurePat.trim() !== '') && !organizationValid(organization)) {
    add('organization', 'connection');
  }
  return issues;
}

/** The message for one field, if it has a problem. */
export function issueFor(issues: readonly SettingsIssue[], field: IssueField): string | undefined {
  return issues.find((issue) => issue.field === field)?.message;
}
