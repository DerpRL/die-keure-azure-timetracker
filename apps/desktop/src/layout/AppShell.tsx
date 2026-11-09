import { useCallback, useId, useMemo, type ReactNode } from 'react';
import { AppLogo } from '../components/AppLogo';
import { IconButton } from '../components/Button';
import { KeyboardShortcut } from '../components/KeyboardShortcut';
import { SearchIcon, SettingsIcon } from '../components/icons';
import { pageShortcutDigit, useCommands, useShortcutUi } from '../shortcuts/hooks';
import { PALETTE_SHORTCUT } from '../shortcuts/ShortcutProvider';
import { formatKeyCombo, type KeyCombo } from '../shortcuts/keys';
import { usePlatform, type Platform } from '../shortcuts/platform';
import type { Command } from '../shortcuts/store';
import { mark, t } from '../i18n';
import { cx } from '../utils/cx';
import {
  LEGACY_ROUTES,
  PAGE_IDS,
  PLACES,
  placeRoute,
  resolveRoute,
  routesEqual,
  visiblePlaces,
  type NavTarget,
  type PageVisibility,
  type PlaceId,
  type Route,
} from './navigation';
import { PageTitleContext } from './pageTitle';
import styles from './AppShell.module.css';

export const SETTINGS_SHORTCUT: KeyCombo = { key: ',', mod: true };

/** The places' colours in the palette (2.2 structure map: blue, green, purple, orange). */
const PLACE_SWATCHES: Readonly<Record<PlaceId, string>> = {
  today: 'var(--chart-2)',
  timesheet: 'var(--chart-1)',
  insights: 'var(--chart-3)',
  settings: 'var(--chart-4)',
};

/** Views that get their own "Go to" entry in the palette besides the places (labels: `t`). */
const PALETTE_VIEWS: ReadonlyArray<{ route: Route; label: string; keywords: readonly string[] }> = [
  { route: { place: 'insights', view: 'report' }, label: mark('Weekly report'), keywords: ['status', 'markdown'] },
  { route: { place: 'insights', view: 'patterns' }, label: mark('Patterns'), keywords: ['heatmap', 'statistics'] },
  { route: { place: 'timesheet', view: 'day' }, label: mark('Day in Timesheet'), keywords: ['time editor', 'edit', 'split'] },
  { route: { place: 'timesheet', view: 'list' }, label: mark('Worklog list'), keywords: ['history', 'csv', 'export'] },
  { route: { place: 'timesheet', view: 'drafts' }, label: mark('Offline drafts'), keywords: ['offline', 'upload'] },
  { route: { place: 'settings', view: 'git' }, label: mark('Git repositories'), keywords: ['branches', 'repositories'] },
  { route: { place: 'settings', view: 'figma' }, label: mark('Figma'), keywords: ['design', 'sources'] },
  { route: { place: 'settings', view: 'appearance' }, label: mark('Appearance'), keywords: ['theme', 'dark', 'size'] },
];

export interface AppShellProps {
  route: Route;
  onNavigate: (target: NavTarget) => void;
  /** Which 1.14 pages are reachable (hidden by the user, unavailable on this OS). */
  isPageVisible: PageVisibility;
  /** Defaults to the detected platform. */
  platform?: Platform;
  /** The running timer in the top bar. */
  timer?: ReactNode;
  /** Update, preview and error banners between the top bar and the view. */
  banners?: ReactNode;
  children: ReactNode;
}

/**
 * Main window frame (2.2 layout): a top bar with the app name, Today / Timesheet / Insights, the
 * command palette, the running timer and Settings behind the gear; then banners and the view.
 * Registers ⌘1… for the top-bar places in their order, ⌘, for Settings and a palette entry per
 * place and per main view. The 1.14 page ids stay reachable as hidden `page.<id>` commands, which
 * pages use to open each other.
 */
