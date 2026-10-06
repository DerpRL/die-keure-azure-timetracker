import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockIpc } from '../../ipc';
import { busyApp, windowsApp } from '../../ipc/fixtures/slices/app';
import { degradedConnection, unconfiguredConnection } from '../../ipc/fixtures/slices/connection';
import { noPrompts, pickerDraftFlow, sampleBranch, ticketDraft } from '../../ipc/fixtures/slices/flow';
import {
  emptyHistory,
  localTracking,
  pausedTracking,
  sampleHistory,
  sampleTodayLogs,
  stoppedTracking,
  unavailableProgress,
} from '../../ipc/fixtures/slices/tracking';
import { MainSurface } from '../../surfaces/MainSurface';
import { renderWithEngine } from '../../test/engine';
import { expectAccessible } from '../../features/tracking/testHelpers';
import OverviewPage from './index';

afterEach(() => {
  resetMockIpc();
  vi.useRealTimers();
});

const shellCalls = (engine: ReturnType<typeof renderWithEngine>['engine'], command: string) =>
  engine.ipc.calls.filter((call) => call.command === command);

describe('Overview page', () => {
  it('shows suggestions, the timer, today’s worklogs, progress and the connection', async () => {
    renderWithEngine(<OverviewPage />, { with: { history: sampleHistory } });
    expect(screen.getByRole('region', { name: 'Suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Branch changed' })).toBeInTheDocument();
    const current = screen.getByRole('region', { name: 'Current tracking' });
    expect(within(current).getByText('Currently tracking')).toBeInTheDocument();
    expect(within(current).getByText('Checkout: retry failed card payments')).toBeInTheDocument();
    const logs = screen.getByRole('list', { name: 'Today’s worklogs' });
    expect(within(logs).getAllByRole('listitem')).toHaveLength(3);
    expect(within(logs).getByText('Invoice PDF shows the wrong VAT number')).toBeInTheDocument();
    expect(within(logs).getByText('daily standup')).toBeInTheDocument();
    expect(within(logs).getByText('1h 0m')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Today' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/ \/ 7h 36m$/));
    expect(screen.getByRole('region', { name: 'Connection details' })).toHaveTextContent('7pace connected');
    expect(screen.getByText('Tokens stay in Keychain. Your Git repositories stay untouched.')).toBeInTheDocument();
    await expectAccessible();
  });

  it('shows placeholders while the slices load', () => {
    renderWithEngine(<OverviewPage />, { slices: {} });
    expect(screen.getByText('Loading the current timer')).toBeInTheDocument();
    expect(screen.getByText('Loading today’s worklogs')).toBeInTheDocument();
    expect(screen.getByText('Loading your time totals')).toBeInTheDocument();
    expect(screen.getByText('Loading the connection')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Suggestions' })).not.toBeInTheDocument();
  });

  it('explains empty days and missing data instead of showing zeros', () => {
    const first = renderWithEngine(<OverviewPage />, {
      with: { history: emptyHistory, prompts: noPrompts, progress: unavailableProgress },
    });
    expect(screen.getByRole('heading', { name: 'A clear start' })).toBeInTheDocument();
    expect(screen.getByText('Your completed worklogs will appear here as you track.')).toBeInTheDocument();
    expect(screen.getByText('Time totals are unavailable until worklogs sync.')).toBeInTheDocument();
    expect(screen.getByText('Time totals: Worklogs could not be downloaded (HTTP 503).')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    first.unmount();
    renderWithEngine(<OverviewPage />, { with: { history: { ...emptyHistory, loaded: false } } });
    expect(screen.getByText('Connect 7pace to see today’s worklogs.')).toBeInTheDocument();
  });

  it('reports Azure problems separately from a healthy 7pace connection', () => {
    renderWithEngine(<OverviewPage />, { with: { connection: degradedConnection } });
    const details = screen.getByRole('region', { name: 'Connection details' });
    expect(details).toHaveTextContent('7pace connected');
    expect(within(details).getByText('Azure tickets: The Azure DevOps personal access token has expired.')).toBeInTheDocument();
    expect(within(details).getByText('Time totals: Worklogs could not be downloaded (HTTP 503).')).toBeInTheDocument();
  });

  it('starts from a stopped timer through the picker only', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, { with: { tracking: stoppedTracking, prompts: noPrompts } });
    const current = screen.getByRole('region', { name: 'Current tracking' });
    expect(within(current).getByText('Ready when you are')).toBeInTheDocument();
    expect(within(current).getByText('Your next focus starts here.')).toBeInTheDocument();
    expect(within(current).getByText('Today 1h 0m')).toBeInTheDocument();
    await user.click(within(current).getByRole('button', { name: 'Start tracking…' }));
    expect(engine.intents).toEqual([{ type: 'tracking.openPicker' }]);
  });

  it('pauses and stops the running timer, disabled while busy', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, { with: { prompts: noPrompts } });
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(engine.intents.map((intent) => intent.type)).toEqual(['tracking.pause', 'tracking.stop']);
    act(() => engine.setSlice('app', busyApp));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Switch ticket…' })).toBeDisabled();
  });

  it('resumes a paused session in the main window', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, { with: { tracking: pausedTracking, prompts: noPrompts } });
    expect(screen.getByText('Paused · no time logged')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume tracking…' }));
    expect(engine.intents).toEqual([{ type: 'tracking.resume' }]);
  });

  it('tracks a worklog’s ticket again and opens its context', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, { with: { history: sampleHistory, prompts: noPrompts } });
    await user.click(screen.getByRole('button', { name: 'Track again: #4790' }));
    expect(engine.intents).toEqual([
      { type: 'tracking.openPicker' },
      { type: 'tracking.chooseTicket', ticketId: 4790 },
    ]);
    await user.click(screen.getByRole('button', { name: '#4790 Invoice PDF shows the wrong VAT number, show details' }));
    expect(engine.dispatched('ticket.showContext')).toEqual([{ type: 'ticket.showContext', ticketId: 4790 }]);
    // A ticket-free worklog cannot be tracked again from here.
    expect(screen.getAllByRole('button', { name: /^Track again/ })).toHaveLength(2);
  });

  it('lists at most five worklogs and links to History', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ ...sampleTodayLogs[0]!, id: `wl-${index}` }));
    const { engine, user } = renderWithEngine(<OverviewPage />, {
      with: { history: { ...sampleHistory, todayLogs: many }, prompts: noPrompts },
    });
    expect(within(screen.getByRole('list', { name: 'Today’s worklogs' })).getAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: '3 more today in History' }));
    await user.click(screen.getByRole('button', { name: 'View history' }));
    expect(shellCalls(engine, 'shell_show_main').map((call) => call.args)).toEqual([{ page: 'history' }, { page: 'history' }]);
  });

  it('asks for setup until 7pace is connected', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, {
      with: { connection: unconfiguredConnection, tracking: stoppedTracking, prompts: noPrompts },
    });
    await user.click(screen.getByRole('button', { name: 'Set up accounts' }));
    expect(shellCalls(engine, 'shell_show_main').at(-1)?.args).toEqual({ page: 'settings' });
  });

  it('shows the local timer with its own clock', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, { with: { tracking: localTracking, prompts: noPrompts } });
    const local = screen.getByRole('region', { name: 'Local tracking · saved on this Mac' });
    expect(within(local).getByRole('timer', { name: 'Local timer' })).toBeInTheDocument();
    expect(within(local).getByText('Not uploaded to 7pace', { exact: false })).toBeInTheDocument();
    await user.click(within(local).getByRole('button', { name: 'Stop local timer' }));
    expect(engine.dispatched('offline.stopLocal')).toHaveLength(1);
  });

  it('moves focus to the next suggestion when one is resolved', async () => {
    const { engine, user } = renderWithEngine(<OverviewPage />, {
      with: { prompts: { ...noPrompts, branches: [sampleBranch], dayReview: { day: '2026-10-06', canSnooze: true } } },
    });
    engine.handle('branch.keep', (_intent, mock) => mock.patchSlice('prompts', { branches: [] }));
    await user.click(screen.getByRole('button', { name: 'Keep tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open review' })).toHaveFocus());
  });

  it('names the Windows credential store on Windows', () => {
    renderWithEngine(<OverviewPage />, { with: { app: windowsApp, tracking: localTracking } });
    expect(screen.getByText('Tokens stay in Windows Credential Manager. Your Git repositories stay untouched.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Local tracking · saved on this computer' })).toBeInTheDocument();
  });
});

