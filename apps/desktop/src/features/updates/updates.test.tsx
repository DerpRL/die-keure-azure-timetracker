import { act, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ipc from '../../ipc';
import { isTauri } from '../../ipc';
import { sampleSlices } from '../../ipc/fixtures';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine, type EngineRenderOptions } from '../../test/engine';
import { DISABLED_MESSAGE, DOWNLOADS_URL, UPDATE_EVENT, type UpdateStatus } from './api';
import { formatBytes, formatDateTime } from './model';
import { UpdateBanner } from './UpdateBanner';
import { UpdateNotice } from './UpdateNotice';
import { UpdateSettings } from './UpdateSettings';

vi.mock('../../ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof ipc>();
  return { ...actual, isTauri: vi.fn(actual.isTauri) };
});

beforeEach(() => {
  // Outside the app unless a test says otherwise.
  vi.mocked(isTauri).mockReturnValue(false);
});

const openUrl = vi.hoisted(() => vi.fn((_url: string) => Promise.resolve()));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: 'idle',
    currentVersion: '2.0.0',
    version: null,
    notes: null,
    date: null,
    downloaded: 0,
    total: null,
    message: 'Checks for updates when the app opens and every minute.',
    error: null,
    checkedAt: null,
    automatic: true,
    enabled: true,
    ...overrides,
  };
}

const AVAILABLE = status({
  phase: 'available',
  version: '2.0.1',
  notes: 'Faster history.\nClearer prompts.',
  date: '2026-10-05T12:00:00Z',
  message: 'Version 2.0.1 is available.',
  checkedAt: '2026-10-06T08:00:00Z',
});

const DOWNLOADING = { ...AVAILABLE, phase: 'downloading', downloaded: 3_200_000, total: 9_800_000, message: 'Downloading and verifying the update…' } satisfies UpdateStatus;
const READY = { ...AVAILABLE, phase: 'ready', downloaded: 9_800_000, total: 9_800_000, message: 'Download verified. Install and restart when you’re ready.' } satisfies UpdateStatus;

/** Renders with the shell's update commands answered by the mock IPC. */
function renderUpdates(ui: ReactElement, initial: UpdateStatus, options?: EngineRenderOptions) {
  const result = renderWithEngine(ui, options);
  const { ipc } = result.engine;
  ipc.handle('shell_update_status', () => initial);
  ipc.handle('shell_update_check', () => status({ message: 'You’re up to date.', checkedAt: '2026-10-06T08:00:00Z' }));
  ipc.handle('shell_update_install', () => DOWNLOADING);
  const push = (next: UpdateStatus) => act(() => ipc.emit(UPDATE_EVENT, next));
  const commands = (name: string) => ipc.calls.filter((call) => call.command === name);
  return { ...result, push, commands };
}

// Axe runs on the rendered tree or dialog: React Aria's own live announcer (for pending buttons)
// leaves an empty `role="img"` node on <body> that outlives each test.

function politeAnnouncement() {
  return document.querySelector('[data-announcer="polite"]');
}

