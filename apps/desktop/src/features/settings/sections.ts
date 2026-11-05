/**
 * Settings sections (2.2 layout): the cards of the Settings views, each deep-linkable as
 * `#settings/<section>` (or `#settings/<view>`), e.g. `#settings/microphone`. Validation issues,
 * palette entries and links name a section; the Settings place shows its view and moves focus to
 * it.
 */
import { isTauri } from '../../ipc';
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
  title: string;
  view: SettingsView;
  /** Hidden when the calendar module does not exist on this OS (Windows at launch). */
  needsCalendar?: boolean;
  /** Other words Settings search matches (the title and the view's title always match). */
  keywords?: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: 'azure', title: 'Azure DevOps', view: 'accounts', keywords: ['organization', 'project', 'personal access token', 'pat'] },
  { id: 'sevenPace', title: '7pace Timetracker', view: 'accounts', keywords: ['workspace', 'url', 'api token', 'pin', 'pairing', 'unpair', 'sign in'] },
  { id: 'connection', title: 'Connection', view: 'accounts', keywords: ['refresh', 'status', 'connected', 'test'] },
  { id: 'targets', title: 'Weekly target', view: 'schedule', keywords: ['daily target', 'hours', 'minutes', 'presets', 'week'] },
  { id: 'workday', title: 'Workday', view: 'schedule', keywords: ['starts', 'ends', 'working hours'] },
  { id: 'holidays', title: 'Public holidays', view: 'schedule', keywords: ['belgium', 'belgian', 'holiday'] },
  { id: 'exceptions', title: 'Days off & exceptions', view: 'schedule', keywords: ['leave', 'half day', 'vacation', 'custom target', 'replacement'] },
  { id: 'meetings', title: 'Calendar meetings', view: 'meetings', needsCalendar: true, keywords: ['default ticket', 'activity', 'resume', 'calendar'] },
  { id: 'microphone', title: 'Calls without a calendar event', view: 'meetings', keywords: ['microphone', 'teams', 'zoom', 'slack', 'calls'] },
  { id: 'tracking', title: 'Timer defaults', view: 'reminders', keywords: ['activity', 'ticket closed', 'completion', 'round', 'rounding', 'quarter hour', '15 minutes'] },
  { id: 'awareness', title: 'Time awareness', view: 'reminders', keywords: ['idle', 'away', 'locked', 'lock', 'forgotten timer', 'inactivity'] },
  { id: 'workApps', title: 'Work applications', view: 'reminders', keywords: ['apps', 'forgotten timer'] },
  { id: 'dayReview', title: 'Day review', view: 'reminders', keywords: ['day check', 'gaps', 'long entries', 'review days'] },
  { id: 'notifications', title: 'Notifications & quiet hours', view: 'notifications', keywords: ['banners', 'quiet hours', 'do not disturb'] },
  { id: 'prompts', title: 'Prompts', view: 'notifications', keywords: ['interruptions', 'open panel', 'notify', 'focus'] },
  { id: 'repositories', title: 'Watched repositories', view: 'git', keywords: ['git', 'branches', 'watch'] },
  { id: 'branchRules', title: 'Branch rules', view: 'git', keywords: ['ticket number pattern', 'regular expression', 'branch'] },
  { id: 'figma', title: 'Figma Desktop', view: 'figma', keywords: ['design', 'linked files', 'context history'] },
  { id: 'calendar', title: 'Calendar access', view: 'calendars', needsCalendar: true, keywords: ['events', 'show on today', 'permission'] },
  { id: 'calendarList', title: 'Calendars', view: 'calendars', needsCalendar: true, keywords: ['exchange', 'icloud', 'which calendars'] },
  { id: 'appearance', title: 'Appearance', view: 'appearance', keywords: ['theme', 'dark', 'light', 'size', 'contrast', 'scale'] },
  { id: 'app', title: 'Menu bar & windows', view: 'appearance', keywords: ['open at login', 'launch', 'mini timer', 'menu bar', 'tray'] },
  { id: 'shortcuts', title: 'Shortcuts', view: 'appearance', keywords: ['keyboard', 'quick switch', 'command palette'] },
  { id: 'features', title: 'Features', view: 'features', keywords: ['privacy', 'permissions', 'modules', 'pages'] },
  { id: 'updates', title: 'Updates', view: 'advanced', keywords: ['version', 'check for updates', 'github'] },
  { id: 'advanced', title: 'Sync intervals', view: 'advanced', keywords: ['polling', 'refresh', 'intervals', 'cadences'] },
  { id: 'data', title: 'Data on this device', view: 'advanced', keywords: ['folder', 'diagnostics', 'log', 'onboarding'] },
  { id: 'reset', title: 'Reset', view: 'advanced', keywords: ['reset local data', 'clear'] },
  { id: 'about', title: 'About', view: 'about', keywords: ['version', 'help', 'release notes', 'report an issue', 'diagnostic info'] },
];