export function AppShell({
  route,
  onNavigate,
  isPageVisible,
  platform: platformOverride,
  timer,
  banners,
  children,
}: AppShellProps) {
  const detected = usePlatform();
  const platform = platformOverride ?? detected;
  const { openPalette } = useShortcutUi();
  const titleId = `${useId()}-title`;

  const places = useMemo(() => visiblePlaces(isPageVisible), [isPageVisible]);
  const tabs = places.filter((place) => place.inTopBar);

  const commands = useMemo((): Command[] => {
    const placeCommands = places.map((place): Command => {
      const digit = place.inTopBar ? pageShortcutDigit(tabs.indexOf(place)) : null;
      return {
        id: `place.${place.id}`,
        label: t(place.title),
        group: 'Pages',
        swatch: PLACE_SWATCHES[place.id],
        keywords: ['go to', 'open'],
        shortcut: place.id === 'settings' ? SETTINGS_SHORTCUT : digit ? { key: digit, mod: true } : undefined,
        allowInInputs: true,
        onAction: () => onNavigate(placeRoute(place.id)),
      };
    });
    const viewCommands = PALETTE_VIEWS.filter((entry) => routesEqual(resolveRoute(entry.route, isPageVisible), entry.route)).map(
      (entry): Command => ({
        id: `view.${entry.route.place}.${'view' in entry.route ? entry.route.view : ''}`,
        label: t(entry.label),
        group: 'Pages',
        swatch: PLACE_SWATCHES[entry.route.place],
        keywords: ['go to', 'open', ...entry.keywords],
        onAction: () => onNavigate(entry.route),
      }),
    );
    // 1.14 page ids, for pages that open each other ("Open this day in History").
    const legacyCommands = PAGE_IDS.filter(isPageVisible).map(
      (page): Command => ({
        id: `page.${page}`,
        label: page,
        group: 'Pages',
        showInPalette: false,
        onAction: () => onNavigate(LEGACY_ROUTES[page]),
      }),
    );
    return [...placeCommands, ...viewCommands, ...legacyCommands];
    // `tabs` derives from `places`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, isPageVisible, onNavigate]);
  useCommands(commands);

  // The top bar wraps at narrow widths and large UI scales; views' sticky toolbars sit right
  // under it through `--top-bar-height`.
  const measureTopBar = useCallback((node: HTMLElement | null) => {
    const shell = node?.parentElement;
    if (!node || !shell) return undefined;
    const update = () => shell.style.setProperty('--top-bar-height', `${node.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);

  const current = PLACES[route.place];
  const settingsOpen = route.place === 'settings';
  const shortcutAria = (place: PlaceId) => {
    if (place === 'settings') return formatKeyCombo(SETTINGS_SHORTCUT, platform).aria;
    const digit = pageShortcutDigit(tabs.findIndex((tab) => tab.id === place));
    return digit ? formatKeyCombo({ key: digit, mod: true }, platform).aria : undefined;
  };

  return (
    <div className={styles.shell} data-surface="main">
      <a href="#main-content" className={styles.skipLink}>
        {t('Skip to content')}
      </a>
      <header ref={measureTopBar} className={styles.topBar}>
        <div className={styles.topLeft}>
          <div className={styles.brand}>
            <AppLogo />
            <span className={styles.brandName}>Azure timetracker</span>
          </div>
          <nav aria-label={t('Main')} className={styles.tabs}>
            {tabs.map((place) => {
              const selected = place.id === route.place;
              return (
                <button
                  key={place.id}
                  type="button"
                  className={cx(styles.tab, selected && styles.tabSelected)}
                  aria-current={selected ? 'page' : undefined}
                  aria-keyshortcuts={shortcutAria(place.id)}
                  onClick={() => onNavigate(placeRoute(place.id))}
                >
                  {t(place.title)}
                </button>
              );
            })}
          </nav>
        </div>
        <div className={styles.topRight}>
          <button
            type="button"
            className={styles.search}
            aria-keyshortcuts={formatKeyCombo(PALETTE_SHORTCUT, platform).aria}
            onClick={openPalette}
          >
            <span className={styles.searchLabel}>
              <SearchIcon className={styles.searchIcon} />
              {t('Search or jump to…')}
            </span>
            <KeyboardShortcut shortcut={PALETTE_SHORTCUT} decorative />
          </button>
          {timer}
          <IconButton
            label={t('Settings')}
            icon={SettingsIcon}
            variant="secondary"
            shortcut={SETTINGS_SHORTCUT}
            className={cx(styles.gear, settingsOpen && styles.gearSelected)}
            aria-current={settingsOpen ? 'page' : undefined}
            onPress={() => onNavigate(placeRoute('settings'))}
          />
        </div>
      </header>
      {banners ? <div className={styles.banners}>{banners}</div> : null}
      <main
        id="main-content"
        tabIndex={-1}
        className={styles.main}
        aria-labelledby={titleId}
        data-place={current.id}
      >
        <PageTitleContext.Provider value={titleId}>{children}</PageTitleContext.Provider>
      </main>
    </div>
  );
}
