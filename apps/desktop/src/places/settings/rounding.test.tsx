import { screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetMockIpc } from '../../ipc';
import { configuredSettings } from '../../ipc/fixtures/slices/settings';
import { AppShell } from '../../layout/AppShell';
import { NavigationContext, type Navigation } from '../../layout/NavigationContext';
import { pageVisibility, resolveRoute, routesEqual, toRoute, type Route } from '../../layout/navigation';
import { renderWithEngine } from '../../test/engine';
import SettingsPlace from './index';

/** Settings → Reminders (Timer defaults) inside the main window. */
function Harness() {
  const [route, setRoute] = useState<Route>({ place: 'settings', view: 'reminders' });
  const isPageVisible = useMemo(() => pageVisibility({ platform: 'macos', hiddenPages: [] }), []);
  const current = resolveRoute(route, isPageVisible);
  const navigation = useMemo<Navigation>(
    () => ({
      route: current,
      navigate: (target) => setRoute(toRoute(target)),
      canNavigate: (target) => routesEqual(resolveRoute(toRoute(target), isPageVisible), toRoute(target)),
      isPageVisible,
    }),
    [current, isPageVisible],
  );
  return (
    <NavigationContext.Provider value={navigation}>
      <AppShell route={current} onNavigate={navigation.navigate} isPageVisible={isPageVisible} platform="macos">
        <SettingsPlace />
      </AppShell>
    </NavigationContext.Provider>
  );
}

const stored = configuredSettings.configuration;
const roundingSwitch = () => screen.getByRole('switch', { name: /Round saved time to the nearest quarter hour/ });

afterEach(() => resetMockIpc());

describe('rounding saved time to quarter hours', () => {
  it('is off by default and explains the rule with an example', () => {
    renderWithEngine(<Harness />, { platform: 'macos' });
    expect(stored.roundToQuarterHours).toBe(false);
    expect(roundingSwitch()).not.toBeChecked();
    expect(screen.getByText(/1h 5m is saved as 1h, 1h 12m as 1h 15m/)).toBeInTheDocument();
    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument();
  });

  it('saves the switch with the rest of the settings', async () => {
    const { engine, user } = renderWithEngine(<Harness />, { platform: 'macos' });
    await user.click(roundingSwitch());
    expect(roundingSwitch()).toBeChecked();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByText('· Quarter-hour rounding')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(engine.dispatched('settings.save')).toEqual([
      { type: 'settings.save', configuration: { ...stored, roundToQuarterHours: true }, azurePat: '', sevenPaceToken: '' },
    ]);
  });

  it('shows a saved choice as on', () => {
    renderWithEngine(<Harness />, {
      platform: 'macos',
      with: { settings: { ...configuredSettings, configuration: { ...stored, roundToQuarterHours: true } } },
    });
    expect(roundingSwitch()).toBeChecked();
  });
});
