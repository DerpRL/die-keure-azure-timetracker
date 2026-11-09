/**
 * Drag to create on the week calendar: where a drag in a day column starts and ends, snapped to
 * quarter hours, and the span it proposes for a new entry.
 */

/** New entries snap to quarter hours. */
export const SNAP_MS = 15 * 60_000;

/** A drag shorter than this (in pixels) is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;

export interface TimeRange {
  from: number;
  to: number;
}

/** The time at `offsetY` pixels down a column of `height` pixels showing `range`. */
export function timeAt(offsetY: number, height: number, range: TimeRange): number {
  const ratio = height > 0 ? Math.min(Math.max(offsetY / height, 0), 1) : 0;
  return range.from + ratio * (range.to - range.from);
}

/**
 * The span a drag between `a` and `b` covers: from the quarter hour the earlier point is in to
 * the end of the quarter hour the later point is in, inside the column, and ending no later than
 * `now` (to the minute), since 7pace refuses future time. `null` when nothing is left.
 */
export function dragSpan(a: number, b: number, range: TimeRange, now: number): { start: number; end: number } | null {
  const start = Math.max(Math.floor(Math.min(a, b) / SNAP_MS) * SNAP_MS, range.from);
  let end = Math.min(Math.ceil(Math.max(a, b) / SNAP_MS) * SNAP_MS, range.to);
  if (end === start) end = Math.min(start + SNAP_MS, range.to);
  end = Math.min(end, Math.floor(now / 60_000) * 60_000);
  return end > start ? { start, end } : null;
}
