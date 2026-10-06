import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { resetMockIpc } from '../../ipc';
import { busyApp, errorApp } from '../../ipc/fixtures/slices/app';
import { disconnectedConnection, unconfiguredConnection } from '../../ipc/fixtures/slices/connection';
import { allPrompts, branchPrompts, idleFlow, noPrompts, panelSearchFlow, sampleBranch, ticketDraftFlow } from '../../ipc/fixtures/slices/flow';
import {
  localTracking,
  pausedTracking,
  runningTracking,
  sampleProgress,
  stoppedTracking,
} from '../../ipc/fixtures/slices/tracking';
import { sampleSlices } from '../../ipc/fixtures';
import { installMockEngine } from '../../ipc/mockEngine';
import { EngineProvider } from '../../state/EngineProvider';
import { SliceStore } from '../../state/store';
import { renderWithEngine } from '../../test/engine';
import { expectAccessible } from '../tracking/testHelpers';
import { PanelView } from './PanelView';

afterEach(() => {
  resetMockIpc();
  vi.useRealTimers();
});

type Engine = ReturnType<typeof renderWithEngine>['engine'];

const shellCalls = (engine: Engine, command: string) => engine.ipc.calls.filter((call) => call.command === command);

/** Waits until the panel subscribed to the shell events. */
async function shellReady(engine: Engine) {
  await waitFor(() => expect(engine.ipc.listenerCount('shell://panel-shown')).toBe(1));
}

