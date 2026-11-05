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

function menuItem(name: string) {
  return within(menu()).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`) });
}

async function open(user: { click: (element: Element) => Promise<void> }, name: string) {
  await user.click(menuItem(name));
  expect(menuItem(name)).toHaveAttribute('aria-current', 'page');
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });

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
    expect(within(menu()).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Azure DevOps & 7pace',
      'Targets & reminders',
      'Overview',
      'Git repositories',
      'Figma',
      'Calendars',
      'Appearance & app',
    ]);
    expect(menuItem('Azure DevOps & 7pace')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Azure DevOps & 7pace' })).toBeInTheDocument();

    await open(user, 'Overview');
    // The menu's "Sources" group and the view's title.
    expect(screen.getAllByRole('heading', { level: 2, name: 'Sources' })).toHaveLength(2);
    expect(screen.getByText('Sources suggest what to track. Nothing changes in 7pace until you confirm.')).toBeInTheDocument();
    await open(user, 'Appearance & app');
    expect(screen.getByRole('heading', { level: 2, name: 'Appearance & app' })).toBeInTheDocument();
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
  it('renders the configured accounts from the fixtures', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 3, name: 'Azure DevOps' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '7pace Timetracker' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toHaveValue('contoso');
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://contoso.timehub.7pace.com');
    // Both credentials are stored; the fields stay blank.
    expect(screen.getAllByText('Stored in Keychain')).toHaveLength(2);
    expect(screen.getByLabelText('Personal access token')).toHaveValue('');
    expect(screen.getByLabelText('Personal access token')).toHaveAttribute('placeholder', 'Paste a new token to replace the stored one');
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    // Nothing is unsaved, so nothing asks to be saved.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Tokens stay in Keychain. Your Git repositories stay untouched.')).toBeInTheDocument();
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

  it('guides the first run with the setup steps and an empty connection', async () => {
    renderSettings({}, { with: { settings: unconfiguredSettings, connection: unconfiguredConnection } });
    expect(screen.getByRole('heading', { level: 3, name: 'Connect your accounts to start tracking' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(['Appearance (done)', '2Accounts']);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
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
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')).toEqual([
      { type: 'settings.save', configuration: { ...stored, project: 'Checkout' }, azurePat: '', sevenPaceToken: '' },
    ]);
    expect(await screen.findByText('Settings saved · connection verified')).toBeInTheDocument();
  });

  it('sends trimmed new secrets with ⌘S and clears them after saving', async () => {
    const { engine, user } = renderSettings();
    await user.type(screen.getByLabelText('Personal access token'), '  pat-123  ');
    await user.type(screen.getByLabelText('API token'), 'token-456');
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
    await open(user, 'Targets & reminders');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const saturday = screen.getByRole('textbox', { name: 'Sat' });
    await user.clear(saturday);
    await user.type(saturday, '4');
    await user.tab();
    // The Sources overview has no save bar of its own, but shows it while edits are unsaved.
    await open(user, 'Overview');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await open(user, 'Azure DevOps & 7pace');
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('Webshop EU');
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.project).toBe('Webshop EU');
    expect(saved?.targets.hoursByWeekday).toEqual([0, 8, 8, 8, 8, 6, 4]);
  });

  it('shows no save bar on any view without unsaved edits', async () => {
    const { user } = renderSettings();
    for (const name of ['Azure DevOps & 7pace', 'Targets & reminders', 'Overview', 'Git repositories', 'Figma', 'Calendars', 'Appearance & app']) {
      await open(user, name);
      expect(screen.queryByRole('button', { name: 'Save changes' }), name).not.toBeInTheDocument();
      expect(screen.queryByText('Unsaved changes'), name).not.toBeInTheDocument();
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
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('tests the connection', async () => {
    const { engine, user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(engine.dispatched('connection.retry')).toHaveLength(1);
  });
});

describe('the save prompt', () => {
  it('appears after an edit and goes away when the edit is undone', async () => {
    const { user } = renderSettings();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    const project = screen.getByLabelText('Project (optional)');
    await user.type(project, 'X');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    await user.type(project, '{Backspace}');
    expect(project).toHaveValue('Webshop');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();

    // A typed token is unsaved too, until it is cleared again.
    const pat = screen.getByLabelText('Personal access token');
    await user.type(pat, 'x');
    expect(saveButton()).toBeInTheDocument();
    await user.clear(pat);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('goes away when a day is switched off and on again, although the list changed order', async () => {
    const { user } = renderSettings({ view: 'tracking' });
    const wednesday = screen.getByRole('checkbox', { name: /^Wed/ });
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
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
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

  it('explains where to get the API token or the PIN approved, expanded until 7pace is connected', async () => {
    const { user } = renderSettings({}, firstRun);
    const token = screen.getByText('How to get a 7pace API token').closest('details')!;
    expect(token).toHaveAttribute('open');
    const tokenSteps = within(screen.getByRole('list', { name: 'How to get a 7pace API token' })).getAllByRole('listitem');
    expect(tokenSteps.map((step) => step.textContent)).toEqual([
      'Open 7pace Timetracker (diekeure-webdev.timehub.7pace.com (opens in your browser)) and go to Settings → Reporting & API.',
      'Create a token there and copy it.',
      'Paste it in API token below and choose Save changes. It is kept in Keychain.',
    ]);
    await user.click(screen.getByRole('link', { name: /^diekeure-webdev\.timehub\.7pace\.com\s*\(opens in your browser\)$/ }));
    expect(platform.openExternalLink).toHaveBeenCalledWith('https://diekeure-webdev.timehub.7pace.com');

    await user.click(screen.getByRole('radio', { name: 'Mobile PIN pairing' }));
    expect(screen.getByText('How to get a pairing PIN approved').closest('details')).toHaveAttribute('open');
    const pinSteps = within(screen.getByRole('list', { name: 'How to get a pairing PIN approved' })).getAllByRole('listitem');
    expect(pinSteps.map((step) => step.textContent)).toEqual([
      'Check the workspace URL above, then choose Generate pairing PIN.',
      'In Azure DevOps, open 7pace Timetracker and go to Apps → Pair Mobile App.',
      'Enter the PIN there within one minute. It expires after that; generate a new one if it does.',
      'When this card says “Paired with …”, choose Save changes to use the connection.',
    ]);
    expect(screen.getByRole('link', { name: /^diekeure-webdev\.timehub\.7pace\.com\s*\(opens in your browser\)$/ })).toHaveAttribute(
      'href',
      'https://diekeure-webdev.timehub.7pace.com',
    );
    await expectNoA11yViolations();
  });

  it('folds the instructions away once a token is stored', () => {
    renderSettings();
    expect(screen.getByText('How to get a 7pace API token').closest('details')).not.toHaveAttribute('open');
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
    expect(screen.getByLabelText('Personal access token')).toHaveValue('');
    expect(screen.getByText('Stored in Keychain')).toBeInTheDocument();
    // The suggested 7pace workspace is still unsaved and still asks to be saved; setup goes on.
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://diekeure-webdev.timehub.7pace.com');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
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
    expect(menuItem('Targets & reminders')).toHaveAccessibleName('Targets & reminders, 3 problems');

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
    expect(menuItem('Targets & reminders')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: 'Inactivity threshold' })).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-awareness')));
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
    expect(screen.getByRole('columnheader', { name: 'Suggests' })).toBeInTheDocument();
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
    expect(within(screen.getByRole('group', { name: 'Theme' })).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
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
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('sets the interruption level per prompt kind', async () => {
    const { engine, user } = renderSettings({ view: 'tracking' });
    await user.click(screen.getByRole('button', { name: /Branch changes/ }));
    await user.click(await screen.findByRole('option', { name: 'Notify only' }));
    expect(engine.dispatched('settings.setPromptInterruption')).toEqual([
      { type: 'settings.setPromptInterruption', kind: 'branch', level: 'notifyOnly' },
    ]);
    expect(screen.getByRole('button', { name: /Branch changes/ })).toHaveTextContent('Notify only');
  });

  it('sets quiet hours', async () => {
    const { engine, user } = renderSettings({ view: 'tracking' });
    const quiet = screen.getByRole('switch', { name: 'Quiet hours' });
    expect(quiet).toHaveAccessibleDescription('No panel or banners between 18:00 and 08:00. Applies right away.');
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
    await open(user, 'Appearance & app');
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
    const { engine, user } = renderSettings({ view: 'appearance' });
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
    renderSettings({ view: 'appearance' });
    const calendar = screen.getByRole('switch', { name: 'Calendar meetings' });
    expect(calendar).toHaveAccessibleDescription(/Privacy.*never sent to Azure or 7pace.*Permission.*Calendar access/);
    expect(screen.getByRole('switch', { name: 'Figma context' })).toHaveAccessibleDescription(/Permission\s*Accessibility/);
    expect(screen.getByRole('switch', { name: 'Calendar on Today' })).toHaveAccessibleDescription(/next to tracked time on Today/);
    expect(screen.getByRole('switch', { name: 'Statistics' })).toHaveAccessibleDescription(/Where time went and Patterns in Insights/);
    expect(screen.getByText('Targets and holidays')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Views' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('applies the Figma module immediately', async () => {
    const { engine, user } = renderSettings({ view: 'appearance' });
    await user.click(screen.getByRole('switch', { name: 'Figma context' }));
    expect(engine.dispatched('figma.setPreferences')).toHaveLength(1);
  });

  it('hides calendar modules where the OS has no calendar', async () => {
    const { user } = renderSettings({ view: 'appearance', os: 'windows' }, { with: { app: WINDOWS_APP } });
    expect(screen.queryByRole('switch', { name: 'Calendar meetings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Calendar on Today' })).not.toBeInTheDocument();
    await open(user, 'Targets & reminders');
    expect(screen.queryByRole('heading', { name: 'Meetings' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Microphone meetings' })).toBeInTheDocument();
    await open(user, 'Overview');
    expect(screen.queryByRole('heading', { name: 'Calendars' })).not.toBeInTheDocument();
  });
});

describe('Targets & reminders', () => {
  it('shows the design’s cards in order with the weekly total', () => {
    renderSettings({ view: 'tracking' });
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Daily targets',
      'Holidays & leave',
      'Meetings',
      'Microphone meetings',
      'Day check',
      'Notifications & quiet hours',
      'Timer & reminders',
      'Time awareness',
    ]);
    expect(screen.getByText('Weekly total:').parentElement).toHaveTextContent('38h 0m a week');
    expect(screen.getAllByRole('textbox', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ })).toHaveLength(7);
    expect(screen.getByRole('group', { name: 'Workday starts' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Remind me to review my day' })).toBeChecked();
  });

  it('edits the day check and meetings in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'tracking' });
    await user.click(screen.getByRole('switch', { name: 'Remind me to review my day' }));
    await user.click(screen.getByRole('switch', { name: 'Suggest tracking when a calendar meeting starts' }));
    await user.click(screen.getByRole('switch', { name: 'Remind me when the tracked ticket is completed' }));
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.dayReview.enabled).toBe(!stored.dayReview.enabled);
    expect(saved?.meetings.enabled).toBe(!stored.meetings.enabled);
    expect(saved?.completionReminders).toBe(!stored.completionReminders);
  });

  it('shows microphone diagnostics with the apps it watches', () => {
    renderSettings({ view: 'tracking' }, { with: { settings: { ...configuredSettings, microphone: microphoneInUse } } });
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
    const { engine, user } = renderSettings({ view: 'tracking' }, { with: { settings: configuredSettings } });
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

  it('names saved work apps from the engine and marks the ones missing on this Mac', () => {
    renderSettings({ view: 'tracking' }, { with: { settings: configuredSettings } });
    const row = (id: string) => screen.getByText(id).closest('li')!;
    expect(within(row('com.googlecode.iterm2')).getByText('iTerm')).toBeInTheDocument();
    expect(row('com.openai.codex')).toHaveTextContent('Not installed on this Mac');
    expect(screen.getAllByText('Not installed on this Mac')).toHaveLength(1);
  });

  it('edits targets, exceptions and work apps in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'tracking' });
    await user.click(screen.getByRole('button', { name: 'Remove exception on 2026-12-24' }));
    await user.click(screen.getByRole('button', { name: 'Remove Xcode from work apps' }));
    const saturday = screen.getByRole('textbox', { name: 'Sat' });
    await user.clear(saturday);
    await user.type(saturday, '4');
    await user.tab();
    expect(screen.getByText('42h 0m')).toBeInTheDocument();
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.targets.dateExceptions).toEqual([{ id: '2026-11-02', kind: 'Full-day leave', hours: 0, note: 'Autumn break' }]);
    expect(saved?.targets.hoursByWeekday).toEqual([0, 8, 8, 8, 8, 6, 4]);
    expect(saved?.targets.weeklyHours).toBe(42);
    expect(saved?.awareness.workAppIds).not.toContain('com.apple.dt.Xcode');
  });

  it('adds Windows work apps by executable name', async () => {
    const { engine, user } = renderSettings({ view: 'tracking', os: 'windows' }, { with: { app: WINDOWS_APP } });
    engine.handle('settings.resolveWorkApp', ({ path }) => ({ id: 'rider64.exe', name: 'JetBrains Rider', path }));
    await user.click(screen.getByRole('button', { name: 'Choose applications…' }));
    expect(platform.chooseApplications).toHaveBeenLastCalledWith('windows');
    expect(await screen.findByText('JetBrains Rider')).toBeInTheDocument();
    expect(screen.getByText('rider64.exe')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.awareness.workAppIds.at(-1)).toBe('rider64.exe');
  });

  it('adds macOS work apps from an app bundle, by bundle identifier, with their name', async () => {
    const { engine, user } = renderSettings({ view: 'tracking' });
    engine.handle('settings.resolveWorkApp', ({ path }) => ({ id: 'dev.zed.Zed', name: 'Zed', path }));
    await user.click(screen.getByRole('button', { name: 'Choose applications…' }));
    expect(platform.chooseApplications).toHaveBeenLastCalledWith('macos');
    expect(engine.dispatched('settings.resolveWorkApp')).toEqual([{ type: 'settings.resolveWorkApp', path: '/Applications/Zed.app' }]);
    expect(await screen.findByText('Zed')).toBeInTheDocument();
    expect(screen.getByText('dev.zed.Zed')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.awareness.workAppIds.at(-1)).toBe('dev.zed.Zed');
  });

  it('reports an app the engine cannot read', async () => {
    const { engine, user } = renderSettings({ view: 'tracking' });
    engine.handle('settings.resolveWorkApp', () => {
      throw new MockEngineError('invalidIntent', 'Zed.app has no bundle identifier.');
    });
    await user.click(screen.getByRole('button', { name: 'Choose applications…' }));
    expect(await screen.findByText('Zed.app has no bundle identifier.')).toBeInTheDocument();
  });

  it('pages long exception lists', async () => {
    const dateExceptions = Array.from({ length: 45 }, (_, index) => ({
      id: `2027-01-${String((index % 28) + 1).padStart(2, '0')}`.replace('2027', String(2027 + Math.floor(index / 28))),
      kind: 'Full-day leave' as const,
      hours: 0,
      note: '',
    }));
    const { user } = renderSettings({ view: 'tracking' }, { with: { settings: settingsWith({ targets: { ...stored.targets, dateExceptions } }) } });
    expect(screen.getByRole('heading', { name: 'Date exceptions (45)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(45);
  });
});

describe('Sources', () => {
  it('shows Git, Figma and Calendars with their real state', async () => {
    const { engine, user } = renderSettings({ view: 'sources' }, { with: { agenda: sampleAgenda } });
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Git repositories',
      'Figma Desktop',
      'Calendars',
    ]);
    const repositories = within(screen.getByRole('list', { name: 'Watched repositories' })).getAllByRole('listitem');
    expect(repositories.length).toBe(sampleSlices().repositories!.repositories.length);
    await user.click(screen.getByRole('switch', { name: /Watch branches/ }));
    expect(engine.dispatched('repositories.toggleWatching')).toHaveLength(1);
    expect(screen.getByText(/linked files? · reads only file names and window titles/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Home · iCloud' })).not.toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Home · iCloud' }));
    // Every calendar shown again: stored as "none chosen", so new calendars appear too.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.selectedCalendarIds).toEqual([]);
    await expectNoA11yViolations();
  });

  it('opens Git repositories, Figma and Calendars from the overview', async () => {
    const { user } = renderSettings({ view: 'sources' }, { with: { settings: settingsWith({ calendarEnabled: false }) } });
    await user.click(within(screen.getByRole('region', { name: 'Git repositories' })).getByRole('button', { name: 'Git repositories' }));
    expect(menuItem('Git repositories')).toHaveAttribute('aria-current', 'page');
    await open(user, 'Overview');
    await user.click(screen.getByRole('button', { name: 'Figma files and history' }));
    expect(menuItem('Figma')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 3, name: 'File register' })).toBeInTheDocument();
    await open(user, 'Overview');
    await user.click(screen.getByRole('button', { name: 'Turn it on in Calendars' }));
    expect(menuItem('Calendars')).toHaveAttribute('aria-current', 'page');
  });

  it('leaves out Figma when it is hidden', () => {
    renderSettings({ view: 'sources', hiddenPages: ['figma'] });
    expect(screen.queryByRole('heading', { name: 'Figma Desktop' })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('switch', { name: 'Watching' }));
    expect(engine.dispatched('repositories.toggleWatching')).toHaveLength(1);
    await user.click(screen.getByRole('switch', { name: 'Open the activity chooser for a new branch' }));
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.autoStartWhenIdle).toBe(!stored.autoStartWhenIdle);
  });

  it('chooses calendars and requests access', async () => {
    const { engine, user } = renderSettings({ view: 'calendars' }, { with: { agenda: sampleAgenda } });
    expect(screen.getByRole('switch', { name: 'Show my calendar on Today' })).toBeChecked();
    const work = screen.getByRole('switch', { name: 'Work · Exchange' });
    expect(work).toBeChecked();
    await user.click(work);
    await user.click(screen.getByRole('switch', { name: 'Home · iCloud' }));
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.selectedCalendarIds).toEqual(['cal-team', 'cal-home']);

    act(() => engine.setSlice('agenda', agendaNotDetermined));
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

describe('Appearance & app', () => {
  it('shows the design’s cards and saves the app switches in the draft', async () => {
    const { engine, user } = renderSettings({ view: 'appearance' });
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Appearance',
      'App',
      'App updates',
      'Features',
      'Advanced',
    ]);
    expect(screen.getByText('Open the command palette')).toBeInTheDocument();
    expect(screen.getByText(`Version ${sampleSlices().app!.version}`)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Floating mini timer' }));
    await user.click(screen.getByRole('switch', { name: /^Quick switch from any app/ }));
    await user.click(saveButton());
    const saved = engine.dispatched('settings.save')[0]?.configuration;
    expect(saved?.miniTimer).toBe(!stored.miniTimer);
    expect(saved?.quickSwitchEnabled).toBe(!stored.quickSwitchEnabled);
  });

  it('saves automatic update checks from the switch the updater section names', async () => {
    const { engine, user } = renderSettings({ view: 'appearance' });
    expect(screen.getByRole('heading', { level: 3, name: 'App updates' })).toBeInTheDocument();
    expect(screen.getByText(/“Check for updates automatically” in these settings/)).toBeInTheDocument();
    const [updates, feature] = screen.getAllByRole('switch', { name: 'Check for updates automatically' });
    await user.click(updates!);
    expect(feature).not.toBeChecked();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.automaticUpdateChecks).toBe(false);
  });

  it('saves the 7pace refresh and polling intervals', async () => {
    const { engine, user } = renderSettings({ view: 'appearance' });
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
    await user.keyboard('Microphone');
    await user.click(within(palette).getByRole('menuitem', { name: /Go to Settings: Microphone meetings/ }));
    await waitFor(() => expect(menuItem('Targets & reminders')).toHaveAttribute('aria-current', 'page'));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-microphone')));
  });

  it('opens the card a link names and clears the link', async () => {
    window.location.hash = '#settings/microphone';
    renderSettings();
    expect(menuItem('Targets & reminders')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('settings-microphone')));
    expect(window.location.hash).toBe('');
  });

  it('follows links while Settings is open', async () => {
    renderSettings();
    act(() => {
      window.location.hash = '#settings/advanced';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(menuItem('Appearance & app')).toHaveAttribute('aria-current', 'page'));
    expect(screen.getByRole('heading', { name: 'Advanced' })).toBeInTheDocument();
    act(() => {
      window.location.hash = '#settings/git';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(menuItem('Git repositories')).toHaveAttribute('aria-current', 'page'));
  });

  it('reads section and view links', () => {
    expect(parseSettingsHash('#settings/holidays')).toEqual({ view: 'tracking', section: 'holidays' });
    expect(parseSettingsHash('#settings/sources')).toEqual({ view: 'sources' });
    expect(parseSettingsHash('#settings/nope')).toBeNull();
    expect(parseSettingsHash('#elsewhere')).toBeNull();
    expect(settingsHash('calendar')).toBe('#settings/calendar');
  });
});

describe('accessibility', () => {
  const views: SettingsView[] = ['accounts', 'tracking', 'sources', 'git', 'figma', 'calendars', 'appearance'];
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
