import { describe, expect, it } from 'vitest';
import type { Configuration } from '../../ipc/contract';
import { defaultConfiguration } from '../../ipc/fixtures/defaults';
import { configuredSettings, invalidConfiguration } from '../../ipc/fixtures/slices/settings';
import { ACCOUNT_DEFAULTS, accountSetupUnfinished, withAccountDefaults } from './accountDefaults';
import { configurationToSave, deepEqual, hasDraftChanges, mergeUnderneath, rebaseDraft } from './configDraft';
import { FEATURES, pageShown, setPageShown } from './features';
import { formatMinutes, stepDuration } from '../../utils/duration';
import { parseSettingsHash } from './sections';
import {
  addExceptions,
  applyPreset,
  matchesPreset,
  TARGET_PRESETS,
  belgianHolidays,
  daysBetween,
  dateKey,
  formatHours,
  MAX_DAILY_MINUTES,
  setTargetMinutes,
  TARGET_STEP_MINUTES,
  targetMinutes,
  weeklyTargetMinutes,
} from './targets';
import {
  cadencesValid,
  dayReviewValid,
  defaultTicketValid,
  MESSAGES,
  organizationValid,
  sevenPaceUrlValid,
  targetsValid,
  validateConfiguration,
} from './validation';

const stored = configuredSettings.configuration;

describe('account defaults', () => {
  it('are die Keure’s accounts, in one place', () => {
    expect(ACCOUNT_DEFAULTS).toEqual({
      organization: 'diekeure-webdev',
      project: 'LK2020',
      sevenPaceUrl: 'https://diekeure-webdev.timehub.7pace.com',
    });
  });

  it('fill every empty account field while nothing is saved', () => {
    const empty = defaultConfiguration();
    expect(accountSetupUnfinished(empty)).toBe(true);
    expect(withAccountDefaults(empty)).toEqual({ ...empty, ...ACCOUNT_DEFAULTS });
    expect(withAccountDefaults({ ...empty, project: 'Other' })).toEqual({ ...empty, ...ACCOUNT_DEFAULTS, project: 'Other' });
  });

  it('keep saved values: after Test and save only the 7pace workspace is suggested', () => {
    const azureSaved = { ...defaultConfiguration(), organization: 'fabrikam', project: '' };
    expect(withAccountDefaults(azureSaved)).toEqual({ ...azureSaved, sevenPaceUrl: ACCOUNT_DEFAULTS.sevenPaceUrl });
  });

  it('suggest nothing once 7pace is set up, so an empty organization or project stays empty', () => {
    expect(withAccountDefaults(stored)).toBe(stored);
    const noProject = { ...stored, project: '' };
    expect(accountSetupUnfinished(noProject)).toBe(false);
    expect(withAccountDefaults(noProject)).toBe(noProject);
    const sevenPaceOnly = { ...stored, organization: '', project: '' };
    expect(withAccountDefaults(sevenPaceOnly)).toBe(sevenPaceOnly);
  });
});

