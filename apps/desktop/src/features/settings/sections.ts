/**
 * Settings sections (2.2 layout): the cards of the Settings views, each deep-linkable as
 * `#settings/<section>` (or `#settings/<view>`), e.g. `#settings/microphone`. Validation issues,
 * palette entries and links name a section; the Settings place shows its view and moves focus to
 * it.
 */
import { isTauri } from '../../ipc';
import { mark, t } from '../../i18n';
import { showMain } from '../../ipc/shell';
import type { PageId, SettingsView } from '../../layout/navigation';

export type SettingsSectionId =
  // Azure DevOps & 7pace
  | 'azure'
  | 'sevenPace'
  | 'connection'
  // Schedule & holidays
  | 'targets'
  | 'workday'
  | 'holidays'
  | 'exceptions'
  // Meetings
  | 'meetings'
  | 'microphone'
  // Reminders
  | 'tracking'
  | 'awareness'
  | 'workApps'
  | 'dayReview'
  // Notifications
  | 'notifications'
  | 'prompts'
  // Git repositories
  | 'repositories'
  | 'branchRules'
  // Figma
  | 'figma'
  // Calendars
  | 'calendar'
  | 'calendarList'
  // Appearance & shortcuts
  | 'appearance'
  | 'app'
  | 'shortcuts'
  // Features & privacy
  | 'features'
  // Updates & advanced
  | 'updates'
  | 'advanced'
  | 'data'
  | 'reset'
  // About
  | 'about';

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  /** English (`mark`): show with `t`, or use `sectionTitle`. */
  title: string;
  view: SettingsView;
  /** Hidden when the calendar module does not exist on this OS (Windows at launch). */
  needsCalendar?: boolean;
  /** Other words Settings search matches (the title and the view's title always match). */
  keywords?: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: 'azure', title: 'Azure DevOps', view: 'accounts', keywords: [mark('organization'), mark('project'), mark('personal access token'), 'pat'] },
  { id: 'sevenPace', title: '7pace Timetracker', view: 'accounts', keywords: [mark('workspace'), 'url', mark('api token'), 'pin', mark('pairing'), mark('unpair'), mark('sign in')] },
  { id: 'connection', title: mark('Connection'), view: 'accounts', keywords: [mark('refresh'), mark('status'), mark('connected'), mark('test')] },
  { id: 'targets', title: mark('Weekly target'), view: 'schedule', keywords: [mark('daily target'), mark('hours'), mark('minutes'), mark('presets'), mark('week')] },
  { id: 'workday', title: mark('Workday'), view: 'schedule', keywords: [mark('starts'), mark('ends'), mark('working hours')] },
  { id: 'holidays', title: mark('Public holidays'), view: 'schedule', keywords: [mark('belgium'), mark('belgian'), mark('holiday')] },
  { id: 'exceptions', title: mark('Days off & exceptions'), view: 'schedule', keywords: [mark('leave'), mark('half day'), mark('vacation'), mark('custom target'), mark('replacement')] },
  { id: 'meetings', title: mark('Calendar meetings'), view: 'meetings', needsCalendar: true, keywords: [mark('default ticket'), mark('activity'), mark('resume'), mark('calendar')] },
  { id: 'microphone', title: mark('Calls without a calendar event'), view: 'meetings', keywords: [mark('microphone'), 'teams', 'zoom', 'slack', mark('calls')] },
  { id: 'tracking', title: mark('Timer defaults'), view: 'reminders', keywords: [mark('activity'), mark('ticket closed'), mark('completion'), mark('round'), mark('rounding'), mark('quarter hour'), mark('15 minutes')] },
  { id: 'awareness', title: mark('Time awareness'), view: 'reminders', keywords: [mark('idle'), mark('away'), mark('locked'), mark('lock'), mark('forgotten timer'), mark('inactivity')] },
  { id: 'workApps', title: mark('Work applications'), view: 'reminders', keywords: [mark('apps'), mark('forgotten timer')] },
  { id: 'dayReview', title: mark('Day review'), view: 'reminders', keywords: [mark('day check'), mark('gaps'), mark('long entries'), mark('review days')] },
  { id: 'notifications', title: mark('Notifications & quiet hours'), view: 'notifications', keywords: [mark('banners'), mark('quiet hours'), mark('do not disturb')] },
  { id: 'prompts', title: mark('Prompts'), view: 'notifications', keywords: [mark('interruptions'), mark('open panel'), mark('notify'), mark('focus')] },
  { id: 'repositories', title: mark('Watched repositories'), view: 'git', keywords: ['git', mark('branches'), mark('watch')] },
  { id: 'branchRules', title: mark('Branch rules'), view: 'git', keywords: [mark('ticket number pattern'), mark('regular expression'), mark('branch')] },
  { id: 'figma', title: 'Figma Desktop', view: 'figma', keywords: [mark('design'), mark('linked files'), mark('context history')] },
  { id: 'calendar', title: mark('Calendar access'), view: 'calendars', needsCalendar: true, keywords: [mark('events'), mark('show on today'), mark('permission')] },
  { id: 'calendarList', title: mark('Calendars'), view: 'calendars', needsCalendar: true, keywords: ['exchange', 'icloud', mark('which calendars')] },
  { id: 'appearance', title: mark('Appearance'), view: 'appearance', keywords: [mark('theme'), mark('dark'), mark('light'), mark('size'), mark('contrast'), mark('scale')] },
  { id: 'app', title: mark('Menu bar & windows'), view: 'appearance', keywords: [mark('open at login'), mark('launch'), mark('mini timer'), mark('menu bar'), mark('tray')] },
  { id: 'shortcuts', title: mark('Shortcuts'), view: 'appearance', keywords: [mark('keyboard'), mark('quick switch'), mark('command palette')] },
  { id: 'features', title: mark('Features'), view: 'features', keywords: [mark('privacy'), mark('permissions'), mark('modules'), mark('pages')] },
  { id: 'updates', title: mark('Updates'), view: 'advanced', keywords: [mark('version'), mark('check for updates'), 'github'] },
  { id: 'advanced', title: mark('Sync intervals'), view: 'advanced', keywords: [mark('polling'), mark('refresh'), mark('intervals'), mark('cadences')] },
  { id: 'data', title: mark('Data on this device'), view: 'advanced', keywords: [mark('folder'), mark('diagnostics'), mark('log'), mark('onboarding')] },
  { id: 'reset', title: mark('Reset'), view: 'advanced', keywords: [mark('reset local data'), mark('clear')] },
  { id: 'about', title: mark('About'), view: 'about', keywords: [mark('version'), mark('help'), mark('release notes'), mark('report an issue'), mark('diagnostic info')] },
];

