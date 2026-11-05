/**
 * The Settings save model (1.14 `SettingsPage` + `AppModel.saveSettings`): the form edits a draft
 * copy of `settings.configuration`; Save sends the whole configuration. Fields that apply
 * immediately through their own intents are never taken from the draft.
 */
import type { Configuration } from '../../ipc/contract';

/**
 * Applied immediately (appearance, Figma, interruptions, quiet hours, onboarding) or owned by
 * another page (repositories). Save always sends the latest slice values for these, so an older
 * draft never overwrites them (1.14 copied `figma`, `interface` and `interfaceSetupCompleted`
 * from the model, and `repositories` from the current configuration).
 */
export const IMMEDIATE_FIELDS = [
  'interface',
  'figma',
  'interruptions',
  'quietHours',
  'interfaceSetupCompleted',
  'repositories',
] as const satisfies ReadonlyArray<keyof Configuration>;

type ImmediateField = (typeof IMMEDIATE_FIELDS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON values (the configuration is plain JSON). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  // `undefined` and a missing key are the same thing in JSON.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Three-way merge of a draft with a newer slice value: keeps what the user changed (`mine`
 * differs from `base`) and takes every other value from `theirs`. Objects merge per key, lists
 * and scalars as a whole; when both sides changed the same value, the user's edit wins.
 */
export function mergeUnderneath<T>(base: T, mine: T, theirs: T): T {
  if (deepEqual(mine, base)) return theirs;
  if (deepEqual(theirs, base) || deepEqual(theirs, mine)) return mine;
  if (isPlainObject(base) && isPlainObject(mine) && isPlainObject(theirs)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    for (const key of keys) {
      const merged = mergeUnderneath(base[key], mine[key], theirs[key]);
      if (merged !== undefined) result[key] = merged;
    }
    return result as T;
  }
  return mine;
}

function withImmediateFrom(target: Configuration, source: Configuration): Configuration {
  const result: Configuration = { ...target };
  for (const field of IMMEDIATE_FIELDS) {
    (result as Record<ImmediateField, unknown>)[field] = source[field];
  }
  return result;
}

/** The draft's own fields only: what Save and Revert are about. */
export function draftFields(configuration: Configuration): Omit<Configuration, ImmediateField> {
  const result: Record<string, unknown> = { ...configuration };
  for (const field of IMMEDIATE_FIELDS) delete result[field];
  return result as Omit<Configuration, ImmediateField>;
}

const sorted = <T extends string | number>(values: readonly T[]): T[] =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The draft's own fields in a form where equal settings compare equal: lists that are really
 * sets (switching a calendar, page, weekday or work app off and on again appends it at the end)
 * are sorted, and a blank quick-switch shortcut is the default, like `null`.
 */
function comparable(configuration: Configuration): Omit<Configuration, ImmediateField> {
  const fields = draftFields(configuration);
  return {
    ...fields,
    selectedCalendarIds: sorted(fields.selectedCalendarIds),
    hiddenPages: sorted(fields.hiddenPages),
    dayReview: { ...fields.dayReview, weekdays: sorted(fields.dayReview.weekdays) },
    awareness: { ...fields.awareness, workAppIds: sorted(fields.awareness.workAppIds) },
    microphone: { ...fields.microphone, apps: sorted(fields.microphone.apps) },
    quickSwitchShortcut: fields.quickSwitchShortcut?.trim() ? fields.quickSwitchShortcut : null,
  };
}

/**
 * The draft differs from the stored configuration in a field Save would write: what decides
 * whether Settings asks to save. Undoing an edit makes them equal again.
 */
export function hasDraftChanges(draft: Configuration, stored: Configuration): boolean {
  return !deepEqual(comparable(draft), comparable(stored));
}

/** What each draft field is called in the save bar ("2 unsaved changes · Friday target, Workday"). */
const FIELD_NAMES: Partial<Record<keyof Configuration, string>> = {
  organization: 'Azure organization',
  project: 'Azure project',
  sevenPaceUrl: '7pace workspace',
  sevenPaceAuthMode: '7pace sign-in',
  branchPattern: 'Ticket number pattern',
  autoStartWhenIdle: 'Activity on branch change',
  notificationsEnabled: 'Notifications',
  watchEnabled: 'Git branch watching',
  calendarEnabled: 'Calendar on Today',
  selectedCalendarIds: 'Calendars',
  activityTypeId: 'Default activity',
  pollSeconds: 'Timer status interval',
  microphone: 'Call detection',
  meetings: 'Calendar meetings',
  completionReminders: 'Ticket closed reminders',
  automaticUpdateChecks: 'Automatic update checks',
  quickSwitchEnabled: 'Quick switch',
  quickSwitchShortcut: 'Quick switch shortcut',
  awareness: 'Time awareness',
  cadences: 'Sync intervals',
  hiddenPages: 'Features',
  miniTimer: 'Mini timer',
  roundToQuarterHours: 'Quarter-hour rounding',
  resumeAfterMeetings: 'Resume after meetings',
  menuBarTimer: 'Menu-bar timer',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The names of the settings the draft changes, in Settings order, for the save bar. Fields
 * without a name of their own are counted under their card's name.
 */
export function draftChanges(draft: Configuration, stored: Configuration): string[] {
  const mine = comparable(draft);
  const theirs = comparable(stored);
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };
  for (const key of Object.keys(mine) as Array<keyof typeof mine>) {
    if (deepEqual(mine[key], theirs[key])) continue;
    if (key === 'targets') {
      const days = mine.targets.minutesByWeekday;
      // Monday first, like the weekly target grid.
      for (const index of [1, 2, 3, 4, 5, 6, 0]) {
        if (days[index] !== theirs.targets.minutesByWeekday[index]) add(`${DAY_NAMES[index]} target`);
      }
      if (mine.targets.belgianHolidaysEnabled !== theirs.targets.belgianHolidaysEnabled) add('Public holidays');
      if (!deepEqual(mine.targets.dateExceptions ?? [], theirs.targets.dateExceptions ?? [])) add('Days off & exceptions');
    } else if (key === 'dayReview') {
      const { startMinute, finishMinute, ...rest } = mine.dayReview;
      const { startMinute: savedStart, finishMinute: savedFinish, ...savedRest } = theirs.dayReview;
      if (startMinute !== savedStart || finishMinute !== savedFinish) add('Workday');
      if (!deepEqual(rest, savedRest)) add('Day review');
    } else {
      add(FIELD_NAMES[key as keyof Configuration] ?? String(key));
    }
  }
  return names;
}

export interface DraftState {
  /** The slice value the draft was last reconciled with. */
  base: Configuration;
  draft: Configuration;
}

/**
 * Reconciles a draft with a new slice value. An unchanged draft simply takes the new values; an
 * edited one keeps the user's changes and takes everything else from the slice. Immediate
 * fields always follow the slice.
 */
export function rebaseDraft({ base, draft }: DraftState, incoming: Configuration): DraftState {
  if (!hasDraftChanges(draft, base)) return { base: incoming, draft: incoming };
  const merged = withImmediateFrom(mergeUnderneath(base, draft, incoming), incoming);
  // The new value already contains the edits (for example after a successful save).
  if (!hasDraftChanges(merged, incoming)) return { base: incoming, draft: incoming };
  return { base: incoming, draft: merged };
}

/** What `settings.save` sends: the draft, with the latest values of the immediate fields. */
export function configurationToSave(draft: Configuration, latest: Configuration): Configuration {
  return withImmediateFrom(draft, latest);
}
