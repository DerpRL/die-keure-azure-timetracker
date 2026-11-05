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
  // Targets & reminders
  | 'targets'
  | 'holidays'
  | 'meetings'
  | 'microphone'
  | 'dayReview'
  | 'notifications'
  | 'tracking'
  | 'awareness'
  // Git repositories
  | 'repositories'
  | 'branchRules'
  // Figma
  | 'figma'
  // Calendars
  | 'calendar'
  // Appearance & app
  | 'appearance'
  | 'app'
  | 'updates'
  | 'features'
  | 'advanced';

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  title: string;
  view: SettingsView;
  /** Hidden when the calendar module does not exist on this OS (Windows at launch). */
  needsCalendar?: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: 'azure', title: 'Azure DevOps', view: 'accounts' },
  { id: 'sevenPace', title: '7pace Timetracker', view: 'accounts' },
  { id: 'connection', title: 'Connection', view: 'accounts' },
  { id: 'targets', title: 'Daily targets', view: 'tracking' },
  { id: 'holidays', title: 'Holidays & leave', view: 'tracking' },
  { id: 'meetings', title: 'Meetings', view: 'tracking', needsCalendar: true },
  { id: 'microphone', title: 'Microphone meetings', view: 'tracking' },
  { id: 'dayReview', title: 'Day check', view: 'tracking' },
  { id: 'notifications', title: 'Notifications & quiet hours', view: 'tracking' },
  { id: 'tracking', title: 'Timer & reminders', view: 'tracking' },
  { id: 'awareness', title: 'Time awareness', view: 'tracking' },
  { id: 'repositories', title: 'Watched repositories', view: 'git' },
  { id: 'branchRules', title: 'Branch rules', view: 'git' },
  { id: 'figma', title: 'Figma Desktop', view: 'figma' },
  { id: 'calendar', title: 'Calendars', view: 'calendars', needsCalendar: true },
  { id: 'appearance', title: 'Appearance', view: 'appearance' },
  { id: 'app', title: 'App', view: 'appearance' },
  { id: 'updates', title: 'App updates', view: 'appearance' },
  { id: 'features', title: 'Features', view: 'appearance' },
  { id: 'advanced', title: 'Advanced', view: 'appearance' },
];

/** The heading and lead line of each Settings view (the menu names some of them shorter). */
export const VIEW_INTROS: Readonly<Record<SettingsView, { title: string; lead: string }>> = {
  accounts: { title: 'Azure DevOps & 7pace', lead: 'Azure DevOps provides ticket details. 7pace Timetracker stores your time.' },
  tracking: {
    title: 'Targets & reminders',
    lead: 'Used for progress bars, the day check and Insights. Nothing here changes your 7pace data.',
  },
  sources: { title: 'Sources', lead: 'Sources suggest what to track. Nothing changes in 7pace until you confirm.' },
  git: {
    title: 'Git repositories',
    lead: 'Switching branch suggests that branch’s ticket. Nothing changes in 7pace until you confirm.',
  },
  figma: { title: 'Figma', lead: 'Your files, ticket links and recent design context. Changes here apply right away.' },
  calendars: { title: 'Calendars', lead: 'Shown on Today and used for meeting suggestions. Events never leave this device.' },
  appearance: {
    title: 'Appearance & app',
    lead: 'Appearance and Open at login apply right away. Everything else applies when you save.',
  },
};

/** Views whose cards edit the saved settings: they always show the save bar. */
export const DRAFT_VIEWS: readonly SettingsView[] = ['accounts', 'tracking', 'git', 'calendars', 'appearance'];

export const DEFAULT_SECTION: SettingsSectionId = 'azure';

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
  // A view's own name wins over a card with the same id (`tracking`, `figma`).
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
