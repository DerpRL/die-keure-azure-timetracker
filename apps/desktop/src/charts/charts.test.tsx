import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITIES,
  activitySlices,
  dstHourHeatmap,
  monthDays,
  timelineEntries,
  weekBuckets,
  weekProgress,
  yearDays,
} from '../gallery/sampleData';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { ActivityBars, type TimeRange } from './ActivityBars';
import { CalendarHeatmap } from './CalendarHeatmap';
import { CumulativeProgress } from './CumulativeProgress';
import { Donut } from './Donut';
import { heatStep } from './heat';
import { HourHeatmap } from './HourHeatmap';
import { Timeline } from './Timeline';

function Explorer({ onZoom, onZoomOut }: { onZoom?: (range: TimeRange) => void; onZoomOut?: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ActivityBars
      title="Recorded time by activity"
      series={ACTIVITIES}
      buckets={weekBuckets()}
      selectedId={selected}
      onSelect={setSelected}
      onZoom={onZoom}
      onZoomOut={onZoomOut}
    />
  );
}

const options = () => within(screen.getByRole('listbox')).getAllByRole('option');

describe('ActivityBars', () => {
  it('labels every bucket and passes axe', async () => {
    renderWithProviders(<Explorer />);
    const bars = options();
    expect(bars).toHaveLength(7);
    expect(bars[0]).toHaveAccessibleName(/^Mon 5 Oct: \d+h \d+m recorded\. Development/);
    expect(bars[6]).toHaveAccessibleName('Sun 11 Oct: 0h 0m recorded');
    expect(screen.getByRole('listbox')).toHaveAccessibleDescription(/Left and Right Arrow/);
    await expectNoA11yViolations();
  });

  it('moves with arrows, selects with Return and zooms with + and −', async () => {
    const onZoom = vi.fn();
    const onZoomOut = vi.fn();
    const { user } = renderWithProviders(<Explorer onZoom={onZoom} onZoomOut={onZoomOut} />);
    await user.tab(); // the "Show as table" toggle
    await user.tab();
    expect(options()[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(options()[2]).toHaveFocus();
    expect(options()[0]).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{Enter}');
    expect(options()[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(options()[6]).toHaveFocus();
    await user.keyboard('{Home}+');
    const [range] = onZoom.mock.lastCall as [TimeRange];
    expect(range.start).toEqual(new Date(2026, 9, 5));
    expect(range.end).toEqual(new Date(2026, 9, 6));
    await user.keyboard('-');
    expect(onZoomOut).toHaveBeenCalled();
    // A (visual-only) tooltip mirrors the focused bar for sighted keyboard users.
    const tooltip = document.querySelector('.tooltip');
    expect(tooltip).toHaveTextContent(/^Mon 5 Oct/);
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    await user.keyboard('{Escape}');
    expect(document.querySelector('.tooltip')).toBeNull();
  });

  it('selects on click and zooms a dragged range', () => {
    const onZoom = vi.fn();
    renderWithProviders(<Explorer onZoom={onZoom} />);
    fireEvent.click(options()[1]!);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(options()[1]!);
    expect(options()[1]).toHaveAttribute('aria-selected', 'false');

    const svg = screen.getByRole('group', { name: /stacked bar chart/ });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 80 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(svg, { pointerId: 1, button: 0, clientX: 300 });
    expect(onZoom).toHaveBeenCalledTimes(1);
    const [range] = onZoom.mock.lastCall as [TimeRange];
    expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    expect(range.start).toEqual(new Date(2026, 9, 5));
  });

  it('switches to the data-table twin', async () => {
    const { user } = renderWithProviders(<Explorer />);
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', { name: 'Recorded time by activity' });
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(within(table).getByRole('columnheader', { name: 'Development' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show as table' })).toHaveAttribute('aria-pressed', 'true');
    await expectNoA11yViolations();
  });
});

describe('CalendarHeatmap', () => {
  it('uses the compact year layout above 62 days and moves by day and week', async () => {
    const onSelectDay = vi.fn();
    const { user } = renderWithProviders(<CalendarHeatmap title="2026" days={yearDays()} onSelectDay={onSelectDay} />);
    const grid = screen.getByRole('grid', { name: '2026' });
    expect(within(grid).getAllByRole('row')).toHaveLength(7);
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells).toHaveLength(365);
    expect(screen.getByRole('gridcell', { name: /^Thursday, 1 January 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Thursday, 31 December 2026: future date' })).toBeInTheDocument();

    screen.getByRole('gridcell', { name: /^Thursday, 1 January 2026/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName(/^Thursday, 8 January 2026/);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectDay).toHaveBeenCalledWith('2026-01-09');
    await expectNoA11yViolations();
  });

  it('uses larger cells with text for a month, including empty and future days', async () => {
    const { user } = renderWithProviders(<CalendarHeatmap title="October 2026" days={monthDays()} />);
    const grid = screen.getByRole('grid', { name: 'October 2026' });
    expect(within(grid).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(within(grid).getByRole('gridcell', { name: /^Saturday, 3 October 2026: 0h 0m/ })).toBeInTheDocument();
    expect(within(grid).getByRole('gridcell', { name: 'Saturday, 31 October 2026: future date' })).toHaveTextContent('Future');
    within(grid).getByRole('gridcell', { name: /^Thursday, 1 October 2026/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/^Thursday, 8 October 2026/);
    await expectNoA11yViolations();
  });

  it('maps values to five steps above empty', () => {
    expect(heatStep(0, 3600)).toBe(0);
    expect(heatStep(1, 3600)).toBe(1);
    expect(heatStep(3600, 3600)).toBe(5);
    expect(heatStep(9000, 3600)).toBe(5);
  });
});

describe('HourHeatmap', () => {
  it('keeps repeated DST hours distinct and navigates in two dimensions', async () => {
    const onSelectCell = vi.fn();
    const { rows, cells } = dstHourHeatmap();
    const { user } = renderWithProviders(<HourHeatmap title="Hours" rows={rows} cells={cells} onSelectCell={onSelectCell} />);
    const grid = screen.getByRole('grid', { name: 'Hours' });
    const dstRow = within(grid).getAllByRole('row')[1]!;
    expect(within(dstRow).getAllByRole('gridcell')).toHaveLength(25);
    expect(within(dstRow).getByRole('gridcell', { name: /Sunday 25 October, 02:00 CEST/ })).toBeInTheDocument();
    expect(within(dstRow).getByRole('gridcell', { name: /Sunday 25 October, 02:00 CET/ })).toBeInTheDocument();

    within(grid).getByRole('gridcell', { name: /Saturday 24 October, 02:00/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/Sunday 25 October, 02:00 CEST/);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName(/Sunday 25 October, 02:00 CET/);
    await user.keyboard('{Enter}');
    expect(onSelectCell).toHaveBeenCalledWith(expect.objectContaining({ label: '02:00 CET', slot: 3 }));
    await expectNoA11yViolations();
  });
});

describe('Timeline', () => {
  function Day({ onZoomToEntry, entries = timelineEntries() }: { onZoomToEntry?: () => void; entries?: ReturnType<typeof timelineEntries> }) {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <Timeline
        title="Tuesday 6 October"
        domain={{ start: new Date(2026, 9, 6, 8), end: new Date(2026, 9, 6, 20) }}
        entries={entries}
        series={ACTIVITIES}
        selectedId={selected}
        onSelect={setSelected}
        onZoomToEntry={onZoomToEntry}
      />
    );
  }

  it('shows one row per entry, pages after 12 and keeps overlaps', async () => {
    const { user } = renderWithProviders(<Day />);
    expect(options()).toHaveLength(12);
    expect(screen.getByText('1–12 of 16 entries')).toBeInTheDocument();
    const entries = timelineEntries();
    expect(entries[4]!.start.getTime()).toBeLessThan(entries[3]!.end.getTime());
    expect(options()[3]).toHaveAccessibleName(/Overlaps the next entry/);
    await user.click(screen.getByRole('button', { name: 'Next entries' }));
    expect(options()).toHaveLength(4);
    expect(screen.getByText('13–16 of 16 entries')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('moves with arrows across pages, selects with Return and zooms with +', async () => {
    const onZoomToEntry = vi.fn();
    const { user } = renderWithProviders(<Day onZoomToEntry={onZoomToEntry} />);
    options()[0]!.focus();
    await user.keyboard('{End}');
    expect(options()[11]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByText('13–16 of 16 entries')).toBeInTheDocument();
    expect(options()[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('+');
    expect(onZoomToEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-12' }));
    expect(screen.getByRole('button', { name: 'Zoom to entry' })).toBeInTheDocument();
  });

  it('explains an empty day', () => {
    renderWithProviders(<Day entries={[]} />);
    expect(screen.getByText(/No entries in this day/)).toBeInTheDocument();
  });
});

describe('CumulativeProgress', () => {
  it('compares recorded time with a dashed target and inspects points with arrows', async () => {
    const { points, target } = weekProgress();
    const { user } = renderWithProviders(
      <CumulativeProgress
        title="Week progress"
        domain={{ start: new Date(2026, 9, 5), end: new Date(2026, 9, 12) }}
        points={points}
        target={target}
      />,
    );
    expect(screen.getByText('Scheduled target (dashed)')).toBeInTheDocument();
    const point = options();
    expect(point).toHaveLength(3);
    expect(point[2]).toHaveAccessibleName(/recorded, target 15h 12m$/);
    point[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(options()[1]).toHaveFocus();
    await expectNoA11yViolations();
  });

  it('omits the target for filtered or zoomed windows', () => {
    const { points } = weekProgress();
    renderWithProviders(
      <CumulativeProgress title="Zoomed" domain={{ start: new Date(2026, 9, 5), end: new Date(2026, 9, 7) }} points={points} />,
    );
    expect(screen.queryByText('Scheduled target (dashed)')).toBeNull();
    expect(options()[1]).not.toHaveAccessibleName(/target/);
  });
});

describe('Donut', () => {
  it('filters through labelled toggle buttons and labels every slice', async () => {
    const onSelect = vi.fn();
    function Mix() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <Donut
          title="Activity mix"
          slices={activitySlices()}
          selectedId={selected}
          onSelect={(id) => {
            setSelected(id);
            onSelect(id);
          }}
        />
      );
    }
    const { user } = renderWithProviders(<Mix />);
    const toolbar = screen.getByRole('toolbar', { name: 'Filter by activity mix' });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName(/^Filter by Development, \d+h \d+m, \d+%$/);
    expect(screen.getAllByRole('img', { name: /^(Development|Meeting|Code review|Design|Testing|Stand-up): / })).toHaveLength(
      buttons.length,
    );
    await user.click(buttons[1]!);
    expect(onSelect).toHaveBeenLastCalledWith('meeting');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{ArrowDown}');
    expect(buttons[2]).toHaveFocus();
    await user.click(buttons[1]!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    await expectNoA11yViolations();
  });
});
