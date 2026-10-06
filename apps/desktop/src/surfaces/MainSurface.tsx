import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { StatusDot } from '../components/Badge';
import { Skeleton } from '../components/EmptyState';
import { AppBanners } from '../features/app/AppBanners';
import { ConnectionStatus } from '../features/app/ConnectionStatus';
import { PageHeaderSlotContext } from '../features/app/PageHeaderActions';
import { OnboardingGate } from '../features/onboarding/OnboardingGate';
import { TicketContextSheet } from '../features/ticketContext/TicketContextSheet';
import { TicketPickerSheet } from '../features/tracking/TicketPickerSheet';
import { isTauri } from '../ipc';
import type { PageInfo } from '../ipc/contract';
import { onNavigate } from '../ipc/shell';
import { AppShell, type NavIndicator } from '../layout/AppShell';
import { PAGES, type PageId } from '../layout/navigation';
import { PageHeader } from '../layout/PageHeader';
import { PAGE_COMPONENTS } from '../pages/registry';
import { useAction, useSlice } from '../state/hooks';
import styles from './surfaces.module.css';

function isPageId(value: string | null | undefined): value is PageId {
  return !!value && Object.hasOwn(PAGES, value);
}

function indicatorFor(page: PageInfo): NavIndicator | undefined {
  if (page.badge) {
    const count = page.badge;
    const label =
      page.id === 'overview'
        ? `${count} pending ${count === 1 ? 'suggestion' : 'suggestions'}`
        : page.id === 'offlineDrafts'
          ? `${count} ${count === 1 ? 'draft' : 'drafts'} ready to upload`
          : `${count} pending`;
    return { count, label };
  }
  if (page.dot) return { dot: true, label: page.id === 'dayReview' ? 'Review pending' : 'Needs attention' };
  return undefined;
}

/** Tells the engine which page is on screen (`null` while the main window is hidden). */
function useVisiblePage(page: PageId) {
  const visible = useAction();
  const { run } = visible;
  useEffect(() => {
    const report = () => {
      void run({ type: 'app.setVisiblePage', page: document.hidden ? null : page });
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [page, run]);
}

function WatchingFooter() {
  const repositories = useSlice('repositories');
  const toggle = useAction();
  if (!repositories) return null;
  const watching = repositories.watching;
  return (
    <div className={styles.sidebarFooter}>
      <StatusDot
        tone={watching ? 'running' : 'paused'}
        label={watching ? 'Watching branches' : 'Observations paused'}
        showLabel
      />
      <Button
        size="small"
        fullWidth
        isPending={toggle.pending}
        onPress={() => void toggle.run({ type: 'repositories.toggleWatching' })}
      >
        {watching ? 'Pause watching' : 'Resume watching'}
      </Button>
    </div>
  );
}

function PageFallback() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton lines={4} />
    </div>
  );
}

/** Main window: sidebar pages from the engine, header, banners, the page and global sheets. */
export function MainSurface() {
  const app = useSlice('app');
  const [page, setPage] = useState<PageId>(() => (isPageId(app?.visiblePage) ? app.visiblePage : 'overview'));
  useVisiblePage(page);

  const pages = app?.pages;
  const hiddenPages = useMemo(
    () => (pages ?? []).filter((info) => info.hidden || !info.available).map((info) => info.id),
    [pages],
  );
  const indicators = useMemo(() => {
    const result: Partial<Record<PageId, NavIndicator>> = {};
    for (const info of pages ?? []) {
      const indicator = indicatorFor(info);
      if (indicator && isPageId(info.id)) result[info.id] = indicator;
    }
    return result;
  }, [pages]);

  const navigate = useCallback((next: PageId) => setPage(next), []);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  // The shell asks for a page (tray menu "Settings…", a prompt's "Review in Time editor", …).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onNavigate((requested) => {
      if (isPageId(requested)) setPage(requested);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // A page the user just hid is no longer reachable: fall back to Overview.
  const current: PageId = hiddenPages.includes(page) ? 'overview' : page;
  const definition = PAGES[current];
  const Page = PAGE_COMPONENTS[current];

  return (
    <OnboardingGate>
      <AppShell
        currentPage={current}
        onNavigate={navigate}
        platform={app ? (app.os === 'windows' ? 'windows' : 'macos') : undefined}
        hiddenPages={hiddenPages}
        indicators={indicators}
        header={
          <PageHeader
            title={definition.title}
            status={<ConnectionStatus />}
            actions={<div ref={setHeaderSlot} className={styles.headerActions} />}
          />
        }
        banners={<AppBanners />}
        sidebarFooter={<WatchingFooter />}
      >
        <PageHeaderSlotContext.Provider value={headerSlot}>
          <Suspense fallback={<PageFallback />}>
            <Page />
          </Suspense>
        </PageHeaderSlotContext.Provider>
      </AppShell>
      <TicketPickerSheet />
      <TicketContextSheet />
    </OnboardingGate>
  );
}
