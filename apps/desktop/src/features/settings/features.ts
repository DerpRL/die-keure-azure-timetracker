/**
 * The Features page (rewrite plan §9): one row per module with its toggle, privacy line and
 * permission. Each row maps to existing `Configuration` fields, or to `hiddenPages` for modules
 * that are only a page. Overview and Settings can never be hidden.
 */
import type { Configuration, HostOs } from '../../ipc/contract';
import type { PageId } from '../../layout/navigation';
import { mark, t } from '../../i18n';

export type FeatureGroup = 'Tracking' | 'Meetings' | 'Views' | 'App';

/** How a row's toggle reads and writes. */
export type FeatureBinding =
  /** A draft field, saved with Save changes. */
  | { kind: 'field'; get: (configuration: Configuration) => boolean; set: (configuration: Configuration, on: boolean) => Configuration }
  /** A view backed by a 1.14 page in `hiddenPages` (draft, saved with Save changes). `where` names its place. */
  | { kind: 'page'; page: PageId; where: string }
  /** `figma.setPreferences`, applied immediately. */
  | { kind: 'figma' }
  /** `@tauri-apps/plugin-autostart`, applied immediately. */
  | { kind: 'launchAtLogin' }
  /** No switch of its own. */
  | { kind: 'info'; text: string };

export interface FeatureDefinition {
  id: string;
  /** English (`mark`): show with `t`. */
  title: string;
  group: FeatureGroup;
  /** In the interface language. */
  privacy: (os: HostOs) => string;
  /** English (`mark`, "None" for no permission): show with `t`. */
  permission: (os: HostOs) => string;
  binding: FeatureBinding;
  /** Only on systems with a calendar source (macOS at launch). */
  needsCalendar?: boolean;
  /** Only where the microphone probe works. */
  needsMicrophone?: boolean;
}

/** Pages whose views can be hidden (never Overview or Settings, which back Today and Settings). */
export const HIDEABLE_PAGES: readonly PageId[] = ['agenda', 'offlineDrafts', 'statistics', 'weeklyReport', 'timeEditor'];

const none = () => mark('None');
const local = (os: HostOs) => (os === 'windows' ? t('this PC') : t('this Mac'));

function field(
  get: (configuration: Configuration) => boolean,
  set: (configuration: Configuration, on: boolean) => Configuration,
): FeatureBinding {
  return { kind: 'field', get, set };
}

