/**
 * Test-only: renders the Timesheet place inside the main window frame on a view, with the
 * navigation the main window gives it.
 */
import { useMemo, useState } from 'react';
import type { SliceMap } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
import { AppShell } from '../../layout/AppShell';
import { NavigationContext, type Navigation } from '../../layout/NavigationContext';
import { pageVisibility, resolveRoute, routesEqual, toRoute, type Route, type TimesheetView } from '../../layout/navigation';
import { renderWithEngine } from '../../test/engine';
import TimesheetPlace from './index';

export interface TimesheetRenderOptions {
  /** Slices merged over the samples; `undefined` values remove a slice. */
  with?: Partial<{ [K in keyof SliceMap]: SliceMap[K] | undefined }>;
  hiddenPages?: string[];
  onNavigate?: (route: Route) => void;
}

function Harness({ initial, hiddenPages = [], onNavigate }: { initial: TimesheetView; hiddenPages?: string[]; onNavigate?: (route: Route) => void }) {
  const [route, setRoute] = useState<Route>({ place: 'timesheet', view: initial });
  const isPageVisible = useMemo(() => pageVisibility({ platform: 'macos', hiddenPages }), [hiddenPages]);
  const current = resolveRoute(route, isPageVisible);
  const navigation = useMemo<Navigation>(
    () => ({
      route: current,
      navigate: (target) => {
        const next = toRoute(target);
        setRoute(next);
        onNavigate?.(next);
      },
      canNavigate: (target) => routesEqual(resolveRoute(toRoute(target), isPageVisible), toRoute(target)),
      isPageVisible,
    }),
    [current, isPageVisible, onNavigate],
  );
  return (
    <NavigationContext.Provider value={navigation}>
      <AppShell route={current} onNavigate={navigation.navigate} isPageVisible={isPageVisible}>
        {current.place === 'timesheet' ? <TimesheetPlace /> : <h1>{current.place}</h1>}
      </AppShell>
    </NavigationContext.Provider>
  );
}

export function renderTimesheet(view: TimesheetView, { with: extra = {}, hiddenPages, onNavigate }: TimesheetRenderOptions = {}) {
  const slices: Partial<SliceMap> = sampleSlices();
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete slices[name as keyof SliceMap];
    else Object.assign(slices, { [name]: value });
  }
  return renderWithEngine(<Harness initial={view} hiddenPages={hiddenPages} onNavigate={onNavigate} />, { slices });
}