describe('PanelView', () => {
  it('leads with the most urgent prompt, then the current timer', async () => {
    renderWithEngine(<PanelView />);
    const main = screen.getByRole('main', { name: 'Azure timetracker' });
    const next = within(main).getByRole('region', { name: 'Next action' });
    expect(within(next).getByRole('heading', { level: 2, name: 'Branch changed' })).toBeInTheDocument();
    const current = within(main).getByRole('region', { name: 'Current tracking' });
    expect(within(current).getByText('Checkout: retry failed card payments')).toBeInTheDocument();
    expect(within(current).getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('Tracking')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Progress/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Quit app' })).toBeInTheDocument();
    expect(screen.getByText('Quitting leaves the 7pace timer running')).toBeInTheDocument();
    await expectAccessible();
  });

  it('shows a skeleton until the slices arrive', () => {
    renderWithEngine(<PanelView />, { slices: {} });
    expect(screen.getByText('Loading')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Loading the connection')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current tracking' })).not.toBeInTheDocument();
  });

  it('asks for setup while no account is configured', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, {
      with: { connection: unconfiguredConnection, tracking: stoppedTracking, prompts: noPrompts },
    });
    expect(screen.getByRole('heading', { name: 'A little setup. A lot less forgotten time.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up accounts' }));
    expect(shellCalls(engine, 'shell_show_main').at(-1)?.args).toEqual({ page: 'settings' });
    // The connection line offers Set up too, never Reconnect.
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
  });

  it('pauses, stops and switches the running timer', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { prompts: noPrompts } });
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Switch ticket…' }));
    expect(engine.intents.map((intent) => intent.type)).toEqual(['tracking.pause', 'tracking.stop', 'tracking.beginPanel']);
    expect(engine.dispatched('tracking.beginPanel')).toEqual([{ type: 'tracking.beginPanel', branchId: null }]);
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
  });

  it('opens the running ticket in Azure DevOps', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = renderWithEngine(<PanelView />, { with: { prompts: noPrompts } });
    await user.click(screen.getByRole('button', { name: '#4821, open in Azure DevOps' }));
    expect(open).toHaveBeenCalledWith('https://dev.azure.com/contoso/_workitems/edit/4821', '_blank', 'noopener,noreferrer');
  });

  it('resumes or clears a paused session', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, {
      with: { tracking: pausedTracking, prompts: noPrompts, connection: { ...disconnectedConnection, connected: true, health: 'confirmed', indicator: 'paused' } },
    });
    expect(screen.getByText('#4790 · Invoice PDF shows the wrong VAT number')).toBeInTheDocument();
    expect(screen.getByText('Paused · no new time is logged')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume…' }));
    await user.click(screen.getByRole('button', { name: 'Clear pause' }));
    expect(engine.intents).toEqual([
      { type: 'tracking.beginPanel', branchId: null },
      { type: 'tracking.resume' },
      { type: 'tracking.discardPause' },
    ]);
  });

  it('says so when no timer runs', () => {
    renderWithEngine(<PanelView />, { with: { tracking: stoppedTracking, prompts: noPrompts } });
    expect(screen.getByText('No timer running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start tracking…' })).toBeEnabled();
  });

  it('disables the writes while the engine is busy', () => {
    renderWithEngine(<PanelView />, { with: { app: busyApp, prompts: branchPrompts } });
    for (const name of ['Pause', 'Stop', 'Switch ticket…', 'Track #4790…']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('ticks the clock every second from the confirmed time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'));
    renderWithEngine(<PanelView />, { with: { prompts: noPrompts } });
    const timer = screen.getByRole('timer', { name: 'Elapsed time' });
    // 4,980 s at 07:59:40 plus 20 s.
    expect(timer).toHaveTextContent('1 hour 23 minutes 20 seconds');
    act(() => {
      vi.advanceTimersByTime(1010);
    });
    expect(timer).toHaveTextContent('1 hour 23 minutes 21 seconds');
    // The clock is a timer, not a live region: nothing is announced every second.
    expect(timer).toHaveAttribute('aria-live', 'off');
  });

  it('keeps a disconnected timer still and says it is the last known one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'));
    renderWithEngine(<PanelView />, {
      with: { prompts: noPrompts, connection: disconnectedConnection, tracking: { ...runningTracking, extrapolate: false } },
    });
    const timer = screen.getByRole('timer', { name: 'Elapsed time' });
    expect(timer).toHaveTextContent('1 hour 23 minutes, last known');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(timer).toHaveTextContent('1 hour 23 minutes, last known');
    expect(screen.getByText('Showing the last known timer. Check 7pace before changing it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  });

  it('shows the local timer first and stops it', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { tracking: localTracking, prompts: noPrompts } });
    expect(screen.getByText('Local tracking')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Local tracking · saved on this Mac' });
    expect(within(section).getByText('Design system: date picker tokens')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current tracking' })).not.toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Stop local timer' }));
    expect(engine.dispatched('offline.stopLocal')).toHaveLength(1);
    await user.click(within(section).getByRole('button', { name: 'Review drafts' }));
    expect(shellCalls(engine, 'shell_show_main').at(-1)?.args).toEqual({ page: 'offlineDrafts' });
  });

  it('opens a section of the main window or quits', async () => {
    const { engine, user } = renderWithEngine(<PanelView />);
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Day review' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(shellCalls(engine, 'shell_show_main').map((call) => call.args)).toEqual([
      { page: 'overview' },
      { page: 'dayReview' },
      { page: 'settings' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Quit app' }));
    expect(shellCalls(engine, 'shell_quit')).toHaveLength(1);
  });

  it('collapses the other suggestions behind a count', async () => {
    const { user } = renderWithEngine(<PanelView />, { with: { prompts: allPrompts } });
    const more = screen.getByRole('button', { name: /^More suggestions/ });
    // One of each kind in the panel: the branch leads, nine wait behind it.
    expect(more).toHaveTextContent('9 waiting');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getByRole('list', { name: 'More suggestions' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3, name: 'Meeting started' })).toHaveLength(1);
  });

  it('shows the latest error and dismisses it', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { app: errorApp } });
    expect(screen.getByText(errorApp.error!)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(engine.dispatched('app.dismissError')).toHaveLength(1);
  });

  it('reconnects and shows the connection details', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { connection: disconnectedConnection } });
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(engine.dispatched('connection.retry')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '7pace connection details' }));
    const details = await screen.findByRole('dialog', { name: 'Connection details' });
    expect(details).toHaveTextContent('Could not reach contoso.timehub.7pace.com. Check your network connection.');
    await expectAccessible();
  });
});

