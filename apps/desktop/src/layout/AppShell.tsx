import { useId, useMemo, type ReactNode } from 'react';
import { Badge, StatusDot, type Tone } from '../components/Badge';
import { ChevronRightIcon, ClockIcon } from '../components/icons';
import { pageShortcutDigit, usePageCommands } from '../shortcuts/hooks';
import { formatKeyCombo } from '../shortcuts/keys';
import { usePlatform, type Platform } from '../shortcuts/platform';
import { cx } from '../utils/cx';
import { visibleNavGroups, type FeatureFlags, type PageId } from './navigation';
import { PageTitleContext } from './pageTitle';
import styles from './AppShell.module.css';

export interface NavIndicator {
  /** Count badge, e.g. pending branch changes on Overview. */
  count?: number;
  /** Small dot, e.g. a pending day review. */
  dot?: boolean;
  /** What the indicator means, for screen readers: "3 pending branch changes", "Review pending". */
  label: string;
  tone?: Tone;
}

export interface AppShellProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  /** Defaults to the detected platform. */
  platform?: Platform;
  features?: FeatureFlags;
  indicators?: Partial<Record<PageId, NavIndicator>>;
  /** Bottom of the sidebar: watching status and the pause button in 1.14. */
  sidebarFooter?: ReactNode;
  /** Usually a `PageHeader`; rendered at the top of the main landmark. */
  header?: ReactNode;
  /** Update, preview and error banners between the header and the page. */
  banners?: ReactNode;
  children: ReactNode;
}

/**
 * Main window frame: sidebar navigation (Today / Insights / Setup), page header, banners and the
 * scrolling page. Registers ⌘1…⌘0 (Ctrl on Windows) in the visible sidebar order.
 */
export function AppShell({
  currentPage,
  onNavigate,
  platform: platformOverride,
  features,
  indicators = {},
  sidebarFooter,
  header,
  banners,
  children,
}: AppShellProps) {
  const detected = usePlatform();
  const platform = platformOverride ?? detected;
  const groups = useMemo(() => visibleNavGroups({ platform, features }), [platform, features]);
  const pages = useMemo(() => groups.flatMap((entry) => entry.pages), [groups]);
  usePageCommands(pages, onNavigate);
  const idPrefix = useId();

  return (
    <div className={styles.shell} data-surface="main">
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <nav aria-label="Sections" className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandTile} aria-hidden="true">
            <ClockIcon />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>Azure</span>
            <span className={styles.brandSub}>timetracker</span>
          </span>
        </div>
        <div className={styles.groups}>
          {groups.map(({ group, pages: groupPages }) => {
            const headingId = `${idPrefix}-${group.id}`;
            return (
              <div key={group.id} className={styles.group}>
                <h2 id={headingId} className={styles.groupTitle}>
                  {group.title}
                </h2>
                <ul role="list" aria-labelledby={headingId} className={styles.list}>
                  {groupPages.map((page) => {
                    const selected = page.id === currentPage;
                    const indicator = indicators[page.id];
                    const digit = pageShortcutDigit(pages.indexOf(page));
                    const Icon = page.icon;
                    return (
                      <li key={page.id}>
                        <button
                          type="button"
                          className={cx(styles.item, selected && styles.selected)}
                          aria-current={selected ? 'page' : undefined}
                          // "Overview, 3 pending branch changes": the visible label stays first (WCAG 2.5.3).
                          aria-label={indicator ? `${page.title}, ${indicator.label}` : undefined}
                          aria-keyshortcuts={digit ? formatKeyCombo({ key: digit, mod: true }, platform).aria : undefined}
                          onClick={() => onNavigate(page.id)}
                        >
                          <Icon className={styles.itemIcon} />
                          <span className={styles.itemLabel}>{page.title}</span>
                          {indicator?.count ? (
                            <Badge tone={indicator.tone ?? 'warning'} accessibleLabel={indicator.label}>
                              {indicator.count}
                            </Badge>
                          ) : null}
                          {indicator?.dot ? <StatusDot tone={indicator.tone ?? 'running'} label={indicator.label} /> : null}
                          {selected ? <ChevronRightIcon className={styles.chevron} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        {sidebarFooter ? <div className={styles.sidebarFooter}>{sidebarFooter}</div> : null}
      </nav>
      <main
        id="main-content"
        tabIndex={-1}
        className={styles.main}
        aria-labelledby={header ? `${idPrefix}-title` : undefined}
      >
        <PageTitleContext.Provider value={`${idPrefix}-title`}>{header}</PageTitleContext.Provider>
        {banners ? <div className={styles.banners}>{banners}</div> : null}
        <div className={styles.page}>{children}</div>
      </main>
    </div>
  );
}
