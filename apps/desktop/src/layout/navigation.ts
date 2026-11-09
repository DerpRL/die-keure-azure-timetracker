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
import { mark } from '../i18n';
import type { Platform } from '../shortcuts/platform';

/*
 * Navigation (2.2 layout, "four places instead of 13 pages"): Today, Timesheet and Insights in
 * the top bar, Settings behind the gear. The engine, the shell and saved settings still speak the
 * 1.14 page ids (`PageId`): they decide what loads and refreshes, which pages a user hid, and what
 * the tray menu and prompts ask the main window to show. This module maps between the two.
 */

/** The 1.14 sidebar pages: the engine's page ids. */
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
 * disappears, with the views and commands that need it.
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
  /** The 1.14 title (log lines, tests); the UI names views by their `ViewDefinition` titles. */
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

export const PAGE_IDS = Object.keys(PAGES) as PageId[];

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && Object.hasOwn(PAGES, value);
}

export interface VisibilityOptions {
  platform: Platform;
  features?: FeatureFlags;
  /** Pages the user hid (Settings → Features & privacy) or the engine reports as unavailable. */
  hiddenPages?: readonly string[];
}

export function isPageVisible(
  page: PageDefinition,
  { platform, features = {}, hiddenPages = [] }: VisibilityOptions,
): boolean {
  if (page.platforms && !page.platforms.includes(platform)) return false;
  if (page.feature && features[page.feature] === false) return false;
  // Overview and Settings can never be hidden: they are how the user gets back.
  if (page.id !== 'overview' && page.id !== 'settings' && hiddenPages.includes(page.id)) return false;
  return true;
}

// -- Places and views ---------------------------------------------------------------------------

export type PlaceId = 'today' | 'timesheet' | 'insights' | 'settings';
export type TimesheetView = 'week' | 'day' | 'list' | 'drafts';
export type InsightsView = 'time' | 'patterns' | 'report';
export type SettingsView =
  | 'accounts'
  | 'schedule'
  | 'meetings'
  | 'reminders'
  | 'notifications'
  | 'sources'
  | 'git'
  | 'figma'
  | 'calendars'
  | 'appearance'
  | 'features'
  | 'advanced'
  | 'about';

/** Settings views of 2.2–2.3 that were split up, for links and saved routes that still name them. */
export const SETTINGS_VIEW_ALIASES: Readonly<Record<string, SettingsView>> = {
  tracking: 'schedule',
};

/** Where the main window is. Today has a single view; its day is page state. */
export type Route =
  | { place: 'today' }
  | { place: 'timesheet'; view: TimesheetView }
  | { place: 'insights'; view: InsightsView }
  | { place: 'settings'; view: SettingsView };

export type ViewOf<P extends PlaceId> = Extract<Route, { place: P }> extends { view: infer V } ? V : never;

export interface ViewDefinition<V extends string = string> {
  id: V;
  /** English (`mark`): translate where shown, `t(view.title)`. */
  title: string;
  /**
   * The engine pages the view shows. The first is reported as the visible page; the others load
   * and refresh alongside it (`app.setVisiblePage { also }`).
   */
  pages: readonly PageId[];
  /** The view is reachable while this page is visible (unset: always). */
  requires?: PageId;
  /**
   * The view is reachable while this page exists on this platform with its feature on, even when
   * the user hid the page (Calendars settings stay when the calendar is hidden from Today).
   */
  requiresAvailable?: PageId;
}

export interface PlaceDefinition {
  id: PlaceId;
  /** English (`mark`): translate where shown, `t(place.title)`. */
  title: string;
  /** Top-bar tabs; Settings sits behind the gear. */
  inTopBar: boolean;
  /** Views in their order on screen; the first visible one is the default. */
  views: readonly ViewDefinition[];
}

