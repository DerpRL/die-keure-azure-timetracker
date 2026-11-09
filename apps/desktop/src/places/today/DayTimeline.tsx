import type { CSSProperties, ReactNode } from 'react';
import { seriesColor } from '../../charts/palette';
import type { AgendaEventView } from '../../ipc/contract';
import { cx } from '../../utils/cx';
import { HOUR_MS, formatTime, overlapLanes, visibleRange } from './model';
import { t } from '../../i18n';
import styles from './today.module.css';

/** Spans shorter than this get a one-line block. */
const SHORT_MS = 30 * 60_000;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export interface TimelineBlock {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  colorIndex: number;
  title: string;
  /** The second line: "09:15 – 12:40 · 3h 25m", "Running since 09:10". */
  detail: string;
  running?: boolean;
  /** Outlined in the warning colour (a long entry). */
  long?: boolean;
  /** Outlined in the danger colour (covers the same time as another entry). */
  overlap?: boolean;
  /**
   * The saved 7pace worklog behind the block, which opens when the block is pressed. Unset for
   * the running timer (not an entry yet). `editable: false` when 7pace locks the entry.
   */
  entry?: { id: string; editable: boolean };
}

export interface TimelineGap {
  start: number;
  end: number;
}

export interface DayTimelineProps {
  /** `YYYY-MM-DD`. */
  day: string;
  /**
   * The Calendar column: the day's events, or a notice in its place (calendar access). `null`
   * leaves the column out (no calendar on this computer, or Agenda hidden).
   */
  calendar: { events: readonly AgendaEventView[] } | { notice: ReactNode } | null;
  blocks: readonly TimelineBlock[];
  /** Hatched possible gaps in the Tracked column. */
  gaps?: readonly TimelineGap[];
  /** The current-time line (today only). */
  now?: number | null;
  /** Opens a block's entry (Timesheet · Day). Unset: the blocks are not interactive. */
  onOpenEntry?: (block: TimelineBlock) => void;
}

interface Range {
  from: number;
  to: number;
}

function position({ from, to }: Range, start: number, end: number): Vars {
  const span = to - from;
  const clippedStart = Math.max(start, from);
  const clippedEnd = Math.min(end, to);
  return {
    top: `${((clippedStart - from) / span) * 100}%`,
    height: `${(Math.max(clippedEnd - clippedStart, 0) / span) * 100}%`,
  };
}

function laneStyle(lane: { lane: number; lanes: number } | undefined): Vars {
  const count = Math.max(lane?.lanes ?? 1, 1);
  const index = lane?.lane ?? 0;
  return { left: `calc(${(index / count) * 100}% + 0.375rem)`, width: `calc(${100 / count}% - 0.75rem)` };
}

function EventItem({ event, range, lane }: { event: AgendaEventView; range: Range; lane: { lane: number; lanes: number } | undefined }) {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const short = end - start < SHORT_MS;
  const place = event.location?.trim();
  const times = `${formatTime(event.start)} – ${formatTime(event.end)}`;
  return (
    <li
      className={cx(styles.block, styles.event, short && styles.short, event.isNow && styles.eventNow)}
      style={{ ...position(range, start, end), ...laneStyle(lane) }}
      aria-current={event.isNow ? 'time' : undefined}
    >
      {short ? (
        <span className={styles.blockLine}>
          {`${formatTime(event.start)} ${event.title}`}
          <span className="visually-hidden">{` ${t('until {time}', { time: formatTime(event.end) })}`}</span>
        </span>
      ) : (
        <>
          <b className={styles.blockTitle}>{event.title}</b>
          <span className={styles.blockDetail}>{place ? `${times} · ${place}` : times}</span>
        </>
      )}
      {event.isNow ? <span className="visually-hidden">{`, ${t('happening now')}`}</span> : null}
    </li>
  );
}

