import type { AppSlice, InterfacePreferences, PageInfo, SliceMap } from '../../contract';

const page = (id: string, title: string, group: string, extra: Partial<PageInfo> = {}): PageInfo => ({
  id,
  title,
  group,
  hidden: false,
  available: true,
  badge: null,
  dot: false,
  ...extra,
});

/** The app on macOS, idle, with one pending branch change on Overview and a due day review. */
export const sampleApp: AppSlice = {
  version: '2.0.0',
  os: 'macos',
  preview: false,
  onboarding: false,
  visiblePage: 'overview',
  pages: [
    page('overview', 'Overview', 'today', { badge: 1 }),
    page('dayReview', 'Day review', 'today', { dot: true }),
    page('agenda', 'Agenda', 'today'),
    page('offlineDrafts', 'Offline drafts', 'today'),
    page('statistics', 'Statistics', 'insights'),
    page('weeklyReport', 'Weekly report', 'insights'),
    page('history', 'History', 'insights'),
    page('timeEditor', 'Time editor', 'insights'),
    page('repositories', 'Repositories', 'setup'),
    page('figma', 'Figma', 'setup'),
    page('settings', 'Settings', 'setup'),
  ],
  busy: false,
  notice: null,
  error: null,
  storageIssue: null,
  features: { calendar: true, microphone: true, figmaTitleOnly: false },
};

/** A 7pace write is in flight: every button that writes is disabled. */
export const busyApp: AppSlice = { ...sampleApp, busy: true };

/** The last tracking error, shown verbatim. */
export const errorApp: AppSlice = {
  ...sampleApp,
  error: 'The 7pace timer changed on the server. Review your current tracking before switching.',
};

/** Windows: no calendar, so no Agenda page and no meeting prompts. */
export const windowsApp: AppSlice = {
  ...sampleApp,
  os: 'windows',
  pages: sampleApp.pages.map((info) => (info.id === 'agenda' ? { ...info, available: false } : info)),
  features: { calendar: false, microphone: true, figmaTitleOnly: true },
};

export const sampleInterface: InterfacePreferences = { theme: 'system', scale: 100, contrast: 'system' };

export default {
  app: sampleApp,
  interface: sampleInterface,
} satisfies Partial<SliceMap>;