export const PLACES: Readonly<Record<PlaceId, PlaceDefinition>> = {
  today: {
    id: 'today',
    title: mark('Today'),
    inTopBar: true,
    views: [{ id: 'day', title: mark('Today'), pages: ['overview', 'dayReview'] }],
  },
  timesheet: {
    id: 'timesheet',
    title: mark('Timesheet'),
    inTopBar: true,
    views: [
      { id: 'week', title: mark('Week'), pages: ['history', 'timeEditor'], requires: 'history' },
      { id: 'day', title: mark('Day'), pages: ['timeEditor'], requires: 'timeEditor' },
      { id: 'list', title: mark('List'), pages: ['history'], requires: 'history' },
      { id: 'drafts', title: mark('Drafts'), pages: ['offlineDrafts'], requires: 'offlineDrafts' },
    ],
  },
  insights: {
    id: 'insights',
    title: mark('Insights'),
    inTopBar: true,
    views: [
      { id: 'time', title: mark('Where time went'), pages: ['statistics', 'weeklyReport'], requires: 'statistics' },
      { id: 'patterns', title: mark('Patterns'), pages: ['statistics'], requires: 'statistics' },
      { id: 'report', title: mark('Weekly report'), pages: ['weeklyReport'], requires: 'weeklyReport' },
    ],
  },
  settings: {
    id: 'settings',
    title: mark('Settings'),
    inTopBar: false,
    views: [
      { id: 'accounts', title: mark('Azure DevOps & 7pace'), pages: ['settings'] },
      { id: 'schedule', title: mark('Schedule & holidays'), pages: ['settings'] },
      { id: 'meetings', title: mark('Meetings'), pages: ['settings'] },
      { id: 'reminders', title: mark('Reminders'), pages: ['settings'] },
      { id: 'notifications', title: mark('Notifications'), pages: ['settings'] },
      { id: 'sources', title: mark('Overview'), pages: ['settings', 'repositories', 'figma'] },
      { id: 'git', title: mark('Git repositories'), pages: ['repositories'] },
      { id: 'figma', title: mark('Figma'), pages: ['figma'], requires: 'figma' },
      { id: 'calendars', title: mark('Calendars'), pages: ['settings', 'agenda'], requiresAvailable: 'agenda' },
      { id: 'appearance', title: mark('Appearance & shortcuts'), pages: ['settings'] },
      { id: 'features', title: mark('Features & privacy'), pages: ['settings'] },
      { id: 'advanced', title: mark('Updates & advanced'), pages: ['settings'] },
      { id: 'about', title: mark('About'), pages: ['settings'] },
    ],
  },
};

export const PLACE_ORDER: readonly PlaceId[] = ['today', 'timesheet', 'insights', 'settings'];

/** The Settings menu: groups of views, as in the design's settings sidebar (titles: `t(group.title)`). */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: string; title: string; views: readonly SettingsView[] }> = [
  { id: 'account', title: mark('Account'), views: ['accounts'] },
  { id: 'tracking', title: mark('Tracking'), views: ['schedule', 'meetings', 'reminders', 'notifications'] },
  { id: 'sources', title: mark('Sources'), views: ['sources', 'git', 'figma', 'calendars'] },
  { id: 'app', title: mark('App'), views: ['appearance', 'features', 'advanced', 'about'] },
];

function routeView(route: Route): string {
  return route.place === 'today' ? 'day' : route.view;
}

export function viewDefinition(route: Route): ViewDefinition {
  const place = PLACES[route.place];
  const id = routeView(route);
  return place.views.find((view) => view.id === id) ?? place.views[0]!;
}

export function routesEqual(a: Route, b: Route): boolean {
  return a.place === b.place && routeView(a) === routeView(b);
}

/** A stable string for a route (`timesheet/week`), also accepted by `parseNavTarget`. */
export function routeKey(route: Route): string {
  return route.place === 'today' ? 'today' : `${route.place}/${route.view}`;
}

function makeRoute(place: PlaceId, view: string): Route {
  return (place === 'today' ? { place } : { place, view }) as Route;
}

