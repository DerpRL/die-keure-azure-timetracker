import { describe, expect, it } from 'vitest';
import { mondaySessions } from '../../ipc/fixtures/slices/dayReview';
import { dayBounds, findOverlaps, formatDayTitle, formatWeekday, overlapLanes, shiftDay, ticketRows, visibleRange } from './model';

const span = (id: string, start: number, end: number) => ({ id, start, end });

describe('Today model', () => {
  it('finds every pair of entries that cover the same time', () => {
    expect(findOverlaps([span('a', 0, 10), span('b', 5, 15), span('c', 15, 20), span('d', 6, 7)])).toEqual([
      { first: 'a', second: 'b', start: 5, end: 10 },
      { first: 'a', second: 'd', start: 6, end: 7 },
      { first: 'b', second: 'd', start: 6, end: 7 },
    ]);
    expect(findOverlaps([span('a', 0, 10), span('b', 10, 20)])).toEqual([]);
  });

  it('puts overlapping spans side by side', () => {
    const lanes = overlapLanes([span('a', 0, 10), span('b', 5, 15), span('c', 20, 30)]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get('c')).toEqual({ lane: 0, lanes: 1 });
  });

  it('shows 08:00–18:00, widened to whole hours around the day’s times', () => {
    const { start } = dayBounds('2026-10-06');
    const hour = 3_600_000;
    expect(visibleRange('2026-10-06', [])).toEqual({ from: start + 8 * hour, to: start + 18 * hour });
    expect(visibleRange('2026-10-06', [start + 7.5 * hour, start + 19.25 * hour])).toEqual({ from: start + 7 * hour, to: start + 20 * hour });
    // Times on other days are ignored.
    expect(visibleRange('2026-10-06', [start - hour])).toEqual({ from: start + 8 * hour, to: start + 18 * hour });
  });

  it('groups a day’s sessions per ticket, most time first', () => {
    const rows = ticketRows(mondaySessions, undefined);
    expect(rows.map((row) => [row.ticketId, row.title, row.count, row.seconds, row.activity])).toEqual([
      [4821, 'Checkout: retry failed card payments', 2, 14_100, 'Development'],
      [4790, 'Invoice PDF shows the wrong VAT number', 1, 5_700, 'Development'],
      [4655, 'Design system: date picker tokens', 1, 3_000, 'Design'],
      [null, 'Reviewing pull requests', 1, 2_400, 'Code review'],
      [4777, 'Sprint ceremonies', 1, 900, 'Standup'],
    ]);
  });

  it('names days as the design does', () => {
    expect(formatDayTitle('2026-10-06')).toBe('Tuesday 6 October');
    expect(formatWeekday('2026-10-05')).toBe('Monday');
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
  });
});
