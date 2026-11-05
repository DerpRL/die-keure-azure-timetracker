import { act, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSettingsHash } from '../../features/settings/sections';
import { resetMockIpc } from '../../ipc';
import type { Configuration, SettingsSlice } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
import { configuredSettings } from '../../ipc/fixtures/slices/settings';
import { MockEngineError } from '../../ipc/mockEngine';
import { AppShell } from '../../layout/AppShell';
import { NavigationContext, type Navigation } from '../../layout/NavigationContext';
import { pageVisibility, parseNavTarget, resolveRoute, routesEqual, toRoute, type Route, type SettingsView } from '../../layout/navigation';
import { renderWithEngine, type EngineRenderOptions } from '../../test/engine';
import SettingsPlace from './index';

/*
 * The 2.4 Settings layout (13 views in four groups): search, the save bar's names, the two-box
 * duration field and presets, the new switches and selects, and the confirmation dialogs.
 * settings.test.tsx covers the behaviour the views carried over from 2.3.
 */

const stored = configuredSettings.configuration;

function settingsWith(patch: Partial<Configuration>): SettingsSlice {
  return { ...configuredSettings, configuration: { ...stored, ...patch } };
}

interface HarnessProps {
  view?: SettingsView;
  os?: 'macos' | 'windows';
}

/** The main window around the Settings place, as in settings.test.tsx. */
function Harness({ view = 'accounts', os = 'macos' }: HarnessProps) {
  const [route, setRoute] = useState<Route>({ place: 'settings', view });
  const isPageVisible = useMemo(() => pageVisibility({ platform: os, hiddenPages: [] }), [os]);
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
      <AppShell route={current} onNavigate={navigation.navigate} isPageVisible={isPageVisible} platform={os}>
        {current.place === 'settings' ? <SettingsPlace /> : <h1>{current.place}</h1>}
      </AppShell>
    </NavigationContext.Provider>
  );
}

function renderSettings(props: HarnessProps = {}, options: EngineRenderOptions = {}) {
  return renderWithEngine(<Harness {...props} />, { platform: props.os ?? 'macos', ...options });
}

type User = ReturnType<typeof renderSettings>['user'];

const menu = () => screen.getByRole('navigation', { name: 'Settings' });

