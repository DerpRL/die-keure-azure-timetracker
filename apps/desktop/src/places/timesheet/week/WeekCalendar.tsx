import type { CSSProperties } from 'react';
import { seriesColor } from '../../../charts/palette';
import { Badge } from '../../../components/Badge';
import { activityColorIndex, type ActivityColors } from '../../../features/activity';
import { dayToDate, formatClockTime } from '../../../features/ticketContext/format';
import { cx } from '../../../utils/cx';
import { formatShortDuration } from '../../../utils/duration';
import { LockIcon } from '../icons';
import { HOUR_MS, type WeekBlock, type WeekDay } from './weekModel';
import styles from './week.module.css';

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Below this a block shows one line; below `TINY_MS` it has no padding either. */
const SHORT_MS = 45 * 60_000;
const TINY_MS = 20 * 60_000;

function clock(time: number): string {
  return formatClockTime(new Date(time));
}

function weekdayLabel(day: WeekDay): string {
  const date = dayToDate(day.key);
  return `${date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()} ${date.getDate()}`;
}

function dayName(day: WeekDay): string {
  return dayToDate(day.key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** What a screen reader hears for a block: everything the block shows, and its flags. */
export function blockLabel(block: WeekBlock): string {
  const head = block.ticketId !== null ? `#${block.ticketId} ${block.title}` : block.title;
  const parts = [head];
  if (block.activityName) parts.push(block.activityName);
  parts.push(
    block.kind === 'running'
      ? `running since ${clock(block.start)}`
      : `${clock(block.start)} to ${clock(block.end)}, ${formatShortDuration((block.end - block.start) / 1000)}`,
  );
  if (block.kind === 'draft') parts.push('offline draft, not in 7pace yet');
  if (block.long) parts.push('long entry');
  if (block.overlap) parts.push('overlaps another entry');
  if (block.locked && block.kind === 'log') parts.push('locked by 7pace');
  return parts.join(', ');
}

function dayLabel(day: WeekDay): string {
  const parts = [dayName(day)];
  if (day.isToday) parts.push('today');
  parts.push(day.seconds > 0 ? formatShortDuration(day.seconds) : 'nothing tracked');
  if (day.gaps.length > 0) parts.push(plural(day.gaps.length, 'possible gap'));
  if (day.overlaps.length > 0) parts.push(plural(day.overlaps.length, 'overlap'));
  if (day.drafts.length > 0) parts.push(plural(day.drafts.length, 'offline draft'));
  return parts.join(', ');
}

interface Range {
  from: number;
  to: number;
}

function place(range: Range, start: number, end: number): Vars {
  const span = range.to - range.from;
  const top = Math.max(start, range.from);
  const bottom = Math.min(end, range.to);
  return {
    top: `${((top - range.from) / span) * 100}%`,
    height: `${(Math.max(bottom - top, 0) / span) * 100}%`,
  };
}

function BlockContent({ block }: { block: WeekBlock }) {
  const length = block.end - block.start;
  const ticket = block.ticketId !== null ? `#${block.ticketId}` : null;
  if (block.locked && block.kind === 'log') {
    return (
      <span className={styles.line}>
        <LockIcon className={styles.lock} />
        <span className={styles.ellipsis}>{`${ticket ?? block.title} · locked`}</span>
      </span>
    );
  }
  if (block.kind === 'running' && length < SHORT_MS) {
    return <b className={styles.ellipsis}>{`${ticket ?? block.title} · running`}</b>;
  }
  if (block.kind === 'draft') {
    return (
      <>
        <b className={styles.ellipsis}>{`Draft · ${ticket ?? block.title}`}</b>
        {length >= SHORT_MS ? <span className={styles.ellipsis}>{`${clock(block.start)} – ${clock(block.end)} · not in 7pace`}</span> : null}
      </>
    );
  }
  if (length < SHORT_MS) {
    return <span className={cx(styles.line, styles.ellipsis)}>{`${ticket ?? block.title} · ${formatShortDuration(length / 1000)}`}</span>;
  }
  return (
    <>
      <b className={styles.title}>{ticket ? `${ticket} ${block.title}` : block.title}</b>
      <span className={styles.ellipsis}>
        {block.kind === 'running'
          ? `Running since ${clock(block.start)}`
          : `${clock(block.start)} – ${clock(block.end)} · ${formatShortDuration(length / 1000)}`}
      </span>
      {block.long ? (
        <Badge tone="warning" className={styles.longChip}>
          Long entry
        </Badge>
      ) : null}
    </>
  );
}

export interface WeekCalendarProps {
  days: readonly WeekDay[];
  hours: { from: number; to: number };
  lanes: ReadonlyMap<string, { lane: number; lanes: number }>;
  colors: ActivityColors;
  selectedId: string | null;
  now: number;
  onSelect: (block: WeekBlock) => void;
  /** The legend's activities (those in the week). */
  legend: ReadonlyArray<{ id: string; name: string; colorIndex: number }>;
}

/**
 * The week as columns of blocks (2.2 "Timesheet · Week"): worklogs in their activity colour,
 * offline drafts dashed, the running timer, hatched gaps, outlined overlaps and the current time.
 * Every block is a button named with everything it shows; each day is a group named with its
 * totals and flags.
 */
export function WeekCalendar({ days, hours, lanes, colors, selectedId, now, onSelect, legend }: WeekCalendarProps) {
  const hourList: number[] = [];
  for (let hour = hours.from; hour < hours.to; hour++) hourList.push(hour);
  const grid: Vars = { '--days': days.length, '--hours': hourList.length };

  return (
    <section aria-label="Week calendar" className={styles.calendar}>
      <div className={styles.scroll}>
        <div className={styles.grid} style={grid}>
          <div className={styles.headRow} aria-hidden="true">
            <span />
            {days.map((day) => (
              <div key={day.key} className={cx(styles.dayHead, day.isToday && styles.todayHead)}>
                <span className={styles.dayLabel}>{day.isToday ? `${weekdayLabel(day)} · TODAY` : weekdayLabel(day)}</span>
                <span className={styles.dayTotal}>
                  {day.seconds > 0 ? formatShortDuration(day.seconds) : <span className={styles.muted}>–</span>}
                  {day.draftSeconds > 0 ? (
                    <Badge tone="accent" className={styles.draftChip}>
                      {`+${formatShortDuration(day.draftSeconds)} draft`}
                    </Badge>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.body}>
            <div className={styles.gutter} aria-hidden="true">
              {hourList.map((hour) => (
                <span key={hour}>{`${String(hour).padStart(2, '0')}:00`}</span>
              ))}
            </div>
            {days.map((day) => {
              const midnight = dayToDate(day.key).getTime();
              const range = { from: midnight + hours.from * HOUR_MS, to: midnight + hours.to * HOUR_MS };
              return (
                <div key={day.key} role="group" aria-label={dayLabel(day)} className={cx(styles.column, day.isToday && styles.todayColumn)}>
                  {day.gaps.map((gap) => (
                    <span key={`gap-${gap.start}`} className={styles.gap} style={place(range, gap.start, gap.end)} aria-hidden="true" />
                  ))}
                  {day.blocks
                    .filter((block) => block.end > range.from && block.start < range.to)
                    .map((block) => {
                      const lane = lanes.get(block.id) ?? { lane: 0, lanes: 1 };
                      const style: Vars = {
                        ...place(range, block.start, block.end),
                        '--activity-color': seriesColor(activityColorIndex(colors, block.activityId)),
                        '--lane': lane.lane,
                        '--lanes': lane.lanes,
                      };
                      const length = block.end - block.start;
                      return (
                        <button
                          key={`${block.kind}-${block.id}`}
                          type="button"
                          className={cx(
                            styles.block,
                            styles[block.kind],
                            length < SHORT_MS && styles.short,
                            length < TINY_MS && styles.tiny,
                            block.overlap && styles.overlap,
                            block.id === selectedId && styles.selected,
                          )}
                          style={style}
                          aria-label={blockLabel(block)}
                          aria-pressed={block.kind === 'draft' ? undefined : block.id === selectedId}
                          onClick={() => onSelect(block)}
                        >
                          <BlockContent block={block} />
                        </button>
                      );
                    })}
                  {day.isToday && now >= range.from && now <= range.to ? (
                    <span className={styles.nowLine} style={{ top: `${((now - range.from) / (range.to - range.from)) * 100}%` }} aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <ul role="list" aria-label="Legend" className={styles.legend}>
        {legend.map((entry) => (
          <li key={entry.id} className={styles.legendItem}>
            <span className={styles.swatch} style={{ '--activity-color': seriesColor(entry.colorIndex) } as Vars} aria-hidden="true" />
            {entry.name}
          </li>
        ))}
        <li className={styles.legendItem}>
          <span className={cx(styles.swatch, styles.draftSwatch)} aria-hidden="true" />
          Offline draft
        </li>
        <li className={styles.legendItem}>
          <span className={cx(styles.swatch, styles.overlapSwatch)} aria-hidden="true" />
          Overlap
        </li>
        <li className={styles.legendItem}>
          <span className={cx(styles.swatch, styles.gapSwatch)} aria-hidden="true" />
          Gap
        </li>
      </ul>
    </section>
  );
}
