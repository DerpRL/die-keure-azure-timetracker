/**
 * Settings categories (1.14 `SettingsCategory`) and the sections inside them. Every section is
 * deep-linkable as `#settings/<section>` (or `#settings/<category>`), e.g. `#settings/calendar`.
 */
import { isTauri } from '../../ipc';
import { showMain } from '../../ipc/shell';

export type SettingsCategoryId =
  | 'accounts'
  | 'tracking'
  | 'meetings'
  | 'dayReview'
  | 'notifications'
  | 'features'
  | 'appearance'
  | 'app'
  | 'advanced';

export type SettingsSectionId =
  | 'connection'
  | 'tracking'
  | 'awareness'
  | 'targets'
  | 'figma'
  | 'calendar'
  | 'meetings'
  | 'microphone'
  | 'dayReview'
  | 'notifications'
  | 'features'
  | 'appearance'
  | 'window'
  | 'updates'
  | 'about'
  | 'advanced';

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  title: string;
  /** Hidden when the calendar module does not exist on this OS (Windows at launch). */
  needsCalendar?: boolean;
}

export interface SettingsCategoryDefinition {
  id: SettingsCategoryId;
  title: string;
  sections: readonly SettingsSectionDefinition[];
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryDefinition[] = [
  { id: 'accounts', title: 'Accounts', sections: [{ id: 'connection', title: 'Accounts & connection' }] },
  {
    id: 'tracking',
    title: 'Tracking',
    sections: [
      { id: 'tracking', title: 'Tracking' },
      { id: 'awareness', title: 'Time awareness' },
      { id: 'targets', title: 'Targets and holidays' },
      { id: 'figma', title: 'Figma Desktop' },
    ],
  },
  {
    id: 'meetings',
    title: 'Meetings',
    sections: [
      { id: 'calendar', title: 'Apple Calendar', needsCalendar: true },
      { id: 'meetings', title: 'Meeting suggestions', needsCalendar: true },
      { id: 'microphone', title: 'Microphone meetings' },
    ],
  },
  { id: 'dayReview', title: 'Day review', sections: [{ id: 'dayReview', title: 'End-of-day review' }] },
  {
    id: 'notifications',
    title: 'Notifications',
    sections: [{ id: 'notifications', title: 'Notifications and interruptions' }],
  },
  { id: 'features', title: 'Features', sections: [{ id: 'features', title: 'Features' }] },
  { id: 'appearance', title: 'Appearance', sections: [{ id: 'appearance', title: 'Appearance & readability' }] },
  {
    id: 'app',
    title: 'App',
    sections: [
      { id: 'window', title: 'Window and startup' },
      { id: 'updates', title: 'App updates' },
      { id: 'about', title: 'About' },
    ],
  },
  { id: 'advanced', title: 'Advanced', sections: [{ id: 'advanced', title: 'Polling intervals' }] },
];

export const DEFAULT_CATEGORY: SettingsCategoryId = 'accounts';

export function categoryOf(section: SettingsSectionId): SettingsCategoryId {
  return SETTINGS_CATEGORIES.find((category) => category.sections.some((entry) => entry.id === section))?.id ?? DEFAULT_CATEGORY;
}

export function sectionTitle(section: SettingsSectionId): string {
  for (const category of SETTINGS_CATEGORIES) {
    const match = category.sections.find((entry) => entry.id === section);
    if (match) return match.title;
  }
  return section;
}

/** The DOM id of a section's anchor. */
export function sectionAnchorId(section: SettingsSectionId): string {
  return `settings-${section}`;
}

export interface SettingsLocation {
  category: SettingsCategoryId;
  /** The section to scroll to, when the link named one. */
  section?: SettingsSectionId;
}

const HASH_PREFIX = '#settings/';

/** `#settings/<section|category>` → where to go; `null` for any other hash. */
export function parseSettingsHash(hash: string): SettingsLocation | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const target = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  for (const category of SETTINGS_CATEGORIES) {
    const section = category.sections.find((entry) => entry.id === target);
    if (section) return { category: category.id, section: section.id };
  }
  const category = SETTINGS_CATEGORIES.find((entry) => entry.id === target);
  return category ? { category: category.id } : null;
}

export function settingsHash(target: SettingsSectionId | SettingsCategoryId): string {
  return `${HASH_PREFIX}${target}`;
}

/**
 * Opens Settings on a section from anywhere in the main window, e.g. the Agenda page's "Choose
 * calendars" or a prompt's "Change in Settings". Inside Tauri the shell also brings the main
 * window to Settings; an open Settings page follows the hash.
 */
export function openSettingsSection(target: SettingsSectionId | SettingsCategoryId): void {
  if (typeof window !== 'undefined') window.location.hash = settingsHash(target);
  if (isTauri()) void showMain('settings').catch(() => undefined);
}
