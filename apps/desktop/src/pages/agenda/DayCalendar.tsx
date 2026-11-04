import { useMemo, type CSSProperties } from 'react';
import type { CalendarDate } from '@internationalized/date';
import { seriesColor } from '../../charts/palette';
import { Card } from '../../components/Card';
import type { AgendaEventView } from '../../ipc/contract';
import { useNow } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { formatShortDuration } from '../../utils/duration';
import { stripWindow } from '../../features/activity';
import { HOUR_MS, dayBounds, formatTime, overlapLanes, safeColor } from './model';
import styles from './agenda.module.css';

/** A worklog in the "Tracked time" column. Epoch milliseconds. */
export interface TrackedBlock {
  id: string;
  start: number;
  end: number;
  colorIndex: number;
  title: string;
}

/** The running timer: it ends at "now". */
export interface RunningBlock {
  start: number;
  colorIndex: number;
  title: string;
}

/** Tracked time for the agenda day, when the slices have it (today's worklogs and the timer). */
export interface TrackedDay {
  blocks: readonly TrackedBlock[];
  running: RunningBlock | null;
}

/** Key of the running timer's block (worklog IDs are UUIDs). */
const RUNNING_ID = 'running-timer';

/** Spans shorter than this get the one-line block. */
const SHORT_MS = 30 * 60_000;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

interface Range {
  from: number;
  to: number;
}

function position({ from, to }: Range, start: number, end: number): { top: string; height: string } {
  const span = to - from;
  const clippedStart = Math.max(start, from);
  const clippedEnd = Math.min(end, to);
  return {
    top: `${((clippedStart - from) / span) * 100}%`,
    height: `${(Math.max(clippedEnd - clippedStart, 0) / span) * 100}%`,
  };
}

interface Lane {
  lane: number;
  lanes: number;
}

/** Side by side when blocks overlap. */
function laneStyle({ lane, lanes }: Lane): Vars {
  const count = Math.max(lanes, 1);
  return { left: `calc(${(lane / count) * 100}% + 0.375rem)`, width: `calc(${100 / count}% - 0.75rem)` };
}

const SINGLE: Lane = { lane: 0, lanes: 1 };

function EventBlock({ event, range, lane }: { event: AgendaEventView; range: Range; lane: Lane }) {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const color = safeColor(event.color);
  const short = end - start < SHORT_MS;
  const style: Vars = { ...position(range, start, end), ...laneStyle(lane) };
  if (color) style['--event-color'] = color;
  const place = event.location?.trim();
  return (
    <div className={cx(styles.block, styles.eventBlock, short && styles.short, event.isNow && styles.nowBlock)} style={style}>
      <b className={styles.blockTitle}>{event.title}</b>
      <span className={styles.blockDetail}>
        {short ? formatTime(event.start) : `${formatTime(event.start)} – ${formatTime(event.end)}${place ? ` · ${place}` : ''}`}
      </span>
      {event.isNow && !short ? <span className={styles.nowChip}>Now</span> : null}
    </div>
  );
}

function WorklogBlock({ block, range, lane, running }: { block: TrackedBlock; range: Range; lane: Lane; running: boolean }) {
  const short = block.end - block.start < SHORT_MS;
  const style: Vars = {
    ...position(range, block.start, block.end),
    ...laneStyle(lane),
    '--activity-color': seriesColor(block.colorIndex),
  };
  return (
    <div className={cx(styles.block, styles.trackedBlock, short && styles.short, running && styles.running)} style={style}>
      <b className={styles.blockTitle}>{block.title}</b>
      <span className={styles.blockDetail}>
        {running ? `Running since ${formatTime(new Date(block.start).toISOString())}` : formatShortDuration((block.end - block.start) / 1000)}
      </span>
    </div>
  );
}

function trackedLabel(tracked: TrackedDay): string {
  const count = tracked.blocks.length;
  const total = tracked.blocks.reduce((sum, block) => sum + (block.end - block.start) / 1000, 0);
  const parts = [count === 0 ? 'no worklogs yet' : `${count} ${count === 1 ? 'worklog' : 'worklogs'}, ${formatShortDuration(total)}`];
  if (tracked.running) parts.push(`timer running since ${formatTime(new Date(tracked.running.start).toISOString())}`);
  return `Tracked time: ${parts.join('; ')}`;
}

export interface DayCalendarProps {
  day: CalendarDate;
  events: readonly AgendaEventView[];
  /** `null` when the slices have no tracked time for this day: the calendar has one column. */
  tracked: TrackedDay | null;
  /** The agenda shows today: draw the current-time line. */
  isToday: boolean;
}