describe('draft model', () => {
  it('sees no change when a set-like list only changed order, or a blank shortcut became null', () => {
    const reordered: Configuration = {
      ...stored,
      selectedCalendarIds: [...stored.selectedCalendarIds, 'a', 'b'],
      hiddenPages: ['weeklyReport', 'offlineDrafts'],
      dayReview: { ...stored.dayReview, weekdays: [5, 1, 2, 3, 4] },
    };
    const original: Configuration = {
      ...stored,
      selectedCalendarIds: ['b', ...stored.selectedCalendarIds, 'a'],
      hiddenPages: ['offlineDrafts', 'weeklyReport'],
      dayReview: { ...stored.dayReview, weekdays: [1, 2, 3, 4, 5] },
    };
    expect(hasDraftChanges(reordered, original)).toBe(false);
    expect(hasDraftChanges({ ...original, hiddenPages: ['offlineDrafts'] }, original)).toBe(true);
    expect(hasDraftChanges({ ...stored, quickSwitchShortcut: '' }, { ...stored, quickSwitchShortcut: null })).toBe(false);
    expect(hasDraftChanges({ ...stored, quickSwitchShortcut: 'Ctrl+K' }, { ...stored, quickSwitchShortcut: null })).toBe(true);
  });

  it('treats undefined and missing keys as equal, and compares lists in order', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: { b: [1] } }, { a: { b: [1] } })).toBe(true);
  });

  it('keeps the user’s edits and takes every other value from a newer slice', () => {
    const base = { name: 'a', nested: { x: 1, y: 2 }, list: [1] };
    const mine = { name: 'mine', nested: { x: 1, y: 3 }, list: [1] };
    const theirs = { name: 'a', nested: { x: 9, y: 2 }, list: [1, 2] };
    expect(mergeUnderneath(base, mine, theirs)).toEqual({ name: 'mine', nested: { x: 9, y: 3 }, list: [1, 2] });
  });

  it('replaces an unchanged draft with the new slice value', () => {
    const incoming: Configuration = { ...stored, organization: 'fabrikam' };
    expect(rebaseDraft({ base: stored, draft: stored }, incoming)).toEqual({ base: incoming, draft: incoming });
  });

  it('always takes immediate settings from the slice, even under an edited draft', () => {
    const draft: Configuration = { ...stored, project: 'Checkout', quietHours: { enabled: false, startMinute: 0, endMinute: 0 } };
    const incoming: Configuration = {
      ...stored,
      interface: { theme: 'dark', scale: 125, contrast: 'increased' },
      figma: { ...stored.figma, enabled: true },
      quietHours: { enabled: true, startMinute: 1080, endMinute: 480 },
      repositories: [],
    };
    const next = rebaseDraft({ base: stored, draft }, incoming);
    expect(next.draft.project).toBe('Checkout');
    expect(next.draft.interface).toEqual(incoming.interface);
    expect(next.draft.figma.enabled).toBe(true);
    expect(next.draft.quietHours).toEqual(incoming.quietHours);
    expect(next.draft.repositories).toEqual([]);
    expect(hasDraftChanges(next.draft, next.base)).toBe(true);
  });

  it('becomes clean when the slice catches up with the edits', () => {
    const draft: Configuration = { ...stored, project: 'Checkout' };
    expect(rebaseDraft({ base: stored, draft }, { ...draft })).toEqual({ base: draft, draft });
  });

  it('saves the draft with the latest immediate values', () => {
    const latest: Configuration = { ...stored, interface: { theme: 'light', scale: 90, contrast: 'standard' } };
    const draft: Configuration = { ...stored, project: 'Checkout', interface: { theme: 'dark', scale: 150, contrast: 'system' } };
    expect(configurationToSave(draft, latest)).toEqual({ ...draft, interface: latest.interface });
  });
});

describe('validation (Configuration::validate)', () => {
  it('accepts the Rust defaults and the sample configuration', () => {
    expect(validateConfiguration(defaultConfiguration())).toEqual([]);
    expect(validateConfiguration(stored)).toEqual([]);
  });

  it('reports every broken rule with the Rust message, in Rust order', () => {
    expect(validateConfiguration(invalidConfiguration).map((issue) => issue.message)).toEqual([
      MESSAGES.awareness,
      MESSAGES.dayReview,
      MESSAGES.defaultTicket,
      MESSAGES.sevenPaceUrl,
    ]);
  });

  it('checks the cadence bounds', () => {
    const cadences = stored.cadences;
    expect(cadencesValid({ ...cadences, probeSeconds: 11 })).toBe(false);
    expect(cadencesValid({ ...cadences, calendarSeconds: 14 })).toBe(false);
    expect(cadencesValid({ ...cadences, progressSeconds: 3600 })).toBe(true);
    expect(cadencesValid({ ...cadences, updateCheckSeconds: 86_401 })).toBe(false);
  });

  it('checks day review times, days and thresholds', () => {
    const review = stored.dayReview;
    expect(dayReviewValid(review)).toBe(true);
    expect(dayReviewValid({ ...review, finishMinute: review.startMinute })).toBe(false);
    expect(dayReviewValid({ ...review, weekdays: [] })).toBe(false);
    expect(dayReviewValid({ ...review, longSessionMinutes: 20 })).toBe(false);
    expect(dayReviewValid({ ...review, gapMinutes: 200 })).toBe(false);
  });

  it('checks targets and exceptions', () => {
    expect(targetsValid(setTargetMinutes(stored.targets, 24 * 60 + 1, 2))).toBe(false);
    expect(targetsValid(setTargetMinutes(stored.targets, -1, 2))).toBe(false);
    expect(targetsValid(setTargetMinutes(stored.targets, 7.5, 2))).toBe(false);
    expect(targetsValid(setTargetMinutes(stored.targets, 24 * 60, 2))).toBe(true);
    expect(targetsValid(setTargetMinutes(stored.targets, 0, 2))).toBe(true);
    expect(targetsValid(addExceptions(stored.targets, [{ id: '2026-02-30', kind: 'Full-day leave', hours: 0, note: '' }]))).toBe(false);
    expect(targetsValid({ minutesByWeekday: [480] })).toBe(false);
  });

  it('parses the default meeting ticket like Rust', () => {
    expect(defaultTicketValid('')).toBe(true);
    expect(defaultTicketValid(' 33984 ')).toBe(true);
    expect(defaultTicketValid('+12')).toBe(true);
    expect(defaultTicketValid('0')).toBe(false);
    expect(defaultTicketValid('#12')).toBe(false);
    expect(defaultTicketValid('2147483648')).toBe(false);
  });

  it('checks the workspace URL and organization like Endpoint', () => {
    expect(sevenPaceUrlValid('https://contoso.timehub.7pace.com')).toBe(true);
    expect(sevenPaceUrlValid(' https://Contoso.timehub.7pace.com/ ')).toBe(true);
    expect(sevenPaceUrlValid('https://contoso.timehub.7pace.com:443')).toBe(true);
    expect(sevenPaceUrlValid('http://contoso.timehub.7pace.com')).toBe(false);
    expect(sevenPaceUrlValid('https://contoso.timehub.7pace.com/api')).toBe(false);
    expect(sevenPaceUrlValid('https://user@contoso.timehub.7pace.com')).toBe(false);
    expect(sevenPaceUrlValid('https://contoso.timehub.7pace.com?x')).toBe(false);
    expect(sevenPaceUrlValid('https://contoso.7pace.com')).toBe(false);
    expect(organizationValid('contoso-eu_2')).toBe(true);
    expect(organizationValid('-contoso')).toBe(false);
    expect(organizationValid('con toso')).toBe(false);
  });

  it('needs a valid organization for a new PAT and a valid URL for a new API token', () => {
    const empty = defaultConfiguration();
    expect(validateConfiguration(empty, { azurePat: 'pat', sevenPaceToken: '' }).map((issue) => issue.field)).toEqual(['organization']);
    expect(validateConfiguration(empty, { azurePat: '', sevenPaceToken: 'token' }).map((issue) => issue.field)).toEqual(['sevenPaceUrl']);
    const pairing: Configuration = { ...empty, sevenPaceAuthMode: 'mobilePIN' };
    expect(validateConfiguration(pairing, { azurePat: '', sevenPaceToken: 'token' })).toEqual([]);
  });
});

