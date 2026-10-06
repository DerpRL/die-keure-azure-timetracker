import type { PageInfo, SliceMap } from '../../contract';

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

export default {
  app: {
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
  },
  interface: { theme: 'system', scale: 100, contrast: 'system' },
} satisfies Partial<SliceMap>;
