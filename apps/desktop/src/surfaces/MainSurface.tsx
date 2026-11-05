import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AppBanners } from '../features/app/AppBanners';
import { OnboardingGate } from '../features/onboarding/OnboardingGate';
import { TicketContextSheet } from '../features/ticketContext/TicketContextSheet';
import { TicketPickerSheet } from '../features/tracking/TicketPickerSheet';
import { TopBarTimer } from '../features/tracking/TopBarTimer';
import { isTauri } from '../ipc';
import { onNavigate } from '../ipc/shell';
import { AppShell } from '../layout/AppShell';
import { NavigationContext, type Navigation } from '../layout/NavigationContext';
import {
  enginePages,
  pageVisibility,
  parseNavTarget,
  resolveRoute,
  routeKey,
  routesEqual,
  toRoute,
  type NavTarget,
  type Route,
} from '../layout/navigation';
import { PageFallback } from '../places/PageFallback';
import { PLACE_COMPONENTS } from '../places/registry';
import { useAction, useSlice } from '../state/hooks';

/**
 * Tells the engine what the view shows (`null` while the main window is hidden): the view's
 * first page, plus the pages it shows part of, so those load and refresh too.
 */
function useVisiblePages(page: string, also: readonly string[]) {
  const { run } = useAction();
  const alsoKey = also.join(',');
  useEffect(() => {
    const report = () => {
      void run(
        document.hidden
          ? { type: 'app.setVisiblePage', page: null }
          : { type: 'app.setVisiblePage', page, also: alsoKey ? alsoKey.split(',') : [] },
      );
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [page, alsoKey, run]);
}

/** Main window: the top bar, banners, the current place and the global sheets. */
export function MainSurface() {
  const app = useSlice('app');
  // Reopening the window shows the view the engine last saw (a 1.14 page id), else Today.
  const [route, setRoute] = useState<Route>(() => parseNavTarget(app?.visiblePage) ?? { place: 'today' });

  const platform = app ? (app.os === 'windows' ? 'windows' : 'macos') : undefined;
  const pages = app?.pages;
  const hiddenKey = (pages ?? [])
    .filter((info) => info.hidden || !info.available)
    .map((info) => info.id)
    .join(',');
  const isPageVisible = useMemo(
    () => pageVisibility({ platform: platform ?? 'macos', hiddenPages: hiddenKey ? hiddenKey.split(',') : [] }),
    [platform, hiddenKey],
  );

  // A view the user just hid is no longer reachable: its place's first view, or Today.
  const current = resolveRoute(route, isPageVisible);
  const { page, also } = enginePages(current, isPageVisible);
  useVisiblePages(page, also);

  const navigate = useCallback((target: NavTarget) => {
    const next = toRoute(target);
    setRoute((previous) => (routesEqual(previous, next) ? previous : next));
  }, []);
  const canNavigate = useCallback(
    (target: NavTarget) => {
      const wanted = toRoute(target);
      return routesEqual(resolveRoute(wanted, isPageVisible), wanted);
    },
    [isPageVisible],
  );
  // Keyed by the route's string so the context stays stable while the route object is recreated.
  const currentKey = routeKey(current);
  const navigation = useMemo<Navigation>(
    () => ({ route: parseNavTarget(currentKey) ?? { place: 'today' }, navigate, canNavigate, isPageVisible }),
    [currentKey, navigate, canNavigate, isPageVisible],
  );

  // The shell asks for a view: tray menu "Settings…", a prompt's "Review in Time editor", …
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onNavigate((requested) => {
      const target = parseNavTarget(requested);
      if (target) navigate(target);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);

  const Place = PLACE_COMPONENTS[current.place];

  return (
    <OnboardingGate>
      <NavigationContext.Provider value={navigation}>
        <AppShell
          route={current}
          onNavigate={navigate}
          isPageVisible={isPageVisible}
          platform={platform}
          timer={<TopBarTimer />}
          banners={<AppBanners />}
        >
          <Suspense fallback={<PageFallback />}>
            <Place />
          </Suspense>
        </AppShell>
        <TicketPickerSheet />
        <TicketContextSheet />
      </NavigationContext.Provider>
    </OnboardingGate>
  );
}
