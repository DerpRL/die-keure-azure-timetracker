/**
 * 7pace stores seconds but the app shows clock times to the minute (seconds truncated). An entry
 * that ends at 10:38:20 and the next one that starts at 10:38:10 both read 10:38, so they are back
 * to back on screen even though they share ten seconds. Overlap checks and side-by-side lanes
 * compare at that displayed minute, as the engine does (`att_core::time::spans_minute`): time
 * shared within one displayed minute is not an overlap, while a full minute or more always is.
 */

const MINUTE_MS = 60_000;

/** The displayed minute of an epoch-milliseconds time (seconds truncated, as clocks show it). */
export function displayedMinute(time: number): number {
  return Math.floor(time / MINUTE_MS);
}

/** Whether `[start, end)` still has length once both ends are truncated to the displayed minute. */
export function spansMinute(start: number, end: number): boolean {
  return displayedMinute(end) > displayedMinute(start);
}
