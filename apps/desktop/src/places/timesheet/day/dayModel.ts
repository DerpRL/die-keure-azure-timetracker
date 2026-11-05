import type { TimeCorrectionIssue, WorkLog } from '../../../ipc/contract';
import { logEnd, logStart } from '../../../features/ticketContext/format';
import { displayedMinute, spansMinute } from '../../../utils/minutes';

/** Where two of the listed entries cover the same time. */
export interface EntryOverlap {
  start: number;
  end: number;
  earlierId: string;
  laterId: string;
}

interface Span {
  id: string;
  start: number;
  end: number;
}

function spans(logs: readonly WorkLog[]): Span[] {
  const result: Span[] = [];
  for (const log of logs) {
    const start = logStart(log)?.getTime();
    const end = logEnd(log)?.getTime();
    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    result.push({ id: log.id, start, end });
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Overlaps between the listed entries, earliest first. Derived from the loaded (filtered) logs
 * for display only; the engine still checks overlaps itself before every write. Like the engine,
 * entries compare at the displayed minute: back-to-back entries that share a few seconds of one
 * minute do not overlap.
 */
export function entryOverlaps(logs: readonly WorkLog[]): EntryOverlap[] {
  const sorted = spans(logs);
  const result: EntryOverlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const earlier = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const later = sorted[j]!;
      if (displayedMinute(later.start) >= displayedMinute(earlier.end)) break;
      const end = Math.min(earlier.end, later.end);
      if (!spansMinute(later.start, end)) continue;
      result.push({ start: later.start, end, earlierId: earlier.id, laterId: later.id });
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

/** Overlapping seconds per entry (the largest overlap it is part of). */
export function overlapSecondsById(overlaps: readonly EntryOverlap[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const overlap of overlaps) {
    const seconds = Math.round((overlap.end - overlap.start) / 1000);
    for (const id of [overlap.earlierId, overlap.laterId]) result.set(id, Math.max(result.get(id) ?? 0, seconds));
  }
  return result;
}

/** The gaps the engine found for Gaps & overlaps (only known once that check has run). */
export function correctionGaps(issues: readonly TimeCorrectionIssue[]): { start: number; end: number }[] {
  return issues
    .filter((issue) => issue.kind === 'gap')
    .map((issue) => ({
      start: Date.parse(issue.start),
      end: Date.parse(issue.end),
    }))
    .filter((gap) => Number.isFinite(gap.start) && Number.isFinite(gap.end) && gap.end > gap.start);
}
