/**
 * Test-only: the Insights place inside the main window frame, with working navigation.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { SliceMap } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
import { AppShell } from '../../layout/AppShell';
import { NavigationContext, type Navigation } from '../../layout/NavigationContext';
import { pageVisibility, resolveRoute, routesEqual, toRoute, type InsightsView, type Route } from '../../layout/navigation';
import { renderWithEngine } from '../../test/engine';
import { ExtrasProvider, type ExtrasId } from './Extras';
import InsightsPlace from './index';

export interface HarnessProps {
  /** Extras open from the start (the retained 1.14 blocks are closed by default). */
  openExtras?: readonly ExtrasId[];
  view?: InsightsView;
  hiddenPages?: string[];
  onNavigate?: (route: Route) => void;
  children?: ReactNode;
}

export function InsightsHarness({ view = 'time', hiddenPages = [], openExtras, onNavigate, children }: HarnessProps) {
  const [route, setRoute] = useState<Route>({ place: 'insights', view });
  const hiddenKey = hiddenPages.join(',');
  const isPageVisible = useMemo(() => pageVisibility({ platform: 'macos', hiddenPages: hiddenKey ? hiddenKey.split(',') : [] }), [hiddenKey]);
  const current = resolveRoute(route, isPageVisible);
  const navigation: Navigation = {
    route: current,
    navigate: (target) => {
      const next = toRoute(target);
      setRoute(next);
      onNavigate?.(next);
    },
    canNavigate: (target) => routesEqual(resolveRoute(toRoute(target), isPageVisible), toRoute(target)),
    isPageVisible,
  };
  return (
    <NavigationContext.Provider value={navigation}>
      <AppShell route={current} onNavigate={navigation.navigate} isPageVisible={isPageVisible}>
        {current.place === 'insights' ? (
          openExtras ? (
            <ExtrasProvider initial={openExtras}>
              <InsightsPlace />
            </ExtrasProvider>
          ) : (
            <InsightsPlace />
          )
        ) : (
          <p>{`Left Insights for ${current.place}`}</p>
        )}
      </AppShell>
      {children}
    </NavigationContext.Provider>
  );
}

/** Renders Insights on `view` with the sample slices, overridden by `slices` (`null` removes one). */
export function renderInsights(
  { view = 'time', hiddenPages, openExtras, onNavigate, children }: HarnessProps = {},
  slices: { [K in keyof SliceMap]?: SliceMap[K] | null } = {},
) {
  const all = sampleSlices();
  for (const [name, value] of Object.entries(slices)) {
    if (value === null) delete all[name as keyof SliceMap];
    else (all as Record<string, unknown>)[name] = value;
  }
  return renderWithEngine(
    <InsightsHarness view={view} hiddenPages={hiddenPages} openExtras={openExtras} onNavigate={onNavigate}>
      {children}
    </InsightsHarness>,
    { slices: all },
  );
}
