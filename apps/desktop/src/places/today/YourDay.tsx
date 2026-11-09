import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { seriesColor } from '../../charts/palette';
import { activityColorIndex, useActivityColors } from '../../features/activity';
import type { AgendaSlice, DayReviewSlice, WorkItemsSlice } from '../../ipc/contract';
import { useNavigation } from '../../layout/NavigationContext';
import { useAction, useNow, useSlice } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { formatShortDuration } from '../../utils/duration';
import { reviewOverlaps, useOpenDayInTimesheet, type LoadedReview } from './DayCheck';
import { DayTimeline, type TimelineBlock, type TimelineGap } from './DayTimeline';
import { capitalize, dayBounds, findOverlaps, formatTime, formatWeekday, sessionName, sessionSeconds } from './model';
import { t } from '../../i18n';
import styles from './today.module.css';

type Swatch = CSSProperties & Record<`--${string}`, string>;

interface LegendItem {
  id: string;
  label: string;
  /** A filled swatch colour (`var(--chart-n)`), or one of the marks: gap, overlap, long, event. */
  swatch: string;
}

function Legend({ items }: { items: readonly LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul role="list" aria-label={t('Legend')} className={styles.legend}>
      {items.map((item) => (
        <li key={item.id} className={styles.legendItem}>
          <span
            aria-hidden="true"
            className={cx(styles.legendSwatch, ['gap', 'overlap', 'long', 'event'].includes(item.swatch) && styles[`mark-${item.swatch}`])}
            style={['gap', 'overlap', 'long', 'event'].includes(item.swatch) ? undefined : ({ '--swatch': item.swatch } as Swatch)}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Calendar access isn't granted, is off or is restricted: say so in the Calendar column. */
function CalendarNotice({ agenda }: { agenda: AgendaSlice }) {
  const preview = useSlice('app')?.preview ?? false;
  const enable = useAction();
  const text =
    agenda.access === 'denied'
      ? t('Calendar access is off. Allow it in System Settings → Privacy & Security → Calendars.')
      : agenda.access === 'restricted'
        ? t('This Mac doesn’t allow apps to read calendars. Ask your administrator.')
        : t('See your meetings next to your time. Events are only read.');
  const label =
    agenda.access === 'denied' ? t('Check access again') : agenda.access === 'authorized' ? t('Connect calendar') : t('Allow calendar access');
  return (
    <div className={styles.calendarNotice}>
      <p className={styles.xs}>{text}</p>
      {agenda.access !== 'restricted' ? (
        <Button size="small" isDisabled={preview} isPending={enable.pending} onPress={() => void enable.run({ type: 'settings.enableCalendar' })}>
          {label}
        </Button>
      ) : null}
      {preview && agenda.access !== 'restricted' ? <p className={styles.xs}>{t('Preview mode: calendar access is turned off.')}</p> : null}
      {enable.error ? (
        <p role="alert" className={styles.xs}>
          {enable.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** The Calendar column for `day`, or `null` when this computer has no calendar (or Agenda is hidden). */
function useCalendarColumn(day: string): { column: Parameters<typeof DayTimeline>[0]['calendar']; ready: boolean } {
  const agenda = useSlice('agenda');
  const navigation = useNavigation();
  const visible = navigation?.isPageVisible('agenda') ?? true;
  if (!visible || !agenda || !agenda.supported || agenda.access === 'unsupported') return { column: null, ready: false };
  if (agenda.access !== 'authorized' || !agenda.enabled) return { column: { notice: <CalendarNotice agenda={agenda} /> }, ready: false };
  return { column: { events: agenda.day === day ? agenda.events : [] }, ready: true };
}

function CalendarFooter() {
  const navigation = useNavigation();
  const open = useAction();
  const target = { place: 'settings', view: 'calendars' } as const;
  return (
    <div className={styles.cardFoot}>
      <Button size="small" variant="plain" isPending={open.pending} onPress={() => void open.run({ type: 'agenda.openCalendar' })}>
        {t('Open Calendar')}
      </Button>
      {navigation?.canNavigate(target) ? (
        <Button size="small" variant="plain" onPress={() => navigation.navigate(target)}>
          {t('Choose calendars')}
        </Button>
      ) : null}
      {open.error ? (
        <p role="alert" className={styles.xs}>
          {open.error.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Opens a tracked block's entry in Timesheet · Day, in its edit sheet (as choosing it in
 * Timesheet · Week does); a locked entry opens its day. Unset when the Day view is hidden.
 */
function useOpenEntry(day: string): ((block: TimelineBlock) => void) | undefined {
  const openDay = useOpenDayInTimesheet();
  if (!openDay) return undefined;
  return (block) => {
    if (!block.entry) return;
    openDay(day, block.entry.editable ? { entry: block.entry.id } : {});
  };
}

function Frame({
  headingId,
  title,
  legend,
  children,
  footer,
  issue,
}: {
  headingId: string;
  title: string;
  legend: readonly LegendItem[];
  children: ReactNode;
  footer?: ReactNode;
  issue?: string | null;
}) {
  return (
    <Card as="section" padding="none" aria-labelledby={headingId} className={cx(styles.flush, styles.dayCard)}>
      <div className={styles.dayHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {title}
        </h2>
        <Legend items={legend} />
      </div>
      {issue ? (
        <div className={styles.dayIssue}>
          <Banner tone="warning" title={t('The calendar could not be read')} live="off">
            {issue}
          </Banner>
        </div>
      ) : null}
      {children}
      {footer}
    </Card>
  );
}

/**
 * "Your day" (2.2 Today): today's calendar events next to the tracked time from today's
 * worklogs and the running timer, with possible gaps from the day review and the current time.
 */
export function YourDayToday({ today, review }: { today: string; review: DayReviewSlice | undefined }) {
  const headingId = useId();
  const history = useSlice('history');
  const tracking = useSlice('tracking');
  const workItems = useSlice('workItems');
  const agenda = useSlice('agenda');
  const colors = useActivityColors();
  const now = useNow();
  const { column, ready } = useCalendarColumn(today);
  const openEntry = useOpenEntry(today);

  const { blocks, legend } = useMemo(() => {
    const { start: dayStart, end: dayEnd } = dayBounds(today);
    const longSeconds = (review?.longEntryMinutes ?? 0) * 60;
    const titleOf = (ticketId: number | null | undefined, fallback: string | null | undefined) => {
      const title = ticketId != null ? workItems?.[String(ticketId)]?.title : undefined;
      if (ticketId != null) return title ? `#${ticketId} ${title}` : `#${ticketId}`;
      return fallback?.trim() || t('Unassigned time');
    };
    const result: TimelineBlock[] = [];
    const activities = new Map<string, LegendItem>();
    for (const log of history?.todayLogs ?? []) {
      const start = Date.parse(log.timestamp);
      if (Number.isNaN(start) || start < dayStart || start >= dayEnd) continue;
      const seconds = Math.max(log.length, 0);
      const colorIndex = activityColorIndex(colors, log.activityType?.id);
      result.push({
        id: log.id,
        start,
        end: start + seconds * 1000,
        colorIndex,
        title: titleOf(log.workItemId, log.comment),
        detail: `${formatTime(start)} – ${formatTime(start + seconds * 1000)} · ${formatShortDuration(seconds)}`,
        long: longSeconds > 0 && seconds >= longSeconds,
        entry: { id: log.id, editable: log.isCanEdit !== false },
      });
      const name = log.activityType?.name;
      if (name && !activities.has(name)) activities.set(name, { id: name, label: name, swatch: seriesColor(colorIndex) });
    }
    const confirmed = tracking?.running && tracking.confirmedAt ? Date.parse(tracking.confirmedAt) : Number.NaN;
    if (tracking && !Number.isNaN(confirmed)) {
      const start = confirmed - tracking.elapsedBase * 1000;
      const colorIndex = activityColorIndex(colors, tracking.activityId);
      result.push({
        id: 'running-timer',
        start,
        end: Math.max(now, start),
        colorIndex,
        title: tracking.ticketId != null ? `#${tracking.ticketId} ${tracking.title}` : tracking.title,
        detail: t('Running since {time}', { time: formatTime(start) }),
        running: true,
      });
      if (tracking.activityName && !activities.has(tracking.activityName)) {
        activities.set(tracking.activityName, { id: tracking.activityName, label: tracking.activityName, swatch: seriesColor(colorIndex) });
      }
    }
    // Only saved worklogs can overlap (the engine's notion, as in the Day check): the running
    // timer's start is not an entry yet.
    const saved = result.filter((block) => !block.running);
    const overlapping = new Set(findOverlaps(saved).flatMap((overlap) => [overlap.first, overlap.second]));
    return {
      blocks: result.map((block) => (overlapping.has(block.id) ? { ...block, overlap: true } : block)),
      legend: [...activities.values()],
    };
  }, [today, history?.todayLogs, tracking, workItems, colors, now, review?.longEntryMinutes]);

  const gaps: TimelineGap[] =
    review?.selectedDay === today && review.summary && !review.summary.gapsUnavailable
      ? review.summary.gaps.map((gap) => ({ start: Date.parse(gap.start), end: Date.parse(gap.end) }))
      : [];
  const fullLegend: LegendItem[] = [
    ...legend,
    ...(ready ? [{ id: 'event', label: t('Calendar event'), swatch: 'event' as const }] : []),
    ...(gaps.length > 0 ? [{ id: 'gap', label: t('Possible gap'), swatch: 'gap' as const }] : []),
    ...(blocks.some((block) => block.overlap) ? [{ id: 'overlap', label: t('Overlap'), swatch: 'overlap' as const }] : []),
  ];

  return (
    <Frame
      headingId={headingId}
      title={t('Your day')}
      legend={fullLegend}
      issue={column && agenda?.issue ? agenda.issue : null}
      footer={ready ? <CalendarFooter /> : null}
    >
      <DayTimeline day={today} calendar={column} blocks={blocks} gaps={gaps} now={now} onOpenEntry={openEntry} />
      {history && !history.loaded && !history.loading ? <p className={cx(styles.caption, styles.dayNote)}>{t('Connect 7pace to see today’s worklogs.')}</p> : null}
    </Frame>
  );
}

/** "Monday on the clock" (2.2 "Today — reviewing Monday"): the reviewed day's worklogs with the review's marks. */
export function YourDayReview({
  review,
  items,
  colorOf,
}: {
  review: LoadedReview;
  items: WorkItemsSlice | undefined;
  colorOf: (activity: string) => number;
}) {
  const headingId = useId();
  const agenda = useSlice('agenda');
  const day = review.selectedDay;
  const { column, ready } = useCalendarColumn(day);
  const openEntry = useOpenEntry(day);
  const overlaps = reviewOverlaps(review);
  const overlapping = new Set(overlaps.flatMap((overlap) => [overlap.first, overlap.second]));
  const blocks: TimelineBlock[] = review.summary.sessions.flatMap((session) => {
    const start = Date.parse(session.start);
    const end = Date.parse(session.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return [];
    return [
      {
        id: session.id,
        start,
        end,
        colorIndex: colorOf(session.activity),
        title: sessionName(session, items),
        detail: `${formatTime(start)} – ${formatTime(end)} · ${formatShortDuration(sessionSeconds(session))}`,
        running: session.isRunning,
        long: session.isLong,
        overlap: overlapping.has(session.id),
        // A saved session is its worklog (the engine's id); the running one isn't saved yet.
        entry: session.isRunning ? undefined : { id: session.id, editable: true },
      },
    ];
  });
  const gaps: TimelineGap[] = review.summary.gapsUnavailable
    ? []
    : review.summary.gaps.map((gap) => ({ start: Date.parse(gap.start), end: Date.parse(gap.end) }));
  const legend: LegendItem[] = [
    { id: 'gap', label: t('Possible gap'), swatch: 'gap' },
    { id: 'overlap', label: t('Overlap'), swatch: 'overlap' },
    { id: 'long', label: t('Long entry'), swatch: 'long' },
  ];
  return (
    <Frame
      headingId={headingId}
      title={capitalize(t('{weekday} on the clock', { weekday: formatWeekday(day) }))}
      legend={legend}
      issue={column && agenda?.issue ? agenda.issue : null}
      footer={ready ? <CalendarFooter /> : null}
    >
      <DayTimeline day={day} calendar={column} blocks={blocks} gaps={gaps} onOpenEntry={openEntry} />
      {blocks.length === 0 ? <p className={cx(styles.caption, styles.dayNote)}>{t('No entries recorded for this day.')}</p> : null}
    </Frame>
  );
}

/** A past day without the day review (hidden by the user): the calendar only. */
export function YourDayCalendarOnly({ day }: { day: string }) {
  const headingId = useId();
  const agenda = useSlice('agenda');
  const { column, ready } = useCalendarColumn(day);
  return (
    <Frame headingId={headingId} title={capitalize(formatWeekday(day))} legend={[]} issue={column && agenda?.issue ? agenda.issue : null} footer={ready ? <CalendarFooter /> : null}>
      <DayTimeline day={day} calendar={column} blocks={[]} />
    </Frame>
  );
}