describe('targets', () => {
  it('edits one weekday in whole minutes, like WorkTargets::set_minutes', () => {
    const targets = { minutesByWeekday: [0, 456, 456, 456, 456, 456, 0] };
    expect(targetMinutes(targets, 1)).toBe(0);
    expect(targetMinutes(targets, 2)).toBe(456);
    expect(targetMinutes(targets, 8)).toBe(0);
    const edited = setTargetMinutes(targets, 457, 6);
    expect(edited.minutesByWeekday).toEqual([0, 456, 456, 456, 456, 457, 0]);
    expect(targets.minutesByWeekday[5]).toBe(456);
    // 4 × 7h 36m + 7h 37m: exact, where decimal hours could drift to 38h 0m.
    expect(weeklyTargetMinutes(edited)).toBe(38 * 60 + 1);
    expect(weeklyTargetMinutes(targets)).toBe(38 * 60);
  });

  it('fills the week from a preset and recognises it, keeping 7h 36m exact', () => {
    const [fourDays, fiveDays] = TARGET_PRESETS;
    const edited = { minutesByWeekday: [0, 456, 456, 456, 456, 457, 0] };
    expect(applyPreset(edited, fourDays!).minutesByWeekday).toEqual([0, 480, 480, 480, 480, 360, 0]);
    expect(weeklyTargetMinutes(applyPreset(edited, fourDays!))).toBe(38 * 60);
    expect(applyPreset(edited, fiveDays!).minutesByWeekday).toEqual([0, 456, 456, 456, 456, 456, 0]);
    expect(weeklyTargetMinutes(applyPreset(edited, fiveDays!))).toBe(38 * 60);
    expect(matchesPreset(applyPreset(edited, fiveDays!), fiveDays!)).toBe(true);
    expect(matchesPreset(edited, fiveDays!)).toBe(false);
  });

  it('formats targets to the minute', () => {
    expect(formatMinutes(456)).toBe('7h 36m');
    expect(formatMinutes(480)).toBe('8h');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(0)).toBe('0h');
    expect(formatMinutes(1440)).toBe('24h');
    expect(formatHours(7.6)).toBe('7h 36m');
  });

  it('steps to the next quarter hour within 0 to 24 hours', () => {
    const stepMinutes = (minutes: number, direction: 1 | -1) =>
      stepDuration(minutes, direction, { step: TARGET_STEP_MINUTES, min: 0, max: MAX_DAILY_MINUTES });
    expect(stepMinutes(480, 1)).toBe(495);
    expect(stepMinutes(480, -1)).toBe(465);
    expect(stepMinutes(456, 1)).toBe(465);
    expect(stepMinutes(456, -1)).toBe(450);
    expect(stepMinutes(0, -1)).toBe(0);
    expect(stepMinutes(1440, 1)).toBe(1440);
    expect(stepMinutes(1435, 1)).toBe(1440);
    expect(stepMinutes(1500, -1)).toBe(1440);
  });

  it('computes the Belgian holidays (Meeus computus)', () => {
    const holidays = belgianHolidays(2026).map((holiday) => `${dateKey(holiday.date)} ${holiday.name}`);
    expect(holidays).toEqual([
      '2026-01-01 New Year’s Day',
      '2026-04-06 Easter Monday',
      '2026-05-01 Labour Day',
      '2026-05-14 Ascension Day',
      '2026-05-25 Whit Monday',
      '2026-07-21 Belgian National Day',
      '2026-08-15 Assumption',
      '2026-11-01 All Saints’ Day',
      '2026-11-11 Armistice Day',
      '2026-12-25 Christmas Day',
    ]);
    // Ascension on 1 May: the fixed holiday comes first.
    expect(belgianHolidays(2008).slice(2, 4).map((holiday) => `${dateKey(holiday.date)} ${holiday.name}`)).toEqual([
      '2008-05-01 Labour Day',
      '2008-05-01 Ascension Day',
    ]);
    expect(belgianHolidays(1500)).toEqual([]);
  });

  it('expands date ranges up to a year and replaces exceptions on the same days', () => {
    expect(daysBetween({ year: 2026, month: 12, day: 30 }, { year: 2027, month: 1, day: 2 }).map(dateKey)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(daysBetween({ year: 2026, month: 1, day: 2 }, { year: 2026, month: 1, day: 1 })).toEqual([]);
    const next = addExceptions(stored.targets, [{ id: '2026-11-02', kind: 'Custom target', hours: 4, note: '' }]);
    expect(next.dateExceptions).toEqual([
      { id: '2026-12-24', kind: 'Half-day leave', hours: 0, note: '' },
      { id: '2026-11-02', kind: 'Custom target', hours: 4, note: '' },
    ]);
  });
});