describe('PanelView tracking flow', () => {
  it('shows the quick switch instead of the rest and cancels it with Escape', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { flow: panelSearchFlow } });
    expect(screen.getByRole('heading', { level: 2, name: 'Quick switch' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current tracking' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ticket number or title' })).toHaveFocus();
    await expectAccessible();
    await user.keyboard('{Escape}');
    expect(engine.dispatched('tracking.cancelPanel')).toHaveLength(1);
    expect(shellCalls(engine, 'shell_hide_panel')).toHaveLength(0);
  });

  it('does not cancel a start in flight with Escape', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { flow: ticketDraftFlow, app: busyApp } });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(engine.dispatched('tracking.cancelPanel')).toHaveLength(0);
    expect(shellCalls(engine, 'shell_hide_panel')).toHaveLength(0);
  });

  it('cancels with the Cancel button', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { flow: panelSearchFlow } });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('tracking.cancelPanel')).toHaveLength(1);
  });

  it('hides the panel with Escape when nothing is being chosen', async () => {
    const { engine, user } = renderWithEngine(<PanelView />);
    await user.keyboard('{Escape}');
    expect(shellCalls(engine, 'shell_hide_panel')).toHaveLength(1);
    expect(engine.dispatched('tracking.cancelPanel')).toHaveLength(0);
  });

  it('goes from a quick ticket to the activity chooser and starts once', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { flow: panelSearchFlow } });
    engine.handle('tracking.chooseTicket', (_intent, mock) => mock.setSlice('flow', ticketDraftFlow));
    await user.click(screen.getByRole('button', { name: '#4790 Invoice PDF shows the wrong VAT number' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Choose an activity' })).toBeInTheDocument();
    expect(screen.getByText('Your current timer continues until you press Start.')).toBeInTheDocument();
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(engine.dispatched('tracking.start')).toEqual([
      { type: 'tracking.start', draftId: ticketDraftFlow.draft!.id, activityId: 'dev', comment: '', includeTicket: true },
    ]);
  });

  it('focuses the first prompt’s primary button when shown with focus', async () => {
    const { engine } = renderWithEngine(<PanelView />);
    await shellReady(engine);
    act(() => engine.ipc.emit('shell://panel-shown', { focused: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Track #4790…' })).toHaveFocus());
  });

  it('leaves focus alone when shown without focus', async () => {
    const { engine } = renderWithEngine(<PanelView />);
    await shellReady(engine);
    act(() => engine.ipc.emit('shell://panel-shown', { focused: false }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole('button', { name: 'Track #4790…' })).not.toHaveFocus();
  });

  it('focuses the ticket search after the quick-switch shortcut', async () => {
    const { engine } = renderWithEngine(<PanelView />, { with: { flow: idleFlow } });
    await shellReady(engine);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => engine.ipc.emit('shortcut://quick-switch', null));
    // The shell already sent `quick.switch`; the engine then opens the flow.
    act(() => engine.setSlice('flow', panelSearchFlow));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Ticket number or title' })).toHaveFocus());
    expect(engine.dispatched('quick.switch')).toHaveLength(0);
  });

  it('cancels the choice when the panel closes, as 1.x did', async () => {
    const { engine } = renderWithEngine(<PanelView />, { with: { flow: panelSearchFlow } });
    await shellReady(engine);
    act(() => engine.ipc.emit('shell://panel-hidden', { reason: 'blur' }));
    await waitFor(() => expect(engine.dispatched('tracking.cancelPanel')).toHaveLength(1));
  });

  it('keeps focus in the panel when a resolved prompt disappears', async () => {
    const { engine, user } = renderWithEngine(<PanelView />);
    engine.handle('branch.keep', (_intent, mock) => mock.setSlice('prompts', noPrompts));
    await user.click(screen.getByRole('button', { name: 'Keep tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch ticket…' })).toHaveFocus());
  });

  it('moves focus into the chooser when the search step ends', async () => {
    const { engine, user } = renderWithEngine(<PanelView />, { with: { flow: panelSearchFlow } });
    engine.handle('tracking.chooseTicket', (_intent, mock) => mock.setSlice('flow', ticketDraftFlow));
    await user.click(screen.getByRole('button', { name: '#4790 Invoice PDF shows the wrong VAT number' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toHaveFocus());
  });

  it('announces a tracking change politely, not on load', async () => {
    const { engine } = renderWithEngine(<PanelView />, { with: { prompts: noPrompts } });
    const polite = () => document.querySelector('[data-announcer="polite"]')?.textContent ?? '';
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(polite()).toBe('');
    act(() => engine.setSlice('tracking', stoppedTracking));
    await waitFor(() => expect(polite()).toBe('Tracking stopped'));
  });

  it('works with the engine connected through a resync', async () => {
    const engine = installMockEngine({ slices: { ...sampleSlices(), prompts: { ...noPrompts, branches: [sampleBranch] }, progress: sampleProgress } });
    render(
      <AppProviders>
        <EngineProvider store={new SliceStore()}>
          <PanelView />
        </EngineProvider>
      </AppProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'Branch changed' })).toBeInTheDocument();
    expect(engine.ipc.calls.some((call) => call.command === 'engine_resync')).toBe(true);
  });
});