/** The heading and lead line of each Settings view (the menu names some of them shorter). */
export const VIEW_INTROS: Readonly<Record<SettingsView, { title: string; lead: string }>> = {
  accounts: { title: 'Azure DevOps & 7pace', lead: 'Azure DevOps provides ticket details. 7pace Timetracker stores your time.' },
  schedule: {
    title: 'Schedule & holidays',
    lead: 'Your hours are used for progress, the day review and Insights. Nothing here changes 7pace.',
  },
  meetings: { title: 'Meetings', lead: 'Suggests Meeting tracking when a meeting starts. Your timer never switches on its own.' },
  reminders: { title: 'Reminders', lead: 'Gentle nudges so your timesheet stays complete.' },
  notifications: { title: 'Notifications', lead: 'Choose how each prompt reaches you.' },
  sources: { title: 'Sources', lead: 'Sources suggest what to track. Nothing changes in 7pace until you confirm.' },
  git: {
    title: 'Git repositories',
    lead: 'Switching branch suggests that branch’s ticket. Nothing changes in 7pace until you confirm.',
  },
  figma: {
    title: 'Figma',
    lead: 'Suggests Design tracking while you work in Figma Desktop. Reads only file names and window titles.',
  },
  calendars: { title: 'Calendars', lead: 'Events show on Today. A meeting that starts can suggest Meeting tracking.' },
  appearance: { title: 'Appearance & shortcuts', lead: 'How the app looks and how you reach it.' },
  features: { title: 'Features & privacy', lead: 'Turn features on or off. Each one tells you what it reads.' },
  advanced: { title: 'Updates & advanced', lead: 'Updates, sync timing and data on this device.' },
  about: { title: 'About', lead: 'Version, connections and what happens with your data.' },
};

export const DEFAULT_SECTION: SettingsSectionId = 'azure';

/**
 * The sections Settings search finds for `query`: every word must appear in the section's title,
 * its view's title or its keywords (case-insensitive). Title matches come first.
 */
export function searchSections(query: string, sections: readonly SettingsSectionDefinition[]): SettingsSectionDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const haystack = (section: SettingsSectionDefinition) =>
    [section.title, VIEW_INTROS[section.view].title, ...(section.keywords ?? [])].join(' ').toLowerCase();
  const matches = sections.filter((section) => words.every((word) => haystack(section).includes(word)));
  const inTitle = (section: SettingsSectionDefinition) => words.every((word) => section.title.toLowerCase().includes(word));
  return [...matches.filter(inTitle), ...matches.filter((section) => !inTitle(section))];
}

function definition(section: SettingsSectionId): SettingsSectionDefinition {
  return SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? SETTINGS_SECTIONS[0]!;
}

export function viewOf(section: SettingsSectionId): SettingsView {
  return definition(section).view;
}

export function sectionTitle(section: SettingsSectionId): string {
  return definition(section).title;
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