function TrackedItem({
  block,
  range,
  lane,
  onOpen,
}: {
  block: TimelineBlock;
  range: Range;
  lane: { lane: number; lanes: number } | undefined;
  onOpen: ((block: TimelineBlock) => void) | undefined;
}) {
  const short = block.end - block.start < SHORT_MS;
  const style: Vars = { ...position(range, block.start, block.end), ...laneStyle(lane), '--activity-color': seriesColor(block.colorIndex) };
  const flags = [block.running ? t('running') : null, block.long ? t('long entry') : null, block.overlap ? t('overlaps another entry') : null].filter(Boolean);
  const content = (
    <>
      {short ? (
        <span className={styles.blockLine}>
          {block.title}
          <span className="visually-hidden">{`, ${block.detail}`}</span>
        </span>
      ) : (
        <>
          <b className={cx(styles.blockTitle, styles.clamp)}>{block.title}</b>
          <span className={styles.blockDetail}>{block.detail}</span>
        </>
      )}
      {flags.length > 0 ? <span className="visually-hidden">{`, ${flags.join(', ')}`}</span> : null}
    </>
  );
  // Saved entries open like a block in Timesheet · Week; the running timer has no entry yet.
  const open = onOpen && block.entry ? () => onOpen(block) : null;
  return (
    <li
      className={cx(
        styles.block,
        styles.tracked,
        short && styles.short,
        block.running && styles.running,
        block.long && styles.long,
        block.overlap && styles.overlap,
        open && styles.openable,
      )}
      style={style}
    >
      {open ? (
        <button
          type="button"
          className={cx(styles.blockButton, short && styles.short)}
          aria-label={[t('Open {title}', { title: block.title }), block.detail, ...flags].join(', ')}
          onClick={open}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
}

/**
 * The day on the clock (2.2 "Your day"): an hour gutter, the calendar's events and the tracked
 * time side by side, 64 px per hour. Both columns are lists, so every block is read with its
 * times; possible gaps are hatched and named. With `onOpenEntry`, a saved entry's block is a
 * button that opens it.
 */
export function DayTimeline({ day, calendar, blocks, gaps = [], now = null, onOpenEntry }: DayTimelineProps) {
  const events = calendar && 'events' in calendar ? calendar.events : [];
  const timed = events.filter((event) => !event.allDay);
  const allDay = events.filter((event) => event.allDay);
  const range = visibleRange(day, [
    ...timed.flatMap((event) => [Date.parse(event.start), Date.parse(event.end)]),
    ...blocks.flatMap((block) => [block.start, block.end]),
    ...(now !== null ? [now, now + HOUR_MS / 2] : []),
  ]);
  const shownEvents = timed.filter((event) => Date.parse(event.end) > range.from && Date.parse(event.start) < range.to);
  const eventLanes = overlapLanes(shownEvents.map((event) => ({ id: event.id, start: Date.parse(event.start), end: Date.parse(event.end) })));
  // In time order, so reading and tabbing follow the clock.
  const shownBlocks = blocks.filter((block) => block.end > range.from && block.start < range.to).sort((a, b) => a.start - b.start);
  const blockLanes = overlapLanes(shownBlocks);
  const hours: number[] = [];
  for (let time = range.from; time < range.to; time += HOUR_MS) hours.push(time);
  const withCalendar = calendar !== null;
  const grid = cx(styles.timelineGrid, !withCalendar && styles.timelineSingle);

  return (
    <div className={styles.timeline}>
      <div className={cx(grid, styles.timelineHead)} aria-hidden="true">
        <span />
        {withCalendar ? <span>{t('Calendar')}</span> : null}
        <span className={withCalendar ? styles.divider : undefined}>{t('Tracked')}</span>
      </div>
      {allDay.length > 0 ? (
        <div className={cx(grid, styles.allDay)}>
          <span className={styles.allDayLabel} aria-hidden="true">
            {t('All day')}
          </span>
          <ul role="list" aria-label={t('All-day events')} className={styles.allDayList}>
            {allDay.map((event) => (
              <li key={event.id} className={cx(styles.block, styles.event, styles.allDayBlock)}>
                <b className={styles.blockTitle}>{event.title}</b>
              </li>
            ))}
          </ul>
          <span className={styles.divider} />
        </div>
      ) : null}
      <div className={cx(grid, styles.timelineBody)} style={{ '--hours': hours.length } as Vars}>
        <div className={styles.gutter} aria-hidden="true">
          {hours.map((time) => (
            <span key={time}>{formatTime(time)}</span>
          ))}
        </div>
        {calendar && 'notice' in calendar ? (
          <div className={cx(styles.column, styles.noticeColumn)}>{calendar.notice}</div>
        ) : withCalendar ? (
          <ul role="list" aria-label={t('Calendar events')} className={styles.column}>
            {shownEvents.map((event) => (
              <EventItem key={event.id} event={event} range={range} lane={eventLanes.get(event.id)} />
            ))}
          </ul>
        ) : null}
        <ul role="list" aria-label={t('Tracked time')} className={cx(styles.column, withCalendar && styles.divider)}>
          {gaps.map((gap) => (
            <li key={`gap-${gap.start}`} className={styles.gap} style={position(range, gap.start, gap.end)}>
              <span className="visually-hidden">{t('Possible gap {start} – {end}', { start: formatTime(gap.start), end: formatTime(gap.end) })}</span>
            </li>
          ))}
          {shownBlocks.map((block) => (
            <TrackedItem key={block.id} block={block} range={range} lane={blockLanes.get(block.id)} onOpen={onOpenEntry} />
          ))}
        </ul>
        {now !== null && now >= range.from && now <= range.to ? (
          <span className={styles.nowLine} aria-hidden="true" style={{ top: `${((now - range.from) / (range.to - range.from)) * 100}%` }} />
        ) : null}
      </div>
    </div>
  );
}
