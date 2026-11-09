import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { seriesColor } from '../../../charts/palette';
import { Badge } from '../../../components/Badge';
import { activityColorIndex, type ActivityColors } from '../../../features/activity';
import { dayToDate, formatClockTime } from '../../../features/ticketContext/format';
import { cx } from '../../../utils/cx';
import { formatShortDuration } from '../../../utils/duration';
import { dateFormat, t, tn } from '../../../i18n';
import { LockIcon } from '../icons';
import { DRAG_THRESHOLD_PX, dragSpan, timeAt, type TimeRange } from './dragCreate';
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
  return `${dateFormat({ weekday: 'short' }).format(date).toUpperCase()} ${date.getDate()}`;
}

function dayName(day: WeekDay): string {
  return dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(dayToDate(day.key));
}

/** What a screen reader hears for a block: everything the block shows, and its flags. */
export function blockLabel(block: WeekBlock): string {
  const head = block.ticketId !== null ? `#${block.ticketId} ${block.title}` : block.title;
  const parts = [head];
  if (block.activityName) parts.push(block.activityName);
  parts.push(
    block.kind === 'running'
      ? t('running since {time}', { time: clock(block.start) })
      : t('{start} to {end}, {duration}', { start: clock(block.start), end: clock(block.end), duration: formatShortDuration((block.end - block.start) / 1000) }),
  );
  if (block.kind === 'draft') parts.push(t('offline draft, not in 7pace yet'));
  if (block.long) parts.push(t('long entry'));
  if (block.overlap) parts.push(t('overlaps another entry'));
  if (block.locked && block.kind === 'log') parts.push(t('locked by 7pace'));
  return parts.join(', ');
}

function dayLabel(day: WeekDay): string {
  const parts = [dayName(day)];
  if (day.isToday) parts.push(t('today'));
  parts.push(day.seconds > 0 ? formatShortDuration(day.seconds) : t('nothing tracked'));
  if (day.gaps.length > 0) parts.push(tn(day.gaps.length, '{count} possible gap', '{count} possible gaps'));
  if (day.overlaps.length > 0) parts.push(tn(day.overlaps.length, '{count} overlap', '{count} overlaps'));
  if (day.drafts.length > 0) parts.push(tn(day.drafts.length, '{count} offline draft', '{count} offline drafts'));
  return parts.join(', ');
}

type Range = TimeRange;

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
        <span className={styles.ellipsis}>{t('{title} · locked', { title: ticket ?? block.title })}</span>
      </span>
    );
  }
  if (block.kind === 'running' && length < SHORT_MS) {
    return <b className={styles.ellipsis}>{t('{title} · running', { title: ticket ?? block.title })}</b>;
  }
  if (block.kind === 'draft') {
    return (
      <>
        <b className={styles.ellipsis}>{t('Draft · {title}', { title: ticket ?? block.title })}</b>
        {length >= SHORT_MS ? <span className={styles.ellipsis}>{t('{start} – {end} · not in 7pace', { start: clock(block.start), end: clock(block.end) })}</span> : null}
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
          ? t('Running since {time}', { time: clock(block.start) })
          : `${clock(block.start)} – ${clock(block.end)} · ${formatShortDuration(length / 1000)}`}
      </span>
      {block.long ? (
        <Badge tone="warning" className={styles.longChip}>
          {t('Long entry')}
        </Badge>
      ) : null}
    </>
  );
}

/** The shortest hour row (52 px at 100%), as before the calendar filled the window. */
const MIN_HOUR_REM = 3.25;
/** The page's bottom padding (`--space-10`), kept below the calendar. */
const BOTTOM_REM = 2.5;

/**
 * The hour height (in px) that lets the calendar reach the bottom of the window, never shorter
 * than 52 px: the hours stretch on a tall window and the page scrolls on a short one. Measured
 * from the calendar's place on the page, so banners above it are taken into account.
 */
