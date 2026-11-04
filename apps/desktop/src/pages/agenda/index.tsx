import { useId, useMemo, useState } from 'react';
import type { CalendarDate } from '@internationalized/date';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { PageHeaderActions } from '../../features/app/PageHeaderActions';
import { AgendaIcon, ChevronLeftIcon, ChevronRightIcon, SettingsIcon } from '../../components/icons';
import type { AgendaEventView, AgendaSlice } from '../../ipc/contract';
import { showMain } from '../../ipc/shell';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useSlice, type Action } from '../../state/hooks';
import { activityColorIndex, useActivityColors } from '../../features/activity';
import { cx } from '../../utils/cx';
import { DayCalendar, type RunningBlock, type TrackedBlock, type TrackedDay } from './DayCalendar';
import { dayBounds, formatDay, formatTime, parseDay, safeColor, todayDate } from './model';
import styles from './agenda.module.css';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Access not granted, denied or the integration is off: explain and offer the next step. In
 * preview mode the engine never asks for access, so the button is disabled with a reason.
 */
function AccessCard({ agenda, preview }: { agenda: AgendaSlice; preview: boolean }) {
  const enable = useAction();
  const hintId = useId();
  const button = (label: string) => (
    <Button
      variant="primary"
      isPending={enable.pending}
      isDisabled={preview}
      aria-describedby={preview ? hintId : undefined}
      onPress={() => void enable.run({ type: 'settings.enableCalendar' })}
    >
      {label}
    </Button>
  );
  let content;
  switch (agenda.access) {
    case 'denied':
      content = (
        <EmptyState
          icon={AgendaIcon}
          headingLevel={2}
          title="Calendar access is off"
          description="Azure timetracker may not read your calendars. Allow it in System Settings → Privacy & Security → Calendars, then return here."
          action={button('Check access again')}
        />
      );
      break;
    case 'restricted':
      content = (
        <EmptyState
          icon={AgendaIcon}
          headingLevel={2}
          title="Calendar access is restricted"
          description="This Mac does not allow apps to read calendars, for example because of a management profile. Ask your administrator."
        />
      );
      break;
    default:
      content = (
        <EmptyState
          icon={AgendaIcon}
          headingLevel={2}
          title="Bring your day into view"
          description="Connect Apple Calendar to see your Exchange, iCloud, Google, and other calendars already added to macOS. Your events are only read."
          action={button(agenda.access === 'authorized' ? 'Connect calendar' : 'Allow calendar access')}
        />
      );
  }
  return (
    <Card>
      {content}
      {preview && agenda.access !== 'restricted' ? (
        <p id={hintId} className={styles.text}>
          Preview mode: calendar access is turned off.
        </p>
      ) : null}
      {enable.error ? (
        <p role="alert" className={styles.error}>
          {enable.error.message}
        </p>
      ) : null}
    </Card>
  );
}

function EventRow({ event }: { event: AgendaEventView }) {
  const color = safeColor(event.color);
  const place = [event.calendarTitle, event.location?.trim() || null].filter(Boolean).join(' · ');
  return (
    <li className={event.isNow ? `${styles.event} ${styles.current}` : styles.event} aria-current={event.isNow ? 'time' : undefined}>
      <span aria-hidden="true" className={styles.bar} style={color ? { background: color } : undefined} />
      <div className={styles.eventBody}>
        <p className={styles.time}>
          {event.allDay ? (
            'All day'
          ) : (
            <span className={styles.mono}>
              <time dateTime={event.start}>{formatTime(event.start)}</time>
              {' – '}
              <time dateTime={event.end}>{formatTime(event.end)}</time>
            </span>
          )}
          {event.isNow ? (
            <Badge tone="accent" accessibleLabel="Happening now" className={styles.nowBadge}>
              Now
            </Badge>
          ) : null}
        </p>
        <h3 className={styles.title}>{event.title}</h3>
        {place ? <p className={styles.meta}>{place}</p> : null}
      </div>
    </li>
  );
}

