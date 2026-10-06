import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SliceMap, StatisticsSlice } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
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
  weekStatistics,
  zoomedWeekStatistics,
} from '../../ipc/fixtures/slices/statistics';
import type { MockEngine } from '../../ipc/mockEngine';
import { useCommand } from '../../shortcuts/hooks';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import StatisticsPage from './index';

beforeEach(() => {
  // Only the date is fixed: "today" is the samples' Tuesday 6 October 2026. Timers stay real.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T08:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(statistics: StatisticsSlice | null = weekStatistics, extra: Partial<SliceMap> = {}) {
  const slices = sampleSlices();
  if (statistics) slices.statistics = statistics;
  else delete slices.statistics;
  return renderWithEngine(<StatisticsPage />, { slices: { ...slices, ...extra } });
}

/** The engine side of the section tabs: publish the chosen section. */
function followSections(engine: MockEngine) {
  engine.handle('statistics.setSection', (intent, mock) => mock.patchSlice('statistics', { section: intent.section }));
}

describe('Statistics page states', () => {
  it('shows a skeleton until the slice arrives', () => {
    renderPage(null);
    expect(screen.getByRole('status')).toHaveTextContent('Loading statistics');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('shows the first download as loading', () => {
    renderPage(loadingStatistics);
    expect(screen.getAllByText('Loading your recorded time…').length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('shows an empty period', async () => {
    renderPage(emptyWeekStatistics);
    expect(screen.getByRole('heading', { level: 2, name: 'No time tracked in this period' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('asks to connect when nothing was downloaded and 7pace is not set up', async () => {
    renderPage(idleStatistics, {
      connection: { ...sampleSlices().connection!, health: 'unconfigured', connected: false, workspace: '' },
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Your statistics are waiting' })).toBeInTheDocument();
    expect(screen.getByText('Connect to 7pace in Settings to explore your recorded time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
    await expectNoA11yViolations();
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
    expect(screen.getByRole('tab', { name: 'Time explorer' })).toBeInTheDocument();
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
  it('renders the range, totals and sections', () => {
    renderPage();
    expect(screen.getByText('28 Sept – 4 Oct 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Whole week' })).toBeInTheDocument();
    const totals = screen.getByRole('list', { name: 'Totals' });
    expect(totals).toHaveTextContent('Recorded time39h 30m37 entries · 5 tracked days');
    expect(totals).toHaveTextContent('Period target104%of 38h 0m scheduled');
    expect(screen.getByRole('tab', { name: 'Time explorer', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Where your time went' })).toBeInTheDocument();
    expect(screen.getByText(/Synced/, { selector: 'p' })).toBeInTheDocument();
  });

  it('refreshes from the page header shortcut target', async () => {
    const { engine, user } = renderPage(idleStatistics);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(engine.dispatched('statistics.refresh')).toHaveLength(1);
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
    expect(screen.getByRole('tabpanel').parentElement).toHaveAttribute('aria-busy', 'true');
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

describe('sections', () => {
  it('switches sections through the engine', async () => {
    const { engine, user } = renderPage();
    followSections(engine);
    await user.click(screen.getByRole('tab', { name: 'Tasks' }));
    expect(engine.dispatched('statistics.setSection')).toEqual([{ type: 'statistics.setSection', section: 'tasks' }]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Tasks you worked on' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Work patterns' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Time by weekday' })).toBeInTheDocument();
    expect(engine.dispatched('statistics.setSection').map((intent) => intent.section)).toEqual(['tasks', 'patterns']);
  });

  it('shows the section from the slice', () => {
    renderPage({ ...weekStatistics, section: 'patterns' });
    expect(screen.getByRole('tab', { name: 'Work patterns', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Context switches' })).toBeInTheDocument();
  });

  it('returns to the engine section when the change is refused', async () => {
    const { engine, user } = renderPage();
    engine.handle('statistics.setSection', () => {
      throw new Error('refused');
    });
    await user.click(screen.getByRole('tab', { name: 'Tasks' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Time explorer', selected: true })).toBeInTheDocument());
  });

  it('has no axe violations in the tasks section', async () => {
    renderPage({ ...weekStatistics, section: 'tasks' });
    expect(screen.getByRole('grid', { name: 'Tasks you worked on' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('has no axe violations in the patterns section', async () => {
    renderPage({ ...weekStatistics, section: 'patterns' });
    expect(screen.getByRole('grid', { name: 'Calendar heatmap' })).toBeInTheDocument();
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
    expect(screen.getByText('All totals and charts below use your active filters.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Totals' })).toHaveTextContent('Average tracked day');
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
    expect(screen.getByRole('heading', { level: 2, name: /^Selected window · / })).toBeInTheDocument();
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

  it('inspects a bar and zooms into it', async () => {
    const { engine, user } = renderPage();
    const bucket = weekStatistics.analysis!.buckets[1]!;
    await user.click(screen.getAllByRole('option')[1]!);
    expect(screen.getByRole('table', { name: /^Recorded time by activity, / })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom into selection' }));
    expect(engine.dispatched('statistics.zoomTo')).toEqual([{ type: 'statistics.zoomTo', start: bucket.start, end: bucket.end }]);
  });
});

describe('timeline', () => {
  it('asks to zoom to a day for longer windows', async () => {
    const { engine, user } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Timeline' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Your day’s task timeline' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom to this day' }));
    // The last day with recorded time: Friday 2 October.
    const friday = weekStatistics.visuals!.days[4]!;
    expect(engine.dispatched('statistics.zoomTo')).toEqual([
      { type: 'statistics.zoomTo', start: friday.interval.start, end: friday.interval.end },
    ]);
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
      if (calls === 1) throw new Error('The worklog cache is locked.');
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

  it('opens the Time editor page through the sidebar command', async () => {
    const open = vi.fn();
    function TimeEditorCommand() {
      useCommand({ id: 'page.timeEditor', label: 'Time editor', group: 'Pages', onAction: open });
      return null;
    }
    const slices = sampleSlices();
    const { user } = renderWithEngine(
      <>
        <TimeEditorCommand />
        <StatisticsPage />
      </>,
      { slices: { ...slices, statistics: weekStatistics } },
    );
    await user.click(screen.getAllByRole('button', { name: /^Edit entries for .* in Time editor$/ })[0]!);
    expect(open).toHaveBeenCalledTimes(1);
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
    const { engine, user } = renderPage({ ...weekStatistics, section: 'patterns' });
    await user.click(screen.getByRole('button', { name: /^Filter by Wed/ }));
    await user.click(screen.getByRole('button', { name: /^Filter by 2\+ hours/ }));
    expect(engine.dispatched('statistics.setFilter').map((intent) => [intent.filter.weekday, intent.filter.lengthBand])).toEqual([
      [4, null],
      [null, 4],
    ]);
  });

  it('opens a day of the calendar heatmap in the timeline', async () => {
    const { engine, user } = renderPage({ ...weekStatistics, section: 'patterns' });
    followSections(engine);
    const tuesday = weekStatistics.visuals!.days[1]!;
    const cells = within(screen.getByRole('grid', { name: 'Calendar heatmap' })).getAllByRole('gridcell');
    await user.click(cells.find((cell) => cell.getAttribute('aria-label')?.startsWith('Tuesday'))!);
    expect(engine.dispatched('statistics.zoomTo')).toEqual([
      { type: 'statistics.zoomTo', start: tuesday.interval.start, end: tuesday.interval.end },
    ]);
    expect(engine.dispatched('statistics.setSection')).toEqual([{ type: 'statistics.setSection', section: 'time' }]);
  });
});

describe('data-table twins', () => {
  it('shows every chart as a table', async () => {
    const { user } = renderPage({ ...weekStatistics, section: 'patterns' });
    const toggles = screen.getAllByRole('button', { name: 'Show as table' });
    // Weekdays, lengths, hours, calendar, hourly heatmap, progress and context switches.
    expect(toggles).toHaveLength(7);
    for (const toggle of toggles) await user.click(toggle);
    for (const caption of ['Time by weekday', 'Entry lengths', 'When you record work', 'Calendar heatmap', 'Hourly heatmap', 'Progress through the period']) {
      expect(screen.getByRole('table', { name: caption })).toBeInTheDocument();
    }
    expect(screen.getByRole('table', { name: 'Task switches by day' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('shows the time chart and the donut as tables', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', { name: 'Where your time went' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + weekStatistics.analysis!.buckets.length);
  });
});