describe('features', () => {
  it('maps page modules to hiddenPages and never hides Overview or Settings', () => {
    const hidden = setPageShown(stored, 'statistics', false);
    expect(hidden.hiddenPages).toEqual(['statistics']);
    expect(pageShown(hidden, 'statistics')).toBe(false);
    expect(setPageShown(hidden, 'statistics', true).hiddenPages).toEqual([]);
    expect(setPageShown(stored, 'settings', false)).toBe(stored);
    expect(setPageShown(stored, 'overview', false)).toBe(stored);
  });

  it('maps module switches to their configuration fields', () => {
    const field = (id: string) => {
      const binding = FEATURES.find((feature) => feature.id === id)?.binding;
      if (binding?.kind !== 'field') throw new Error(`${id} is not a field`);
      return binding;
    };
    expect(field('watch').set(stored, false).watchEnabled).toBe(false);
    expect(field('calendar').set(stored, false).calendarEnabled).toBe(false);
    expect(field('microphone').set(stored, false).microphone.enabled).toBe(false);
    const awareness = field('idle').set(stored, false).awareness;
    expect([awareness.idleEnabled, awareness.lockEnabled, awareness.forgottenEnabled]).toEqual([false, false, true]);
    expect(field('forgotten').set(stored, false).awareness.forgottenEnabled).toBe(false);
    expect(field('completion').set(stored, false).completionReminders).toBe(false);
    expect(field('dayReview').set(stored, false).dayReview.enabled).toBe(false);
    expect(field('quickSwitch').set(stored, false).quickSwitchEnabled).toBe(false);
    expect(field('updates').set(stored, false).automaticUpdateChecks).toBe(false);
    expect(field('notifications').set(stored, false).notificationsEnabled).toBe(false);
  });
});

describe('labels and links', () => {
  it('parses deep links to sections and views', () => {
    expect(parseSettingsHash('#settings/calendar')).toEqual({ view: 'calendars', section: 'calendar' });
    expect(parseSettingsHash('#settings/app')).toEqual({ view: 'appearance', section: 'app' });
    expect(parseSettingsHash('#settings/accounts')).toEqual({ view: 'accounts' });
    // 2.3's Targets & reminders view: its Timer & reminders card is now Reminders → Timer defaults.
    expect(parseSettingsHash('#settings/tracking')).toEqual({ view: 'reminders', section: 'tracking' });
    expect(parseSettingsHash('#settings/schedule')).toEqual({ view: 'schedule' });
    expect(parseSettingsHash('#settings/workday')).toEqual({ view: 'schedule', section: 'workday' });
    expect(parseSettingsHash('#settings/unknown')).toBeNull();
    expect(parseSettingsHash('#other')).toBeNull();
  });
});
