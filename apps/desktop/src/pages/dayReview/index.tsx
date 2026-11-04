import { parseDate } from '@internationalized/date';
import { useId, useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Card, Heading, Section, SectionHeading } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DayReviewIcon,
  HistoryIcon,
  PauseIcon,
  RunningIcon,
  StopIcon,
  SuccessIcon,
  WarningIcon,
} from '../../components/icons';
import { Meter } from '../../components/Progress';
import { ActivityChip, ActivityLegend, ActivityPill, ActivitySwatch, DayStrip, stripWindow } from '../../features/activity';
import type { DayReviewSlice, ReviewSession, WorkItemsSlice } from '../../ipc/contract';
import { PageRefresh } from '../../features/app/PageHeaderActions';
import { useEngineDraft } from '../../features/ticketContext/drafts';
import {
  dayToDate,
  formatClockTime,
  formatDayLong,
  formatInstant,
  formatTimeRange,
  localToday,
  parseInstant,
  secondsBetween,
  toCalendarDay,
} from '../../features/ticketContext/format';
import { useOpenPage } from '../../features/ticketContext/navigation';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useNow, useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { dayActivities, sessionSeconds, sessionTitle, ticketRows, useActivityIndex } from './model';
import styles from './DayReview.module.css';

function shiftDay(day: string, amount: number): string {
  return parseDate(day).add({ days: amount }).toString();
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "#4821 Title" opens the ticket's details; free entries show their title. */
function SessionTitle({ session, items }: { session: ReviewSession; items: WorkItemsSlice | undefined }) {
  const title = sessionTitle(session, items);
  return session.ticketId !== null ? (
    <span className={styles.ticket}>
      <TicketLink ticketId={session.ticketId} title={title} />
    </span>
  ) : (
    <span className={styles.itemTitle}>{title}</span>
  );
}

function SessionRow({ session, items, colorIndex }: { session: ReviewSession; items: WorkItemsSlice | undefined; colorIndex: number }) {
  return (
    <li className={styles.item}>
      <ActivityPill colorIndex={colorIndex} />
      <div className={styles.itemText}>
        <SessionTitle session={session} items={items} />
        <div className={styles.meta}>
          <span className={styles.mono}>{formatTimeRange(parseInstant(session.start), parseInstant(session.end))}</span>
          {session.activity ? <ActivityChip name={session.activity} colorIndex={colorIndex} /> : null}
          {session.isRunning ? (
            <Badge tone="running" icon={RunningIcon}>
              Running
            </Badge>
          ) : null}
          {session.isLong ? (
            <Badge tone="warning" icon={WarningIcon}>
              Long entry
            </Badge>
          ) : null}
          {session.ticketId === null ? <span>No Azure ticket</span> : null}
        </div>
      </div>
      <span className={styles.duration}>{formatShortDuration(sessionSeconds(session))}</span>
    </li>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className={styles.stat}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>{value}</p>
      <p className={styles.caption}>{detail}</p>
    </Card>
  );
}

/** The day's worklogs on the clock, with hatched possible gaps and long entries outlined. */
function YourDay({
  review,
  colorOf,
}: {
  review: DayReviewSlice & { summary: NonNullable<DayReviewSlice['summary']> };
  colorOf: (activity: string) => number;
}) {
  const { summary } = review;
  const isToday = review.selectedDay === localToday().toString();
  const blocks = useMemo(
    () =>
      summary.sessions.flatMap((session) => {
        const start = parseInstant(session.start)?.getTime();
        const end = parseInstant(session.end)?.getTime();
        if (start === undefined || end === undefined) return [];
        const name = session.ticketId !== null ? `#${session.ticketId} ${session.title}` : session.title;
        return [
          {
            id: session.id,
            start,
            end,
            colorIndex: colorOf(session.activity),
            label: `${name} · ${formatShortDuration(sessionSeconds(session))}${session.isLong ? ' · long entry' : ''}`,
            running: session.isRunning,
            flagged: session.isLong,
          },
        ];
      }),
    [summary.sessions, colorOf],
  );
  const gaps = useMemo(
    () =>
      summary.gapsUnavailable
        ? []
        : summary.gaps.flatMap((gap) => {
            const start = parseInstant(gap.start)?.getTime();
            const end = parseInstant(gap.end)?.getTime();
            return start === undefined || end === undefined ? [] : [{ start, end }];
          }),
    [summary.gaps, summary.gapsUnavailable],
  );
  const clock = useNow(isToday);
  const now = isToday ? clock : null;
  const { from, to } = stripWindow(dayToDate(review.selectedDay), [
    ...blocks.flatMap((block) => [block.start, block.end]),
    ...(now !== null ? [now] : []),
  ]);
  const legend = dayActivities(summary.sessions).map((activity) => ({
    id: activity,
    name: activity,
    colorIndex: colorOf(activity),
  }));
  const longCount = summary.sessions.filter((session) => session.isLong).length;
  const label = [
    `Timeline of ${formatDayLong(review.selectedDay)}: ${plural(blocks.length, 'worklog', 'worklogs')}`,
    gaps.length > 0 ? plural(gaps.length, 'possible gap', 'possible gaps') : null,
    longCount > 0 ? plural(longCount, 'long entry', 'long entries') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Section
      title="Your day"
      subtitle={`Worklogs on the clock, ${formatClockTime(new Date(from))}–${formatClockTime(new Date(to))}.${gaps.length > 0 ? ' Hatched areas are possible gaps.' : ''}`}
      actions={<ActivityLegend items={legend} />}
    >
      <DayStrip from={from} to={to} blocks={blocks} gaps={gaps} now={now} label={label} size="large" />
    </Section>
  );
}

function TimePerTicket({
  sessions,
  items,
  colorOf,
}: {
  sessions: readonly ReviewSession[];
  items: WorkItemsSlice | undefined;
  colorOf: (activity: string) => number;
}) {
  const headingId = useId();
  const rows = useMemo(() => ticketRows(sessions, items), [sessions, items]);
  return (
    <Card as="section" padding="none" aria-labelledby={headingId} className={styles.flushCard}>
      <SectionHeading id={headingId} title="Time per ticket" size="group" className={styles.tableHead} />
      <div className={styles.scroll}>
        <table className={styles.table} aria-labelledby={headingId}>
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              <th scope="col" className={styles.end}>
                Entries
              </th>
              <th scope="col" className={styles.end}>
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <span className={styles.ticketCell}>
                    <ActivitySwatch colorIndex={colorOf(row.activity)} />
                    <span>
                      {row.ticketId !== null ? (
                        <>
                          <span className={styles.ticketNumber}>{`#${row.ticketId}`}</span>{' '}
                        </>
                      ) : null}
                      {row.title}
                    </span>
                  </span>
                </th>
                <td className={styles.end}>{row.count}</td>
                <td className={`${styles.end} ${styles.strong}`}>{formatShortDuration(row.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Summary({ review }: { review: DayReviewSlice & { summary: NonNullable<DayReviewSlice['summary']> } }) {
  const items = useSlice('workItems');
  const tracking = useSlice('tracking');
  const connection = useSlice('connection');
  const app = useSlice('app');
  const prompts = useSlice('prompts');
  const pause = useAction();
  const stop = useAction();
  const mark = useAction();
  const snooze = useAction();
  const toEditor = useAction();
  const toHistory = useAction();
  const reload = useAction();
  const { openPage, canOpen } = useOpenPage();
  const colorOf = useActivityIndex();
  const entriesHeadingId = useId();
  const finishHeadingId = useId();

  const { summary } = review;
  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const tracked = summary.sessions.reduce((sum, session) => sum + sessionSeconds(session), 0);
  const longSessions = summary.sessions.filter((session) => session.isLong);
  const longSeconds = longSessions.reduce((sum, session) => sum + sessionSeconds(session), 0);
  const gapSeconds = summary.gaps.reduce((sum, gap) => sum + secondsBetween(gap.start, gap.end), 0);
  const reviewedAt = review.record?.reviewedAt ?? null;
  const isToday = review.selectedDay === localToday().toString();
  const canSnooze = isToday && !!prompts?.dayReview?.canSnooze;
  const timerControlsDisabled = busy || connection?.health !== 'confirmed';
  const count = summary.sessions.length;

  const afterTracking = () => void reload.run({ type: 'dayReview.refresh' });

  return (
    <>
      <Section title="Day at a glance" subtitle={formatDayLong(review.selectedDay)} variant="plain">
        <div className={styles.stats}>
          <Metric label="Tracked time" value={formatShortDuration(tracked)} detail={plural(count, 'entry', 'entries')} />
          <Metric label="Daily target" value={formatShortDuration(review.targetSeconds)} detail="From your Settings" />
          <Metric label="Long entries" value={String(longSessions.length)} detail={`${review.longEntryMinutes} minutes or more`} />
        </div>
        {review.targetSeconds > 0 ? (
          <Meter
            label="Tracked time against the daily target"
            value={tracked}
            maxValue={review.targetSeconds}
            valueLabel={`${formatShortDuration(tracked)} of ${formatShortDuration(review.targetSeconds)}`}
            tone={tracked >= review.targetSeconds ? 'running' : 'accent'}
          />
        ) : null}
      </Section>

      {count > 0 ? <YourDay review={review} colorOf={colorOf} /> : null}

      <div className={styles.columns}>
        {count > 0 ? <TimePerTicket sessions={summary.sessions} items={items} colorOf={colorOf} /> : null}

        <Section title="Needs a look" subtitle="Suggestions to review, not automatic corrections.">
          {summary.timerRunning ? (
            <div className={`${styles.box} ${styles.boxWarning}`}>
              <Heading level={3} className={styles.boxTitle}>
                <RunningIcon className={styles.warningIcon} />
                Your timer is still running
              </Heading>
              <p>{tracking?.title ?? summary.sessions.find((session) => session.isRunning)?.title ?? ''}</p>
              <div className={styles.actions}>
                <Button
                  icon={PauseIcon}
                  isDisabled={timerControlsDisabled}
                  isPending={pause.pending}
                  onPress={() => void pause.run({ type: 'tracking.pause' }).then(afterTracking)}
                >
                  Pause tracking
                </Button>
                <Button
                  variant="primary"
                  icon={StopIcon}
                  isDisabled={timerControlsDisabled}
                  isPending={stop.pending}
                  onPress={() => void stop.run({ type: 'tracking.stop' }).then(afterTracking)}
                >
                  Stop tracking
                </Button>
              </div>
              {(pause.error ?? stop.error) ? <Banner tone="error">{(pause.error ?? stop.error)?.message}</Banner> : null}
              <p className={styles.caption}>Marking the day reviewed will leave this timer running.</p>
            </div>
          ) : summary.timerUnconfirmed ? (
            <Banner tone="warning" live="off">
              Current timer status is unconfirmed. Reconnect or refresh before finishing.
            </Banner>
          ) : null}
          {longSessions.length > 0 ? (
            <div className={`${styles.box} ${styles.boxWarning}`}>
              <div className={styles.boxHead}>
                <Heading level={3} className={styles.boxTitle}>
                  Long time entries
                </Heading>
                <span className={styles.duration}>{formatShortDuration(longSeconds)}</span>
              </div>
              <p className={styles.caption}>Check whether these include a forgotten timer or an intentionally long session.</p>
              <ul role="list" className={styles.boxList}>
                {longSessions.map((session) => (
                  <li key={session.id} className={styles.meta}>
                    <SessionTitle session={session} items={items} />
                    <span className={styles.mono}>{formatTimeRange(parseInstant(session.start), parseInstant(session.end))}</span>
                    {session.activity ? <ActivityChip name={session.activity} colorIndex={colorOf(session.activity)} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={styles.box}>
            <div className={styles.boxHead}>
              <Heading level={3} className={styles.boxTitle}>
                Possible gaps
              </Heading>
              {!summary.gapsUnavailable && summary.gaps.length > 0 ? (
                <span className={styles.duration}>{formatShortDuration(gapSeconds)}</span>
              ) : null}
            </div>
            {summary.gapsUnavailable ? (
              <p className={styles.caption}>
                A reliable gap estimate is unavailable for this day. Review the entries below and refresh if the connection is out of date.
              </p>
            ) : summary.gaps.length === 0 ? (
              <p className={styles.caption}>{`No gaps of ${review.gapMinutes} minutes or longer in your configured workday so far.`}</p>
            ) : (
              <>
                <p className={styles.caption}>
                  {`${formatShortDuration(gapSeconds)} without a reported entry. Lunch, breaks and time off can explain these gaps.`}
                </p>
                <ul role="list" className={styles.gapChips}>
                  {summary.gaps.map((gap) => (
                    <li key={gap.start}>
                      <Badge tone="neutral">
                        {`${formatTimeRange(parseInstant(gap.start), parseInstant(gap.end))} · ${formatShortDuration(secondsBetween(gap.start, gap.end))}`}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Section>
      </div>

      <Card as="section" padding="none" aria-labelledby={entriesHeadingId} className={styles.flushCard}>
        <SectionHeading
          id={entriesHeadingId}
          title="Time entries"
          subtitle="Reported sessions, ordered by start time."
          size="group"
          className={styles.listHead}
          actions={
            canOpen('timeEditor') || canOpen('history') ? (
              <>
                {canOpen('timeEditor') ? (
                  <Button
                    size="small"
                    isDisabled={busy}
                    onPress={() => {
                      // loadCorrections also opens the Gaps & overlaps sheet.
                      void toEditor
                        .run({
                          type: 'timeEditor.setDay',
                          day: review.selectedDay,
                        })
                        .then(() => toEditor.run({ type: 'timeEditor.loadCorrections' }));
                      openPage('timeEditor');
                    }}
                  >
                    Review gaps & overlaps in Time editor…
                  </Button>
                ) : null}
                {canOpen('history') ? (
                  <Button
                    size="small"
                    icon={HistoryIcon}
                    onPress={() => {
                      void toHistory
                        .run({
                          type: 'history.setRange',
                          from: review.selectedDay,
                          to: review.selectedDay,
                        })
                        .then(() => toHistory.run({ type: 'history.load' }));
                      openPage('history');
                    }}
                  >
                    Open this day in History
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />
        {count === 0 ? (
          <p className={`${styles.caption} ${styles.listEmpty}`}>No entries recorded for this day.</p>
        ) : (
          <ul role="list" className={styles.list}>
            {summary.sessions.map((session) => (
              <SessionRow key={session.id} session={session} items={items} colorIndex={colorOf(session.activity)} />
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby={finishHeadingId} className={styles.finish}>
        <SectionHeading
          id={finishHeadingId}
          title="Finish the review"
          subtitle="This saves a local review status. It does not submit a timesheet or change any worklog."
          size="group"
          className={styles.finishHead}
          actions={
            reviewedAt ? (
              <p className={styles.reviewed} role="status">
                <SuccessIcon className={styles.successIcon} />
                {`Reviewed ${formatInstant(reviewedAt)}`}
              </p>
            ) : (
              <>
                <Button
                  variant="primary"
                  icon={SuccessIcon}
                  isDisabled={review.loading || !!review.issue || preview}
                  isPending={mark.pending}
                  onPress={() =>
                    void mark.run({
                      type: 'dayReview.markReviewed',
                      day: review.selectedDay,
                    })
                  }
                >
                  Mark day reviewed
                </Button>
                {canSnooze ? (
                  <Button isDisabled={preview} isPending={snooze.pending} onPress={() => void snooze.run({ type: 'dayReview.snooze' })}>
                    Remind me in 30 minutes
                  </Button>
                ) : null}
              </>
            )
          }
        />
        {mark.error ? <Banner tone="error">{mark.error.message}</Banner> : null}
      </Card>

      <div className={styles.notes}>
        {review.syncedAt ? <p>{`Worklogs synced ${formatInstant(review.syncedAt)}`}</p> : null}
        <p>
          Possible gaps use reported start times within your configured workday. Breaks may be intentional. Midnight entries or uncertain
          timer status hide gap estimates.
        </p>
        <p>
          The review clips overnight entries to this day and counts the current timer only through its last confirmed duration. Nothing is
          edited or stopped automatically.
        </p>
        {summary.omittedLogs > 0 ? (
          <p className={styles.warningText}>
            <WarningIcon className={styles.inlineIcon} />
            {summary.omittedLogs === 1
              ? '1 entry has an invalid date or duration and needs checking in 7pace.'
              : `${summary.omittedLogs} entries have an invalid date or duration and need checking in 7pace.`}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Day review (1.14 `DayReviewView`): a final, read-only check of one day's time. */
export default function DayReviewPage() {
  const review = useSlice('dayReview');
  const app = useSlice('app');
  const refresh = useAction();
  const setDay = useAction();
  const mark = useAction();
  const { openPage, canOpen } = useOpenPage();
  const [day, setDayDraft] = useEngineDraft(review?.selectedDay ?? '');

  const today = localToday().toString();
  const configured = review?.configured ?? false;
  const changeDay = (next: string) => {
    if (next > today) return;
    setDayDraft(next);
    void setDay.run({ type: 'dayReview.setDay', day: next });
  };
  const canMark = !!review?.summary && !review.record?.reviewedAt && !review.loading && !review.issue && !app?.preview;

  useCommands([
    {
      id: 'dayReview.previous',
      label: 'Previous day',
      group: 'Actions',
      keywords: ['day review'],
      isDisabled: !day,
      onAction: () => changeDay(shiftDay(day, -1)),
    },
    {
      id: 'dayReview.next',
      label: 'Next day',
      group: 'Actions',
      keywords: ['day review'],
      isDisabled: !day || day >= today,
      onAction: () => changeDay(shiftDay(day, 1)),
    },
    {
      id: 'dayReview.today',
      label: 'Review today',
      group: 'Actions',
      keywords: ['day review'],
      isDisabled: day === today,
      onAction: () => changeDay(today),
    },
    {
      id: 'dayReview.markReviewed',
      label: 'Mark day reviewed',
      group: 'Actions',
      keywords: ['day review', 'finish'],
      isDisabled: !canMark,
      onAction: () => {
        if (review)
          void mark.run({
            type: 'dayReview.markReviewed',
            day: review.selectedDay,
          });
      },
    },
  ]);

  if (!review) {
    return (
      <div className={styles.page} aria-busy="true">
        <span role="status" className="visually-hidden">
          Loading the day review
        </span>
        <Skeleton lines={2} />
        <Skeleton shape="rect" height="10rem" />
      </div>
    );
  }

  const summary = review.summary;

  return (
    <div className={styles.page}>
      <PageRefresh
        onRefresh={() => void refresh.run({ type: 'dayReview.refresh' })}
        isRefreshing={review.loading}
        isDisabled={!configured}
        label="Refresh review"
      />
      <p className={styles.intro}>A final check of your time. You decide what needs attention.</p>

      <Card className={styles.dayBar}>
        <div className={styles.dayControls}>
          <IconButton label="Previous day" icon={ChevronLeftIcon} onPress={() => changeDay(shiftDay(day, -1))} isDisabled={!day} />
          <DatePicker
            label="Review date"
            value={toCalendarDay(day)}
            maxValue={localToday()}
            onChange={(value) => {
              if (value) changeDay(value.toString());
            }}
          />
          <IconButton
            label="Next day"
            icon={ChevronRightIcon}
            onPress={() => changeDay(shiftDay(day, 1))}
            isDisabled={!day || day >= today}
          />
          <Button onPress={() => changeDay(today)} isDisabled={day === today}>
            Today
          </Button>
        </div>
        {summary && !review.loading ? (
          review.record?.reviewedAt ? (
            <Badge tone="success" icon={SuccessIcon}>
              Reviewed
            </Badge>
          ) : (
            <Badge tone="warning">Not reviewed yet</Badge>
          )
        ) : null}
      </Card>

      {(setDay.error ?? refresh.error) ? <Banner tone="error">{(setDay.error ?? refresh.error)?.message}</Banner> : null}
      {review.issue ? (
        <Banner tone="warning" title="Could not refresh worklogs">
          <p>{review.issue}</p>
          {summary ? <p>The entries below are from the last successful sync.</p> : null}
        </Banner>
      ) : null}

      <LoadingRegion
        label="Loading the day’s worklogs…"
        isLoading={review.loading && !summary}
        placeholder={
          <div className={styles.loading}>
            <Skeleton shape="rect" height="6rem" />
            <Skeleton lines={4} />
          </div>
        }
      >
        {summary ? (
          <div className={styles.page}>
            <Summary review={{ ...review, summary }} />
          </div>
        ) : !review.issue ? (
          <Card>
            <EmptyState
              icon={DayReviewIcon}
              headingLevel={2}
              title={configured ? 'Nothing to review yet' : 'Connect to review your day'}
              description={
                configured
                  ? 'Refresh the review to load this day’s worklogs.'
                  : 'Your review uses your own 7pace worklogs. Set up your account to get started.'
              }
              action={
                configured ? (
                  <Button onPress={() => void refresh.run({ type: 'dayReview.refresh' })}>Refresh review</Button>
                ) : canOpen('settings') ? (
                  <Button variant="primary" onPress={() => openPage('settings')}>
                    Open Settings
                  </Button>
                ) : null
              }
            />
          </Card>
        ) : null}
      </LoadingRegion>
    </div>
  );
}
