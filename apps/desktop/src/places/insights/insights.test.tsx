import { act, screen, waitFor, within } from '@testing-library/react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleSlices } from '../../ipc/fixtures';
import { emptyWeekStatistics, weekStatistics, zoomedWeekStatistics } from '../../ipc/fixtures/slices/statistics';
import { weeklyDraftText, weeklyEmpty } from '../../ipc/fixtures/slices/weekly';
import { MockEngineError } from '../../ipc/mockEngine';
import { expectNoA11yViolations } from '../../test/axe';
import { parseMarkdown } from './markdown';
import { busiestHours, dayLevel } from './PatternsView';
import { renderInsights } from './testing';
import { needsOutcomes } from './WeeklyAside';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.mocked(save).mockReset();
  vi.mocked(writeText).mockClear();
  // "Today" is the samples' Tuesday 6 October 2026. Timers stay real.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T08:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

const aside = () => screen.getByRole('complementary', { name: 'Weekly report' });

describe('Insights header', () => {
  it('puts the period, filters, Jump to and Refresh in one header row', async () => {
    const { engine, user } = renderInsights();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('28 Sept – 4 Oct 2026');
    const period = screen.getByRole('radiogroup', { name: 'Period' });
    expect(within(period).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Day', 'Week', 'Month', 'Year']);
    expect(within(period).getByRole('radio', { name: 'Week', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ticket' })).toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton', { name: /Jump to/ }).length).toBeGreaterThan(0);
    // An earlier week offers the way back.
    await user.click(screen.getByRole('button', { name: 'Current week' }));
    expect(engine.dispatched('statistics.current')).toHaveLength(1);
  });

  it('hides "Current week" in the current week', () => {
    renderInsights({}, { statistics: { ...weekStatistics, range: { period: 'week', start: '2026-10-04T22:00:00Z', end: '2026-10-11T22:00:00Z' } } });
    expect(screen.queryByRole('button', { name: 'Current week' })).not.toBeInTheDocument();
  });

  it('shows the zoomed window and the active filters under the header', async () => {
    const { engine, user } = renderInsights({}, { statistics: zoomedWeekStatistics });
    const scope = screen.getByRole('region', { name: 'Scope' });
    expect(within(scope).getByText(/^Selected window · /)).toBeInTheDocument();
    await user.click(within(scope).getByRole('button', { name: 'Reset zoom' }));
    expect(engine.dispatched('statistics.resetZoom')).toHaveLength(1);
  });
});

describe('Where time went', () => {
  it('stacks each day by activity against the shared daily target and zooms into a day', async () => {
    const { engine, user } = renderInsights();
    const days = screen.getByRole('list', { name: /^Per day, by activity\. Choose a bar/ });
    const bars = within(days).getAllByRole('button');
    expect(bars).toHaveLength(7);
    expect(bars[0]).toHaveAccessibleName(/^Mon 28 Sept: 7h 25m; .*Development .*; target 7h 36m$/);
    expect(bars[5]).toHaveAccessibleName('Sat 3 Oct: no time');
    expect(screen.getByText('Target 7h 36m')).toBeInTheDocument();
    expect(within(days).getAllByRole('listitem')[0]).toHaveTextContent('7h 25mMon 28');
    await user.click(bars[4]!);
    const friday = weekStatistics.analysis!.buckets[4]!;
    expect(engine.dispatched('statistics.zoomTo')).toEqual([{ type: 'statistics.zoomTo', start: friday.start, end: friday.end }]);
  });

  it('names the chart after the resolution', () => {
    renderInsights({}, { statistics: zoomedWeekStatistics });
    expect(screen.getByRole('heading', { level: 2, name: 'Per hour, by activity' })).toBeInTheDocument();
  });

  it('lists tickets by time and shows them all on request', async () => {
    const { engine, user } = renderInsights();
    const section = screen.getByRole('region', { name: 'By ticket' });
    const rows = within(within(section).getByRole('list', { name: 'Recorded time by ticket' })).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent('#4821 Checkout: retry failed card payments9h 55m');
    expect(rows[6]).toHaveTextContent('Pairing on the renderer · no ticket1h 0m');
    await user.click(within(section).getByRole('button', { name: 'Show all 9' }));
    expect(within(section).getAllByRole('listitem')).toHaveLength(9);
    await user.click(within(rows[0]!).getByRole('button', { name: '#4821 Checkout: retry failed card payments, show details' }));
    expect(engine.dispatched('ticket.showContext')).toEqual([{ type: 'ticket.showContext', ticketId: 4821 }]);
  });

  it('has the weekly report next to the charts, with what the draft is based on', async () => {
    renderInsights();
    const panel = aside();
    expect(within(panel).getByText('Week of 5 Oct – 11 Oct 2026')).toBeInTheDocument();
    expect(within(panel).getByText('Draft · saved on this Mac')).toBeInTheDocument();
    expect(within(panel).getByText('8h 25m tracked · target 38h 0m')).toBeInTheDocument();
    const tickets = within(within(panel).getByRole('list', { name: 'Time per ticket' })).getAllByRole('listitem');
    expect(tickets[0]).toHaveTextContent('#4821 Checkout: retry failed card payments4h 25m');
    expect(tickets[3]).toHaveTextContent('Reviewing pull requests · no ticket0h 40m');
    // The sample draft has outcomes: no reminder.
    expect(within(panel).queryByText(/Add outcomes before sharing/)).not.toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('reminds to add outcomes while the draft has placeholders or is empty', () => {
    renderInsights({}, { weekly: weeklyEmpty });
    expect(within(aside()).getByText('Add outcomes before sharing. The draft only lists recorded time.')).toBeInTheDocument();
    expect(within(aside()).getByText('No draft yet')).toBeInTheDocument();
    expect(within(aside()).getByRole('button', { name: 'Copy' })).toBeDisabled();
    expect(within(aside()).getByRole('button', { name: 'Export Markdown' })).toBeDisabled();
  });

  it('edits the draft in the panel', async () => {
    const { engine, user } = renderInsights({}, { weekly: weeklyEmpty });
    await user.click(within(aside()).getByRole('radio', { name: 'Edit' }));
    await user.type(within(aside()).getByRole('textbox', { name: 'Editable weekly status report' }), 'Hi');
    expect(engine.dispatched('weekly.setText').map((intent) => intent.text)).toEqual(['H', 'Hi']);
  });

  it('asks before regenerating over a draft, then copies and exports it', async () => {
    vi.mocked(save).mockResolvedValue('/Users/sam/weekly.md');
    const { engine, user } = renderInsights();
    engine.handle('weekly.generate', (intent) => {
      if (!intent.replace) throw new MockEngineError('needsConfirmation', 'Replace your edited report?');
      return null;
    });
    await user.click(within(aside()).getByRole('button', { name: 'Regenerate' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Replace this week’s draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Replace draft' }));
    expect(engine.dispatched('weekly.generate').map((intent) => intent.replace)).toEqual([false, true]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.click(within(aside()).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(weeklyDraftText);
    await user.click(within(aside()).getByRole('button', { name: 'Export Markdown' }));
    await waitFor(() => expect(engine.dispatched('weekly.exportMarkdown')).toEqual([{ type: 'weekly.exportMarkdown', path: '/Users/sam/weekly.md' }]));
  });

  it('leaves out the stat cards and the explorer for an empty period', () => {
    renderInsights({}, { statistics: emptyWeekStatistics });
    expect(screen.queryByRole('list', { name: 'Totals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Explore entries' })).not.toBeInTheDocument();
    expect(aside()).toBeInTheDocument();
  });
});

describe('Patterns', () => {
  it('shows a tile per day that opens its timeline under Where time went', async () => {
    const onNavigate = vi.fn();
    const { engine, user } = renderInsights({ view: 'patterns', onNavigate });
    const tiles = within(screen.getByRole('list', { name: /^Recorded time per day/ })).getAllByRole('button');
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'Mon 287h 25m',
      'Tue 297h 50m',
      'Wed 307h 45m',
      'Thu 18h 10m',
      'Fri 28h 20m',
      'Sat 3–',
      'Sun 4–',
    ]);
    await user.click(tiles[1]!);
    const tuesday = weekStatistics.visuals!.days[1]!;
    expect(engine.dispatched('statistics.zoomTo')).toEqual([{ type: 'statistics.zoomTo', start: tuesday.interval.start, end: tuesday.interval.end }]);
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'insights', view: 'time' });
    expect(await screen.findByRole('radio', { name: 'Timeline', checked: true })).toBeInTheDocument();
  });

  it('shows the hourly heatmap and the week at a glance', async () => {
    const onNavigate = vi.fn();
    const { user } = renderInsights({ view: 'patterns', onNavigate });
    expect(screen.getByRole('grid', { name: 'Hourly heatmap' })).toBeInTheDocument();
    const glance = screen.getByRole('complementary', { name: 'This week at a glance' });
    const facts = within(glance).getAllByRole('definition').map((fact) => fact.textContent);
    expect(within(glance).getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Busiest hours',
      'Longest day',
      'Average tracked day',
      'Overlapping time',
      'Covered clock time',
    ]);
    expect(facts[0]).toBe('09:00 – 12:00 and 13:00 – 17:00');
    expect(facts[1]).toBe('Fri 2 Oct · 8h 20m');
    await user.click(within(glance).getByRole('button', { name: 'See entries in Timesheet' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'list' });
  });

  it('offers Timesheet entries only when the list is reachable', () => {
    renderInsights({ view: 'patterns', hiddenPages: ['history'] });
    expect(screen.queryByRole('button', { name: 'See entries in Timesheet' })).not.toBeInTheDocument();
  });

  it('explains the missing patterns until the window is analysed', () => {
    renderInsights({ view: 'patterns' }, { statistics: { ...weekStatistics, visuals: null } });
    expect(screen.getByText('The day and hour patterns appear once this window’s worklogs are analysed.')).toBeInTheDocument();
  });
});

describe('hidden views', () => {
  it('drops the weekly report panel and tab when the Weekly report is hidden', () => {
    renderInsights({ hiddenPages: ['weeklyReport'] });
    expect(screen.queryByRole('complementary', { name: 'Weekly report' })).not.toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Insights views' });
    expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['Where time went', 'Patterns']);
  });

  it('shows only the weekly report, without tabs, when Statistics is hidden', () => {
    const { engine } = renderInsights({ hiddenPages: ['statistics'] });
    expect(screen.getByRole('region', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Insights views' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Period' })).not.toBeInTheDocument();
    act(() => engine.setSlice('weekly', sampleSlices().weekly!));
    expect(screen.getByRole('heading', { level: 1, name: '5 Oct – 11 Oct 2026' })).toBeInTheDocument();
  });
});

describe('retained 1.14 blocks', () => {
  const toggle = (name: RegExp) => screen.getByRole('button', { name });

  it('keep the explorer closed under Where time went until opened', async () => {
    const { user } = renderInsights();
    const button = toggle(/^Explore entries/);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleName('Explore entries');
    expect(button).toHaveAccessibleDescription('Time explorer, heatmaps, timeline, progress, tasks and entries');
    expect(screen.queryByRole('radio', { name: 'Time explorer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search' })).not.toBeInTheDocument();
    await expectNoA11yViolations();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toContainElement(screen.getByRole('radio', { name: 'Time explorer' }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Chart type' })).toBeInTheDocument();
    await expectNoA11yViolations();
    await user.click(button);
    expect(screen.queryByRole('radio', { name: 'Time explorer' })).not.toBeInTheDocument();
  });

  it('keep the 1.14 work patterns closed on Patterns until opened', async () => {
    const { user } = renderInsights({ view: 'patterns' });
    expect(screen.queryByRole('heading', { name: 'Time by weekday' })).not.toBeInTheDocument();
    await user.click(toggle(/^More work patterns/));
    expect(screen.getByRole('heading', { name: 'Time by weekday' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('keep Week so far closed on the Weekly report until opened', async () => {
    const { user } = renderInsights({ view: 'report' });
    expect(screen.queryByRole('complementary', { name: 'Week so far' })).not.toBeInTheDocument();
    await user.click(toggle(/^Week so far/));
    expect(screen.getByRole('complementary', { name: 'Week so far' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('remember what is open while moving between the Insights views', async () => {
    const { user } = renderInsights();
    await user.click(toggle(/^Explore entries/));
    const tabs = () => screen.getByRole('navigation', { name: 'Insights views' });
    await user.click(within(tabs()).getByRole('button', { name: 'Patterns' }));
    expect(toggle(/^More work patterns/)).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(tabs()).getByRole('button', { name: 'Where time went' }));
    expect(toggle(/^Explore entries/)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: 'Time explorer' })).toBeInTheDocument();
  });

  it('open the explorer when a Patterns day opens its timeline', async () => {
    const { user } = renderInsights({ view: 'patterns' });
    const tiles = within(screen.getByRole('list', { name: /^Recorded time per day/ })).getAllByRole('button');
    await user.click(tiles[1]!);
    expect(await screen.findByRole('radio', { name: 'Timeline', checked: true })).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('parses the draft’s headings, nested lists, continuation lines and paragraphs', () => {
    expect(
      parseMarkdown('# Title\n\nIntro line\nwraps here.\n\n## Worked on\n- One\n  - Detail\n    continued\n- Two\n\n## Next\n* [ADD PLANS]\n'),
    ).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'Intro line wraps here.' },
      { kind: 'heading', level: 2, text: 'Worked on' },
      {
        kind: 'list',
        items: [
          { text: 'One', children: [{ text: 'Detail continued', children: [] }] },
          { text: 'Two', children: [] },
        ],
      },
      { kind: 'heading', level: 2, text: 'Next' },
      { kind: 'list', items: [{ text: '[ADD PLANS]', children: [] }] },
    ]);
  });

  it('finds the busiest hours, day levels and missing outcomes', () => {
    expect(busiestHours(weekStatistics.analysis!)).toBe('09:00 – 12:00 and 13:00 – 17:00');
    expect(busiestHours({ ...weekStatistics.analysis!, hours: [] })).toBeNull();
    expect([0, 3600, 14_400, 25_000, 27_360].map((seconds) => dayLevel(seconds, 27_360))).toEqual([0, 1, 2, 3, 4]);
    expect(needsOutcomes('')).toBe(true);
    expect(needsOutcomes('## Outcomes\n- [ADD WHAT SHIPPED OR CHANGED]')).toBe(true);
    expect(needsOutcomes(weeklyDraftText)).toBe(false);
  });
});

describe('accessibility', () => {
  it('has no axe violations on Where time went', async () => {
    renderInsights();
    await expectNoA11yViolations();
  });

  it('has no axe violations on Patterns', async () => {
    renderInsights({ view: 'patterns' });
    await expectNoA11yViolations();
  });
});
