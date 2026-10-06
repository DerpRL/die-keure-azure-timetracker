/**
 * The Features page (rewrite plan §9): one row per module with its toggle, privacy line and
 * permission. Each row maps to existing `Configuration` fields, or to `hiddenPages` for modules
 * that are only a page. Overview and Settings can never be hidden.
 */
import type { Configuration, HostOs } from '../../ipc/contract';
import type { PageId } from '../../layout/navigation';

export type FeatureGroup = 'Tracking' | 'Meetings' | 'Pages' | 'App';

/** How a row's toggle reads and writes. */
export type FeatureBinding =
  /** A draft field, saved with Save changes. */
  | { kind: 'field'; get: (configuration: Configuration) => boolean; set: (configuration: Configuration, on: boolean) => Configuration }
  /** A page in `hiddenPages` (draft, saved with Save changes). */
  | { kind: 'page'; page: PageId }
  /** `figma.setPreferences`, applied immediately. */
  | { kind: 'figma' }
  /** `@tauri-apps/plugin-autostart`, applied immediately. */
  | { kind: 'launchAtLogin' }
  /** No switch of its own. */
  | { kind: 'info'; text: string };

export interface FeatureDefinition {
  id: string;
  title: string;
  group: FeatureGroup;
  privacy: (os: HostOs) => string;
  permission: (os: HostOs) => string;
  binding: FeatureBinding;
  /** Only on systems with a calendar source (macOS at launch). */
  needsCalendar?: boolean;
  /** Only where the microphone probe works. */
  needsMicrophone?: boolean;
}

/** Pages that can be hidden from the sidebar (never Overview or Settings). */
export const HIDEABLE_PAGES: readonly PageId[] = ['agenda', 'offlineDrafts', 'statistics', 'weeklyReport', 'timeEditor'];

const none = () => 'None';
const local = (os: HostOs) => (os === 'windows' ? 'this PC' : 'this Mac');

function field(
  get: (configuration: Configuration) => boolean,
  set: (configuration: Configuration, on: boolean) => Configuration,
): FeatureBinding {
  return { kind: 'field', get, set };
}