/**
 * The visible hours: 08:00–18:00, widened to whole hours around every event, worklog and (today)
 * the current time, within the day.
 */
function visibleRange(day: CalendarDate, events: readonly AgendaEventView[], tracked: TrackedDay | null, nowHour: number | null): Range {
  const { start, end } = dayBounds(day);
  const times = events.filter((event) => !event.allDay).flatMap((event) => [Date.parse(event.start), Date.parse(event.end)]);
  if (tracked) {
    times.push(...tracked.blocks.flatMap((block) => [block.start, block.end]));
    if (tracked.running) times.push(tracked.running.start);
  }
  if (nowHour !== null) times.push(nowHour, nowHour + HOUR_MS);
  const strip = stripWindow(
    new Date(start),
    times.filter((time) => time >= start && time <= end),
  );
  return { from: Math.max(strip.from, start), to: Math.min(strip.to, end) };
}

/**
 * The day as a vertical calendar: hour gutter, an all-day row, the events in their calendar
 * colours and, for today, the tracked time next to them. It repeats the "Events" list visually,
 * so the event column is hidden from assistive technology; the tracked column is one image with a
 * summary.
 */
export function DayCalendar({ day, events, tracked, isToday }: DayCalendarProps) {
  const now = useNow(isToday);
  const nowHour = isToday ? Math.floor(now / HOUR_MS) * HOUR_MS : null;
  const range = useMemo(() => visibleRange(day, events, tracked, nowHour), [day, events, tracked, nowHour]);
  const allDay = events.filter((event) => event.allDay);
  const timed = events.filter((event) => !event.allDay && Date.parse(event.end) > range.from && Date.parse(event.start) < range.to);
  const lanes = overlapLanes(timed.map((event) => ({ id: event.id, start: Date.parse(event.start), end: Date.parse(event.end) })));
  const worklogs: TrackedBlock[] = tracked
    ? [
        ...tracked.blocks,
        ...(tracked.running ? [{ id: RUNNING_ID, ...tracked.running, end: Math.max(now, tracked.running.start) }] : []),
      ].filter((block) => block.end > range.from && block.start < range.to)
    : [];
  const worklogLanes = overlapLanes(worklogs);
  const hours: number[] = [];
  for (let time = range.from; time < range.to; time += HOUR_MS) hours.push(time);
  const grid = cx(styles.calGrid, tracked && styles.calGridTracked);
  return (
    <Card padding="none" className={styles.calendar}>
      <div className={cx(grid, styles.calHead)} aria-hidden="true">
        <span />
        <span>Calendar events</span>
        {tracked ? <span className={styles.calDivider}>Tracked time</span> : null}
      </div>
      {allDay.length > 0 ? (
        <div className={cx(grid, styles.allDay)} aria-hidden="true">
          <span className={styles.allDayLabel}>All day</span>
          <div className={styles.allDayEvents}>
            {allDay.map((event) => {
              const color = safeColor(event.color);
              return (
                <div key={event.id} className={cx(styles.block, styles.eventBlock, styles.allDayBlock)} style={color ? ({ '--event-color': color } as Vars) : undefined}>
                  <b className={styles.blockTitle}>{event.title}</b>
                  {event.calendarTitle ? <span className={styles.blockDetail}>{event.calendarTitle}</span> : null}
                </div>
              );
            })}
          </div>
          {tracked ? <span className={styles.calDivider} /> : null}
        </div>
      ) : null}
      <div className={cx(grid, styles.calBody)} style={{ '--hours': hours.length } as Vars}>
        <div className={styles.gutter} aria-hidden="true">
          {hours.map((time) => (
            <span key={time}>{formatTime(new Date(time).toISOString())}</span>
          ))}
        </div>
        <div className={styles.column} aria-hidden="true">
          {timed.map((event) => (
            <EventBlock key={event.id} event={event} range={range} lane={lanes.get(event.id) ?? SINGLE} />
          ))}
        </div>
        {tracked ? (
          <div className={cx(styles.column, styles.calDivider)} role="img" aria-label={trackedLabel(tracked)}>
            {worklogs.map((block) => (
              <WorklogBlock
                key={block.id}
                block={block}
                range={range}
                lane={worklogLanes.get(block.id) ?? SINGLE}
                running={block.id === RUNNING_ID}
              />
            ))}
          </div>
        ) : null}
        {isToday && now >= range.from && now <= range.to ? (
          <span className={styles.nowLine} aria-hidden="true" style={{ top: `${((now - range.from) / (range.to - range.from)) * 100}%` }} />
        ) : null}
      </div>
    </Card>
  );
}