function useFillHeight(hours: number) {
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const measure = () => {
      const calendar = ref.current;
      if (!calendar) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const top = calendar.getBoundingClientRect().top + window.scrollY;
      const fixed = ['[data-week-head]', '[data-week-legend]']
        .map((selector) => calendar.querySelector(selector)?.getBoundingClientRect().height ?? 0)
        .reduce((sum, value) => sum + value, 0);
      // 2 px: the card's top and bottom border.
      const available = window.innerHeight - top - fixed - BOTTOM_REM * rem - 2;
      const next = Math.max(MIN_HOUR_REM * rem, Math.floor(available / hours));
      setHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    window.addEventListener('resize', measure);
    // Banners, the header wrapping and the scale setting move the calendar.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [hours]);
  return { ref, height };
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
  /**
   * A span dragged across a day column (snapped to quarter hours, never in the future). Without
   * it, dragging does nothing.
   */
  onCreate?: (span: { start: number; end: number }) => void;
  /** A drag started on time that has not passed yet: 7pace takes no future time. */
  onFutureDrag?: () => void;
}

/** A drag in progress: the column, where it started (time and pixels) and where it is now. */
interface Drag {
  day: string;
  range: Range;
  anchor: number;
  anchorY: number;
  current: number;
  moved: boolean;
}

/**
 * The week as columns of blocks (2.2 "Timesheet · Week"): worklogs in their activity colour,
 * offline drafts dashed, the running timer, hatched gaps, outlined overlaps and the current time.
 * Every block is a button named with everything it shows; each day is a group named with its
 * totals and flags.
 */
export function WeekCalendar({ days, hours, lanes, colors, selectedId, now, onSelect, legend, onCreate, onFutureDrag }: WeekCalendarProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // Escape cancels a drag.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') update(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragging]);

  const pointerTime = (event: PointerEvent<HTMLDivElement>, range: Range) => {
    const box = event.currentTarget.getBoundingClientRect();
    return timeAt(event.clientY - box.top, box.height, range);
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>, day: string, range: Range) => {
    // Blocks keep their own click; only the empty column starts a drag.
    if (!onCreate || event.button !== 0 || (event.target as Element).closest('button')) return;
    const time = pointerTime(event, range);
    if (time >= now) {
      onFutureDrag?.();
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    update({ day, range, anchor: time, anchorY: event.clientY, current: time, moved: false });
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const moved = current.moved || Math.abs(event.clientY - current.anchorY) >= DRAG_THRESHOLD_PX;
    update({ ...current, current: pointerTime(event, current.range), moved });
  };
  const endDrag = () => {
    const current = dragRef.current;
    update(null);
    if (!current?.moved || !onCreate) return;
    const span = dragSpan(current.anchor, current.current, current.range, now);
    if (span) onCreate(span);
  };
  const ghost = drag?.moved ? dragSpan(drag.anchor, drag.current, drag.range, now) : null;

  const hourCount = Math.max(hours.to - hours.from, 1);
  const { ref: calendarRef, height: hourPx } = useFillHeight(hourCount);

  const hourList: number[] = [];
  for (let hour = hours.from; hour < hours.to; hour++) hourList.push(hour);
  const grid: Vars = { '--days': days.length, '--hours': hourList.length, ...(hourPx ? { '--hour-height': `${hourPx}px` } : {}) };

  return (
    <section ref={calendarRef} aria-label={t('Week calendar')} className={styles.calendar}>
      <div className={styles.scroll}>
        <div className={styles.grid} style={grid}>
          <div className={styles.headRow} aria-hidden="true" data-week-head="">
            <span />
            {days.map((day) => (
              <div key={day.key} className={cx(styles.dayHead, day.isToday && styles.todayHead)}>
                <span className={styles.dayLabel}>{day.isToday ? t('{day} · TODAY', { day: weekdayLabel(day) }) : weekdayLabel(day)}</span>
                <span className={styles.dayTotal}>
                  {day.seconds > 0 ? formatShortDuration(day.seconds) : <span className={styles.muted}>–</span>}
                  {day.draftSeconds > 0 ? (
                    <Badge tone="accent" className={styles.draftChip}>
                      {t('+{duration} draft', { duration: formatShortDuration(day.draftSeconds) })}
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
                <div
                  key={day.key}
                  role="group"
                  aria-label={dayLabel(day)}
                  className={cx(styles.column, day.isToday && styles.todayColumn, onCreate && styles.creatable)}
                  onPointerDown={(event) => startDrag(event, day.key, range)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={() => update(null)}
                >
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
                  {ghost && drag?.day === day.key ? (
                    <span className={styles.ghost} style={place(range, ghost.start, ghost.end)} aria-hidden="true">
                      <b>{`${clock(ghost.start)} – ${clock(ghost.end)}`}</b>
                      <span>{formatShortDuration((ghost.end - ghost.start) / 1000)}</span>
                    </span>
                  ) : null}
                  {day.isToday && now >= range.from && now <= range.to ? (
                    <span className={styles.nowLine} style={{ top: `${((now - range.from) / (range.to - range.from)) * 100}%` }} aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <ul role="list" aria-label={t('Legend')} className={styles.legend} data-week-legend="">
        {legend.map((entry) => (
          <li key={entry.id} className={styles.legendItem}>
            <span className={styles.swatch} style={{ '--activity-color': seriesColor(entry.colorIndex) } as Vars} aria-hidden="true" />
            {entry.name}
          </li>
        ))}
        <li className={styles.legendItem}>
          <span className={cx(styles.swatch, styles.draftSwatch)} aria-hidden="true" />
          {t('Offline draft')}
        </li>
        <li className={styles.legendItem}>
          <span className={cx(styles.swatch, styles.overlapSwatch)} aria-hidden="true" />
          {t('Overlap')}
        </li>
        <li className={styles.legendItem}>
          <span className={cx(styles.swatch, styles.gapSwatch)} aria-hidden="true" />
          {t('Gap')}
        </li>
      </ul>
    </section>
  );
}