export const FEATURES: readonly FeatureDefinition[] = [
  {
    id: 'watch',
    title: 'Git branch watching',
    group: 'Tracking',
    privacy: (os) => `Reads only the current branch of the repositories you add. Nothing leaves ${local(os)}.`,
    permission: none,
    binding: field(
      (c) => c.watchEnabled,
      (c, on) => ({ ...c, watchEnabled: on }),
    ),
  },
  {
    id: 'idle',
    title: 'Time awareness (idle, lock)',
    group: 'Tracking',
    privacy: () =>
      'Reads elapsed input inactivity and lock events only. No keystrokes, window titles, documents or screenshots are collected.',
    permission: none,
    binding: field(
      (c) => c.awareness.idleEnabled || c.awareness.lockEnabled,
      (c, on) => ({ ...c, awareness: { ...c.awareness, idleEnabled: on, lockEnabled: on } }),
    ),
  },
  {
    id: 'forgotten',
    title: 'Forgotten-timer reminders',
    group: 'Tracking',
    privacy: () => 'Reads the foreground app’s identity only, compared with your work applications.',
    permission: none,
    binding: field(
      (c) => c.awareness.forgottenEnabled,
      (c, on) => ({ ...c, awareness: { ...c.awareness, forgottenEnabled: on } }),
    ),
  },
  {
    id: 'completion',
    title: 'Ticket completion reminders',
    group: 'Tracking',
    privacy: () => 'Checks the tracked ticket’s state in Azure about once a minute while tracking.',
    permission: () => 'Azure PAT with Work Items (Read)',
    binding: field(
      (c) => c.completionReminders,
      (c, on) => ({ ...c, completionReminders: on }),
    ),
  },
  {
    id: 'figma',
    title: 'Figma context',
    group: 'Tracking',
    privacy: (os) =>
      os === 'windows'
        ? 'Reads only Figma window titles. No design content, Figma account, token or plugin.'
        : 'Reads only Figma file URLs and window titles. No design content, Figma account, token or plugin.',
    permission: (os) => (os === 'windows' ? 'None (window titles, experimental)' : 'Accessibility'),
    binding: { kind: 'figma' },
  },
  {
    id: 'quickSwitch',
    title: 'Quick switch',
    group: 'Tracking',
    privacy: () => 'Registers one global keyboard shortcut. No other keys are read.',
    permission: none,
    binding: field(
      (c) => c.quickSwitchEnabled,
      (c, on) => ({ ...c, quickSwitchEnabled: on }),
    ),
  },
  {
    id: 'targets',
    title: 'Targets and holidays',
    group: 'Tracking',
    privacy: (os) => `Your schedule and exceptions stay on ${local(os)}.`,
    permission: none,
    binding: { kind: 'info', text: 'Always on. Progress, day reviews and statistics follow your weekly schedule.' },
  },
  {
    id: 'calendar',
    title: 'Calendar meetings',
    group: 'Meetings',
    privacy: () => 'Calendar events stay on your Mac and are never sent to Azure or 7pace.',
    permission: () => 'Calendar access',
    binding: field(
      (c) => c.calendarEnabled,
      (c, on) => ({ ...c, calendarEnabled: on }),
    ),
    needsCalendar: true,
  },
  {
    id: 'microphone',
    title: 'Microphone meetings',
    group: 'Meetings',
    privacy: () => 'Reads which apps use the microphone; never records audio.',
    permission: (os) => (os === 'windows' ? 'None' : 'None (macOS 14.2 or later)'),
    binding: field(
      (c) => c.microphone.enabled,
      (c, on) => ({ ...c, microphone: { ...c.microphone, enabled: on } }),
    ),
    needsMicrophone: true,
  },
  {
    id: 'meetingEnd',
    title: 'Meeting-end reminders',
    group: 'Meetings',
    privacy: () => 'Uses the same calendar and microphone signals as the meeting suggestions.',
    permission: none,
    binding: {
      kind: 'info',
      text: 'Follow Calendar meetings and Microphone meetings. Choose how they interrupt under Notifications (Meeting ended, Return after meetings).',
    },
  },
  {
    id: 'dayReview',
    title: 'Day review',
    group: 'Tracking',
    privacy: (os) => `Reminds you to review your day. Review status is stored only on ${local(os)}.`,
    permission: () => 'Notifications (optional)',
    binding: field(
      (c) => c.dayReview.enabled,
      (c, on) => ({ ...c, dayReview: { ...c.dayReview, enabled: on } }),
    ),
  },
  {
    id: 'agenda',
    title: 'Agenda page',
    group: 'Pages',
    privacy: () => 'Shows events from the calendars you choose. Events stay on your Mac.',
    permission: () => 'Calendar access',
    binding: { kind: 'page', page: 'agenda' },
    needsCalendar: true,
  },
  {
    id: 'offlineDrafts',
    title: 'Offline drafts and local timer',
    group: 'Pages',
    privacy: (os) => `Drafts stay on ${local(os)} until you upload them.`,
    permission: none,
    binding: { kind: 'page', page: 'offlineDrafts' },
  },
  {
    id: 'weeklyReport',
    title: 'Weekly report',
    group: 'Pages',
    privacy: (os) => `Report drafts are stored on ${local(os)}.`,
    permission: none,
    binding: { kind: 'page', page: 'weeklyReport' },
  },
  {
    id: 'statistics',
    title: 'Statistics',
    group: 'Pages',
    privacy: (os) => `Calculated on ${local(os)} from your 7pace worklogs.`,
    permission: none,
    binding: { kind: 'page', page: 'statistics' },
  },
  {
    id: 'timeEditor',
    title: 'Time editor',
    group: 'Pages',
    privacy: (os) => `Changes reach 7pace only when you save them. The recovery journal stays on ${local(os)}.`,
    permission: none,
    binding: { kind: 'page', page: 'timeEditor' },
  },
  {
    id: 'updates',
    title: 'Check for updates automatically',
    group: 'App',
    privacy: () => 'Checks the public update feed. No personal data is sent.',
    permission: none,
    binding: field(
      (c) => c.automaticUpdateChecks,
      (c, on) => ({ ...c, automaticUpdateChecks: on }),
    ),
  },
  {
    id: 'launchAtLogin',
    title: 'Launch at login',
    group: 'App',
    privacy: () => 'Opens Azure timetracker when you sign in. Applies immediately.',
    permission: (os) => (os === 'windows' ? 'None' : 'Login items'),
    binding: { kind: 'launchAtLogin' },
  },
  {
    id: 'notifications',
    title: 'Notifications',
    group: 'App',
    privacy: () => 'Shown by the system notification centre on this device only.',
    permission: () => 'Notifications',
    binding: field(
      (c) => c.notificationsEnabled,
      (c, on) => ({ ...c, notificationsEnabled: on }),
    ),
  },
];

/** A page module is on while the page is not hidden. */
export function pageShown(configuration: Configuration, page: PageId): boolean {
  return !configuration.hiddenPages.includes(page);
}

/** Shows or hides a page. Overview and Settings are never added to `hiddenPages`. */
export function setPageShown(configuration: Configuration, page: PageId, shown: boolean): Configuration {
  if (page === 'overview' || page === 'settings') return configuration;
  const others = configuration.hiddenPages.filter((entry) => entry !== page);
  return { ...configuration, hiddenPages: shown ? others : [...others, page] };
}
