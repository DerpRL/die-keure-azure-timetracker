import { act, screen, waitFor, within } from '@testing-library/react';
import { save } from '@tauri-apps/plugin-dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../../ipc/fixtures';
import { historyEmpty, historyLoading, historyNotLoaded, manyHistoryLogs } from '../../../ipc/fixtures/slices/history';
import { MockEngineError } from '../../../ipc/mockEngine';
import type { HistorySlice, SliceMap } from '../../../ipc/contract';
import { expectNoA11yViolations } from '../../../test/axe';
import { renderTimesheet } from '../testing';
import { formatRangeTitle } from './index';

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
  return renderTimesheet('list', { with: { history, ...extra } });
}

/** The day group (its `tbody`) under the day heading. */
function dayGroup(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name }).closest('tbody')!;
}

/** Worklog rows, without the day rows. */
function rows(group: HTMLElement): HTMLElement[] {
  return within(group).getAllByRole('row').slice(1);
}

describe('Timesheet · List', () => {
  it('titles the range with its totals and groups worklogs by day, newest first', async () => {
    renderHistory(sampleSlices().history);
    expect(screen.getByRole('heading', { level: 1, name: '30 Sept – 6 Oct 2026' })).toBeInTheDocument();
    expect(screen.getByText('27h 55m · 15 worklogs · 4 tickets')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
    const days = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(days).toEqual(['Tuesday 6 October', 'Monday 5 October', 'Friday 2 October', 'Thursday 1 October', 'Wednesday 30 September']);
    const monday = dayGroup('Monday 5 October');
    expect(within(monday).getByText('7h 15m')).toBeInTheDocument();
    expect(rows(monday)).toHaveLength(6);
    expect(within(monday).getAllByRole('button', { name: '#4821 Checkout: retry failed card payments, show details' })).toHaveLength(2);
    expect(screen.getByText('Support rotation')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('shows each worklog’s start, activity and comment, and marks work without a ticket', () => {
    renderHistory(sampleSlices().history);
    const monday = dayGroup('Monday 5 October');
    const review = within(monday).getByText('Reviewing pull requests').closest('tr')!;
    expect(within(review).getByText('Code review')).toBeInTheDocument();
    expect(within(review).getByText('· no ticket')).toBeInTheDocument();
    expect(within(review).getByText('16:20')).toBeInTheDocument();
    expect(within(review).getByText('0h 40m')).toBeInTheDocument();
    expect(within(review).queryByRole('button', { name: /Track again/ })).toBeNull();
    expect(within(monday).getAllByText('Development')).toHaveLength(3);
    expect(within(monday).getByText('Card retry flow')).toBeInTheDocument();
  });

  it('formats range titles', () => {
    expect(formatRangeTitle('2026-09-30', '2026-10-06')).toBe('30 Sept – 6 Oct 2026');
    expect(formatRangeTitle('2026-10-05', '2026-10-06')).toBe('5 – 6 October 2026');
    expect(formatRangeTitle('2026-10-06', '2026-10-06')).toBe('Tuesday 6 October');
    expect(formatRangeTitle('2025-12-29', '2026-01-02')).toBe('29 Dec 2025 – 2 Jan 2026');
  });

  it('selects the range preset that matches the loaded dates, else Custom', () => {
    const { engine } = renderHistory(sampleSlices().history);
    const range = screen.getByRole('radiogroup', { name: 'Range' });
    expect(within(range).getByRole('radio', { name: 'Custom…' })).toBeChecked();
    act(() => engine.setSlice('history', { ...sampleSlices().history!, from: '2026-10-05', to: '2026-10-06' }));
    expect(within(range).getByRole('radio', { name: 'This week' })).toBeChecked();
    expect(screen.queryByRole('group', { name: 'Custom range' })).toBeNull();
  });

  it('filters the list and its totals', async () => {
    const { user } = renderHistory(sampleSlices().history);
    await user.type(screen.getByRole('searchbox', { name: 'Filter tickets' }), 'invoice');
    expect(screen.getByText('5h 30m · 3 worklogs · 1 ticket')).toBeInTheDocument();
    expect(screen.queryByText('Reviewing pull requests')).toBeNull();
  });

  it('tracks a ticket again through the activity chooser', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.click(screen.getAllByRole('button', { name: 'Track again, #4790' })[0]!);
    expect(engine.dispatched('tracking.chooseTicket')).toEqual([{ type: 'tracking.chooseTicket', ticketId: 4790, surface: 'picker' }]);
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
  });

  it('disables Track again while a write is in progress', () => {
    renderHistory(sampleSlices().history, { app: { ...sampleSlices().app!, busy: true } });
    for (const button of screen.getAllByRole('button', { name: /^Track again/ })) expect(button).toBeDisabled();
  });

  it('sets a custom range with the date fields and loads it', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    const custom = screen.getByRole('group', { name: 'Custom range' });
    await user.click(within(custom).getAllByRole('spinbutton', { name: /day, From/i })[0]!);
    await user.keyboard('{ArrowDown}');
    expect(engine.dispatched('history.setRange')).toEqual([{ type: 'history.setRange', from: '2026-09-29', to: '2026-10-06' }]);
    await user.click(within(custom).getByRole('button', { name: 'Load' }));
    expect(engine.dispatched('history.load')).toHaveLength(1);
  });

  it('loads today, this week and last week', async () => {
    const { engine, user } = renderHistory({ ...sampleSlices().history!, from: '2026-10-06', to: '2026-10-06' });
    await user.click(screen.getByRole('radio', { name: 'This week' }));
    await user.click(screen.getByRole('radio', { name: 'Last week' }));
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(engine.dispatched('history.load')).toHaveLength(3));
    expect(engine.dispatched('history.setRange').map(({ from, to }) => [from, to])).toEqual([
      ['2026-10-05', '2026-10-06'],
      ['2026-09-28', '2026-10-04'],
      ['2026-10-06', '2026-10-06'],
    ]);
  });

  it('steps to the previous range of the same length, never past today', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    expect(screen.getByRole('button', { name: 'Next range' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous range' }));
    expect(engine.dispatched('history.setRange')).toEqual([{ type: 'history.setRange', from: '2026-09-23', to: '2026-09-29' }]);
    await waitFor(() => expect(engine.dispatched('history.load')).toHaveLength(1));
  });

  it('pages a long range instead of rendering every worklog', async () => {
    const logs = manyHistoryLogs(400);
    const { user } = renderHistory({ ...sampleSlices().history!, logs, totalSeconds: 400 * 1800 });
    const count = () => screen.getAllByRole('button', { name: /show details|^Track again/ }).length;
    expect(screen.getByText('Showing 150 of 400 worklogs')).toBeInTheDocument();
    const before = count();
    await user.click(screen.getByRole('button', { name: 'Show more worklogs' }));
    expect(screen.getByText('Showing 300 of 400 worklogs')).toBeInTheDocument();
    expect(count()).toBeGreaterThan(before);
  });

  it('lists App activity, newest first', async () => {
    const { user } = renderHistory(sampleSlices().history);
    await user.click(screen.getByRole('tab', { name: 'App activity' }));
    const list = screen.getByRole('list', { name: 'App activity, newest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Branch change detected');
    expect(items[0]).toHaveTextContent('webshop: feature/AB#4821-card-retry → feature/AB#4790-vat-number');
    // The range and filter belong to the worklogs.
    expect(screen.queryByRole('radiogroup', { name: 'Range' })).toBeNull();
    await expectNoA11yViolations();
  });

  it('explains an empty App activity log', async () => {
    const { user } = renderHistory(historyEmpty);
    await user.click(screen.getByRole('tab', { name: 'App activity' }));
    expect(screen.getByRole('heading', { name: 'A quiet beginning' })).toBeInTheDocument();
  });

  it('shows a skeleton, then the first download', async () => {
    const { engine } = renderHistory(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Loading worklogs');
    act(() => engine.setSlice('history', historyLoading));
    expect(await screen.findAllByText('Loading worklogs…')).not.toHaveLength(0);
    await expectNoA11yViolations();
  });

  it('explains an empty range and a missing connection', async () => {
    const { engine } = renderHistory(historyEmpty);
    expect(screen.getByRole('heading', { name: 'No worklogs in this view' })).toBeInTheDocument();
    act(() => engine.setSlice('history', historyNotLoaded));
    expect(screen.getByRole('heading', { name: 'Your worklogs are waiting' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('shows the engine’s issue and retries the load', async () => {
    const { engine, user } = renderHistory({ ...sampleSlices().history!, issue: 'History: the 7pace request timed out.' });
    const banner = screen.getByText('History: the 7pace request timed out.').closest('[role="alert"]') as HTMLElement;
    expect(within(banner).getByText('Worklogs could not be loaded')).toBeInTheDocument();
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

  it('refreshes with ⌘R', async () => {
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.keyboard('{Meta>}r{/Meta}');
    expect(engine.dispatched('history.load')).toHaveLength(1);
  });
});

describe('List export', () => {
  it('asks for a path, sends it to the engine and confirms', async () => {
    vi.mocked(save).mockResolvedValue('/Users/sam/Downloads/azure-time-history.csv');
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'azure-time-history.csv' }));
    await waitFor(() =>
      expect(engine.dispatched('history.exportCsv')).toEqual([{ type: 'history.exportCsv', path: '/Users/sam/Downloads/azure-time-history.csv' }]),
    );
    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(notifications).findByText('Worklogs exported')).toBeInTheDocument();
  });

  it('does nothing when the dialog is cancelled', async () => {
    vi.mocked(save).mockResolvedValue(null);
    const { engine, user } = renderHistory(sampleSlices().history);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(engine.dispatched('history.exportCsv')).toHaveLength(0);
  });

  it('shows a failed export verbatim', async () => {
    vi.mocked(save).mockResolvedValue('/Volumes/locked/history.csv');
    const { engine, user } = renderHistory(sampleSlices().history);
    engine.handle('history.exportCsv', () => {
      throw new MockEngineError('storage', 'The file could not be written: permission denied.');
    });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('The file could not be written: permission denied.')).toBeInTheDocument();
  });

  it('cannot export an empty range', () => {
    renderHistory(historyEmpty);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});