/** A view in the menu; its name may go on with a problem count or the accounts' "connected" dot. */
function menuItem(name: string) {
  return within(menu()).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,.*|connected)?$`) });
}

async function open(user: User, name: string) {
  await user.click(menuItem(name));
  expect(menuItem(name)).toHaveAttribute('aria-current', 'page');
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });
const searchBox = () => within(menu()).getByRole('searchbox', { name: 'Search settings' });
const UNSAVED = /^\d+ unsaved changes?$/;

function durationBoxes(label: string) {
  return {
    hours: screen.getByRole('textbox', { name: `${label} hours` }),
    minutes: screen.getByRole('textbox', { name: `${label} minutes` }),
  };
}

async function setDuration(user: User, label: string, hours: string, minutes: string) {
  const boxes = durationBoxes(label);
  await user.clear(boxes.hours);
  await user.type(boxes.hours, hours);
  await user.clear(boxes.minutes);
  await user.type(boxes.minutes, minutes);
  await user.tab();
}

function expectDuration(label: string, hours: string, minutes: string) {
  const boxes = durationBoxes(label);
  expect(boxes.hours, `${label} hours`).toHaveValue(hours);
  expect(boxes.minutes, `${label} minutes`).toHaveValue(minutes);
}

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  resetMockIpc();
  window.location.hash = '';
  for (const log of document.querySelectorAll('[data-live-announcer]:not([data-announcer]) [role="log"]')) log.replaceChildren();
});

describe('Settings search', () => {
  it('lists matching cards by title first, with their view, instead of the menu', async () => {
    const { user } = renderSettings();
    await user.type(searchBox(), 'holiday');
    expect(within(menu()).getByRole('status')).toHaveTextContent('4 results');
    expect(within(menu()).queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument();
    const results = within(within(menu()).getByRole('list', { name: 'Search results' })).getAllByRole('button');
    expect(results.map((result) => result.textContent)).toEqual([
      'Public holidaysSchedule & holidays',
      'Weekly targetSchedule & holidays',
      'WorkdaySchedule & holidays',
      'Days off & exceptionsSchedule & holidays',
    ]);
    // Every word has to match, in the title, the view's title or the card's keywords.
    await user.clear(searchBox());
    await user.type(searchBox(), 'quarter round');
    expect(within(menu()).getByRole('status')).toHaveTextContent('1 result');
    expect(within(menu()).getByRole('button', { name: /^Timer defaults/ })).toBeInTheDocument();
  });

  it('goes to the first result with Enter and moves focus to its card', async () => {
    const { user } = renderSettings();
    await user.type(searchBox(), 'holiday{Enter}');
    expect(menuItem('Schedule & holidays')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-holidays')));
    expect(document.activeElement).toHaveAccessibleName('Public holidays');
    // The search is cleared and the menu is back.
    expect(searchBox()).toHaveValue('');
    expect(within(menu()).getByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('goes to a result that is clicked', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    await user.type(searchBox(), 'quiet');
    expect(within(menu()).getByRole('status')).toHaveTextContent('1 result');
    await user.click(within(menu()).getByRole('button', { name: /^Notifications & quiet hours/ }));
    expect(menuItem('Notifications')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-notifications')));
  });

  it('says when nothing matches, and leaves out cards this system does not have', async () => {
    const { user } = renderSettings();
    await user.type(searchBox(), 'zzz');
    expect(within(menu()).getByRole('status')).toHaveTextContent('No settings match');
    expect(within(menu()).queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
    // Enter has nowhere to go: the view and the search stay.
    await user.keyboard('{Enter}');
    expect(searchBox()).toHaveValue('zzz');
    expect(screen.getByRole('heading', { level: 2, name: 'Azure DevOps & 7pace' })).toBeInTheDocument();

    await user.clear(searchBox());
    await user.type(searchBox(), 'exchange');
    expect(within(menu()).getByRole('status')).toHaveTextContent('1 result');
  });

  it('finds no calendar cards on Windows', async () => {
    const app = { ...sampleSlices().app!, os: 'windows' as const, features: { calendar: false, microphone: true, figmaTitleOnly: true } };
    const { user } = renderSettings({ os: 'windows' }, { with: { app } });
    await user.type(searchBox(), 'exchange');
    expect(within(menu()).getByRole('status')).toHaveTextContent('No settings match');
  });
});

describe('the save bar', () => {
  it('counts and names the unsaved changes and goes away when they are undone', async () => {
    const { user } = renderSettings();
    const project = screen.getByRole('textbox', { name: 'Project (optional)' });
    await user.type(project, 'X');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByText('· Azure project')).toBeInTheDocument();
    await open(user, 'Schedule & holidays');
    await setDuration(user, 'Fri', '7', '0');
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('· Azure project, Friday target')).toBeInTheDocument();

    await setDuration(user, 'Fri', '6', '0');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByText('· Azure project')).toBeInTheDocument();
    await open(user, 'Azure DevOps & 7pace');
    await user.type(screen.getByRole('textbox', { name: 'Project (optional)' }), '{Backspace}');
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('names at most four changes, then how many more', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    await user.click(screen.getByRole('radio', { name: '5 × 7h 36m' }));
    expect(screen.getByText('5 unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('· Monday target, Tuesday target, Wednesday target, Thursday target and 1 more')).toBeInTheDocument();
    // Choosing the saved preset again undoes them all.
    await user.click(screen.getByRole('radio', { name: 'Mon–Thu 8h, Fri 6h' }));
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });
});

describe('weekly target presets and the duration field', () => {
  it('fills in the days from a preset and marks the preset that matches', async () => {
    const { engine, user } = renderSettings({ view: 'schedule' });
    const fourDays = screen.getByRole('radio', { name: 'Mon–Thu 8h, Fri 6h' });
    const fiveDays = screen.getByRole('radio', { name: '5 × 7h 36m' });
    expect(fourDays).toBeChecked();
    expect(fiveDays).not.toBeChecked();
    await user.click(fiveDays);
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) expectDuration(day, '7', '36');
    expectDuration('Sat', '0', '00');
    expectDuration('Sun', '0', '00');
    expect(fiveDays).toBeChecked();
    expect(fourDays).not.toBeChecked();
    expect(screen.getByText('Weekly total:').parentElement).toHaveTextContent('38h a week');
    // A changed day matches no preset.
    await setDuration(user, 'Wed', '8', '0');
    expect(fiveDays).not.toBeChecked();
    await user.click(fiveDays);
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.targets.minutesByWeekday).toEqual([0, 456, 456, 456, 456, 456, 0]);
  });

  it('saves 7h 36m typed into the two boxes as exactly 456 minutes', async () => {
    const { engine, user } = renderSettings({ view: 'schedule' });
    await setDuration(user, 'Mon', '7', '36');
    expectDuration('Mon', '7', '36');
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration.targets.minutesByWeekday;
    expect(saved?.[1]).toBe(456);
    expect(Number.isInteger(saved?.[1])).toBe(true);
  });

  it('shows saved 456 minutes as 7h 36m and keeps it when typed again', async () => {
    const minutesByWeekday = [0, 456, 456, 456, 456, 456, 0];
    const { user } = renderSettings({ view: 'schedule' }, { with: { settings: settingsWith({ targets: { ...stored.targets, minutesByWeekday } }) } });
    expectDuration('Mon', '7', '36');
    expect(screen.getByRole('radio', { name: '5 × 7h 36m' })).toBeChecked();
    await setDuration(user, 'Mon', '7', '36');
    // Enter uses the text too.
    await user.clear(durationBoxes('Tue').minutes);
    await user.type(durationBoxes('Tue').minutes, '36{Enter}');
    expectDuration('Tue', '7', '36');
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });
});

describe('settings saved to their own fields', () => {
  it('saves resume after meetings, the menu-bar timer and when the day review comes', async () => {
    const { engine, user } = renderSettings({ view: 'meetings' });
    const resume = screen.getByRole('switch', { name: 'Resume the previous ticket afterwards' });
    expect(resume).toBeChecked();
    await user.click(resume);

    await open(user, 'Appearance & shortcuts');
    const menuBar = screen.getByRole('switch', { name: 'Show the timer in the menu bar' });
    expect(menuBar).toBeChecked();
    await user.click(menuBar);

    await open(user, 'Reminders');
    await user.click(screen.getByRole('button', { name: /^When the workday ends \(17:00\)/ }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      '15 minutes before the workday ends (16:45)',
      'When the workday ends (17:00)',
      'Next morning, when the workday starts (09:00)',
    ]);
    await user.click(screen.getByRole('option', { name: 'Next morning, when the workday starts (09:00)' }));
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('· Day review, Menu-bar timer, Resume after meetings')).toBeInTheDocument();

    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration).toEqual({
      ...stored,
      resumeAfterMeetings: false,
      menuBarTimer: false,
      dayReview: { ...stored.dayReview, reminder: 'nextMorning' },
    });
  });

  it('has no menu-bar timer on Windows', () => {
    const app = { ...sampleSlices().app!, os: 'windows' as const, features: { calendar: false, microphone: true, figmaTitleOnly: true } };
    renderSettings({ view: 'appearance', os: 'windows' }, { with: { app } });
    expect(screen.getByRole('heading', { level: 3, name: 'Notification area & windows' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Show the timer in the menu bar' })).not.toBeInTheDocument();
  });
});

describe('confirmation dialogs', () => {
  it('removes the 7pace API token only after confirming', async () => {
    const { engine, user } = renderSettings();
    const sevenPace = screen.getByRole('region', { name: '7pace Timetracker' });
    await user.click(within(sevenPace).getByRole('button', { name: 'Remove token' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Remove the 7pace API token?' });
    expect(dialog).toHaveTextContent('The 7pace sign-in is removed from Keychain.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(engine.dispatched('pairing.unpair')).toEqual([]);

    await user.click(within(sevenPace).getByRole('button', { name: 'Remove token' }));
    dialog = screen.getByRole('alertdialog', { name: 'Remove the 7pace API token?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove token' }));
    expect(engine.dispatched('pairing.unpair')).toEqual([{ type: 'pairing.unpair' }]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // The mock engine forgets the token, like the engine.
    expect(within(sevenPace).queryByRole('button', { name: 'Remove token' })).not.toBeInTheDocument();
    expect(within(sevenPace).getByText('Not connected yet')).toBeInTheDocument();
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('unpairs a PIN pairing through pairing.unpair', async () => {
    const { engine, user } = renderSettings({}, { with: { settings: settingsWith({ sevenPaceAuthMode: 'mobilePIN' }) } });
    await user.click(within(screen.getByRole('region', { name: '7pace Timetracker' })).getByRole('button', { name: 'Unpair' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Unpair 7pace?' });
    await user.click(within(dialog).getByRole('button', { name: 'Unpair' }));
    expect(engine.dispatched('pairing.unpair')).toEqual([{ type: 'pairing.unpair' }]);
  });

  it('keeps the dialog open and shows why unpairing failed', async () => {
    const { engine, user } = renderSettings();
    engine.handle('pairing.unpair', () => {
      throw new MockEngineError('credentialStore', 'Keychain did not answer.');
    });
    await user.click(within(screen.getByRole('region', { name: '7pace Timetracker' })).getByRole('button', { name: 'Remove token' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove token' }));
    expect(await screen.findByText('Keychain did not answer.')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('resets local data only after confirming', async () => {
    const { engine, user } = renderSettings({ view: 'advanced' });
    await user.click(screen.getByRole('button', { name: 'Reset…' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Reset local data?' });
    expect(dialog).toHaveTextContent('This cannot be undone.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('app.resetLocalData')).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Reset…' }));
    dialog = screen.getByRole('alertdialog', { name: 'Reset local data?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset local data' }));
    expect(engine.dispatched('app.resetLocalData')).toEqual([{ type: 'app.resetLocalData' }]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(engine.dispatched('settings.save')).toEqual([]);
  });
});

describe('prompts', () => {
  it('sets each prompt kind from its row of radios and resets them all', async () => {
    const { engine, user } = renderSettings({ view: 'notifications' });
    const prompts = screen.getByRole('region', { name: 'Prompts' });
    expect(within(prompts).getAllByRole('radio')).toHaveLength(configuredSettings.interruptions.length * 4);
    expect(within(prompts).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Prompt',
      'Off',
      'Notify',
      'Open panel',
      'Open & focus',
    ]);
    expect(screen.getByRole('radio', { name: '7pace timer checks: Open & focus' })).toBeChecked();
    const reset = within(prompts).getByRole('button', { name: 'Reset to defaults' });
    expect(reset).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: 'Branch changes: Off' }));
    await user.click(screen.getByRole('radio', { name: 'Figma files: Open & focus' }));
    expect(engine.dispatched('settings.setPromptInterruption')).toEqual([
      { type: 'settings.setPromptInterruption', kind: 'branch', level: 'off' },
      { type: 'settings.setPromptInterruption', kind: 'figma', level: 'openAndFocus' },
    ]);
    expect(screen.getByRole('radio', { name: 'Branch changes: Off' })).toBeChecked();

    await user.click(reset);
    expect(engine.dispatched('settings.setPromptInterruption').slice(2)).toEqual(
      expect.arrayContaining([
        { type: 'settings.setPromptInterruption', kind: 'branch', level: 'openPanel' },
        { type: 'settings.setPromptInterruption', kind: 'figma', level: 'openPanel' },
        { type: 'settings.setPromptInterruption', kind: 'trackingAttention', level: 'openPanel' },
      ]),
    );
    expect(engine.dispatched('settings.setPromptInterruption')).toHaveLength(5);
    for (const choice of configuredSettings.interruptions) {
      expect(screen.getByRole('radio', { name: `${choice.label}: Open panel` })).toBeChecked();
    }
    expect(reset).toBeDisabled();
    // Prompts apply right away, never through the draft.
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('puts the radio back when the engine refuses a level', async () => {
    const { engine, user } = renderSettings({ view: 'notifications' });
    engine.handle('settings.setPromptInterruption', () => {
      throw new MockEngineError('invalidIntent', 'That level is not available.');
    });
    await user.click(screen.getByRole('radio', { name: 'Branch changes: Notify' }));
    expect(await screen.findByText('That level is not available.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Branch changes: Open panel' })).toBeChecked();
  });

  it('explains that Notify works like Off while notifications are off', () => {
    renderSettings({ view: 'notifications' }, { with: { settings: settingsWith({ notificationsEnabled: false }) } });
    expect(screen.getByText('Notifications are off, so Notify works like Off.')).toBeInTheDocument();
  });
});

describe('the view header', () => {
  it('tests both connections from the Azure DevOps & 7pace title, outside the cards', async () => {
    const { engine, user } = renderSettings();
    const test = screen.getByRole('button', { name: 'Test both connections' });
    expect(test.closest('section')).toBeNull();
    await user.click(test);
    expect(engine.dispatched('connection.retry')).toEqual([{ type: 'connection.retry' }]);
    await open(user, 'Schedule & holidays');
    expect(screen.queryByRole('button', { name: 'Test both connections' })).not.toBeInTheDocument();
  });

  it('shows why the test could not run', async () => {
    const { engine, user } = renderSettings();
    engine.handle('connection.retry', () => {
      throw new MockEngineError('offline', '7pace could not be reached.');
    });
    await user.click(screen.getByRole('button', { name: 'Test both connections' }));
    expect(await screen.findByText('7pace could not be reached.')).toBeInTheDocument();
  });
});

describe('links from 2.3', () => {
  it('opens Reminders at Timer defaults for the old #settings/tracking link', async () => {
    window.location.hash = '#settings/tracking';
    renderSettings();
    expect(menuItem('Reminders')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-tracking')));
    expect(document.activeElement).toHaveAccessibleName('Timer defaults');
    expect(window.location.hash).toBe('');
  });

  it('follows #settings/tracking while Settings is open', async () => {
    renderSettings({ view: 'about' });
    act(() => {
      window.location.hash = '#settings/tracking';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(menuItem('Reminders')).toHaveAttribute('aria-current', 'page'));
  });

  it('reads the old tracking view as a link and as a saved route', () => {
    expect(parseSettingsHash('#settings/tracking')).toEqual({ view: 'reminders', section: 'tracking' });
    expect(parseNavTarget('settings/tracking')).toEqual({ place: 'settings', view: 'schedule' });
    expect(parseNavTarget('settings/reminders')).toEqual({ place: 'settings', view: 'reminders' });
  });
});
