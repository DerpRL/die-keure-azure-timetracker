import { act, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettingsHash, settingsHash } from '../../features/settings/sections';
import { MESSAGES } from '../../features/settings/validation';
import type * as PlatformModule from '../../features/settings/platform';
import { calendarShown, setCalendarShown } from '../../features/settings/MeetingsSections';
import { resetMockIpc } from '../../ipc';
import type { Configuration, SettingsSlice } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
import { emptyRepositories } from '../../ipc/fixtures/slices/repositories';
import {
  agendaNotDetermined,
  configuredSettings,
  invalidSettings,
  microphoneInUse,
  pairingComplete,
  pairingInProgress,
  sampleAgenda,
  saveValidationError,
  unconfiguredConnection,
  unconfiguredSettings,
} from '../../ipc/fixtures/slices/settings';
import { MockEngineError } from '../../ipc/mockEngine';
import { AppShell } from '../../layout/AppShell';
import { NavigationContext, type Navigation } from '../../layout/NavigationContext';
import { pageVisibility, resolveRoute, routesEqual, toRoute, type Route, type SettingsView } from '../../layout/navigation';
import { EngineProvider } from '../../state/EngineProvider';
import { SliceStore } from '../../state/store';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine, type EngineRenderOptions } from '../../test/engine';
import { renderWithProviders } from '../../test/render';
import SettingsPlace from './index';

const platform = vi.hoisted(() => ({
  readLaunchAtLogin: vi.fn(() => Promise.resolve<boolean | null>(false)),
  writeLaunchAtLogin: vi.fn((on: boolean) => Promise.resolve(on)),
  chooseApplications: vi.fn((os: 'macos' | 'windows') =>
    Promise.resolve(os === 'windows' ? ['C:\\Program Files\\JetBrains\\Rider64.exe'] : ['/Applications/Zed.app']),
  ),
  openExternalLink: vi.fn(() => Promise.resolve()),
  copyText: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../features/settings/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  ...platform,
}));

const stored = configuredSettings.configuration;

function settingsWith(patch: Partial<Configuration>, rest: Partial<SettingsSlice> = {}): SettingsSlice {
  return { ...configuredSettings, ...rest, configuration: { ...stored, ...patch } };
}

function appWith(patch: Partial<NonNullable<ReturnType<typeof sampleSlices>['app']>>) {
  return { ...sampleSlices().app!, ...patch };
}

const WINDOWS_APP = appWith({ os: 'windows', features: { calendar: false, microphone: true, figmaTitleOnly: true } });

interface HarnessProps {
  view?: SettingsView;
  hiddenPages?: string[];
  os?: 'macos' | 'windows';
}