describe('Overview in the main window', () => {
  it('puts Track a ticket and Refresh in the page header', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, { with: { history: sampleHistory } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    await user.click(refresh);
    await user.click(screen.getByRole('button', { name: 'Track a ticket' }));
    expect(engine.dispatched('connection.refresh')).toHaveLength(1);
    expect(engine.dispatched('tracking.openPicker')).toHaveLength(1);
    await user.keyboard('{Meta>}r{/Meta}');
    expect(engine.dispatched('connection.refresh')).toHaveLength(2);
  });

  it('opens the picker sheet over the page and starts only on Start tracking', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, { with: { history: sampleHistory, prompts: noPrompts } });
    engine.handle('tracking.openPicker', (_intent, mock) => mock.setSlice('flow', pickerDraftFlow));
    const track = await screen.findByRole('button', { name: 'Track a ticket' });
    await user.click(track);
    const sheet = await screen.findByRole('dialog', { name: 'Choose an activity' });
    await expectAccessible();
    await user.click(within(sheet).getByRole('button', { name: 'Start tracking' }));
    expect(engine.dispatched('tracking.start')).toEqual([
      { type: 'tracking.start', draftId: ticketDraft.id, activityId: 'dev', comment: '', includeTicket: true },
    ]);
    // Closing returns focus to the button that opened it.
    engine.handle('tracking.closePicker', (_intent, mock) => mock.patchSlice('flow', { surface: 'none', draft: null }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(track).toHaveFocus());
  });

  it('offers the Tracking commands with their 1.14 shortcuts', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, { with: { prompts: noPrompts } });
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    await user.keyboard('{Meta>}n{/Meta}');
    expect(engine.dispatched('tracking.openPicker')).toHaveLength(1);
    await user.keyboard('{Meta>}{Shift>}d{/Shift}{/Meta}');
    expect(engine.dispatched('dayReview.open')).toHaveLength(1);
  });
});