/** Whether a page is reachable; `available` ignores what the user hid. */
export interface PageVisibility {
  (page: PageId): boolean;
  available?: (page: PageId) => boolean;
}

/** Whether the page is reachable with these options. */
export function pageVisibility(options: VisibilityOptions): PageVisibility {
  const visible: PageVisibility = (page) => isPageVisible(PAGES[page], options);
  visible.available = (page) => isPageVisible(PAGES[page], { ...options, hiddenPages: [] });
  return visible;
}

export function isViewVisible(view: ViewDefinition, visible: PageVisibility): boolean {
  if (view.requires && !visible(view.requires)) return false;
  if (view.requiresAvailable && !(visible.available ?? visible)(view.requiresAvailable)) return false;
  return true;
}

export function visibleViews(place: PlaceId, visible: PageVisibility): ViewDefinition[] {
  return PLACES[place].views.filter((view) => isViewVisible(view, visible));
}

/** Places with at least one visible view, in top-bar order (Today and Settings always). */
export function visiblePlaces(visible: PageVisibility): PlaceDefinition[] {
  return PLACE_ORDER.map((id) => PLACES[id]).filter((place) => visibleViews(place.id, visible).length > 0);
}

/**
 * The route to show for `route` with these pages visible: its own view if visible, else the
 * place's first visible view, else Today.
 */
export function resolveRoute(route: Route, visible: PageVisibility): Route {
  const views = visibleViews(route.place, visible);
  if (views.length === 0) return { place: 'today' };
  const id = routeView(route);
  const view = views.find((entry) => entry.id === id) ?? views[0]!;
  return makeRoute(route.place, view.id);
}

/** The default route of a place (its first view; `resolveRoute` skips hidden ones). */
export function placeRoute(place: PlaceId): Route {
  return makeRoute(place, PLACES[place].views[0]!.id);
}

/** Where a 1.14 page id lives now. */
export const LEGACY_ROUTES: Readonly<Record<PageId, Route>> = {
  overview: { place: 'today' },
  dayReview: { place: 'today' },
  agenda: { place: 'today' },
  offlineDrafts: { place: 'timesheet', view: 'drafts' },
  statistics: { place: 'insights', view: 'time' },
  weeklyReport: { place: 'insights', view: 'report' },
  history: { place: 'timesheet', view: 'list' },
  timeEditor: { place: 'timesheet', view: 'day' },
  repositories: { place: 'settings', view: 'git' },
  figma: { place: 'settings', view: 'figma' },
  settings: { place: 'settings', view: 'accounts' },
};

/** Something the app can be asked to show: a 1.14 page id or a route. */
export type NavTarget = PageId | Route;

/**
 * Reads a navigation request from the shell or a saved state: a 1.14 page id (`timeEditor`), a
 * place (`insights`) or a place and view (`settings/git`). `null` when it names nothing.
 */
export function parseNavTarget(value: string | null | undefined): Route | null {
  if (!value) return null;
  if (isPageId(value)) return LEGACY_ROUTES[value];
  const [place = '', named] = value.split('/');
  if (!Object.hasOwn(PLACES, place)) return null;
  const definition = PLACES[place as PlaceId];
  if (named === undefined) return placeRoute(definition.id);
  const view = place === 'settings' ? (SETTINGS_VIEW_ALIASES[named] ?? named) : named;
  return definition.views.some((entry) => entry.id === view) ? makeRoute(definition.id, view) : null;
}

export function toRoute(target: NavTarget): Route {
  return typeof target === 'string' ? LEGACY_ROUTES[target] : target;
}

/** What the engine is told for a route: the first page, plus the visible others. */
export function enginePages(route: Route, visible: PageVisibility): { page: PageId; also: PageId[] } {
  const [page = 'overview', ...rest] = viewDefinition(route).pages;
  return { page, also: rest.filter(visible) };
}