/** Which calendars appear, with a link to the selection in Settings. */
function CalendarsCard({ agenda }: { agenda: AgendaSlice }) {
  const [openError, setOpenError] = useState<string | null>(null);
  const headingId = useId();
  const selected = agenda.calendars.filter((calendar) => calendar.selected);
  const shown = selected.length > 0 ? selected : agenda.calendars;
  return (
    <Card as="section" aria-labelledby={headingId} className={styles.calendars}>
      <h2 id={headingId} className={styles.cardTitle}>
        {selected.length > 0 ? 'Calendars' : 'All calendars'}
      </h2>
      {shown.length > 0 ? (
        <ul role="list" aria-label="Calendars shown" className={styles.calendarList}>
          {shown.map((calendar) => {
            const color = safeColor(calendar.color);
            return (
              <li key={calendar.id}>
                <span aria-hidden="true" className={styles.swatch} style={color ? { background: color } : undefined} />
                {calendar.source ? `${calendar.title} · ${calendar.source}` : calendar.title}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div>
        <Button
          size="small"
          variant="plain"
          icon={SettingsIcon}
          onPress={() => {
            setOpenError(null);
            showMain('settings').catch((error: unknown) => setOpenError(messageOf(error)));
          }}
        >
          Choose calendars in Settings
        </Button>
      </div>
      {openError ? (
        <p role="alert" className={styles.error}>
          {openError}
        </p>
      ) : null}
      <p className={styles.text}>
        Missing a calendar? Add its account in macOS System Settings → Internet Accounts and enable Calendars.
      </p>
    </Card>
  );
}

/**
 * Today's tracked time from the slices the app already keeps: `history.todayLogs` (completed
 * worklogs) and the running timer. Other days have no tracked time in any slice, so `null`.
 */
function useTrackedDay(day: CalendarDate, isToday: boolean): TrackedDay | null {
  const history = useSlice('history');
  const tracking = useSlice('tracking');
  const workItems = useSlice('workItems');
  const colors = useActivityColors();
  return useMemo(() => {
    if (!isToday || !history?.loaded) return null;
    const { start: dayStart, end: dayEnd } = dayBounds(day);
    const titleOf = (ticketId: number | null | undefined, fallback: string | null | undefined) => {
      const title = ticketId != null ? workItems?.[String(ticketId)]?.title : undefined;
      if (ticketId != null) return title ? `#${ticketId} ${title}` : `#${ticketId}`;
      return fallback?.trim() || 'Unassigned time';
    };
    const blocks: TrackedBlock[] = [];
    for (const log of history.todayLogs) {
      const start = Date.parse(log.timestamp);
      if (Number.isNaN(start) || start < dayStart || start >= dayEnd) continue;
      blocks.push({
        id: log.id,
        start,
        end: start + Math.max(log.length, 0) * 1000,
        colorIndex: activityColorIndex(colors, log.activityType?.id),
        title: titleOf(log.workItemId, log.comment),
      });
    }
    let running: RunningBlock | null = null;
    const confirmed = tracking?.running && tracking.confirmedAt ? Date.parse(tracking.confirmedAt) : Number.NaN;
    if (tracking && !Number.isNaN(confirmed)) {
      running = {
        start: confirmed - tracking.elapsedBase * 1000,
        colorIndex: activityColorIndex(colors, tracking.activityId),
        title: tracking.ticketId != null ? `#${tracking.ticketId} ${tracking.title}` : tracking.title,
      };
    }
    return { blocks, running };
  }, [day, isToday, history, tracking, workItems, colors]);
}

function DayAgenda({ agenda, setDay, day }: { agenda: AgendaSlice; setDay: Action; day: CalendarDate }) {
  const listHeadingId = useId();
  const go = (next: CalendarDate) => void setDay.run({ type: 'agenda.setDay', day: next.toString() });
  const current = todayDate();
  const isToday = day.compare(current) === 0;
  const count = agenda.events.length;
  const tracked = useTrackedDay(day, isToday);
  return (
    <>
      <div role="group" aria-label="Day" className={styles.nav}>
        <div className={styles.navStart}>
          <IconButton label="Previous day" icon={ChevronLeftIcon} variant="secondary" onPress={() => go(day.subtract({ days: 1 }))} />
          <IconButton label="Next day" icon={ChevronRightIcon} variant="secondary" onPress={() => go(day.add({ days: 1 }))} />
          <h2 className={styles.dayHeading}>
            {formatDay(day)}
            {isToday ? <Badge tone="accent">Today</Badge> : null}
          </h2>
        </div>
        <div className={styles.navEnd}>
          <span className={styles.count} aria-live="polite">
            {count} {count === 1 ? 'event' : 'events'}
          </span>
          <DatePicker
            label="Day"
            hideLabel
            value={day}
            onChange={(value) => {
              if (value && value.compare(day) !== 0) go(value);
            }}
          />
          <Button isDisabled={isToday} onPress={() => go(current)}>
            Today
          </Button>
        </div>
      </div>
      {setDay.error ? (
        <p role="alert" className={styles.error}>
          {setDay.error.message}
        </p>
      ) : null}
      <div className={styles.layout}>
        <DayCalendar day={day} events={agenda.events} tracked={tracked} isToday={isToday} />
        <div className={styles.aside}>
          <Card as="section" padding="none" aria-labelledby={listHeadingId}>
            <h2 id={listHeadingId} className={cx(styles.cardTitle, styles.listHeading)}>
              {isToday ? 'Events today' : 'Events'}
            </h2>
            {count === 0 ? (
              <div className={styles.listEmpty}>
                <EmptyState title="An open day" description="No events in your selected calendars." size="compact" />
              </div>
            ) : (
              <ol role="list" aria-label={`Events on ${formatDay(day)}`} className={styles.events}>
                {agenda.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ol>
            )}
          </Card>
          <CalendarsCard agenda={agenda} />
        </div>
      </div>
    </>
  );
}

/** Agenda page (1.14 `AgendaView`), macOS only: the events of one day from the selected calendars. */
export default function AgendaPage() {
  const agenda = useSlice('agenda');
  const preview = useSlice('app')?.preview ?? false;
  const setDay = useAction();
  const openCalendar = useAction();
  const day = agenda ? parseDay(agenda.day) : null;
  const ready = !!agenda && agenda.supported && agenda.access === 'authorized' && agenda.enabled && !!day;

  useCommands(
    ready && day
      ? [
          {
            id: 'agenda.previousDay',
            label: 'Agenda: previous day',
            group: 'Actions',
            onAction: () => void setDay.run({ type: 'agenda.setDay', day: day.subtract({ days: 1 }).toString() }),
          },
          {
            id: 'agenda.nextDay',
            label: 'Agenda: next day',
            group: 'Actions',
            onAction: () => void setDay.run({ type: 'agenda.setDay', day: day.add({ days: 1 }).toString() }),
          },
          {
            id: 'agenda.today',
            label: 'Agenda: today',
            group: 'Actions',
            onAction: () => void setDay.run({ type: 'agenda.setDay', day: todayDate().toString() }),
          },
        ]
      : [],
  );

  if (!agenda) {
    return (
      <LoadingRegion label="Loading agenda" isLoading placeholder={<Skeleton lines={6} />}>
        {null}
      </LoadingRegion>
    );
  }

  const calendarApp = agenda.supported && agenda.access !== 'unsupported';

  return (
    <div className={styles.page}>
      {calendarApp ? (
        <PageHeaderActions>
          <Button onPress={() => void openCalendar.run({ type: 'agenda.openCalendar' })} isPending={openCalendar.pending}>
            Open Calendar
          </Button>
        </PageHeaderActions>
      ) : null}
      <p className={styles.intro}>Events from the calendars connected to this Mac.</p>
      {openCalendar.error ? (
        <Banner tone="error" onDismiss={openCalendar.clearError} dismissLabel="Dismiss error">
          {openCalendar.error.message}
        </Banner>
      ) : null}
      {agenda.issue ? (
        <Banner tone="warning" title="The calendar could not be read" live="off">
          {agenda.issue}
        </Banner>
      ) : null}
      {!agenda.supported || agenda.access === 'unsupported' ? (
        <Card>
          <EmptyState
            icon={AgendaIcon}
            headingLevel={2}
            title="Agenda is not available on this computer"
            description="Calendar meetings use the calendars connected to macOS. Windows has no calendar source yet."
          />
        </Card>
      ) : ready && day ? (
        <DayAgenda agenda={agenda} setDay={setDay} day={day} />
      ) : (
        <AccessCard agenda={agenda} preview={preview} />
      )}
    </div>
  );
}