describe('UpdateBanner', () => {
  it('stays hidden while idle, checking or after a failed check', async () => {
    const { push, commands } = renderUpdates(<UpdateBanner />, status());
    await waitFor(() => expect(commands('shell_update_status')).toHaveLength(1));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    push(status({ phase: 'checking', message: 'Checking GitHub for a new version…' }));
    expect(screen.queryByText('Checking GitHub for a new version…')).not.toBeInTheDocument();
    push(status({ phase: 'failed', error: 'The update server could not be reached.', message: 'The update server could not be reached.' }));
    expect(screen.queryByText('The update server could not be reached.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers an available update and downloads it only when asked', async () => {
    const { user, commands, container } = renderUpdates(<UpdateBanner />, AVAILABLE);
    expect(await screen.findByText('App update available')).toBeInTheDocument();
    expect(screen.getByText('Version 2.0.1 is available.')).toBeInTheDocument();
    expect(commands('shell_update_install')).toHaveLength(0);
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: 'Download and restart' }));
    expect(commands('shell_update_install')).toHaveLength(1);
    expect(await screen.findByRole('progressbar', { name: 'Update download' })).toHaveAttribute('aria-valuenow', '32');
    await expectNoA11yViolations(container);
  });

  it('shows download progress from the shell events and announces phase changes once', async () => {
    const { push } = renderUpdates(<UpdateBanner />, AVAILABLE);
    await screen.findByText('App update available');
    push({ ...DOWNLOADING, downloaded: 4_900_000 });
    const bar = screen.getByRole('progressbar', { name: 'Update download' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuetext', `50% · ${formatBytes(4_900_000)} of ${formatBytes(9_800_000)}`);
    await waitFor(() => expect(politeAnnouncement()).toHaveTextContent('Downloading the app update.'));
    // The size is unknown: an indeterminate bar with the downloaded amount.
    push({ ...DOWNLOADING, total: null, downloaded: 300_000 });
    expect(screen.getByText('300 KB downloaded')).toBeInTheDocument();
  });

  it('asks to restart once the download is ready, but not while the engine is busy', async () => {
    const busyApp = { ...sampleSlices().app!, busy: true };
    const { user, commands, engine, push } = renderUpdates(<UpdateBanner />, READY);
    const restart = await screen.findByRole('button', { name: 'Restart to update' });
    expect(screen.getByText('Update ready to install')).toBeInTheDocument();
    act(() => engine.setSlice('app', busyApp));
    expect(restart).toBeDisabled();
    expect(screen.getByText('Waiting for the current operation to finish…')).toBeInTheDocument();
    act(() => engine.setSlice('app', { ...busyApp, busy: false }));
    await user.click(restart);
    expect(commands('shell_update_install')).toHaveLength(1);
    // The engine refused the restart: its message is shown verbatim.
    push({ ...READY, error: 'Wait for the time editor to finish saving.' });
    expect(screen.getByText('Wait for the time editor to finish saving.')).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toHaveTextContent('Wait for the time editor to finish saving.'));
  });

  it('reports a failed download with details and a retry', async () => {
    const failed: UpdateStatus = {
      ...AVAILABLE,
      phase: 'failed',
      error: 'The update could not be verified with the app’s release key, so it was not installed.',
      message: 'The update could not be verified with the app’s release key, so it was not installed.',
    };
    const { user, commands } = renderUpdates(<UpdateBanner />, failed);
    expect(await screen.findByText('Update needs attention')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View details of the app update' }));
    const dialog = screen.getByRole('dialog', { name: 'App updates' });
    expect(within(dialog).getByRole('heading', { name: 'Version 2.0.1' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Clearer prompts/)).toBeInTheDocument();
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(commands('shell_update_install')).toHaveLength(1);
  });

  it('shows a refused install command verbatim', async () => {
    const { user, engine } = renderUpdates(<UpdateBanner />, AVAILABLE);
    engine.ipc.handle('shell_update_install', () => {
      throw new Error('There is no update to install. Check for updates first.');
    });
    await user.click(await screen.findByRole('button', { name: 'Download and restart' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no update to install. Check for updates first.');
  });
});

describe('UpdateSettings', () => {
  it('shows the saved automatic setting read-only and checks on request', async () => {
    const { user, commands, container } = renderUpdates(<UpdateSettings />, status());
    expect(screen.getByRole('heading', { level: 2, name: 'App updates' })).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/Checks at startup and every minute/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(await screen.findByText('Installed version 2.0.0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(commands('shell_update_check')).toHaveLength(1);
    expect(await screen.findByText('You’re up to date.')).toBeInTheDocument();
    expect(screen.getByText(`Last checked: ${formatDateTime('2026-10-06T08:00:00Z')}`)).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toHaveTextContent('You’re up to date.'));
    await expectNoA11yViolations(container);
  });

  it('follows the saved settings for automatic checks and the cadence', async () => {
    const settings = sampleSlices().settings!;
    renderUpdates(<UpdateSettings />, status({ automatic: false }), {
      with: {
        settings: {
          ...settings,
          configuration: { ...settings.configuration, automaticUpdateChecks: false, cadences: { ...settings.configuration.cadences, updateCheckSeconds: 300 } },
        },
      },
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/only checks when you choose Check for updates/)).toBeInTheDocument();
    expect(await screen.findByText('Installed version 2.0.0')).toBeInTheDocument();
  });

  it('shows the offered release with notes and the install action', async () => {
    const { user, commands } = renderUpdates(<UpdateSettings />, AVAILABLE);
    expect(await screen.findByRole('heading', { level: 3, name: 'Version 2.0.1' })).toBeInTheDocument();
    expect(screen.getByText(/Faster history/)).toBeInTheDocument();
    expect(screen.getByText('Published 5 Oct 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download and restart' }));
    expect(commands('shell_update_install')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Download installer on GitHub/ }));
    expect(openUrl).toHaveBeenCalledWith(DOWNLOADS_URL);
  });

  it('disables everything in preview and development builds', async () => {
    renderUpdates(<UpdateSettings />, status({ enabled: false, message: DISABLED_MESSAGE }));
    expect(await screen.findByText(DISABLED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  });

  it('falls back to the preview status outside the app', async () => {
    const { engine } = renderWithEngine(<UpdateSettings />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading update status');
    expect(await screen.findByText(DISABLED_MESSAGE)).toBeInTheDocument();
    expect(engine.ipc.calls.map((call) => call.command)).toContain('shell_update_status');
    expect(screen.getByText(`Installed version ${sampleSlices().app!.version}`)).toBeInTheDocument();
  });

  it('shows why the status is unavailable inside the app', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const { engine } = renderWithEngine(<UpdateSettings />);
    engine.ipc.handle('shell_update_status', () => {
      throw new Error('The updater is not ready.');
    });
    expect(await screen.findByText('Update status is unavailable')).toBeInTheDocument();
    expect(screen.getByText('The updater is not ready.')).toBeInTheDocument();
  });
});

describe('UpdateNotice', () => {
  it('renders nothing without an update', async () => {
    const { commands } = renderUpdates(<UpdateNotice />, status());
    await waitFor(() => expect(commands('shell_update_status')).toHaveLength(1));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/update/i)).not.toBeInTheDocument();
  });

  it('opens the update in Settings from the panel', async () => {
    const { user, engine, commands, container } = renderUpdates(<UpdateNotice />, AVAILABLE);
    engine.ipc.handle('shell_show_main', () => null);
    expect(await screen.findByText('Version 2.0.1 is available')).toBeInTheDocument();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: 'View update in Settings' }));
    expect(commands('shell_show_main').at(-1)?.args).toEqual({ page: 'settings' });
  });

  it('shows progress and restarts from the panel', async () => {
    const { user, push, commands } = renderUpdates(<UpdateNotice />, DOWNLOADING);
    expect(await screen.findByText('Downloading update… 32%')).toBeInTheDocument();
    push(READY);
    await user.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(commands('shell_update_install')).toHaveLength(1);
  });
});
