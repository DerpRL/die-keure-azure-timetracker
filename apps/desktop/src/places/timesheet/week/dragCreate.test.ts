import { describe, expect, it } from 'vitest';
import { dragSpan, SNAP_MS, timeAt } from './dragCreate';

const HOUR = 3_600_000;
const day = Date.UTC(2026, 9, 5);
const range = { from: day + 8 * HOUR, to: day + 18 * HOUR };
const at = (hours: number) => day + hours * HOUR;
const later = at(30);

describe('drag to create', () => {
  it('maps a position in the column to a time inside it', () => {
    expect(timeAt(0, 1000, range)).toBe(range.from);
    expect(timeAt(500, 1000, range)).toBe(at(13));
    expect(timeAt(-20, 1000, range)).toBe(range.from);
    expect(timeAt(1200, 1000, range)).toBe(range.to);
    expect(timeAt(10, 0, range)).toBe(range.from);
  });

  it('covers whole quarter hours in either direction', () => {
    expect(dragSpan(at(9.1), at(10.3), range, later)).toEqual({ start: at(9), end: at(10.5) });
    expect(dragSpan(at(10.3), at(9.1), range, later)).toEqual({ start: at(9), end: at(10.5) });
    // Within one quarter hour: that quarter hour.
    expect(dragSpan(at(9.05), at(9.1), range, later)).toEqual({ start: at(9), end: at(9) + SNAP_MS });
  });

  it('stays inside the column and never reaches into the future', () => {
    expect(dragSpan(at(17.9), at(19), range, later)).toEqual({ start: at(17.75), end: at(18) });
    const now = at(11) + 7 * 60_000 + 30_000;
    expect(dragSpan(at(10), at(12), range, now)).toEqual({ start: at(10), end: at(11) + 7 * 60_000 });
    expect(dragSpan(at(11.5), at(12), range, now)).toBeNull();
  });
});
