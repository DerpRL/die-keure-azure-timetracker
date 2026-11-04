import type { CSSProperties } from 'react';
import { seriesColor } from '../../charts/palette';
import { cx } from '../../utils/cx';
import styles from './activity.module.css';

export interface DayStripBlock {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  colorIndex: number;
  /** Short text inside the block when it is wide enough, e.g. "#4821". */
  label?: string;
  /** The running entry: dashed outline. */
  running?: boolean;
  /** Needs a look (long entry): amber outline. */
  flagged?: boolean;
}

export interface DayStripGap {
  start: number;
  end: number;
}

export interface DayStripProps {
  /** Visible window, epoch milliseconds. */
  from: number;
  to: number;
  blocks: readonly DayStripBlock[];
  /** Possible gaps, drawn hatched. */
  gaps?: readonly DayStripGap[];
  /** Current time marker, when inside the window. */
  now?: number | null;
  /** The whole strip is one image for assistive technology: describe what it shows. */
  label: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

const HOUR = 3_600_000;

function hourLabel(time: number): string {
  return new Date(time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** At most this many hour labels, so they never run into each other. */
const MAX_TICKS = 7;

/** Hour ticks on whole hours: every 1, 2, 3, 4 or 6 hours, whichever keeps them to `MAX_TICKS`. */
export function stripTicks(from: number, to: number): number[] {
  const span = Math.max(to - from, 0);
  const step = ([1, 2, 3, 4, 6].find((hours) => span / (hours * HOUR) < MAX_TICKS) ?? 6) * HOUR;
  // Align to local whole hours that are a multiple of the step (08:00, 10:00, … not 09:00, 11:00).
  const start = new Date(from);
  start.setMinutes(0, 0, 0);
  if (start.getTime() < from) start.setHours(start.getHours() + 1);
  const stepHours = step / HOUR;
  while (start.getHours() % stepHours !== 0) start.setHours(start.getHours() + 1);
  const result: number[] = [];
  for (let time = start.getTime(); time <= to && result.length <= MAX_TICKS; time += step) result.push(time);
  return result;
}

/**
 * Lanes for overlapping blocks: a block that starts before the previous one ends drops to the
 * second lane, so overlaps stay visible instead of hiding each other.
 */
function lanes(blocks: readonly DayStripBlock[]): Map<string, 0 | 1 | 2> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const result = new Map<string, 0 | 1 | 2>();
  let lastEnd = -Infinity;
  let lastId: string | null = null;
  for (const block of sorted) {
    if (block.start < lastEnd && lastId) {
      result.set(lastId, 1);
      result.set(block.id, 2);
    } else {
      result.set(block.id, 0);
    }
    if (block.end > lastEnd) {
      lastEnd = block.end;
      lastId = block.id;
    }
  }
  return result;
}

/**
 * One day (or part of it) as a horizontal strip of worklog blocks in their activity colours, with
 * hatched gaps and a "now" marker: the Calendar Blocks look from the 2.0 redesign.
 */
export function DayStrip({ from, to, blocks, gaps = [], now, label, size = 'medium', className }: DayStripProps) {
  const span = Math.max(to - from, 1);
  const pct = (time: number) => `${(Math.min(Math.max(time - from, 0), span) / span) * 100}%`;
  const width = (start: number, end: number) => `${(Math.max(Math.min(end, to) - Math.max(start, from), 0) / span) * 100}%`;
  const laneOf = lanes(blocks);
  const visible = blocks.filter((block) => block.end > from && block.start < to);
  return (
    <div className={cx(styles.strip, styles[`strip-${size}`], className)}>
      <div className={styles.track} role="img" aria-label={label}>
        {gaps
          .filter((gap) => gap.end > from && gap.start < to)
          .map((gap) => (
            <span key={`gap-${gap.start}`} className={styles.gap} style={{ left: pct(gap.start), width: width(gap.start, gap.end) }} />
          ))}
        {visible.map((block) => {
          const lane = laneOf.get(block.id) ?? 0;
          const style: CSSProperties & { '--activity-color': string } = {
            left: pct(block.start),
            width: width(block.start, block.end),
            '--activity-color': seriesColor(block.colorIndex),
          };
          return (
            <span
              key={block.id}
              className={cx(
                styles.block,
                lane === 1 && styles.laneTop,
                lane === 2 && styles.laneBottom,
                block.running && styles.running,
                block.flagged && styles.flagged,
              )}
              style={style}
            >
              {block.label ? <span className={styles.blockLabel}>{block.label}</span> : null}
            </span>
          );
        })}
        {now != null && now >= from && now <= to ? <span className={styles.now} style={{ left: pct(now) }} /> : null}
      </div>
      <div className={styles.ticks} aria-hidden="true">
        {stripTicks(from, to).map((time) => (
          <span key={time} className={styles.tick} style={{ left: pct(time) }}>
            {hourLabel(time)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The window a day strip shows: from the earlier of `startHour` and the first block (rounded down
 * to the hour) to the later of `endHour` and the last block or now (rounded up), never outside
 * `day` itself. A timer that started days ago (or entries crossing midnight) only stretch the
 * window to the day's edge, so the strip always shows one day at hour scale.
 */
export function stripWindow(
  day: Date,
  times: readonly number[],
  { startHour = 8, endHour = 18, minHours = 0 }: { startHour?: number; endHour?: number; minHours?: number } = {},
): { from: number; to: number } {
  const base = new Date(day);
  base.setHours(0, 0, 0, 0);
  const dayStart = base.getTime();
  const next = new Date(base);
  next.setDate(next.getDate() + 1);
  const dayEnd = next.getTime();
  let from = dayStart + startHour * HOUR;
  let to = dayStart + endHour * HOUR;
  for (const time of times) {
    if (!Number.isFinite(time)) continue;
    const clamped = Math.min(Math.max(time, dayStart), dayEnd);
    from = Math.min(from, Math.floor(clamped / HOUR) * HOUR);
    to = Math.max(to, Math.ceil(clamped / HOUR) * HOUR);
  }
  from = Math.max(from, dayStart);
  to = Math.min(to, dayEnd);
  if (to - from < minHours * HOUR) {
    to = Math.min(from + minHours * HOUR, dayEnd);
    from = Math.max(dayStart, to - minHours * HOUR);
  }
  return { from, to };
}