/** The heading and lead line of each Settings view (the menu names some of them shorter). English (`mark`): show with `t`. */
export const VIEW_INTROS: Readonly<Record<SettingsView, { title: string; lead: string }>> = {
  accounts: { title: mark('Azure DevOps & 7pace'), lead: mark('Azure DevOps provides ticket details. 7pace Timetracker stores your time.') },
  schedule: {
    title: mark('Schedule & holidays'),
    lead: mark('Your hours are used for progress, the day review and Insights. Nothing here changes 7pace.'),
  },
  meetings: { title: mark('Meetings'), lead: mark('Suggests Meeting tracking when a meeting starts. Your timer never switches on its own.') },
  reminders: { title: mark('Reminders'), lead: mark('Gentle nudges so your timesheet stays complete.') },
  notifications: { title: mark('Notifications'), lead: mark('Choose how each prompt reaches you.') },
  sources: { title: mark('Sources'), lead: mark('Sources suggest what to track. Nothing changes in 7pace until you confirm.') },
  git: {
    title: mark('Git repositories'),
    lead: mark('Switching branch suggests that branch’s ticket. Nothing changes in 7pace until you confirm.'),
  },
  figma: {
    title: 'Figma',
    lead: mark('Suggests Design tracking while you work in Figma Desktop. Reads only file names and window titles.'),
  },
  calendars: { title: mark('Calendars'), lead: mark('Events show on Today. A meeting that starts can suggest Meeting tracking.') },
  appearance: { title: mark('Appearance & shortcuts'), lead: mark('How the app looks and how you reach it.') },
  features: { title: mark('Features & privacy'), lead: mark('Turn features on or off. Each one tells you what it reads.') },
  advanced: { title: mark('Updates & advanced'), lead: mark('Updates, sync timing and data on this device.') },
  about: { title: mark('About'), lead: mark('Version, connections and what happens with your data.') },
};

export const DEFAULT_SECTION: SettingsSectionId = 'azure';

/**
 * The sections Settings search finds for `query`: every word must appear in the section's title,
 * its view's title or its keywords (case-insensitive). Title matches come first.
 */
export function searchSections(query: string, sections: readonly SettingsSectionDefinition[]): SettingsSectionDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  // English and the interface language both match, so "pat" and "token" work in Dutch too.
  const both = (text: string) => [text, t(text)];
  const haystack = (section: SettingsSectionDefinition) =>
    [...both(section.title), ...both(VIEW_INTROS[section.view].title), ...(section.keywords ?? []).flatMap(both)].join(' ').toLowerCase();
  const matches = sections.filter((section) => words.every((word) => haystack(section).includes(word)));
  const inTitle = (section: SettingsSectionDefinition) =>
    words.every((word) => both(section.title).some((title) => title.toLowerCase().includes(word)));
  return [...matches.filter(inTitle), ...matches.filter((section) => !inTitle(section))];
}

function definition(section: SettingsSectionId): SettingsSectionDefinition {
  return SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? SETTINGS_SECTIONS[0]!;
}

export function viewOf(section: SettingsSectionId): SettingsView {
  return definition(section).view;
}

/** The section's title in the interface language. */
export function sectionTitle(section: SettingsSectionId): string {
  return t(definition(section).title);
}

/** The DOM id of a section's anchor. */
export function sectionAnchorId(section: SettingsSectionId): string {
  return `settings-${section}`;
}

export interface SettingsLocation {
  view: SettingsView;
  /** The section to scroll to, when the link named one. */
  section?: SettingsSectionId;
}

const HASH_PREFIX = '#settings/';

/** `#settings/<section|view>` → where to go; `null` for any other hash. */
export function parseSettingsHash(hash: string): SettingsLocation | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const target = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  // A view's own name wins over a card with the same id (`figma`, `notifications`).
  if (Object.hasOwn(VIEW_INTROS, target)) return { view: target as SettingsView };
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === target);
  return section ? { view: section.view, section: section.id } : null;
}

export function settingsHash(target: SettingsSectionId | SettingsView): string {
  return `${HASH_PREFIX}${target}`;
}

function isSection(target: string): target is SettingsSectionId {
  return SETTINGS_SECTIONS.some((entry) => entry.id === target);
}

/**
 * Opens Settings on a section or view from anywhere in the main window, e.g. a prompt's "Change
 * in Settings". Inside Tauri the shell also brings the main window to that Settings view; the
 * Settings place reads the hash, shows the section and clears the hash.
 */
export function openSettingsSection(target: SettingsSectionId | SettingsView): void {
  if (typeof window !== 'undefined') window.location.hash = settingsHash(target);
  const view = isSection(target) ? viewOf(target) : target;
  // The shell passes any page id through; the main window also accepts `place/view` (parseNavTarget).
  if (isTauri()) void showMain(`settings/${view}` as PageId).catch(() => undefined);
}
