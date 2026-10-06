import {
  AgendaIcon,
  DayReviewIcon,
  FigmaIcon,
  HistoryIcon,
  OfflineDraftsIcon,
  OverviewIcon,
  RepositoriesIcon,
  SettingsIcon,
  StatisticsIcon,
  TimeEditorIcon,
  WeeklyReportIcon,
  type IconComponent,
} from '../components/icons';
import type { Platform } from '../shortcuts/platform';

export type PageId =
  | 'overview'
  | 'dayReview'
  | 'agenda'
  | 'offlineDrafts'
  | 'statistics'
  | 'weeklyReport'
  | 'history'
  | 'timeEditor'
  | 'repositories'
  | 'figma'
  | 'settings';

/**
 * Feature-registry modules that own a page (rewrite plan §9). A page whose module is switched off
 * disappears from the sidebar, the shortcuts and the command palette.
 */
export type FeatureId =
  | 'calendarMeetings'
  | 'offlineDrafts'
  | 'dayReview'
  | 'statistics'
  | 'weeklyReport'
  | 'timeEditor'
  | 'figmaContext';

export type FeatureFlags = Partial<Record<FeatureId, boolean>>;

export interface PageDefinition {
  id: PageId;
  /** Sidebar label, page title and palette entry (strings from 1.14 `AppPage`). */
  title: string;
  icon: IconComponent;
  feature?: FeatureId;
  /** Platforms that can show the page at all. Omitted means every platform. */
  platforms?: readonly Platform[];
}

export const PAGES: Readonly<Record<PageId, PageDefinition>> = {
  overview: { id: 'overview', title: 'Overview', icon: OverviewIcon },
  dayReview: { id: 'dayReview', title: 'Day review', icon: DayReviewIcon, feature: 'dayReview' },
  // Windows has no calendar source at launch (decision 2 in the rewrite plan).
  agenda: { id: 'agenda', title: 'Agenda', icon: AgendaIcon, feature: 'calendarMeetings', platforms: ['macos'] },
  offlineDrafts: { id: 'offlineDrafts', title: 'Offline drafts', icon: OfflineDraftsIcon, feature: 'offlineDrafts' },
  statistics: { id: 'statistics', title: 'Statistics', icon: StatisticsIcon, feature: 'statistics' },
  weeklyReport: { id: 'weeklyReport', title: 'Weekly report', icon: WeeklyReportIcon, feature: 'weeklyReport' },
  history: { id: 'history', title: 'History', icon: HistoryIcon },
  timeEditor: { id: 'timeEditor', title: 'Time editor', icon: TimeEditorIcon, feature: 'timeEditor' },
  repositories: { id: 'repositories', title: 'Repositories', icon: RepositoriesIcon },
  figma: { id: 'figma', title: 'Figma', icon: FigmaIcon, feature: 'figmaContext' },
  settings: { id: 'settings', title: 'Settings', icon: SettingsIcon },
};

export interface NavGroup {
  id: 'today' | 'insights' | 'setup';
  title: string;
  pages: readonly PageId[];
}

/** Sidebar order from 1.14.2 (`RootView.sidebar`). */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'today', title: 'Today', pages: ['overview', 'dayReview', 'agenda', 'offlineDrafts'] },
  { id: 'insights', title: 'Insights', pages: ['statistics', 'weeklyReport', 'history', 'timeEditor'] },
  { id: 'setup', title: 'Setup', pages: ['repositories', 'figma', 'settings'] },
];

export interface VisibilityOptions {
  platform: Platform;
  features?: FeatureFlags;
}

export function isPageVisible(page: PageDefinition, { platform, features = {} }: VisibilityOptions): boolean {
  if (page.platforms && !page.platforms.includes(platform)) return false;
  if (page.feature && features[page.feature] === false) return false;
  return true;
}

export interface VisibleNavGroup {
  group: NavGroup;
  pages: PageDefinition[];
}

export function visibleNavGroups(options: VisibilityOptions): VisibleNavGroup[] {
  return NAV_GROUPS.map((group) => ({
    group,
    pages: group.pages.map((id) => PAGES[id]).filter((page) => isPageVisible(page, options)),
  })).filter((entry) => entry.pages.length > 0);
}

/** Visible pages in sidebar order; page shortcuts are numbered from this list. */
export function visiblePages(options: VisibilityOptions): PageDefinition[] {
  return visibleNavGroups(options).flatMap((entry) => entry.pages);
}
