import { act, screen, waitFor, within } from '@testing-library/react';
import { save } from '@tauri-apps/plugin-dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import { historyEmpty, historyLoading, historyNotLoaded, manyHistoryLogs } from '../../ipc/fixtures/slices/history';
import { MockEngineError } from '../../ipc/mockEngine';
import type { HistorySlice, SliceMap } from '../../ipc/contract';
import { PageFrame } from '../../features/ticketContext/testing';
import { MainSurface } from '../../surfaces/MainSurface';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import HistoryPage from './index';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));

beforeEach(() => {
  vi.mocked(save).mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderHistory(history: HistorySlice | undefined, extra: Partial<SliceMap> = {}) {
  const slices = sampleSlices();
  if (history) slices.history = history;
  else delete slices.history;
  return renderWithEngine(
    <PageFrame title="History">
      <HistoryPage />
    </PageFrame>,
    { slices: { ...slices, ...extra } },
  );
}

function renderInWindow(extra: Partial<SliceMap> = {}) {
  return renderWithEngine(<MainSurface />, { with: { app: { ...sampleSlices().app!, visiblePage: 'history' }, ...extra } });
}

describe('History page', () => {
  it('groups worklogs by day, newest first, with totals', async () => {
    renderHistory(sampleSlices().history);
    const days = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(days).toEqual(['Tuesday 6 October', 'Monday 5 October', 'Friday 2 October', 'Thursday 1 October', 'Wednesday 30 September']);
    const monday = screen.getByRole('heading', { name: 'Monday 5 October' }).closest('section')!;
    expect(within(monday).getByText('7h 15m')).toBeInTheDocument();
    expect(within(monday).getAllByRole('listitem')).toHaveLength(6);
    expect(within(monday).getByText('Reviewing pull requests')).toBeInTheDocument();
    expect(within(monday).getAllByRole('button', { name: '#4821 Checkout: retry failed card payments, show details' })).toHaveLength(2);
    expect(screen.getByText('Support rotation')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('shows totals for the filtered view', async () => {
    const { user } = renderHistory(sampleSlices().history);
    const metrics = () => screen.getByText('Worklogs').closest('dl')!;
    expect(within(metrics()).getByText('15')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Filter tickets' }), 'invoice');
    expect(within(metrics()).getByText('3')).toBeInTheDocument();
    expect(within(metrics()).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Reviewing pull requests')).toBeNull();
  });

  it('tracks a ticket again through the activity chooser', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.click(screen.getAllByRole('button', { name: 'Track again, #4790' })[0]!);
    expect(engine.dispatched('tracking.chooseTicket')).toEqual([{ type: 'tracking.chooseTicket', ticketId: 4790 }]);
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
  });

  it('disables Track again while a write is in progress', () => {
    renderHistory(sampleSlices().history, { app: { ...sampleSlices().app!, busy: true } });
    for (const button of screen.getAllByRole('button', { name: /^Track again/ })) expect(button).toBeDisabled();
  });

  it('sets the range with the date fields and loads it', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.click(screen.getAllByRole('spinbutton', { name: /day, From/i })[0]!);
    await user.keyboard('{ArrowDown}');
    expect(engine.dispatched('history.setRange')).toEqual([{ type: 'history.setRange', from: '2026-09-29', to: '2026-10-06' }]);
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(engine.dispatched('history.load')).toHaveLength(1);
  });

  it('loads today, this week and last week', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.click(screen.getByRole('button', { name: 'This week' }));
    await user.click(screen.getByRole('button', { name: 'Last week' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(engine.dispatched('history.load')).toHaveLength(3));
    expect(engine.dispatched('history.setRange').map(({ from, to }) => [from, to])).toEqual([
      ['2026-10-05', '2026-10-06'],
      ['2026-09-28', '2026-10-04'],
      ['2026-10-06', '2026-10-06'],
    ]);
  });

  it('pages a long range instead of rendering every worklog', async () => {
    const logs = manyHistoryLogs(400);
    const { user } = renderHistory({ ...sampleSlices().history!, logs, totalSeconds: 400 * 1800 });
    const rows = () => screen.getAllByRole('listitem').length;
    expect(screen.getByText('Showing 150 of 400 worklogs')).toBeInTheDocument();
    expect(rows()).toBe(150);
    await user.click(screen.getByRole('button', { name: 'Show more worklogs' }));
    expect(screen.getByText('Showing 300 of 400 worklogs')).toBeInTheDocument();
    expect(rows()).toBe(300);
  });

  it('lists App activity, newest first', async () => {
    const { user } = renderHistory(sampleSlices().history);
    await user.click(screen.getByRole('tab', { name: 'App activity' }));
    const list = screen.getByRole('list', { name: 'App activity, newest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Branch change detected');
    expect(items[0]).toHaveTextContent('webshop: feature/AB#4821-card-retry → feature/AB#4790-vat-number');
    await expectNoA11yViolations();
  });

  it('explains an empty App activity log', async () => {
    const { user } = renderHistory(historyEmpty);
    await user.click(screen.getByRole('tab', { name: 'App activity' }));
    expect(screen.getByRole('heading', { name: 'A quiet beginning' })).toBeInTheDocument();
  });

  it('shows a skeleton, then the first download', async () => {
    const { engine } = renderHistory(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history');
    act(() => engine.setSlice('history', historyLoading));
    expect(await screen.findAllByText('Loading worklogs…')).not.toHaveLength(0);
    await expectNoA11yViolations();
  });

  it('explains an empty range and a missing connection', async () => {
    const { engine } = renderHistory(historyEmpty);
    expect(screen.getByRole('heading', { name: 'No worklogs in this view' })).toBeInTheDocument();
    act(() => engine.setSlice('history', historyNotLoaded));
    expect(screen.getByRole('heading', { name: 'Your history is waiting' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('shows the engine’s history issue and retries the load', async () => {
    const { engine, user } = renderHistory({ ...sampleSlices().history!, issue: 'History: the 7pace request timed out.' });
    const banner = screen.getByText('History: the 7pace request timed out.').closest('[role="alert"]') as HTMLElement;
    expect(within(banner).getByText('History could not be loaded')).toBeInTheDocument();
    await expectNoA11yViolations();
    engine.handle('history.load', (_intent, mock) => mock.patchSlice('history', { issue: null }));
    await user.click(within(banner).getByRole('button', { name: 'Retry' }));
    expect(engine.dispatched('history.load')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('History: the 7pace request timed out.')).toBeNull());
  });

  it('shows a rejected load once when the slice carries the same issue', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    engine.handle('history.load', (_intent, mock) => {
      mock.patchSlice('history', { issue: 'The request timed out.' });
      throw new MockEngineError('timeout', 'The request timed out.');
    });
    await user.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(screen.getAllByText('The request timed out.')).toHaveLength(1));
  });

  it('shows a failed load verbatim', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    engine.handle('history.load', () => {
      throw new MockEngineError('invalidIntent', 'Choose a history end date on or after the start date.');
    });
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText('Choose a history end date on or after the start date.')).toBeInTheDocument();
  });
});

describe('History export', () => {
  it('asks for a path, sends it to the engine and confirms', async () => {
    vi.mocked(save).mockResolvedValue('/Users/sam/Downloads/azure-time-history.csv');
    const { engine, user } = renderInWindow();
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'azure-time-history.csv' }));
    await waitFor(() =>
      expect(engine.dispatched('history.exportCsv')).toEqual([
        { type: 'history.exportCsv', path: '/Users/sam/Downloads/azure-time-history.csv' },
      ]),
    );
    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(notifications).findByText('History exported')).toBeInTheDocument();
  });

  it('does nothing when the dialog is cancelled', async () => {
    vi.mocked(save).mockResolvedValue(null);
    const { engine, user } = renderInWindow();
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(engine.dispatched('history.exportCsv')).toHaveLength(0);
  });

  it('shows a failed export verbatim', async () => {
    vi.mocked(save).mockResolvedValue('/Volumes/locked/history.csv');
    const { engine, user } = renderInWindow();
    engine.handle('history.exportCsv', () => {
      throw new MockEngineError('storage', 'The file could not be written: permission denied.');
    });
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('The file could not be written: permission denied.')).toBeInTheDocument();
  });

  it('cannot export an empty range', async () => {
    renderInWindow({ history: historyEmpty });
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('refreshes from the page header', async () => {
    const { engine, user } = renderInWindow();
    await user.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(engine.dispatched('history.load')).toHaveLength(1);
  });
});
