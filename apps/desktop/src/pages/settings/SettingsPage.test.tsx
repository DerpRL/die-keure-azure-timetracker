import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockIpc } from '../../ipc';
import type { Configuration, SettingsSlice } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
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
import { EngineProvider } from '../../state/EngineProvider';
import { SliceStore } from '../../state/store';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import { renderWithProviders } from '../../test/render';
import { MESSAGES } from '../../features/settings/validation';
import type * as PlatformModule from '../../features/settings/platform';
import SettingsPage from './index';

const platform = vi.hoisted(() => ({
  readLaunchAtLogin: vi.fn(() => Promise.resolve<boolean | null>(false)),
  writeLaunchAtLogin: vi.fn((on: boolean) => Promise.resolve(on)),
  chooseExecutables: vi.fn(() => Promise.resolve(['C:\\Program Files\\JetBrains\\Rider64.exe'])),
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

function tab(name: string) {
  return screen.getByRole('tab', { name: new RegExp(`^${name}(,|$)`) });
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

describe('Settings page states', () => {
  it('renders the configured accounts from the fixtures', () => {
    renderWithEngine(<SettingsPage />);
    expect(screen.getByRole('tablist', { name: 'Settings categories' })).toBeInTheDocument();
    expect(tab('Accounts')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Accounts & connection' })).toBeInTheDocument();
    expect(screen.getByLabelText('Azure organization')).toHaveValue('contoso');
    expect(screen.getByLabelText('7pace workspace')).toHaveValue('https://contoso.timehub.7pace.com');
    // Both credentials are stored; the fields stay blank.
    expect(screen.getAllByText('Stored')).toHaveLength(2);
    expect(screen.getByLabelText('Azure DevOps PAT')).toHaveValue('');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('shows a skeleton until the settings slice arrives', () => {
    renderWithEngine(<SettingsPage />, { slices: {} });
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('explains when the engine cannot be reached', async () => {
    resetMockIpc();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithProviders(
      <EngineProvider store={new SliceStore()}>
        <SettingsPage />
      </EngineProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Settings are unavailable' })).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });

  it('guides the first run with an empty connection', () => {
    renderWithEngine(<SettingsPage />, { with: { settings: unconfiguredSettings, connection: unconfiguredConnection } });
    expect(screen.getByText('Connect your accounts to start tracking')).toBeInTheDocument();
    expect(screen.queryByText('Stored')).not.toBeInTheDocument();
    expect(screen.getByText('Work Items (Read) permission is enough for ticket lookup.')).toBeInTheDocument();
    expect(screen.getByText('The timer has not been checked yet.')).toBeInTheDocument();
  });
});

describe('Save and Revert', () => {
  it('sends exactly the edited configuration; blank secrets stay blank', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    const project = screen.getByLabelText('Azure project');
    await user.clear(project);
    await user.type(project, 'Checkout');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')).toEqual([
      { type: 'settings.save', configuration: { ...stored, project: 'Checkout' }, azurePat: '', sevenPaceToken: '' },
    ]);
    expect(await screen.findByText('Settings saved · connection verified')).toBeInTheDocument();
  });

  it('sends trimmed new secrets and clears them after saving', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.type(screen.getByLabelText('Azure DevOps PAT'), '  pat-123  ');
    await user.type(screen.getByLabelText('7pace API token'), 'token-456');
    await user.keyboard('{Meta>}s{/Meta}');
    expect(engine.dispatched('settings.save')).toEqual([
      { type: 'settings.save', configuration: stored, azurePat: 'pat-123', sevenPaceToken: 'token-456' },
    ]);
    await waitFor(() => expect(screen.getByLabelText('Azure DevOps PAT')).toHaveValue(''));
    expect(screen.getByLabelText('7pace API token')).toHaveValue('');
  });

  it('reverts edits and typed secrets', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    const organization = screen.getByLabelText('Azure organization');
    await user.clear(organization);
    await user.type(organization, 'fabrikam');
    await user.type(screen.getByLabelText('Azure DevOps PAT'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expect(organization).toHaveValue('contoso');
    expect(screen.getByLabelText('Azure DevOps PAT')).toHaveValue('');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeDisabled();
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('takes new slice values under an unchanged draft and keeps the user’s edits otherwise', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    const organization = screen.getByLabelText('Azure organization');
    const project = screen.getByLabelText('Azure project');
    act(() => engine.setSlice('settings', settingsWith({ organization: 'fabrikam' })));
    expect(organization).toHaveValue('fabrikam');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();

    await user.type(project, 'X');
    act(() => engine.setSlice('settings', settingsWith({ organization: 'northwind' })));
    expect(organization).toHaveValue('northwind');
    expect(project).toHaveValue('WebshopX');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('never lets the draft overwrite settings that apply immediately', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.type(screen.getByLabelText('Azure project'), ' EU');
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

  it('disables writes while the engine is busy', () => {
    renderWithEngine(<SettingsPage />, { with: { app: appWith({ busy: true }) } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh connection' })).toBeDisabled();
  });
});

describe('validation', () => {
  it('validates inline and blocks Save with the Rust messages', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />, { with: { settings: invalidSettings } });
    expect(screen.getByText(MESSAGES.sevenPaceUrl)).toBeInTheDocument();
    expect(screen.getByLabelText('7pace workspace')).toHaveAttribute('aria-invalid', 'true');
    expect(tab('Tracking')).toHaveAccessibleName('Tracking, 1 problem');
    expect(tab('Day review')).toHaveAccessibleName('Day review, 1 problem');

    await user.click(saveButton());
    expect(engine.dispatched('settings.save')).toEqual([]);
    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Fix these settings before saving');
    for (const message of [MESSAGES.awareness, MESSAGES.dayReview, MESSAGES.defaultTicket, MESSAGES.sevenPaceUrl]) {
      expect(within(summary).getByText(message)).toBeInTheDocument();
    }

    await user.click(within(summary).getByRole('button', { name: 'Go to Time awareness' }));
    expect(tab('Tracking')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Inactivity threshold' })).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(document.getElementById('settings-awareness'));
  });

  it('validates the URL while the user types', async () => {
    const { user } = renderWithEngine(<SettingsPage />);
    const url = screen.getByLabelText('7pace workspace');
    await user.type(url, '/api');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(MESSAGES.sevenPaceUrl)).toBeInTheDocument();
    await user.type(url, '{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(url).not.toHaveAttribute('aria-invalid');
  });

  it('shows the engine’s rejection verbatim', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    engine.handle('settings.save', () => {
      throw new MockEngineError(saveValidationError.kind, saveValidationError.message);
    });
    await user.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Settings were not saved');
    expect(alert).toHaveTextContent(saveValidationError.message);
  });

  it('tests the branch pattern live through the engine', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    engine.handle('settings.testBranchPattern', ({ branch, pattern }) =>
      pattern.includes('(') && !pattern.includes(')')
        ? { text: 'Invalid pattern: The value “(” is invalid.', valid: false }
        : branch.includes('33624')
          ? { text: 'Ticket #33624', valid: true }
          : { text: 'No unique ticket found', valid: true },
    );
    await user.click(tab('Tracking'));
    expect(await screen.findByText('Ticket #33624')).toBeInTheDocument();
    expect(engine.dispatched('settings.testBranchPattern').at(-1)).toEqual({
      type: 'settings.testBranchPattern',
      branch: 'feature/33624-improve-loading',
      pattern: stored.branchPattern,
    });
    const pattern = screen.getByLabelText('Ticket pattern');
    await user.clear(pattern);
    await user.type(pattern, '(');
    await waitFor(() => expect(pattern).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getAllByText('Invalid pattern: The value “(” is invalid.').length).toBeGreaterThan(0);
  });
});

describe('immediate settings', () => {
  it('applies appearance through app.setInterface', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Appearance'));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(engine.dispatched('app.setInterface')).toEqual([
      { type: 'app.setInterface', preferences: { theme: 'dark', scale: 100, contrast: 'system' } },
    ]);
    await user.click(screen.getByRole('radio', { name: '125%' }));
    expect(engine.dispatched('app.setInterface').at(-1)).toEqual({
      type: 'app.setInterface',
      preferences: { theme: 'dark', scale: 125, contrast: 'system' },
    });
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('applies Figma preferences through figma.setPreferences', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Tracking'));
    await user.click(screen.getByRole('switch', { name: 'Observe Figma files' }));
    expect(engine.dispatched('figma.setPreferences')).toEqual([
      { type: 'figma.setPreferences', preferences: { enabled: true, dismissalMinutes: 15, historyDays: 30 } },
    ]);
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('sets the interruption level per prompt kind', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Notifications'));
    await user.click(screen.getByRole('button', { name: /Branch changes/ }));
    await user.click(await screen.findByRole('option', { name: 'Notify only' }));
    expect(engine.dispatched('settings.setPromptInterruption')).toEqual([
      { type: 'settings.setPromptInterruption', kind: 'branch', level: 'notifyOnly' },
    ]);
    expect(screen.getByRole('button', { name: /Branch changes/ })).toHaveTextContent('Notify only');
  });

  it('sets quiet hours', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Notifications'));
    await user.click(screen.getByRole('switch', { name: 'Use quiet hours' }));
    expect(engine.dispatched('settings.setQuietHours')).toEqual([
      { type: 'settings.setQuietHours', quietHours: { enabled: true, startMinute: 1080, endMinute: 480 } },
    ]);
    const from = screen.getAllByRole('spinbutton').filter((segment) => /hour/i.test(segment.getAttribute('aria-label') ?? ''));
    // Day review is in another category, so the first hour segment is "Quiet from".
    await user.click(from[0]!);
    await user.keyboard('{ArrowUp}');
    expect(engine.dispatched('settings.setQuietHours').at(-1)).toEqual({
      type: 'settings.setQuietHours',
      quietHours: { enabled: true, startMinute: 1140, endMinute: 480 },
    });
  });

  it('turns launch at login on through the autostart plugin', async () => {
    const { user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('App'));
    const toggle = screen.getByRole('switch', { name: 'Open Azure timetracker at login' });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    expect(platform.writeLaunchAtLogin).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });
});

describe('PIN pairing', () => {
  it('counts down to the PIN’s expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00.000Z'));
    renderWithEngine(<SettingsPage />, { with: { settings: pairingInProgress } });
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
    const { engine, user } = renderWithEngine(<SettingsPage />, { with: { settings: pairingInProgress } });
    await user.click(screen.getByRole('button', { name: 'Cancel pairing' }));
    expect(engine.dispatched('pairing.cancel')).toHaveLength(1);
  });

  it('generates a PIN for the saved workspace only', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />, { with: { settings: pairingComplete } });
    expect(screen.getByText('Paired with contoso.timehub.7pace.com. Save changes to use this connection.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate pairing PIN' }));
    expect(engine.dispatched('pairing.generatePin')).toEqual([{ type: 'pairing.generatePin' }]);

    await user.type(screen.getByLabelText('7pace workspace'), '/');
    await user.clear(screen.getByLabelText('7pace workspace'));
    await user.type(screen.getByLabelText('7pace workspace'), 'https://fabrikam.timehub.7pace.com');
    expect(screen.getByRole('button', { name: 'Generate pairing PIN' })).toBeDisabled();
    expect(screen.getByText('Save changes first: pairing uses the saved 7pace workspace.')).toBeInTheDocument();
  });

  it('cancels pairing when the workspace changes', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />, { with: { settings: pairingInProgress } });
    await user.type(screen.getByLabelText('7pace workspace'), '/');
    expect(engine.dispatched('pairing.cancel')).toHaveLength(1);
  });

  it('switches between API token and PIN pairing in the draft', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(screen.getByRole('radio', { name: 'Mobile PIN pairing' }));
    expect(screen.queryByLabelText('7pace API token')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate pairing PIN' })).toBeEnabled();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.sevenPaceAuthMode).toBe('mobilePIN');
  });
});

describe('features', () => {
  it('maps module switches to configuration fields and hiddenPages', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Features'));
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

  it('lists every module with its privacy line and permission', async () => {
    const { user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Features'));
    const calendar = screen.getByRole('switch', { name: 'Calendar meetings' });
    expect(calendar).toHaveAccessibleDescription(/Privacy.*never sent to Azure or 7pace.*Permission.*Calendar access/);
    expect(screen.getByRole('switch', { name: 'Figma context' })).toHaveAccessibleDescription(/Permission\s*Accessibility/);
    expect(screen.getByText('Targets and holidays')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('applies the Figma module immediately', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Features'));
    await user.click(screen.getByRole('switch', { name: 'Figma context' }));
    expect(engine.dispatched('figma.setPreferences')).toHaveLength(1);
  });

  it('hides calendar modules where the OS has no calendar', async () => {
    const { user } = renderWithEngine(<SettingsPage />, {
      with: { app: appWith({ os: 'windows', features: { calendar: false, microphone: true, figmaTitleOnly: true } }) },
      platform: 'windows',
    });
    await user.click(tab('Features'));
    expect(screen.queryByRole('switch', { name: 'Calendar meetings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Agenda page' })).not.toBeInTheDocument();
    await user.click(tab('Meetings'));
    expect(screen.queryByRole('heading', { name: 'Apple Calendar' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Microphone meetings' })).toBeInTheDocument();
  });
});

describe('sections', () => {
  it('chooses calendars and requests access', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />, { with: { agenda: sampleAgenda } });
    await user.click(tab('Meetings'));
    const work = screen.getByRole('checkbox', { name: 'Work · Exchange' });
    expect(work).toBeChecked();
    await user.click(work);
    await user.click(screen.getByRole('checkbox', { name: 'Home · iCloud' }));
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.selectedCalendarIds).toEqual(['cal-team', 'cal-home']);

    act(() => engine.setSlice('agenda', agendaNotDetermined));
    await user.click(screen.getByRole('button', { name: 'Allow calendar access…' }));
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(1);
  });

  it('shows microphone diagnostics with the apps it watches', async () => {
    const { user } = renderWithEngine(<SettingsPage />, { with: { settings: { ...configuredSettings, microphone: microphoneInUse } } });
    await user.click(tab('Meetings'));
    expect(screen.getByText('Microphone in use: Microsoft Teams, WebKit, Voice Memos')).toBeInTheDocument();
    const owners = within(screen.getByRole('list', { name: 'Apps using the microphone' })).getAllByRole('listitem');
    expect(owners.map((owner) => owner.textContent)).toEqual([
      'Microsoft Teamscom.microsoft.teams2Selected',
      'WebKitcom.apple.WebKit.GPUSelected',
      'Voice Memoscom.apple.VoiceMemosIgnored',
    ]);
  });

  it('edits targets, exceptions and work apps in the draft', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('Tracking'));
    await user.click(screen.getByRole('button', { name: 'Remove exception on 2026-12-24' }));
    await user.click(screen.getByRole('button', { name: 'Remove Xcode from work apps' }));
    const saturday = screen.getByRole('textbox', { name: 'Saturday' });
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
    const { engine, user } = renderWithEngine(<SettingsPage />, {
      with: { app: appWith({ os: 'windows', features: { calendar: false, microphone: true, figmaTitleOnly: true } }) },
      platform: 'windows',
    });
    await user.click(tab('Tracking'));
    await user.click(screen.getByRole('button', { name: 'Choose applications…' }));
    expect(await screen.findByText('rider64.exe')).toBeInTheDocument();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.awareness.workAppIds.at(-1)).toBe('rider64.exe');
  });

  it('saves automatic update checks from the switch the updater section names', async () => {
    const { engine, user } = renderWithEngine(<SettingsPage />);
    await user.click(tab('App'));
    expect(screen.getByRole('heading', { level: 2, name: 'App updates' })).toBeInTheDocument();
    expect(screen.getByText(/“Check for updates automatically” in these settings/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Check for updates automatically' }));
    await user.click(tab('Features'));
    expect(screen.getByRole('switch', { name: 'Check for updates automatically' })).not.toBeChecked();
    await user.click(saveButton());
    expect(engine.dispatched('settings.save')[0]?.configuration.automaticUpdateChecks).toBe(false);
  });

  it('pages long exception lists', async () => {
    const dateExceptions = Array.from({ length: 45 }, (_, index) => ({
      id: `2027-01-${String((index % 28) + 1).padStart(2, '0')}`.replace('2027', String(2027 + Math.floor(index / 28))),
      kind: 'Full-day leave' as const,
      hours: 0,
      note: '',
    }));
    const { user } = renderWithEngine(<SettingsPage />, {
      with: { settings: settingsWith({ targets: { ...stored.targets, dateExceptions } }) },
    });
    await user.click(tab('Tracking'));
    expect(screen.getByRole('heading', { name: 'Date exceptions (45)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getAllByRole('button', { name: /^Remove exception on/ })).toHaveLength(45);
  });

  it('registers every section in the command palette', async () => {
    const { user } = renderWithEngine(<SettingsPage />);
    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.keyboard('Microphone');
    await user.click(within(palette).getByRole('menuitem', { name: 'Go to Settings: Microphone meetings' }));
    await waitFor(() => expect(tab('Meetings')).toHaveAttribute('aria-selected', 'true'));
  });

  it('opens the section a deep link names', () => {
    window.location.hash = '#settings/microphone';
    renderWithEngine(<SettingsPage />);
    expect(tab('Meetings')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(document.getElementById('settings-microphone'));
  });

  it('follows links while the page is open', async () => {
    renderWithEngine(<SettingsPage />);
    act(() => {
      window.location.hash = '#settings/advanced';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(tab('Advanced')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('heading', { name: 'Polling intervals' })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  const categories = ['Accounts', 'Tracking', 'Meetings', 'Day review', 'Notifications', 'Features', 'Appearance', 'App', 'Advanced'];
  for (const category of categories) {
    it(`has no axe violations in ${category}`, async () => {
      const { user } = renderWithEngine(<SettingsPage />, { with: { agenda: sampleAgenda } });
      await user.click(tab(category));
      await expectNoA11yViolations();
    });
  }

  it('has no axe violations with validation errors and a pairing in progress', async () => {
    const settings: SettingsSlice = {
      ...pairingInProgress,
      configuration: { ...invalidSettings.configuration, sevenPaceAuthMode: 'mobilePIN' },
    };
    const { user } = renderWithEngine(<SettingsPage />, { with: { settings } });
    expect(screen.getByText('482913')).toBeInTheDocument();
    await user.click(saveButton());
    expect(screen.getByText('Fix these settings before saving')).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});
