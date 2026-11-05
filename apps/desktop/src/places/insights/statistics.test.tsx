import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SliceMap, StatisticsSlice } from '../../ipc/contract';
import {
  emptyWeekStatistics,
  entriesPage,
  failedRefreshStatistics,
  failedStatistics,
  filteredWeekStatistics,
  idleStatistics,
  loadingStatistics,
  monthEntries,
  monthStatistics,
  unconfiguredStatistics,
  weekEntries,
  weekStatistics,
  zoomedWeekEntries,
  zoomedWeekStatistics,
} from '../../ipc/fixtures/slices/statistics';
import { MockEngineError, type MockEngine } from '../../ipc/mockEngine';
import type { InsightsView } from '../../layout/navigation';
import { expectNoA11yViolations } from '../../test/axe';
import { renderInsights } from './testing';

beforeEach(() => {
  // Only the date is fixed: "today" is the samples' Tuesday 6 October 2026. Timers stay real.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T08:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(statistics: StatisticsSlice | null = weekStatistics, extra: Partial<SliceMap> = {}, view: InsightsView = 'time') {
  // The tests below use the retained explorer and work patterns: open them from the start.
  return renderInsights({ view, openExtras: ['explore', 'patterns'] }, { ...extra, statistics });
}

const patterns = (statistics: StatisticsSlice = weekStatistics) => renderPage(statistics, {}, 'patterns');

/** The engine side of `statistics.entries`, with or without an interval. */
function serveEntries(engine: MockEngine, entries = weekEntries) {
  engine.handle('statistics.entries', (intent) => entriesPage(entries, intent.offset, intent.limit, intent.start, intent.end));
}

/** The engine side of the section tabs: publish the chosen section. */
function followSections(engine: MockEngine) {
  engine.handle('statistics.setSection', (intent, mock) => mock.patchSlice('statistics', { section: intent.section }));
}

describe('Statistics page states', () => {
  it('shows a skeleton until the slice arrives', () => {
    renderPage(null);
    expect(screen.getByRole('main')).toHaveAccessibleName('Insights');
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('Loading statistics'))).toBe(true);
    expect(screen.queryByRole('list', { name: 'Totals' })).not.toBeInTheDocument();
  });

  it('shows the first download as loading', () => {
    renderPage(loadingStatistics);
    expect(screen.getAllByText('Loading your recorded time…').length).toBeGreaterThan(0);
    expect(screen.queryByRole('list', { name: 'Totals' })).not.toBeInTheDocument();
  });

  it('shows an empty period', async () => {
    renderPage(emptyWeekStatistics);
    expect(screen.getByRole('heading', { level: 2, name: 'No time tracked in this period' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Totals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Explore entries' })).not.toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('asks to connect in Settings when the engine has no 7pace connection', async () => {
    const onNavigate = vi.fn();
    const { user } = renderInsights({ onNavigate }, { statistics: unconfiguredStatistics });
    expect(screen.getByRole('heading', { level: 2, name: 'Your statistics are waiting' })).toBeInTheDocument();
    expect(screen.getByText('Connect to 7pace in Settings to explore your recorded time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh statistics' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Ticket' })).not.toBeInTheDocument();
    await expectNoA11yViolations();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onNavigate).toHaveBeenCalledWith({ place: 'settings', view: 'accounts' });
  });

  it('offers a refresh when connected but nothing was downloaded yet', () => {
    renderPage(idleStatistics);
    expect(screen.getByText('Refresh to download the recorded time of this period.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('shows a failed first download verbatim and retries', async () => {
    const { engine, user } = renderPage(failedStatistics);
    expect(screen.getByText('Could not refresh worklogs')).toBeInTheDocument();
    expect(screen.getByText(failedStatistics.issue!)).toBeInTheDocument();
    expect(screen.queryByText('Showing the last downloaded worklogs.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(engine.dispatched('statistics.refresh')).toHaveLength(1);
  });

  it('keeps the old data when a refresh fails', () => {
    renderPage(failedRefreshStatistics);
    expect(screen.getByText(failedRefreshStatistics.issue!)).toBeInTheDocument();
    expect(screen.getByText('Showing the last downloaded worklogs.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Time explorer' })).toBeInTheDocument();
  });

  it('shows "no entries" with Clear filters when filters match nothing', async () => {
    const { engine, user } = renderPage({
      ...emptyWeekStatistics,
      filter: { ...emptyWeekStatistics.filter, query: 'nothing like this' },
      targetComparable: false,
    });
    expect(screen.getByRole('heading', { level: 2, name: 'No entries match these filters' })).toBeInTheDocument();
    const empty = screen.getByRole('heading', { level: 2, name: 'No entries match these filters' }).parentElement!;
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(engine.dispatched('statistics.clearFilters')).toHaveLength(1);
  });
});

describe('Statistics page from the week sample', () => {
  it('renders the range as the title, the totals, the charts and the explorer', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '28 Sept – 4 Oct 2026' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAccessibleName('28 Sept – 4 Oct 2026');
    const totals = within(screen.getByRole('list', { name: 'Totals' })).getAllByRole('listitem');
    expect(totals.map((item) => item.firstChild?.textContent)).toEqual(['Recorded', 'Tickets', 'Typical entry', 'Billable']);
    expect(totals[0]).toHaveTextContent('Recorded39h 30m104% of 38h 0m target');
    expect(totals[1]).toHaveTextContent(`Tickets${weekStatistics.analysis!.tasks.length}incl. work without a ticket`);
    expect(totals[2]).toHaveTextContent('Typical entry');
    expect(totals[2]).toHaveTextContent('median');
    expect(screen.getByRole('heading', { level: 2, name: 'Per day, by activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'By ticket' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Time explorer', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Where your time went' })).toBeInTheDocument();
    expect(screen.getAllByText(/^Synced /).length).toBeGreaterThan(0);
  });

  it('refreshes from the header and with ⌘R', async () => {
    const { engine, user } = renderPage(idleStatistics);
    await user.click(screen.getByRole('button', { name: 'Refresh statistics' }));
    await user.keyboard('{Meta>}r{/Meta}');
    expect(engine.dispatched('statistics.refresh')).toHaveLength(2);
  });

  it('has no axe violations in the time section', async () => {
    renderPage();
    await expectNoA11yViolations();
  });
});

describe('analysis updates', () => {
  it('marks the sections busy while analysing and announces the result', async () => {
    const { engine } = renderPage();
    act(() => engine.patchSlice('statistics', { analyzing: true }));
    expect(screen.getAllByText('Updating…').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    act(() => engine.patchSlice('statistics', { analyzing: false }));
    await waitFor(() =>
      expect(document.querySelector('[data-announcer="polite"]')).toHaveTextContent('Statistics updated: 39h 30m recorded.'),
    );
  });
});

describe('period navigation', () => {
  it('sends the period, previous, next and current intents', async () => {
    const { engine, user } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Month' }));
    expect(engine.dispatched('statistics.setPeriod')).toEqual([{ type: 'statistics.setPeriod', period: 'month' }]);
    await user.click(screen.getByRole('button', { name: 'Previous period' }));
    await user.click(screen.getByRole('button', { name: 'Next period' }));
    expect(engine.dispatched('statistics.move').map((intent) => intent.amount)).toEqual([-1, 1]);
    await user.click(screen.getByRole('button', { name: 'Current week' }));
    expect(engine.dispatched('statistics.current')).toHaveLength(1);
  });

  it('disables Next for the current period', () => {
    renderPage({ ...weekStatistics, range: { period: 'week', start: '2026-10-04T22:00:00Z', end: '2026-10-11T22:00:00Z' } });
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });

  it('jumps to a typed date once typing pauses', async () => {
    const { engine, user } = renderPage();
    const day = screen.getAllByRole('spinbutton', { name: /day, Jump to/i })[0]!;
    await user.click(day);
    await user.keyboard('15');
    expect(engine.dispatched('statistics.jumpTo')).toHaveLength(0);
    await waitFor(() => expect(engine.dispatched('statistics.jumpTo')).toEqual([{ type: 'statistics.jumpTo', date: '2026-09-15' }]));
  });
});

describe('views and explorer sections', () => {
  it('switches the explorer between Time explorer and Tasks through the engine', async () => {
    const { engine, user } = renderPage();
    followSections(engine);
    await user.click(screen.getByRole('radio', { name: 'Tasks' }));
    expect(engine.dispatched('statistics.setSection')).toEqual([{ type: 'statistics.setSection', section: 'tasks' }]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Tasks you worked on' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Time explorer' }));
    expect(engine.dispatched('statistics.setSection').map((intent) => intent.section)).toEqual(['tasks', 'time']);
  });

  it('opens the explorer section the engine remembers', () => {
    renderPage({ ...weekStatistics, section: 'tasks' });
    expect(screen.getByRole('radio', { name: 'Tasks', checked: true })).toBeInTheDocument();
    // The 1.14 "Work patterns" section is now the Patterns view: the explorer shows Time explorer.
    renderPage({ ...weekStatistics, section: 'patterns' });
    expect(screen.getAllByRole('radio', { name: 'Time explorer', checked: true }).length).toBeGreaterThan(0);
  });

  it('returns to the engine section when the change is refused', async () => {
    const { engine, user } = renderPage();
    engine.handle('statistics.setSection', () => {
      throw new Error('refused');
    });
    await user.click(screen.getByRole('radio', { name: 'Tasks' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Time explorer', checked: true })).toBeInTheDocument());
  });

  it('moves between Where time went, Patterns and Weekly report with the view tabs', async () => {
    const onNavigate = vi.fn();
    const { user } = renderInsights({ onNavigate, openExtras: ['explore', 'patterns'] }, { statistics: weekStatistics });
    const tabs = screen.getByRole('navigation', { name: 'Insights views' });
    expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['Where time went', 'Patterns', 'Weekly report']);
    expect(within(tabs).getByRole('button', { name: 'Where time went' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(tabs).getByRole('button', { name: 'Patterns' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'insights', view: 'patterns' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Per hour' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: 'Insights views' })).getByRole('button', { name: 'Weekly report' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Preview' })).toBeInTheDocument();
  });

  it('has no axe violations in the tasks section', async () => {
    renderPage({ ...weekStatistics, section: 'tasks' });
    expect(screen.getByRole('grid', { name: 'Tasks you worked on' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('has no axe violations on Patterns', async () => {
    patterns();
    expect(screen.getByRole('heading', { name: 'Time by weekday' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('filters', () => {
  it('sends the search once typing pauses', async () => {
    const { engine, user } = renderPage();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'VAT');
    expect(engine.dispatched('statistics.setFilter')).toHaveLength(0);
    await waitFor(() =>
      expect(engine.dispatched('statistics.setFilter')).toEqual([
        { type: 'statistics.setFilter', filter: { ...weekStatistics.filter, query: 'VAT' } },
      ]),
    );
  });

  it('filters by activity from the available activities', async () => {
    const { engine, user } = renderPage();
    await user.click(screen.getByRole('button', { name: /Activity/ }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['All activities', 'Code review', 'Design', 'Development', 'Meeting', 'Standup']);
    await user.click(screen.getByRole('option', { name: 'Design' }));
    expect(engine.dispatched('statistics.setFilter')).toEqual([
      { type: 'statistics.setFilter', filter: { ...weekStatistics.filter, activityId: 'activity:design' } },
    ]);
  });

  it('filters by any ticket of the period, also while another ticket is filtered', async () => {
    const { engine, user } = renderPage(filteredWeekStatistics);
    const ticket = screen.getByRole('combobox', { name: 'Ticket' });
    expect(ticket).toHaveValue('#4821 Checkout: retry failed card payments');
    await user.clear(ticket);
    await user.type(ticket, 'VAT');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['#4790 Invoice PDF shows the wrong VAT number']);
    await user.click(screen.getByRole('option', { name: '#4790 Invoice PDF shows the wrong VAT number' }));
    expect(engine.dispatched('statistics.setFilter').at(-1)).toEqual({
      type: 'statistics.setFilter',
      filter: { ...filteredWeekStatistics.filter, taskId: 'ticket:4790' },
    });
  });

  it('shows active filters as chips and clears them', async () => {
    const { engine, user } = renderPage(filteredWeekStatistics);
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Activity: Development',
      'Task: #4821 Checkout: retry failed card payments',
    ]);
    await user.click(within(chips).getByRole('button', { name: 'Activity: Development, remove filter' }));
    expect(engine.dispatched('statistics.setFilter').at(-1)).toEqual({
      type: 'statistics.setFilter',
      filter: { ...filteredWeekStatistics.filter, activityId: null },
    });
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(engine.dispatched('statistics.clearFilters')).toHaveLength(1);
    expect(screen.getByText('All totals and charts use your active filters.')).toBeInTheDocument();
  });

  it('resets the search field when the engine clears the filters', () => {
    const { engine } = renderPage({ ...weekStatistics, filter: { ...weekStatistics.filter, query: 'VAT' } });
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('VAT');
    act(() => engine.patchSlice('statistics', { filter: weekStatistics.filter }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
  });
});

describe('zoom', () => {
  it('zooms in from the toolbar and the keyboard', async () => {
    const { engine, user } = renderPage();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(engine.dispatched('statistics.scale')).toEqual([{ type: 'statistics.scale', factor: 0.5 }]);

    const bar = screen.getAllByRole('option')[2]!;
    act(() => bar.focus());
    await user.keyboard('+');
    const bucket = weekStatistics.analysis!.buckets[2]!;
    expect(engine.dispatched('statistics.zoomTo')).toEqual([{ type: 'statistics.zoomTo', start: bucket.start, end: bucket.end }]);
  });

  it('zooms out, goes back, pans and resets a zoomed window', async () => {
    const { engine, user } = renderPage(zoomedWeekStatistics);
    expect(screen.getByText(/^Selected window · /)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Pan earlier' }));
    await user.click(screen.getByRole('button', { name: 'Pan later' }));
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(engine.dispatched('statistics.scale')).toEqual([{ type: 'statistics.scale', factor: 2 }]);
    expect(engine.dispatched('statistics.back')).toHaveLength(1);
    expect(engine.dispatched('statistics.pan').map((intent) => intent.direction)).toEqual([-1, 1]);
    expect(engine.dispatched('statistics.resetZoom')).toHaveLength(1);
  });

  it('zooms to an exact range', async () => {
    const { engine, user } = renderPage(zoomedWeekStatistics);
    await user.click(screen.getByRole('button', { name: 'Choose range…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zoom to a time range' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply range' }));
    expect(engine.dispatched('statistics.zoomTo')).toEqual([
      { type: 'statistics.zoomTo', start: zoomedWeekStatistics.window.start, end: zoomedWeekStatistics.window.end },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('drills into a bar with statistics.entries for its interval, then zooms into it', async () => {
    const { engine, user } = renderPage();
    serveEntries(engine);
    const bucket = weekStatistics.analysis!.buckets[1]!;
    const expected = entriesPage(weekEntries, 0, 100, bucket.start, bucket.end);
    await user.click(screen.getAllByRole('option')[1]!);
    expect(engine.dispatched('statistics.entries')).toEqual([
      { type: 'statistics.entries', offset: 0, limit: 100, start: bucket.start, end: bucket.end },
    ]);
    expect(screen.getByRole('table', { name: /^Recorded time by activity, / })).toBeInTheDocument();
    expect(await screen.findByText(`Entries 1–${expected.total} of ${expected.total}`)).toBeInTheDocument();
    const drill = screen.getByRole('grid', { name: /^Tue 29 Sept · / });
    expect(within(drill).getAllByRole('row')).toHaveLength(1 + expected.total);
    expect(screen.queryByRole('grid', { name: 'Entries in this window' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zoom into selection' }));
    expect(engine.dispatched('statistics.zoomTo')).toEqual([{ type: 'statistics.zoomTo', start: bucket.start, end: bucket.end }]);
  });

  it('shows only the time inside the selected bar and clears the selection', async () => {
    const { engine, user } = renderPage(zoomedWeekStatistics);
    serveEntries(engine, zoomedWeekEntries);
    // 09:00–10:00 on Wednesday: the 08:45–11:00 entry counts one hour.
    const bucket = zoomedWeekStatistics.analysis!.buckets[9]!;
    await user.click(screen.getAllByRole('option')[9]!);
    expect(engine.dispatched('statistics.entries').at(-1)).toEqual({
      type: 'statistics.entries',
      offset: 0,
      limit: 100,
      start: bucket.start,
      end: bucket.end,
    });
    const row = await screen.findByRole('row', { name: /#4821 Checkout/ });
    expect(row).toHaveTextContent(/09:00 – 10:00/);
    expect(row).toHaveTextContent('1h 0min selection');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('grid', { name: 'Entries in this window' })).toBeInTheDocument();
  });
});

describe('timeline', () => {
  it('loads the chosen day with statistics.entries for that day', async () => {
    const { engine, user } = renderPage();
    serveEntries(engine);
    await user.click(screen.getByRole('radio', { name: 'Timeline' }));
    // The last day with recorded time first: Friday 2 October.
    const [monday, , , , friday] = weekStatistics.visuals!.days;
    expect(engine.dispatched('statistics.entries')).toEqual([
      { type: 'statistics.entries', offset: 0, limit: 500, start: friday!.interval.start, end: friday!.interval.end },
    ]);
    const listbox = await screen.findByRole('listbox', { name: 'Your day’s task timeline: entries' });
    const fridayEntries = entriesPage(weekEntries, 0, 500, friday!.interval.start, friday!.interval.end);
    expect(within(listbox).getAllByRole('option')).toHaveLength(Math.min(12, fridayEntries.total));

    await user.click(screen.getByRole('button', { name: 'Zoom to this day' }));
    expect(engine.dispatched('statistics.zoomTo')).toEqual([
      { type: 'statistics.zoomTo', start: friday!.interval.start, end: friday!.interval.end },
    ]);

    await user.click(screen.getByRole('button', { name: /Timeline day/ }));
    await user.click(screen.getByRole('option', { name: /^Mon 28 Sept/ }));
    expect(engine.dispatched('statistics.entries').at(-1)).toEqual({
      type: 'statistics.entries',
      offset: 0,
      limit: 500,
      start: monday!.interval.start,
      end: monday!.interval.end,
    });
  });

  it('shows the engine message when a day cannot be loaded', async () => {
    const { engine, user } = renderPage();
    engine.handle('statistics.entries', () => {
      throw new MockEngineError('notFound', 'The selected period is no longer loaded.');
    });
    await user.click(screen.getByRole('radio', { name: 'Timeline' }));
    expect(await screen.findByText('The selected period is no longer loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the entries of a zoomed day', async () => {
    const { user } = renderPage(zoomedWeekStatistics);
    await user.click(screen.getByRole('radio', { name: 'Timeline' }));
    const rows = within(screen.getByRole('listbox', { name: 'Your day’s task timeline: entries' })).getAllByRole('option');
    expect(rows).toHaveLength(zoomedWeekStatistics.analysis!.entryCount);
    await user.click(rows[1]!);
    expect(screen.getByRole('heading', { level: 3, name: 'Selected timeline entry' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('entries', () => {
  it('pages through statistics.entries with increasing offsets', async () => {
    const { engine, user } = renderPage(monthStatistics);
    engine.handle('statistics.entries', (intent) => entriesPage(monthEntries, intent.offset, intent.limit));
    const list = screen.getByRole('grid', { name: 'Entries in this window' });
    expect(within(list).getAllByRole('row')).toHaveLength(1 + monthStatistics.analysis!.entriesPreview.length);
    expect(screen.getByText(`Showing the first 8 of ${monthEntries.length} entries`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Show all ${monthEntries.length} entries` }));
    expect(await screen.findByText(`Entries 1–100 of ${monthEntries.length}`)).toBeInTheDocument();
    expect(within(screen.getByRole('grid', { name: 'Entries in this window' })).getAllByRole('row')).toHaveLength(101);

    await user.click(screen.getByRole('button', { name: 'Next entries' }));
    expect(await screen.findByText(`Entries 101–${monthEntries.length} of ${monthEntries.length}`)).toBeInTheDocument();
    const rows = within(screen.getByRole('grid', { name: 'Entries in this window' })).getAllByRole('row');
    expect(rows).toHaveLength(1 + monthEntries.length - 100);
    expect(rows[1]).toHaveTextContent(monthEntries[100]!.record.log.comment!);
    expect(screen.getByRole('button', { name: 'Next entries' })).toBeDisabled();
    expect(engine.dispatched('statistics.entries')).toEqual([
      { type: 'statistics.entries', offset: 0, limit: 100 },
      { type: 'statistics.entries', offset: 100, limit: 100 },
    ]);

    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getByText(`Showing the first 8 of ${monthEntries.length} entries`)).toBeInTheDocument();
  });

  it('shows an entries error verbatim and retries', async () => {
    const { engine, user } = renderPage(monthStatistics);
    let calls = 0;
    engine.handle('statistics.entries', (intent) => {
      calls += 1;
      if (calls === 1) throw new MockEngineError('storage', 'The worklog cache is locked.');
      return entriesPage(monthEntries, intent.offset, intent.limit);
    });
    await user.click(screen.getByRole('button', { name: `Show all ${monthEntries.length} entries` }));
    expect(await screen.findByText('The worklog cache is locked.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(`Entries 1–100 of ${monthEntries.length}`)).toBeInTheDocument();
  });

  it('opens an entry’s day in the Time editor', async () => {
    const { engine, user } = renderPage();
    const first = weekStatistics.analysis!.entriesPreview[0]!;
    await user.click(screen.getAllByRole('button', { name: /^Edit entries for .* in Time editor$/ })[0]!);
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-09-28' }]);
    expect(engine.dispatched('timeEditor.setFilter')).toEqual([{ type: 'timeEditor.setFilter', text: String(first.record.ticketId) }]);
  });

  it('opens the day in Timesheet through the main window’s page command', async () => {
    const onNavigate = vi.fn();
    const { user } = renderInsights({ onNavigate, openExtras: ['explore', 'patterns'] }, { statistics: weekStatistics });
    await user.click(screen.getAllByRole('button', { name: /^Edit entries for .* in Time editor$/ })[0]!);
    expect(onNavigate).toHaveBeenCalledWith({ place: 'timesheet', view: 'day' });
  });

  it('opens ticket details from an entry', async () => {
    const { engine, user } = renderPage();
    await user.click(screen.getAllByRole('button', { name: /^#4777 Sprint ceremonies, show details$/ })[0]!);
    expect(engine.dispatched('ticket.showContext')).toEqual([{ type: 'ticket.showContext', ticketId: 4777 }]);
  });
});

describe('tasks and patterns', () => {
  it('explores a task: filters by it and opens the time explorer', async () => {
    const { engine, user } = renderPage({ ...weekStatistics, section: 'tasks' });
    followSections(engine);
    const top = weekStatistics.analysis!.tasks[0]!;
    await user.click(screen.getByRole('button', { name: `Explore ${top.title}` }));
    expect(engine.dispatched('statistics.setFilter')).toEqual([
      { type: 'statistics.setFilter', filter: { ...weekStatistics.filter, taskId: top.id } },
    ]);
    expect(engine.dispatched('statistics.setSection')).toEqual([{ type: 'statistics.setSection', section: 'time' }]);
  });

  it('sorts tasks and filters by activity from the donut', async () => {
    const { engine, user } = renderPage({ ...weekStatistics, section: 'tasks' });
    const grid = screen.getByRole('grid', { name: 'Tasks you worked on' });
    expect(within(grid).getAllByRole('rowheader')[0]).toHaveTextContent('#4821');
    await user.click(screen.getByRole('button', { name: /Sort/ }));
    await user.click(screen.getByRole('option', { name: 'Most entries' }));
    expect(within(grid).getAllByRole('rowheader')[0]).toHaveTextContent('#4777');
    await user.click(screen.getByRole('button', { name: /^Filter by Design/ }));
    expect(engine.dispatched('statistics.setFilter').at(-1)).toEqual({
      type: 'statistics.setFilter',
      filter: { ...weekStatistics.filter, activityId: 'activity:design' },
    });
  });

  it('filters by weekday and entry length', async () => {
    const { engine, user } = patterns();
    await user.click(screen.getByRole('button', { name: /^Filter by Wed/ }));
    await user.click(screen.getByRole('button', { name: /^Filter by 2\+ hours/ }));
    expect(engine.dispatched('statistics.setFilter').map((intent) => [intent.filter.weekday, intent.filter.lengthBand])).toEqual([
      [4, null],
      [null, 4],
    ]);
  });

});

describe('heatmaps and progress', () => {
  it('offers the 1.14 charts in their order', () => {
    renderPage();
    const picker = screen.getByRole('radiogroup', { name: 'Chart type' });
    expect(within(picker).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Activity chart', 'Heatmaps', 'Timeline', 'Progress']);
  });

  it('shows the calendar and hourly heatmaps of the week', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heatmaps' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Your work at a glance' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Calendar heatmap' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Hourly heatmap' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entries in this window' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('opens a day of the calendar heatmap in the timeline', async () => {
    const { engine, user } = renderPage();
    followSections(engine);
    serveEntries(engine);
    await user.click(screen.getByRole('radio', { name: 'Heatmaps' }));
    const tuesday = weekStatistics.visuals!.days[1]!;
    const cells = within(screen.getByRole('grid', { name: 'Calendar heatmap' })).getAllByRole('gridcell');
    await user.click(cells.find((cell) => cell.getAttribute('aria-label')?.startsWith('Tuesday'))!);
    expect(engine.dispatched('statistics.zoomTo')).toEqual([
      { type: 'statistics.zoomTo', start: tuesday.interval.start, end: tuesday.interval.end },
    ]);
    expect(screen.getByRole('radio', { name: 'Timeline', checked: true })).toBeInTheDocument();
    expect(engine.dispatched('statistics.setSection')).toEqual([]);
  });

  it('opens an hour of the hourly heatmap in the timeline', async () => {
    const { engine, user } = renderPage();
    serveEntries(engine);
    await user.click(screen.getByRole('radio', { name: 'Heatmaps' }));
    const grid = screen.getByRole('grid', { name: 'Hourly heatmap' });
    await user.click(within(grid).getAllByRole('gridcell')[0]!);
    const [zoom] = engine.dispatched('statistics.zoomTo');
    const intervals = weekStatistics.visuals!.hours.map((hour) => hour.interval);
    expect(intervals).toContainEqual({ start: zoom!.start, end: zoom!.end });
    expect(screen.getByRole('radio', { name: 'Timeline', checked: true })).toBeInTheDocument();
  });

  it('shows the progress chart with the scheduled target', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Progress' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Progress through the period' })).toBeInTheDocument();
    expect(screen.getByText(/Recorded time alongside your scheduled target/)).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('explains the missing heatmaps until the window is analysed', async () => {
    const { user } = renderPage({ ...weekStatistics, visuals: null });
    await user.click(screen.getByRole('radio', { name: 'Heatmaps' }));
    expect(screen.getByText('The heatmaps appear once this window’s worklogs are analysed.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Progress' }));
    expect(screen.getByText('The progress chart appears once this window’s worklogs are analysed.')).toBeInTheDocument();
  });
});

describe('data-table twins', () => {
  it('shows every pattern chart as a table', async () => {
    const { user } = patterns();
    const toggles = screen.getAllByRole('button', { name: 'Show as table' });
    // Per day, the hourly heatmap, weekdays, lengths, hours and context switches.
    expect(toggles).toHaveLength(6);
    for (const toggle of toggles) await user.click(toggle);
    for (const caption of ['Recorded time per day', 'Hourly heatmap', 'Time by weekday', 'Entry lengths', 'When you record work', 'Task switches by day']) {
      expect(screen.getByRole('table', { name: caption })).toBeInTheDocument();
    }
    await expectNoA11yViolations();
  });

  it('shows the heatmaps and the progress chart as tables', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heatmaps' }));
    // The first toggle belongs to "Per day, by activity".
    const toggles = screen.getAllByRole('button', { name: 'Show as table' }).slice(1);
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) await user.click(toggle);
    expect(screen.getByRole('table', { name: 'Calendar heatmap' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Hourly heatmap' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Progress' }));
    await user.click(screen.getAllByRole('button', { name: 'Show as table' }).at(-1)!);
    expect(screen.getByRole('table', { name: 'Progress through the period' })).toBeInTheDocument();
  });

  it('shows the time chart and the donut as tables', async () => {
    const { user } = renderPage();
    const toggles = screen.getAllByRole('button', { name: 'Show as table' });
    // Per day, by activity, then the explorer's time chart.
    await user.click(toggles[0]!);
    const days = screen.getByRole('table', { name: 'Per day, by activity' });
    expect(within(days).getAllByRole('row')).toHaveLength(1 + weekStatistics.analysis!.buckets.length);
    await user.click(screen.getAllByRole('button', { name: 'Show as table' })[0]!);
    const table = screen.getByRole('table', { name: 'Where your time went' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + weekStatistics.analysis!.buckets.length);
  });
});