export const FEATURES: readonly FeatureDefinition[] = [
  {
    id: 'watch',
    title: mark('Git branch watching'),
    group: 'Tracking',
    privacy: (os) => t('Reads only the current branch of the repositories you add. Nothing leaves {place}.', { place: local(os) }),
    permission: none,
    binding: field(
      (c) => c.watchEnabled,
      (c, on) => ({ ...c, watchEnabled: on }),
    ),
  },
  {
    id: 'idle',
    title: mark('Time awareness (idle, lock)'),
    group: 'Tracking',
    privacy: () =>
      t('Reads elapsed input inactivity and lock events only. No keystrokes, window titles, documents or screenshots are collected.'),
    permission: none,
    binding: field(
      (c) => c.awareness.idleEnabled || c.awareness.lockEnabled,
      (c, on) => ({ ...c, awareness: { ...c.awareness, idleEnabled: on, lockEnabled: on } }),
    ),
  },
  {
    id: 'forgotten',
    title: mark('Forgotten-timer reminders'),
    group: 'Tracking',
    privacy: () => t('Reads the foreground app’s identity only, compared with your work applications.'),
    permission: none,
    binding: field(
      (c) => c.awareness.forgottenEnabled,
      (c, on) => ({ ...c, awareness: { ...c.awareness, forgottenEnabled: on } }),
    ),
  },
  {
    id: 'completion',
    title: mark('Ticket completion reminders'),
    group: 'Tracking',
    privacy: () => t('Checks the tracked ticket’s state in Azure about once a minute while tracking.'),
    permission: () => mark('Azure PAT with Work Items (Read)'),
    binding: field(
      (c) => c.completionReminders,
      (c, on) => ({ ...c, completionReminders: on }),
    ),
  },
  {
    id: 'figma',
    title: mark('Figma context'),
    group: 'Tracking',
    privacy: (os) =>
      os === 'windows'
        ? t('Reads only Figma window titles. No design content, Figma account, token or plugin.')
        : t('Reads only Figma file URLs and window titles. No design content, Figma account, token or plugin.'),
    permission: (os) => (os === 'windows' ? mark('None (window titles, experimental)') : mark('Accessibility')),
    binding: { kind: 'figma' },
  },
  {
    id: 'quickSwitch',
    title: mark('Quick switch'),
    group: 'Tracking',
    privacy: () => t('Registers one global keyboard shortcut. No other keys are read.'),
    permission: none,
    binding: field(
      (c) => c.quickSwitchEnabled,
      (c, on) => ({ ...c, quickSwitchEnabled: on }),
    ),
  },
  {
    id: 'targets',
    title: mark('Targets and holidays'),
    group: 'Tracking',
    privacy: (os) => t('Your schedule and exceptions stay on {place}.', { place: local(os) }),
    permission: none,
    binding: { kind: 'info', text: mark('Always on. Progress, day reviews and statistics follow your weekly schedule.') },
  },
  {
    id: 'calendar',
    title: mark('Calendar meetings'),
    group: 'Meetings',
    privacy: () => t('Calendar events stay on your Mac and are never sent to Azure or 7pace.'),
    permission: () => mark('Calendar access'),
    binding: field(
      (c) => c.calendarEnabled,
      (c, on) => ({ ...c, calendarEnabled: on }),
    ),
    needsCalendar: true,
  },
  {
    id: 'microphone',
    title: mark('Microphone meetings'),
    group: 'Meetings',
    privacy: () => t('Reads which apps use the microphone; never records audio.'),
    permission: (os) => (os === 'windows' ? mark('None') : mark('None (macOS 14.2 or later)')),
    binding: field(
      (c) => c.microphone.enabled,
      (c, on) => ({ ...c, microphone: { ...c.microphone, enabled: on } }),
    ),
    needsMicrophone: true,
  },
  {
    id: 'meetingEnd',
    title: mark('Meeting-end reminders'),
    group: 'Meetings',
    privacy: () => t('Uses the same calendar and microphone signals as the meeting suggestions.'),
    permission: none,
    binding: {
      kind: 'info',
      text: mark('Follow Calendar meetings and Microphone meetings. Choose how they interrupt under Notifications (Meeting ended, Return after meetings).'),
    },
  },
  {
    id: 'dayReview',
    title: mark('Day review'),
    group: 'Tracking',
    privacy: (os) => t('Reminds you to review your day. Review status is stored only on {place}.', { place: local(os) }),
    permission: () => mark('Notifications (optional)'),
    binding: field(
      (c) => c.dayReview.enabled,
      (c, on) => ({ ...c, dayReview: { ...c.dayReview, enabled: on } }),
    ),
  },
  {
    id: 'agenda',
    title: mark('Calendar on Today'),
    group: 'Views',
    privacy: () => t('Shows events from the calendars you choose. Events stay on your Mac.'),
    permission: () => mark('Calendar access'),
    binding: { kind: 'page', page: 'agenda', where: mark('Shows your calendar next to tracked time on Today. Settings → Calendars stays available for meeting suggestions.') },
    needsCalendar: true,
  },
  {
    id: 'offlineDrafts',
    title: mark('Offline drafts and local timer'),
    group: 'Views',
    privacy: (os) => t('Drafts stay on {place} until you upload them.', { place: local(os) }),
    permission: none,
    binding: { kind: 'page', page: 'offlineDrafts', where: mark('Shows Drafts in Timesheet.') },
  },
  {
    id: 'weeklyReport',
    title: mark('Weekly report'),
    group: 'Views',
    privacy: (os) => t('Report drafts are stored on {place}.', { place: local(os) }),
    permission: none,
    binding: { kind: 'page', page: 'weeklyReport', where: mark('Shows the weekly report in Insights.') },
  },
  {
    id: 'statistics',
    title: mark('Statistics'),
    group: 'Views',
    privacy: (os) => t('Calculated on {place} from your 7pace worklogs.', { place: local(os) }),
    permission: none,
    binding: { kind: 'page', page: 'statistics', where: mark('Shows Where time went and Patterns in Insights.') },
  },
  {
    id: 'timeEditor',
    title: mark('Time editor'),
    group: 'Views',
    privacy: (os) => t('Changes reach 7pace only when you save them. The recovery journal stays on {place}.', { place: local(os) }),
    permission: none,
    binding: { kind: 'page', page: 'timeEditor', where: mark('Shows Day in Timesheet, where you split, merge and correct entries.') },
  },
  {
    id: 'updates',
    title: mark('Check for updates automatically'),
    group: 'App',
    privacy: () => t('Checks the public update feed. No personal data is sent.'),
    permission: none,
    binding: field(
      (c) => c.automaticUpdateChecks,
      (c, on) => ({ ...c, automaticUpdateChecks: on }),
    ),
  },
  {
    id: 'launchAtLogin',
    title: mark('Launch at login'),
    group: 'App',
    privacy: () => t('Opens Azure timetracker when you sign in. Applies immediately.'),
    permission: (os) => (os === 'windows' ? mark('None') : mark('Login items')),
    binding: { kind: 'launchAtLogin' },
  },
  {
    id: 'notifications',
    title: mark('Notifications'),
    group: 'App',
    privacy: () => t('Shown by the system notification centre on this device only.'),
    permission: () => mark('Notifications'),
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