/** The main window around the Settings place: the top bar, navigation and the view's route. */
function Harness({ view = 'accounts', hiddenPages = [], os = 'macos' }: HarnessProps) {
  const [route, setRoute] = useState<Route>({ place: 'settings', view });
  const isPageVisible = useMemo(() => pageVisibility({ platform: os, hiddenPages }), [os, hiddenPages]);
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

function menu() {
  return screen.getByRole('navigation', { name: 'Settings' });
}

/** A view in the menu; its name may go on with a problem count or the accounts' "connected" dot. */
function menuItem(name: string) {
  return within(menu()).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,.*|connected)?$`) });
}

async function open(user: { click: (element: Element) => Promise<void> }, name: string) {
  await user.click(menuItem(name));
  expect(menuItem(name)).toHaveAttribute('aria-current', 'page');
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });

type User = Awaited<ReturnType<typeof renderSettings>>['user'];

/** The save bar's count: "1 unsaved change", "3 unsaved changes". */
const UNSAVED = /^\d+ unsaved changes?$/;

function unsaved(count: number) {
  return screen.getByText(`${count} unsaved ${count === 1 ? 'change' : 'changes'}`);
}

/** A settings card (a `<section>` labelled by its heading). */
function card(name: string | RegExp) {
  return screen.getByRole('region', { name });
}

/** Opens the field for a new token in a card where one is stored. */
async function replaceToken(user: User, cardName: 'Azure DevOps' | '7pace Timetracker') {
  await user.click(within(card(cardName)).getByRole('button', { name: 'Replace…' }));
}

/** The hours and minutes boxes of a duration field ("Mon", "Target"). */
function durationBoxes(label: string) {
  return {
    hours: screen.getByRole('textbox', { name: `${label} hours` }),
    minutes: screen.getByRole('textbox', { name: `${label} minutes` }),
  };
}

/** Types hours and minutes into a duration field and leaves it, which uses the text. */
async function setDuration(user: User, label: string, hours: string, minutes: string) {
  const boxes = durationBoxes(label);
  await user.clear(boxes.hours);
  if (hours !== '') await user.type(boxes.hours, hours);
  await user.clear(boxes.minutes);
  if (minutes !== '') await user.type(boxes.minutes, minutes);
  await user.tab();
}

function expectDuration(label: string, hours: string, minutes: string) {
  const boxes = durationBoxes(label);
  expect(boxes.hours, `${label} hours`).toHaveValue(hours);
  expect(boxes.minutes, `${label} minutes`).toHaveValue(minutes);
}

/** The weekly total chip of the Weekly target card. */
const weeklyTotal = () => screen.getByText('Weekly total:').parentElement;

const level3 = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  resetMockIpc();
  vi.useRealTimers();
  window.location.hash = '';
  // React Aria announces selections through its own live region with `aria-labelledby`
  // pointing into the tree; after cleanup those references dangle for the next test's axe run.
  for (const log of document.querySelectorAll('[data-live-announcer]:not([data-announcer]) [role="log"]')) log.replaceChildren();
});

describe('the Settings menu', () => {
  it('groups the views as in the design and opens the chosen one', async () => {
    const { user } = renderSettings();
    expect(within(menu()).getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(within(menu()).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Account',
      'Tracking',
      'Sources',
      'App',
    ]);
    expect(
      within(menu())
        .getAllByRole('listitem')
        // The accounts item ends with its visually hidden "connected" dot.
        .map((item) => within(item).getByRole('button').textContent?.replace(/connected$/, '')),
    ).toEqual([
      'Azure DevOps & 7pace',
      'Schedule & holidays',
      'Meetings',
      'Reminders',
      'Notifications',
      'Overview',
      'Git repositories',
      'Figma',
      'Calendars',
      'Appearance & shortcuts',
      'Features & privacy',
      'Updates & advanced',
      'About',
    ]);
    expect(menuItem('Azure DevOps & 7pace')).toHaveAttribute('aria-current', 'page');
    expect(within(menuItem('Azure DevOps & 7pace')).getByText('connected')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Azure DevOps & 7pace' })).toBeInTheDocument();

    await open(user, 'Overview');
    // The menu's "Sources" group and the view's title.
    expect(screen.getAllByRole('heading', { level: 2, name: 'Sources' })).toHaveLength(2);
    expect(screen.getByText('Sources suggest what to track. Nothing changes in 7pace until you confirm.')).toBeInTheDocument();
    await open(user, 'Appearance & shortcuts');
    expect(screen.getByRole('heading', { level: 2, name: 'Appearance & shortcuts' })).toBeInTheDocument();
    await open(user, 'Reminders');
    expect(screen.getByRole('heading', { level: 2, name: 'Reminders' })).toBeInTheDocument();
    // The gear in the top bar is marked as the current place.
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves out Figma and Calendars where they are hidden or unavailable', () => {
    renderSettings({ hiddenPages: ['figma'], os: 'windows' }, { with: { app: WINDOWS_APP } });
    const names = within(menu()).getAllByRole('button').map((button) => button.textContent);
    expect(names).not.toContain('Figma');
    expect(names).not.toContain('Calendars');
    expect(names).toContain('Git repositories');
  });
});

describe('states', () => {
  it('renders the configured accounts from the fixtures', async () => {
    const { user } = renderSettings();
    expect(level3()).toEqual(['Azure DevOps', '7pace Timetracker']);
    expect(within(screen.getByRole('list', { name: 'Connection status' })).getAllByRole('listitem').map((tile) => tile.textContent)).toEqual([
      'Azure DevOps connectedcontoso · Webshop',
      '7pace connectedAPI token',
      '2 tokens in KeychainNever shown or exported',
    ]);
    expect(screen.getByRole('textbox', { name: 'Organization' })).toHaveValue('contoso');
    expect(screen.getByRole('textbox', { name: 'Workspace URL' })).toHaveValue('https://contoso.timehub.7pace.com');
    // Both credentials are stored: no fields until the user chooses to replace one.
    expect(screen.getAllByText('Stored in Keychain')).toHaveLength(2);
    expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument();
    await replaceToken(user, 'Azure DevOps');
    expect(screen.getByLabelText('Personal access token')).toHaveValue('');
    expect(screen.getByLabelText('Personal access token')).toHaveAttribute('placeholder', 'Paste a new token to replace the stored one');
    await user.click(screen.getByRole('button', { name: 'Keep the stored one' }));
    expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    // Nothing is unsaved, so nothing asks to be saved.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Tokens stay in Keychain. Your Git repositories are never changed.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Setup steps' })).not.toBeInTheDocument();
  });

  it('shows a skeleton until the settings slice arrives, with the menu', () => {
    renderSettings({}, { slices: {} });
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings');
    expect(menu()).toBeInTheDocument();
  });

  it('explains when the engine cannot be reached', async () => {
    resetMockIpc();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithProviders(
      <EngineProvider store={new SliceStore()}>
        <Harness />
      </EngineProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Settings are unavailable' })).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });

  it('explains the accounts while no 7pace workspace is saved, without onboarding steps', async () => {
    renderSettings({}, { with: { settings: unconfiguredSettings, connection: unconfiguredConnection } });
    expect(screen.getByRole('heading', { level: 3, name: 'Connect your accounts to start tracking' })).toBeInTheDocument();
    // The setup steps belong to the onboarding itself now.
    expect(screen.queryByRole('list', { name: 'Setup steps' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Stored in/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Not connected yet')).toHaveLength(2);
    expect(screen.getByText('Needs “Work Items (Read)”. That is enough for ticket lookup.')).toBeInTheDocument();
    expect(screen.getByText('The timer has not been checked yet.')).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('Save and Revert', () => {
  it('sends exactly the edited configuration; blank secrets stay blank', async () => {
    const { engine, user } = renderSettings();
    const project = screen.getByLabelText('Project (optional)');
    await user.clear(project);
    await user.type(project, 'Checkout');
    expect(unsaved(1)).toBeInTheDocument();
    expect(screen.getByText('· Azure project')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')).toEqual([
      { type: 'settings.save', configuration: { ...stored, project: 'Checkout' }, azurePat: '', sevenPaceToken: '' },
    ]);
    expect(await screen.findByText('Settings saved · connection verified')).toBeInTheDocument();
  });

  it('sends trimmed new secrets with ⌘S and clears them after saving', async () => {
    const { engine, user } = renderSettings();
    await replaceToken(user, 'Azure DevOps');
    await user.type(screen.getByLabelText('Personal access token'), '  pat-123  ');
    await replaceToken(user, '7pace Timetracker');
    await user.type(screen.getByLabelText('API token'), 'token-456');
    expect(unsaved(2)).toBeInTheDocument();
    expect(screen.getByText('· Azure token, 7pace token')).toBeInTheDocument();
    await user.keyboard('{Meta>}s{/Meta}');
    expect(engine.dispatched('settings.save')).toEqual([
      { type: 'settings.save', configuration: stored, azurePat: 'pat-123', sevenPaceToken: 'token-456' },
    ]);
    await waitFor(() => expect(screen.getByLabelText('Personal access token')).toHaveValue(''));
    expect(screen.getByLabelText('API token')).toHaveValue('');
  });

  it('reverts edits and typed secrets', async () => {
    const { engine, user } = renderSettings();
    const organization = screen.getByLabelText('Organization');
    await user.clear(organization);
    await user.type(organization, 'fabrikam');
    await replaceToken(user, 'Azure DevOps');
    await user.type(screen.getByLabelText('Personal access token'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expect(organization).toHaveValue('contoso');
    expect(screen.getByLabelText('Personal access token')).toHaveValue('');
    // The save bar goes away with the edits; focus moves to the view's title, not the page.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Azure DevOps & 7pace' })).toHaveFocus();
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('keeps one draft across views and saves every view’s edits together', async () => {
    const { engine, user } = renderSettings();
    await user.type(screen.getByLabelText('Project (optional)'), ' EU');
    await open(user, 'Schedule & holidays');
    expect(unsaved(1)).toBeInTheDocument();
    await setDuration(user, 'Sat', '4', '0');
    // The Sources overview has no save bar of its own, but shows it while edits are unsaved.
    await open(user, 'Overview');
    expect(unsaved(2)).toBeInTheDocument();
    expect(screen.getByText('· Azure project, Saturday target')).toBeInTheDocument();
    await open(user, 'Azure DevOps & 7pace');
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('Webshop EU');
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.project).toBe('Webshop EU');
    expect(saved?.targets.minutesByWeekday).toEqual([0, 480, 480, 480, 480, 360, 240]);
  });

  it('shows no save bar on any view without unsaved edits', async () => {
    const { user } = renderSettings();
    for (const name of [
      'Azure DevOps & 7pace',
      'Schedule & holidays',
      'Meetings',
      'Reminders',
      'Notifications',
      'Overview',
      'Git repositories',
      'Figma',
      'Calendars',
      'Appearance & shortcuts',
      'Features & privacy',
      'Updates & advanced',
      'About',
    ]) {
      await open(user, name);
      expect(screen.queryByRole('button', { name: 'Save changes' }), name).not.toBeInTheDocument();
      expect(screen.queryByText(UNSAVED), name).not.toBeInTheDocument();
    }
  });

  it('takes new slice values under an unchanged draft and keeps the user’s edits otherwise', async () => {
    const { engine, user } = renderSettings();
    const organization = screen.getByLabelText('Organization');
    const project = screen.getByLabelText('Project (optional)');
    act(() => engine.setSlice('settings', settingsWith({ organization: 'fabrikam' })));
    expect(organization).toHaveValue('fabrikam');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();

    await user.type(project, 'X');
    act(() => engine.setSlice('settings', settingsWith({ organization: 'northwind' })));
    expect(organization).toHaveValue('northwind');
    expect(project).toHaveValue('WebshopX');
    expect(unsaved(1)).toBeInTheDocument();
  });

  it('never lets the draft overwrite settings that apply immediately', async () => {
    const { engine, user } = renderSettings();
    await user.type(screen.getByLabelText('Project (optional)'), ' EU');
    const latest = settingsWith({
      interface: { theme: 'dark', scale: 125, contrast: 'increased' },
      figma: { enabled: true, dismissalMinutes: 30, historyDays: 60 },
      quietHours: { enabled: true, startMinute: 1140, endMinute: 420 },
      interruptions: { branch: 'off' },
      repositories: [],
    });
    act(() => engine.setSlice('settings', latest));
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration).toEqual({ ...latest.configuration, project: 'Webshop EU' });
  });

  it('disables writes while the engine is busy', async () => {
    const { user } = renderSettings({}, { with: { app: appWith({ busy: true }) } });
    await user.type(screen.getByLabelText('Project (optional)'), ' EU');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test both connections' })).toBeDisabled();
  });

  it('tests the connection', async () => {
    const { engine, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Test both connections' }));
    expect(engine.dispatched('connection.retry')).toHaveLength(1);
  });
});

describe('the save prompt', () => {
  it('appears after an edit and goes away when the edit is undone', async () => {
    const { user } = renderSettings();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    const project = screen.getByLabelText('Project (optional)');
    await user.type(project, 'X');
    expect(unsaved(1)).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    await user.type(project, '{Backspace}');
    expect(project).toHaveValue('Webshop');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();

    // A typed token is unsaved too, until it is cleared again.
    await replaceToken(user, 'Azure DevOps');
    const pat = screen.getByLabelText('Personal access token');
    await user.type(pat, 'x');
    expect(saveButton()).toBeInTheDocument();
    await user.clear(pat);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('goes away when a day is switched off and on again, although the list changed order', async () => {
    const { user } = renderSettings({ view: 'reminders' });
    const wednesday = screen.getByRole('button', { name: 'Wednesday' });
    expect(wednesday).toHaveAttribute('aria-pressed', 'true');
    await user.click(wednesday);
    expect(saveButton()).toBeInTheDocument();
    await user.click(wednesday);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('goes away after saving and confirms the save', async () => {
    const { user } = renderSettings();
    await user.type(screen.getByLabelText('Project (optional)'), ' EU');
    await user.click(saveButton());
    expect(await screen.findByText('Settings saved · connection verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Azure DevOps & 7pace' })).toHaveFocus();
  });
});

describe('the first run', () => {
  const firstRun = { with: { settings: unconfiguredSettings, connection: unconfiguredConnection } };

  it('prefills die Keure’s accounts as unsaved suggestions', async () => {
    const { engine, user } = renderSettings({}, firstRun);
    expect(screen.getByLabelText('Organization')).toHaveValue('diekeure-webdev');
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('LK2020');
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://diekeure-webdev.timehub.7pace.com');
    // Suggested values are not saved yet, so Settings asks to save them.
    expect(unsaved(3)).toBeInTheDocument();
    expect(screen.getByText('· Azure organization, Azure project, 7pace workspace')).toBeInTheDocument();
    const organization = screen.getByLabelText('Organization');
    await user.clear(organization);
    await user.type(organization, 'fabrikam');
    await user.keyboard('{Meta>}s{/Meta}');
    expect(engine.dispatched('settings.save')[0]?.configuration).toMatchObject({
      organization: 'fabrikam',
      project: 'LK2020',
      sevenPaceUrl: 'https://diekeure-webdev.timehub.7pace.com',
    });
  });

  it('keeps saved account values and never fills a project left empty on purpose', () => {
    renderSettings({}, { with: { settings: settingsWith({ project: '' }) } });
    expect(screen.getByLabelText('Organization')).toHaveValue('contoso');
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('explains where to get the API token or the PIN approved', async () => {
    const { user } = renderSettings({}, firstRun);
    const tokenSteps = within(screen.getByRole('list', { name: 'How to get a 7pace API token' })).getAllByRole('listitem');
    expect(tokenSteps.map((step) => step.textContent)).toEqual([
      'Open 7pace Timetracker (diekeure-webdev.timehub.7pace.com (opens in your browser)) and go to Settings → Reporting & API.',
      'Create a token there and copy it.',
      'Paste it in API token below. It is kept in Keychain once your settings are saved.',
    ]);
    await user.click(screen.getByRole('link', { name: /^diekeure-webdev\.timehub\.7pace\.com\s*\(opens in your browser\)$/ }));
    expect(platform.openExternalLink).toHaveBeenCalledWith('https://diekeure-webdev.timehub.7pace.com');

    await user.click(screen.getByRole('radio', { name: 'Mobile PIN pairing' }));
    expect(screen.queryByRole('list', { name: 'How to get a 7pace API token' })).not.toBeInTheDocument();
    const pinSteps = within(screen.getByRole('list', { name: 'How to get a pairing PIN approved' })).getAllByRole('listitem');
    expect(pinSteps.map((step) => step.textContent)).toEqual([
      'Check the workspace URL above, then choose Generate pairing PIN.',
      'In Azure DevOps, open 7pace Timetracker and go to Apps → Pair Mobile App.',
      'Enter the PIN there within one minute. It expires after that; generate a new one if it does.',
      'When this card says “Paired with …”, save your settings to use the connection.',
    ]);
    await expectNoA11yViolations();
  });

  it('keeps the token steps in view once a token is stored, linking the saved workspace', () => {
    renderSettings();
    expect(screen.getByRole('list', { name: 'How to get a 7pace API token' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^contoso\.timehub\.7pace\.com\s*\(opens in your browser\)$/ })).toHaveAttribute(
      'href',
      'https://contoso.timehub.7pace.com',
    );
  });
});

describe('Test and save', () => {
  const firstRun = { with: { settings: unconfiguredSettings, connection: unconfiguredConnection } };
  const testButton = () => screen.getByRole('button', { name: 'Test and save' });

  it('needs an organization and a token', async () => {
    const { user } = renderSettings({}, firstRun);
    expect(testButton()).toBeDisabled();
    expect(screen.getByText('Paste a token to test it.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Personal access token'), 'fake-pat');
    expect(testButton()).toBeEnabled();
    await user.clear(screen.getByLabelText('Organization'));
    expect(testButton()).toBeDisabled();
    expect(screen.getByText('Enter your organization to test the token.')).toBeInTheDocument();
  });

  it('tests the token against the organization and project, then saves only those', async () => {
    const { engine, user } = renderSettings({}, firstRun);
    engine.handle('settings.save', (intent, mock) =>
      mock.setSlice('settings', { ...unconfiguredSettings, configuration: intent.configuration, hasAzurePat: true }),
    );
    await user.type(screen.getByLabelText('Personal access token'), '  fake-pat-for-tests ');
    await user.click(testButton());
    expect(engine.dispatched('settings.testAzurePat')).toEqual([
      { type: 'settings.testAzurePat', organization: 'diekeure-webdev', project: 'LK2020', azurePat: 'fake-pat-for-tests' },
    ]);
    expect(engine.dispatched('settings.save')).toEqual([
      {
        type: 'settings.save',
        configuration: { ...unconfiguredSettings.configuration, organization: 'diekeure-webdev', project: 'LK2020' },
        azurePat: 'fake-pat-for-tests',
        sevenPaceToken: '',
      },
    ]);
    expect(await screen.findByText('The token works for “diekeure-webdev”, project “LK2020” and is saved in Keychain.')).toBeInTheDocument();
    // The token is stored now: its field gives way to "Stored in Keychain" and Replace….
    expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument();
    expect(within(card('Azure DevOps')).getByText('Stored in Keychain')).toBeInTheDocument();
    expect(within(card('Azure DevOps')).getByRole('button', { name: 'Replace…' })).toBeInTheDocument();
    // The suggested 7pace workspace is still unsaved and still asks to be saved; setup goes on.
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://diekeure-webdev.timehub.7pace.com');
    expect(unsaved(1)).toBeInTheDocument();
    expect(screen.getByText('· 7pace workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Connect your accounts to start tracking' })).toBeInTheDocument();
  });

  it('shows why a token failed and saves nothing', async () => {
    const { engine, user } = renderSettings({}, firstRun);
    const message =
      'Azure DevOps did not accept this token for “diekeure-webdev”. Check that you copied all of it, that it has not expired, and that it was created for this organization with the Work Items (Read) scope.';
    engine.handle('settings.testAzurePat', () => {
      throw new MockEngineError('authentication', message);
    });
    await user.type(screen.getByLabelText('Personal access token'), 'wrong-fake-pat');
    await user.click(testButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(engine.dispatched('settings.save')).toEqual([]);
    expect(screen.getByLabelText('Personal access token')).toHaveValue('wrong-fake-pat');
    // The message is about what was tested; editing the token clears it.
    await user.type(screen.getByLabelText('Personal access token'), '2');
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it.each([
    ['projectNotFound', '“diekeure-webdev” has no project called “LK2020”, or this token cannot see it. Check the spelling, or leave Project empty to search every project.'],
    ['offline', 'Azure DevOps could not be reached. Check your internet connection and try again.'],
  ])('shows the %s failure verbatim', async (kind, message) => {
    const { engine, user } = renderSettings({}, firstRun);
    engine.handle('settings.testAzurePat', () => {
      throw new MockEngineError(kind, message);
    });
    await user.type(screen.getByLabelText('Personal access token'), 'fake-pat');
    await user.click(testButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('runs with Return in the token field and shows that it is checking', async () => {
    const { engine, user } = renderSettings({}, firstRun);
    let answer: () => void = () => {};
    engine.handle('settings.testAzurePat', () => new Promise<null>((resolve) => (answer = () => resolve(null))));
    await user.type(screen.getByLabelText('Personal access token'), 'fake-pat{Enter}');
    expect(await screen.findByText('Checking the token with Azure DevOps…')).toBeInTheDocument();
    expect(engine.dispatched('settings.testAzurePat')).toHaveLength(1);
    // Pressing again while it runs does not start a second test.
    await user.keyboard('{Enter}');
    expect(engine.dispatched('settings.testAzurePat')).toHaveLength(1);
    await act(() => {
      answer();
      return Promise.resolve();
    });
    expect(await screen.findByText(/^The token works for/)).toBeInTheDocument();
    expect(screen.queryByText('Checking the token with Azure DevOps…')).not.toBeInTheDocument();
  });

  it('tests the stored token when the field is empty', async () => {
    const { engine, user } = renderSettings();
    await user.click(testButton());
    expect(engine.dispatched('settings.testAzurePat')).toEqual([
      { type: 'settings.testAzurePat', organization: 'contoso', project: 'Webshop', azurePat: '' },
    ]);
  });
});

describe('validation', () => {
  it('validates inline, counts problems in the menu and blocks Save with the Rust messages', async () => {
    const { engine, user } = renderSettings({}, { with: { settings: invalidSettings } });
    expect(screen.getByText(MESSAGES.sevenPaceUrl)).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace URL')).toHaveAttribute('aria-invalid', 'true');
    expect(menuItem('Azure DevOps & 7pace')).toHaveAccessibleName('Azure DevOps & 7pace, 1 problem');
    expect(menuItem('Reminders')).toHaveAccessibleName('Reminders, 2 problems');
    expect(menuItem('Meetings')).toHaveAccessibleName('Meetings, 1 problem');
    expect(menuItem('Schedule & holidays')).toHaveAccessibleName('Schedule & holidays');

    // Nothing was edited, so there is no save bar; ⌘S still checks and lists the problems.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await user.keyboard('{Meta>}s{/Meta}');
    expect(engine.dispatched('settings.save')).toEqual([]);
    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Fix these settings before saving');
    for (const message of [MESSAGES.awareness, MESSAGES.dayReview, MESSAGES.defaultTicket, MESSAGES.sevenPaceUrl]) {
      expect(within(summary).getByText(message)).toBeInTheDocument();
    }

    await user.click(within(summary).getByRole('button', { name: 'Go to Time awareness' }));
    expect(menuItem('Reminders')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: 'Away minutes' })).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-awareness')));

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Go to Calendar meetings' }));
    expect(menuItem('Meetings')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: 'Default meeting ticket' })).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-meetings')));
  });

  it('validates the URL while the user types', async () => {
    const { user } = renderSettings();
    const url = screen.getByLabelText('Workspace URL');
    await user.type(url, '/api');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(MESSAGES.sevenPaceUrl)).toBeInTheDocument();
    await user.type(url, '{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(url).not.toHaveAttribute('aria-invalid');
  });

  it('shows the engine’s rejection verbatim', async () => {
    const { engine, user } = renderSettings();
    engine.handle('settings.save', () => {
      throw new MockEngineError(saveValidationError.kind, saveValidationError.message);
    });
    await user.type(screen.getByLabelText('Project (optional)'), ' EU');
    await user.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Settings were not saved');
    expect(alert).toHaveTextContent(saveValidationError.message);
  });

  it('tests the branch pattern live through the engine, under Git repositories', async () => {
    const { engine, user } = renderSettings({ view: 'git' });
    engine.handle('settings.testBranchPattern', ({ branch, pattern }) =>
      pattern.includes('(') && !pattern.includes(')')
        ? { text: 'Invalid pattern: The value “(” is invalid.', valid: false }
        : branch.includes('4790')
          ? { text: 'Ticket #4790', valid: true }
          : { text: 'No unique ticket found', valid: true },
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Branch rules' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'The app suggests' })).toBeInTheDocument();
    expect(await screen.findByText('Ticket #4790')).toBeInTheDocument();
    expect(engine.dispatched('settings.testBranchPattern').at(-1)).toEqual({
      type: 'settings.testBranchPattern',
      branch: 'feature/AB#4790-vat-number',
      pattern: stored.branchPattern,
    });
    const tryBranch = screen.getByLabelText('Try a branch name');
    await user.clear(tryBranch);
    await user.type(tryBranch, 'main');
    expect(await screen.findByText('No unique ticket found')).toBeInTheDocument();
    const pattern = screen.getByLabelText('Ticket number pattern');
    await user.clear(pattern);
    await user.type(pattern, '(');
    await waitFor(() => expect(pattern).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getAllByText('Invalid pattern: The value “(” is invalid.').length).toBeGreaterThan(0);
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.branchPattern).toBe('(');
  });
});

describe('immediate settings', () => {
  it('applies appearance through app.setInterface', async () => {
    const { engine, user } = renderSettings({ view: 'appearance' });
    expect(within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'System',
      'Light',
      'Dark',
    ]);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(engine.dispatched('app.setInterface')).toEqual([
      { type: 'app.setInterface', preferences: { theme: 'dark', scale: 100, contrast: 'system' } },
    ]);
    await user.click(screen.getByRole('radio', { name: '125%' }));
    expect(engine.dispatched('app.setInterface').at(-1)).toEqual({
      type: 'app.setInterface',
      preferences: { theme: 'dark', scale: 125, contrast: 'system' },
    });
    await user.click(within(screen.getByRole('radiogroup', { name: 'Contrast' })).getByRole('radio', { name: 'Increased' }));
    expect(engine.dispatched('app.setInterface').at(-1)).toMatchObject({ preferences: { contrast: 'increased' } });
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('applies Figma observation from the Sources overview through figma.setPreferences', async () => {
    const { engine, user } = renderSettings({ view: 'sources' });
    await user.click(screen.getByRole('switch', { name: 'Observe Figma files' }));
    expect(engine.dispatched('figma.setPreferences')).toEqual([
      { type: 'figma.setPreferences', preferences: { enabled: true, dismissalMinutes: 15, historyDays: 30 } },
    ]);
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });

  it('sets the interruption level per prompt kind', async () => {
    const { engine, user } = renderSettings({ view: 'notifications' });
    await user.click(screen.getByRole('radio', { name: 'Branch changes: Notify' }));
    expect(engine.dispatched('settings.setPromptInterruption')).toEqual([
      { type: 'settings.setPromptInterruption', kind: 'branch', level: 'notifyOnly' },
    ]);
    expect(screen.getByRole('radio', { name: 'Branch changes: Notify' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Branch changes: Open panel' })).not.toBeChecked();
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('sets quiet hours', async () => {
    const { engine, user } = renderSettings({ view: 'notifications' });
    const quiet = screen.getByRole('switch', { name: 'Quiet hours' });
    expect(quiet).toHaveAccessibleDescription(
      'No banners and no panels in this period. Prompts wait in the panel and on Today; 7pace activity checks still interrupt. Applies right away.',
    );
    expect(screen.getByRole('group', { name: 'Quiet from' })).toHaveTextContent('18:00');
    expect(screen.getByRole('group', { name: 'Quiet until' })).toHaveTextContent('8:00');
    await user.click(quiet);
    expect(engine.dispatched('settings.setQuietHours')).toEqual([
      { type: 'settings.setQuietHours', quietHours: { enabled: true, startMinute: 1080, endMinute: 480 } },
    ]);
    const from = within(screen.getByRole('group', { name: 'Quiet from' }))
      .getAllByRole('spinbutton')
      .filter((segment) => /hour/i.test(segment.getAttribute('aria-label') ?? ''));
    await user.click(from[0]!);
    await user.keyboard('{ArrowUp}');
    expect(engine.dispatched('settings.setQuietHours').at(-1)).toEqual({
      type: 'settings.setQuietHours',
      quietHours: { enabled: true, startMinute: 1140, endMinute: 480 },
    });
  });

  it('turns Open at login on through the autostart plugin', async () => {
    const { user } = renderSettings({ view: 'appearance' });
    const toggle = screen.getByRole('switch', { name: 'Open at login' });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    expect(platform.writeLaunchAtLogin).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('shows the onboarding again, only without unsaved changes', async () => {
    const { engine, user } = renderSettings();
    await user.clear(screen.getByRole('textbox', { name: 'Organization' }));
    await user.type(screen.getByRole('textbox', { name: 'Organization' }), 'fabrikam');
    await open(user, 'Updates & advanced');
    const again = screen.getByRole('button', { name: 'Show onboarding again' });
    expect(again).toBeDisabled();
    expect(screen.getByText(/^Save or revert your changes first/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expect(again).toBeEnabled();
    await user.click(again);
    expect(engine.dispatched('app.restartOnboarding')).toEqual([{ type: 'app.restartOnboarding' }]);
  });
});

describe('PIN pairing', () => {
  it('counts down to the PIN’s expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00.000Z'));
    renderSettings({}, { with: { settings: pairingInProgress } });
    expect(screen.getByText('482913')).toBeInTheDocument();
    expect(screen.getByText('60 seconds left')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1010);
    });
    expect(screen.getByText('59 seconds left')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Enter this PIN in 7pace → Apps → Pair Mobile App. Waiting for approval…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Requesting / waiting…' })).toBeDisabled();
  });

  it('cancels a pairing in progress', async () => {
    const { engine, user } = renderSettings({}, { with: { settings: pairingInProgress } });
    await user.click(screen.getByRole('button', { name: 'Cancel pairing' }));
    expect(engine.dispatched('pairing.cancel')).toHaveLength(1);
  });

  it('generates a PIN for the workspace as typed, saved or not', async () => {
    const { engine, user } = renderSettings({}, { with: { settings: pairingComplete } });
    const saved = pairingComplete.configuration.sevenPaceUrl.trim();
    expect(screen.getByText('Paired with contoso.timehub.7pace.com. Save changes to use this connection.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate pairing PIN' }));
    expect(engine.dispatched('pairing.generatePin')).toEqual([{ type: 'pairing.generatePin', workspace: saved }]);

    await user.clear(screen.getByLabelText('Workspace URL'));
    expect(screen.getByRole('button', { name: 'Generate pairing PIN' })).toBeDisabled();
    expect(screen.getByText('Enter your 7pace workspace above to pair.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Workspace URL'), 'https://fabrikam.timehub.7pace.com');
    await user.click(screen.getByRole('button', { name: 'Generate pairing PIN' }));
    expect(engine.dispatched('pairing.generatePin').at(-1)).toEqual({
      type: 'pairing.generatePin',
      workspace: 'https://fabrikam.timehub.7pace.com',
    });
  });

  it('cancels pairing when the workspace changes', async () => {
    const { engine, user } = renderSettings({}, { with: { settings: pairingInProgress } });
    await user.type(screen.getByLabelText('Workspace URL'), '/');
    expect(engine.dispatched('pairing.cancel')).toHaveLength(1);
  });

  it('switches between API token and PIN pairing in the draft', async () => {
    const { engine, user } = renderSettings();
    await user.click(screen.getByRole('radio', { name: 'Mobile PIN pairing' }));
    expect(screen.queryByLabelText('API token')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate pairing PIN' })).toBeEnabled();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.sevenPaceAuthMode).toBe('mobilePIN');
  });
});

describe('features', () => {
  it('maps module switches to configuration fields and hiddenPages', async () => {
    const { engine, user } = renderSettings({ view: 'features' });
    await user.click(screen.getByRole('switch', { name: 'Statistics' }));
    await user.click(screen.getByRole('switch', { name: 'Git branch watching' }));
    await user.click(screen.getByRole('switch', { name: 'Time awareness (idle, lock)' }));
    await user.click(screen.getByRole('switch', { name: 'Notifications' }));
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved).toEqual({
      ...stored,
      hiddenPages: ['statistics'],
      watchEnabled: false,
      notificationsEnabled: false,
      awareness: { ...stored.awareness, idleEnabled: false, lockEnabled: false },
    });
  });

  it('lists every module with its privacy line, permission and where a view shows', () => {
    renderSettings({ view: 'features' });
    const calendar = screen.getByRole('switch', { name: 'Calendar meetings' });
    expect(calendar).toHaveAccessibleDescription(/never sent to Azure or 7pace\.\s*Calendar access$/);
    expect(screen.getByRole('switch', { name: 'Figma context' })).toHaveAccessibleDescription(/window titles\..*Accessibility$/);
    expect(screen.getByRole('switch', { name: 'Calendar on Today' })).toHaveAccessibleDescription(/next to tracked time on Today/);
    expect(screen.getByRole('switch', { name: 'Statistics' })).toHaveAccessibleDescription(/Where time went and Patterns in Insights/);
    expect(screen.getByText('Targets and holidays')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Views' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('applies the Figma module immediately', async () => {
    const { engine, user } = renderSettings({ view: 'features' });
    await user.click(screen.getByRole('switch', { name: 'Figma context' }));
    expect(engine.dispatched('figma.setPreferences')).toHaveLength(1);
  });

  it('hides calendar modules where the OS has no calendar', async () => {
    const { user } = renderSettings({ view: 'features', os: 'windows' }, { with: { app: WINDOWS_APP } });
    expect(screen.queryByRole('switch', { name: 'Calendar meetings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Calendar on Today' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Microphone meetings' })).toBeInTheDocument();
    await open(user, 'Meetings');
    expect(level3()).toEqual(['Calls without a calendar event']);
    await open(user, 'Overview');
    expect(screen.queryByRole('heading', { name: 'Calendars' })).not.toBeInTheDocument();
    expect(within(menu()).queryByRole('button', { name: 'Calendars' })).not.toBeInTheDocument();
  });
});

describe('Schedule & holidays', () => {
  it('shows the design’s cards in order with the weekly total', () => {
    renderSettings({ view: 'schedule' });
    expect(level3()).toEqual(['Weekly target', 'Workday', 'Public holidays', 'Days off & exceptions']);
    expect(weeklyTotal()).toHaveTextContent('38h a week');
    expect(screen.getAllByRole('group', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ })).toHaveLength(7);
    expectDuration('Mon', '8', '00');
    expectDuration('Fri', '6', '00');
    expect(screen.getByRole('group', { name: 'Workday starts' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lower my target on Belgian public holidays' })).toBeChecked();
  });

  it('edits targets and exceptions in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'schedule' });
    await user.click(screen.getByRole('button', { name: 'Remove exception on 2026-12-24' }));
    await setDuration(user, 'Sat', '4', '0');
    expectDuration('Sat', '4', '00');
    expect(weeklyTotal()).toHaveTextContent('42h a week');
    await user.click(screen.getByRole('switch', { name: 'Lower my target on Belgian public holidays' }));
    expect(screen.getByText('· Saturday target, Public holidays, Days off & exceptions')).toBeInTheDocument();
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.targets.dateExceptions).toEqual([{ id: '2026-11-02', kind: 'Full-day leave', hours: 0, note: 'Autumn break' }]);
    expect(saved?.targets.minutesByWeekday).toEqual([0, 480, 480, 480, 480, 360, 240]);
    expect(saved?.targets.belgianHolidaysEnabled).toBe(false);
  });

  it('sets each day to the minute and keeps the weekly total exact', async () => {
    const { engine, user } = renderSettings({ view: 'schedule' });
    expectDuration('Sun', '0', '00');
    for (const [day, minutes] of [
      ['Mon', '36'],
      ['Tue', '36'],
      ['Wed', '36'],
      ['Thu', '36'],
      ['Fri', '37'],
    ] as const) {
      await setDuration(user, day, '7', minutes);
      expectDuration(day, '7', minutes);
    }
    // 4 × 7h 36m + 7h 37m: decimal hours would have floored this to 38h 0m.
    expect(weeklyTotal()).toHaveTextContent('38h 1m a week');
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.targets.minutesByWeekday).toEqual([0, 456, 456, 456, 456, 457, 0]);
  });

  it('steps an hour in the hours box and a quarter hour in the minutes box with the arrow keys', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    const friday = durationBoxes('Fri');
    await user.click(friday.minutes);
    await user.keyboard('{ArrowUp}');
    expectDuration('Fri', '6', '15');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expectDuration('Fri', '5', '45');
    await user.click(friday.hours);
    await user.keyboard('{ArrowUp}');
    expectDuration('Fri', '6', '45');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expectDuration('Fri', '4', '45');
    // Typed minutes step from what is typed, snapping to the quarter hour.
    await user.clear(friday.hours);
    await user.type(friday.hours, '7');
    await user.clear(friday.minutes);
    await user.type(friday.minutes, '36{ArrowUp}');
    expectDuration('Fri', '7', '45');
    // Never below 0 or past 24 hours.
    await user.click(durationBoxes('Sun').minutes);
    await user.keyboard('{ArrowDown}');
    expectDuration('Sun', '0', '00');
    await setDuration(user, 'Sat', '23', '50');
    await user.click(durationBoxes('Sat').hours);
    await user.keyboard('{ArrowUp}');
    expectDuration('Sat', '24', '00');
    expect(weeklyTotal()).toHaveTextContent('63h 45m a week');
  });

  it('rejects targets that are not durations or past 24 hours, keeping the last valid one', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    const monday = durationBoxes('Mon');
    await setDuration(user, 'Mon', '25', '00');
    expect(monday.hours).toHaveValue('25');
    expect(monday.hours).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Use 0 to 24h')).toBeInTheDocument();
    await user.clear(monday.hours);
    await user.type(monday.hours, 'eight');
    // No error while typing; it shows once the text is used.
    expect(screen.queryByText('Use whole hours and 0–59 minutes')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Use whole hours and 0–59 minutes')).toBeInTheDocument();
    await setDuration(user, 'Mon', '8', '60');
    expect(monday.minutes).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Use whole hours and 0–59 minutes')).toBeInTheDocument();
    // The draft keeps the last valid target (8h, as saved): nothing to save.
    expect(weeklyTotal()).toHaveTextContent('38h a week');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await setDuration(user, 'Mon', '24', '0');
    expectDuration('Mon', '24', '00');
    expect(monday.hours).not.toHaveAttribute('aria-invalid');
    expect(weeklyTotal()).toHaveTextContent('54h a week');
  });

  it('shows the save bar only for real target changes', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    await setDuration(user, 'Mon', '8', '0');
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
    await setDuration(user, 'Mon', '8', '1');
    expect(unsaved(1)).toBeInTheDocument();
    expect(screen.getByText('· Monday target')).toBeInTheDocument();
    await setDuration(user, 'Mon', '8', '');
    expectDuration('Mon', '8', '00');
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });

  it('replaces typed targets with the preset and with Revert', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    const preset = screen.getByRole('radio', { name: 'Mon–Thu 8h, Fri 6h' });
    expect(preset).toBeChecked();
    await setDuration(user, 'Mon', '7', '30');
    expect(preset).not.toBeChecked();
    await user.click(preset);
    expectDuration('Mon', '8', '00');
    expect(preset).toBeChecked();
    await setDuration(user, 'Mon', '6', '45');
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expectDuration('Mon', '8', '00');
  });

  it('adds a custom target exception to the minute and blocks text that is not a duration', async () => {
    const { engine, user } = renderSettings({ view: 'schedule' });
    await user.click(screen.getByRole('button', { name: /Full-day leave/ }));
    await user.click(screen.getByRole('option', { name: 'Custom target' }));
    const add = screen.getByRole('button', { name: 'Add exception' });
    await setDuration(user, 'Target', 'soon', '');
    expect(screen.getByText('Use whole hours and 0–59 minutes')).toBeInTheDocument();
    expect(add).toBeDisabled();
    await setDuration(user, 'Target', '7', '36');
    expectDuration('Target', '7', '36');
    expect(add).toBeEnabled();
    await user.click(add);
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    const custom = saved?.targets.dateExceptions?.find((item) => item.kind === 'Custom target');
    expect(Math.round((custom?.hours ?? 0) * 60)).toBe(456);
    expect(screen.getByText(/Custom target · 7h 36m/)).toBeInTheDocument();
  });

  it('adds a range of dates', async () => {
    const { user } = renderSettings({ view: 'schedule' });
    await user.click(screen.getByRole('checkbox', { name: 'A range of dates' }));
    expect(screen.getByRole('group', { name: 'From' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Through' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add / replace dates' })).toBeEnabled();
  });

  it('pages long exception lists', async () => {
    const dateExceptions = Array.from({ length: 45 }, (_, index) => ({
      id: `2027-01-${String((index % 28) + 1).padStart(2, '0')}`.replace('2027', String(2027 + Math.floor(index / 28))),
      kind: 'Full-day leave' as const,
      hours: 0,
      note: '',
    }));
    const { user } = renderSettings({ view: 'schedule' }, { with: { settings: settingsWith({ targets: { ...stored.targets, dateExceptions } }) } });
    expect(screen.getByRole('list', { name: 'Date exceptions (45)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(45);
  });
});

describe('Meetings', () => {
  it('shows calendar meetings and calls without a calendar event', () => {
    renderSettings({ view: 'meetings' });
    expect(level3()).toEqual(['Calendar meetings', 'Calls without a calendar event']);
  });

  it('shows microphone diagnostics with the apps it watches', () => {
    renderSettings({ view: 'meetings' }, { with: { settings: { ...configuredSettings, microphone: microphoneInUse } } });
    expect(screen.getByText('Microphone in use: Microsoft Teams, WebKit, Voice Memos')).toBeInTheDocument();
    const owners = within(screen.getByRole('list', { name: 'Apps using the microphone' })).getAllByRole('listitem');
    expect(owners.map((owner) => owner.textContent)).toEqual([
      'Microsoft Teamscom.microsoft.teams2Selected',
      'WebKitcom.apple.WebKit.GPUSelected',
      'Voice Memoscom.apple.VoiceMemosIgnored',
    ]);
    // 08:02:14Z in Brussels.
    expect(screen.getByText('Checked 10:02:14')).toBeInTheDocument();
  });

  it('checks the microphone now, only while suggestions are on', async () => {
    const { engine, user } = renderSettings({ view: 'meetings' }, { with: { settings: configuredSettings } });
    expect(screen.getByText('Watching microphone status · checked every 2 seconds')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(engine.dispatched('microphone.checkNow')).toHaveLength(1);
    act(() =>
      engine.setSlice('settings', {
        ...configuredSettings,
        configuration: { ...configuredSettings.configuration, microphone: { ...configuredSettings.configuration.microphone, enabled: false } },
      }),
    );
    expect(screen.getByText('Microphone meeting suggestions are off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  });
});

describe('Reminders', () => {
  it('shows the design’s cards in order', () => {
    renderSettings({ view: 'reminders' });
    expect(level3()).toEqual(['Timer defaults', 'Time awareness', 'Work applications', 'Day review']);
    expect(screen.getByRole('switch', { name: 'Remind me to review my day' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Round saved time to the nearest quarter hour' })).not.toBeChecked();
  });

  it('edits the day check, ticket reminders and meetings in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'reminders' });
    await user.click(screen.getByRole('switch', { name: 'Remind me to review my day' }));
    await user.click(screen.getByRole('switch', { name: 'Tell me when my ticket is closed' }));
    await open(user, 'Meetings');
    await user.click(screen.getByRole('switch', { name: 'Suggest tracking when a meeting starts' }));
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.dayReview.enabled).toBe(!stored.dayReview.enabled);
    expect(saved?.meetings.enabled).toBe(!stored.meetings.enabled);
    expect(saved?.completionReminders).toBe(!stored.completionReminders);
  });

  it('names saved work apps from the engine and marks the ones missing on this Mac', () => {
    renderSettings({ view: 'reminders' }, { with: { settings: configuredSettings } });
    const row = (id: string) => screen.getByText(id).closest('li')!;
    expect(within(row('com.googlecode.iterm2')).getByText('iTerm')).toBeInTheDocument();
    expect(row('com.openai.codex')).toHaveTextContent('Not installed');
    expect(screen.getAllByText('Not installed')).toHaveLength(1);
  });

  it('removes work apps in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'reminders' });
    await user.click(screen.getByRole('button', { name: 'Remove Xcode from work apps' }));
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.awareness.workAppIds).not.toContain('com.apple.dt.Xcode');
  });

  it('adds Windows work apps by executable name', async () => {
    const { engine, user } = renderSettings({ view: 'reminders', os: 'windows' }, { with: { app: WINDOWS_APP } });
    engine.handle('settings.resolveWorkApp', ({ path }) => ({ id: 'rider64.exe', name: 'JetBrains Rider', path }));
    await user.click(screen.getByRole('button', { name: 'Add app…' }));
    expect(platform.chooseApplications).toHaveBeenLastCalledWith('windows');
    expect(await screen.findByText('JetBrains Rider')).toBeInTheDocument();
    expect(screen.getByText('rider64.exe')).toBeInTheDocument();
    // Typed paths are reduced to the executable name Windows matches.
    expect(screen.getByText('Add by executable name')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Executable name' }), 'C:\\Tools\\Code.EXE');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('textbox', { name: 'Executable name' })).toHaveValue('');
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.awareness.workAppIds.slice(-2)).toEqual(['rider64.exe', 'code.exe']);
  });

  it('adds macOS work apps from an app bundle, by bundle identifier, with their name', async () => {
    const { engine, user } = renderSettings({ view: 'reminders' });
    engine.handle('settings.resolveWorkApp', ({ path }) => ({ id: 'dev.zed.Zed', name: 'Zed', path }));
    await user.click(screen.getByRole('button', { name: 'Add app…' }));
    expect(platform.chooseApplications).toHaveBeenLastCalledWith('macos');
    expect(engine.dispatched('settings.resolveWorkApp')).toEqual([{ type: 'settings.resolveWorkApp', path: '/Applications/Zed.app' }]);
    expect(await screen.findByText('Zed')).toBeInTheDocument();
    expect(screen.getByText('dev.zed.Zed')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    // An app already in the list cannot be added twice.
    await user.type(screen.getByRole('textbox', { name: 'Bundle identifier' }), 'dev.zed.Zed');
    expect(add).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: 'Bundle identifier' }));
    await user.type(screen.getByRole('textbox', { name: 'Bundle identifier' }), 'com.sublimetext.4');
    await user.click(add);
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.awareness.workAppIds.slice(-2)).toEqual(['dev.zed.Zed', 'com.sublimetext.4']);
  });

  it('reports an app the engine cannot read', async () => {
    const { engine, user } = renderSettings({ view: 'reminders' });
    engine.handle('settings.resolveWorkApp', () => {
      throw new MockEngineError('invalidIntent', 'Zed.app has no bundle identifier.');
    });
    await user.click(screen.getByRole('button', { name: 'Add app…' }));
    expect(await screen.findByText('Zed.app has no bundle identifier.')).toBeInTheDocument();
  });
});

describe('Sources', () => {
  it('shows Git, Figma, Calendars and Calls with their real state', async () => {
    const { engine, user } = renderSettings({ view: 'sources' }, { with: { agenda: sampleAgenda } });
    expect(level3()).toEqual(['Git repositories', 'Figma', 'Calendars', 'Calls']);
    const repositories = within(screen.getByRole('list', { name: 'Watched repositories' })).getAllByRole('listitem');
    expect(repositories.length).toBe(sampleSlices().repositories!.repositories.length);
    await user.click(screen.getByRole('switch', { name: 'Watch Git repositories' }));
    expect(engine.dispatched('repositories.toggleWatching')).toHaveLength(1);
    expect(screen.getByText(/linked files? · reads only file names and window titles/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Calendars shown' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Work',
      'Team events',
    ]);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Show my calendar on Today' }));
    expect(unsaved(1)).toBeInTheDocument();
    expect(screen.getByText('The calendar is off.')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.calendarEnabled).toBe(false);
    await expectNoA11yViolations();
  });

  it('opens Git repositories, Figma, Calendars and Meetings from the overview', async () => {
    const { user } = renderSettings({ view: 'sources' }, { with: { settings: settingsWith({ calendarEnabled: false }) } });
    await user.click(within(card('Git repositories')).getByRole('button', { name: 'Manage Git repositories' }));
    expect(menuItem('Git repositories')).toHaveAttribute('aria-current', 'page');
    await open(user, 'Overview');
    await user.click(screen.getByRole('button', { name: 'Manage Figma' }));
    expect(menuItem('Figma')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 3, name: 'File register' })).toBeInTheDocument();
    await open(user, 'Overview');
    expect(within(card('Calendars')).getByText('The calendar is off.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage Calendars' }));
    expect(menuItem('Calendars')).toHaveAttribute('aria-current', 'page');
    await open(user, 'Overview');
    await user.click(screen.getByRole('button', { name: 'Manage Calls' }));
    expect(menuItem('Meetings')).toHaveAttribute('aria-current', 'page');
  });

  it('leaves out Figma when it is hidden', () => {
    renderSettings({ view: 'sources', hiddenPages: ['figma'] });
    expect(screen.queryByRole('heading', { name: 'Figma' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Git repositories' })).toBeInTheDocument();
  });

  it('works without repositories', () => {
    renderSettings({ view: 'sources' }, { with: { repositories: emptyRepositories } });
    expect(screen.getByText('No repositories yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add repository' })).toBeInTheDocument();
  });
});

describe('Git repositories and Calendars', () => {
  it('shows the watched repositories, the Watching switch and the branch rules', async () => {
    const { engine, user } = renderSettings({ view: 'git' });
    expect(screen.getByRole('heading', { level: 3, name: /^Watched repositories · \d+$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add repositories…' })).toBeInTheDocument();
    expect(screen.getByText('Checks every 2 s')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Watch repositories' }));
    expect(engine.dispatched('repositories.toggleWatching')).toHaveLength(1);
    await user.click(screen.getByRole('switch', { name: 'Ask for an activity when the branch changes' }));
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.autoStartWhenIdle).toBe(!stored.autoStartWhenIdle);
  });

  it('chooses calendars and requests access', async () => {
    const { engine, user } = renderSettings({ view: 'calendars' }, { with: { agenda: sampleAgenda } });
    expect(level3()).toEqual(['Access', 'Calendars']);
    expect(screen.getByRole('switch', { name: 'Show events on Today' })).toBeChecked();
    expect(screen.getByText('2 of 3 shown')).toBeInTheDocument();
    const work = screen.getByRole('checkbox', { name: /^Work/ });
    const home = screen.getByRole('checkbox', { name: /^Home/ });
    expect(work).toBeChecked();
    expect(home).not.toBeChecked();
    // Every calendar shown again: stored as "none chosen", so new calendars appear too.
    await user.click(home);
    expect(unsaved(1)).toBeInTheDocument();
    expect(screen.getByText('· Calendars')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.selectedCalendarIds).toEqual([]);
    await user.click(work);
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[1]?.configuration.selectedCalendarIds).toEqual(['cal-team', 'cal-home']);

    act(() => engine.setSlice('agenda', agendaNotDetermined));
    expect(screen.queryByRole('region', { name: 'Calendars' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow calendar access…' }));
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(1);
  });

  it('keeps "none chosen" meaning every calendar', () => {
    const all = ['a', 'b', 'c'];
    expect(calendarShown([], 'b')).toBe(true);
    expect(calendarShown(['a'], 'b')).toBe(false);
    expect(setCalendarShown([], all, 'b', false)).toEqual(['a', 'c']);
    expect(setCalendarShown(['a', 'c'], all, 'b', true)).toEqual([]);
    expect(setCalendarShown(['a'], all, 'c', true)).toEqual(['a', 'c']);
  });
});

describe('Appearance, features and advanced', () => {
  it('shows the design’s cards and saves the app switches in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'appearance' });
    expect(level3()).toEqual(['Appearance', 'Menu bar & windows', 'Shortcuts']);
    expect(screen.getByText('Command palette')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Floating mini timer' }));
    await user.click(screen.getByRole('switch', { name: 'Quick switch ticket' }));
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.miniTimer).toBe(!stored.miniTimer);
    expect(saved?.quickSwitchEnabled).toBe(!stored.quickSwitchEnabled);
  });

  it('shows the version and saves automatic update checks, the same setting as the feature switch', async () => {
    const { engine, user } = renderSettings({ view: 'advanced' });
    expect(level3()).toEqual(['Updates', 'Sync intervals', 'Data on this Mac', 'Reset']);
    expect(screen.getByText(`Version ${sampleSlices().app!.version}`)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Check for updates automatically' }));
    await open(user, 'Features & privacy');
    expect(screen.getByRole('switch', { name: 'Check for updates automatically' })).not.toBeChecked();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.automaticUpdateChecks).toBe(false);
  });

  it('saves the 7pace refresh and polling intervals', async () => {
    const { engine, user } = renderSettings({ view: 'advanced' });
    await user.click(screen.getByRole('button', { name: /Refresh 7pace/ }));
    const options = await screen.findAllByRole('option');
    await user.click(options.find((option) => option.getAttribute('aria-selected') !== 'true')!);
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.pollSeconds).not.toBe(stored.pollSeconds);
  });
});

describe('links and the palette', () => {
  it('registers every card in the command palette', async () => {
    const { user } = renderSettings();
    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.keyboard('Calls without');
    await user.click(within(palette).getByRole('menuitem', { name: /Go to Settings: Calls without a calendar event/ }));
    await waitFor(() => expect(menuItem('Meetings')).toHaveAttribute('aria-current', 'page'));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-microphone')));
  });

  it('opens the card a link names and clears the link', async () => {
    window.location.hash = '#settings/microphone';
    renderSettings();
    expect(menuItem('Meetings')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-microphone')));
    expect(window.location.hash).toBe('');
  });

  it('follows links while Settings is open', async () => {
    renderSettings();
    act(() => {
      window.location.hash = '#settings/advanced';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(menuItem('Updates & advanced')).toHaveAttribute('aria-current', 'page'));
    expect(screen.getByRole('heading', { level: 3, name: 'Sync intervals' })).toBeInTheDocument();
    act(() => {
      window.location.hash = '#settings/git';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(menuItem('Git repositories')).toHaveAttribute('aria-current', 'page'));
  });

  it('reads section and view links', () => {
    expect(parseSettingsHash('#settings/holidays')).toEqual({ view: 'schedule', section: 'holidays' });
    expect(parseSettingsHash('#settings/sources')).toEqual({ view: 'sources' });
    // A view's own name wins over a card with the same id.
    expect(parseSettingsHash('#settings/notifications')).toEqual({ view: 'notifications' });
    expect(parseSettingsHash('#settings/calendarList')).toEqual({ view: 'calendars', section: 'calendarList' });
    expect(parseSettingsHash('#settings/nope')).toBeNull();
    expect(parseSettingsHash('#elsewhere')).toBeNull();
    expect(settingsHash('calendar')).toBe('#settings/calendar');
  });
});

describe('accessibility', () => {
  const views: SettingsView[] = [
    'accounts',
    'schedule',
    'meetings',
    'reminders',
    'notifications',
    'sources',
    'git',
    'figma',
    'calendars',
    'appearance',
    'features',
    'advanced',
    'about',
  ];
  for (const view of views) {
    it(`has no axe violations in ${view}`, async () => {
      renderSettings({ view }, { with: { agenda: sampleAgenda } });
      await expectNoA11yViolations();
    });
  }

  it('has no axe violations with validation errors and a pairing in progress', async () => {
    const settings: SettingsSlice = {
      ...pairingInProgress,
      configuration: { ...invalidSettings.configuration, sevenPaceAuthMode: 'mobilePIN' },
    };
    const { user } = renderSettings({}, { with: { settings } });
    expect(screen.getByText('482913')).toBeInTheDocument();
    await user.keyboard('{Meta>}s{/Meta}');
    expect(screen.getByText('Fix these settings before saving')).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});
