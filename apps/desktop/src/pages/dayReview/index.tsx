import { parseDate } from '@internationalized/date';
import { useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Card, Heading, Section } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DayReviewIcon,
  HistoryIcon,
  PauseIcon,
  RunningIcon,
  StopIcon,
  SuccessIcon,
  WarningIcon,
} from '../../components/icons';
import { Meter } from '../../components/Progress';
import { DataTable } from '../../charts/DataTable';
import type { DayReviewSlice, ReviewSession, WorkItemsSlice } from '../../ipc/contract';
import { PageRefresh } from '../../features/app/PageHeaderActions';
import { useEngineDraft } from '../../features/ticketContext/drafts';
import {
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
import { useAction, useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import styles from './DayReview.module.css';

function shiftDay(day: string, amount: number): string {
  return parseDate(day).add({ days: amount }).toString();
}

function sessionSeconds(session: ReviewSession): number {
  return secondsBetween(session.start, session.end);
}

function SessionRow({ session, items }: { session: ReviewSession; items: WorkItemsSlice | undefined }) {
  const Icon = session.isRunning ? RunningIcon : SuccessIcon;
  const title = session.ticketId !== null ? (items?.[String(session.ticketId)]?.title ?? session.title) : session.title;
  return (
    <li className={styles.session}>
      <Icon className={styles.sessionIcon} />
      <div className={styles.sessionText}>
        {session.ticketId !== null ? (
          <span className={styles.sessionTitle}>
            <TicketLink ticketId={session.ticketId} title={title} />
          </span>
        ) : (
          <span className={styles.sessionTitle}>{title}</span>
        )}
        <span className={styles.caption}>
          {`${formatTimeRange(parseInstant(session.start), parseInstant(session.end))} · ${session.activity}${session.isRunning ? ' · running' : ''}`}
        </span>
        {session.isLong ? (
          <span>
            <Badge tone="warning" icon={WarningIcon}>
              Long entry
            </Badge>
          </span>
        ) : null}
      </div>
      <span className={styles.duration}>{formatShortDuration(sessionSeconds(session))}</span>
    </li>
  );
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof ClockIcon }) {
  return (
    <Card className={styles.metric}>
      <p className={styles.metricLabel}>
        <Icon />
        {label}
      </p>
      <p className={styles.metricValue}>{value}</p>
      <p className={styles.caption}>{detail}</p>
    </Card>
  );
}

function ticketRows(sessions: readonly ReviewSession[], items: WorkItemsSlice | undefined) {
  const groups = new Map<string, { label: string; count: number; seconds: number }>();
  for (const session of sessions) {
    const key = session.ticketId !== null ? `ticket:${session.ticketId}` : `free:${session.title}`;
    const label =
      session.ticketId !== null ? `#${session.ticketId} · ${items?.[String(session.ticketId)]?.title ?? session.title}` : session.title;
    const group = groups.get(key) ?? { label, count: 0, seconds: 0 };
    group.count += 1;
    group.seconds += sessionSeconds(session);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .map(([id, group]) => ({
      id,
      cells: { ticket: group.label, entries: String(group.count), time: formatShortDuration(group.seconds) },
    }));
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

  const { summary } = review;
  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const tracked = summary.sessions.reduce((sum, session) => sum + sessionSeconds(session), 0);
  const longSessions = summary.sessions.filter((session) => session.isLong);
  const gapSeconds = summary.gaps.reduce((sum, gap) => sum + secondsBetween(gap.start, gap.end), 0);
  const rows = useMemo(() => ticketRows(summary.sessions, items), [summary.sessions, items]);
  const reviewedAt = review.record?.reviewedAt ?? null;
  const isToday = review.selectedDay === localToday().toString();
  const canSnooze = isToday && !!prompts?.dayReview?.canSnooze;
  const timerControlsDisabled = busy || connection?.health !== 'confirmed';
  const count = summary.sessions.length;

  const afterTracking = () => void reload.run({ type: 'dayReview.refresh' });

  return (
    <>
      <Section title="Day at a glance" subtitle={formatDayLong(review.selectedDay)} variant="plain">
        <div className={styles.metrics}>
          <Metric label="Tracked time" value={formatShortDuration(tracked)} detail={`${count} ${count === 1 ? 'entry' : 'entries'}`} icon={ClockIcon} />
          <Metric label="Daily target" value={formatShortDuration(review.targetSeconds)} detail="From your Settings" icon={DayReviewIcon} />
          <Metric
            label="Long entries"
            value={String(longSessions.length)}
            detail={`${review.longEntryMinutes} minutes or more`}
            icon={WarningIcon}
          />
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
        {rows.length > 0 ? (
          <DataTable
            caption="Time per ticket"
            columns={[
              { id: 'ticket', header: 'Ticket' },
              { id: 'entries', header: 'Entries', align: 'end' },
              { id: 'time', header: 'Time', align: 'end' },
            ]}
            rows={rows}
          />
        ) : null}
      </Section>

      <Section title="Needs a look" subtitle="Suggestions to review, not automatic corrections." variant="plain">
        {summary.timerRunning ? (
          <Card className={styles.attention}>
            <Heading level={3} className={styles.cardTitle}>
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
            {pause.error ?? stop.error ? <Banner tone="error">{(pause.error ?? stop.error)?.message}</Banner> : null}
            <p className={styles.caption}>Marking the day reviewed will leave this timer running.</p>
          </Card>
        ) : summary.timerUnconfirmed ? (
          <Banner tone="warning" live="off">
            Current timer status is unconfirmed. Reconnect or refresh before finishing.
          </Banner>
        ) : null}
        {longSessions.length > 0 ? (
          <Card>
            <Heading level={3} className={styles.cardTitle}>
              Long time entries
            </Heading>
            <p className={styles.caption}>Check whether these include a forgotten timer or an intentionally long session.</p>
            <ul role="list" className={styles.sessions}>
              {longSessions.map((session) => (
                <SessionRow key={session.id} session={session} items={items} />
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <Heading level={3} className={styles.cardTitle}>
            Possible gaps
          </Heading>
          {summary.gapsUnavailable ? (
            <p className={styles.caption}>
              A reliable gap estimate is unavailable for this day. Review the entries below and refresh if the connection is out of date.
            </p>
          ) : summary.gaps.length === 0 ? (
            <p className={styles.caption}>
              {`No gaps of ${review.gapMinutes} minutes or longer in your configured workday so far.`}
            </p>
          ) : (
            <>
              <p className={styles.caption}>
                {`${formatShortDuration(gapSeconds)} without a reported entry. Lunch, breaks and time off can explain these gaps.`}
              </p>
              <ul role="list" className={styles.gaps}>
                {summary.gaps.map((gap) => (
                  <li key={gap.start} className={styles.gap}>
                    <span>
                      <ClockIcon className={styles.inlineIcon} />
                      {formatTimeRange(parseInstant(gap.start), parseInstant(gap.end))}
                    </span>
                    <span className={styles.duration}>{formatShortDuration(secondsBetween(gap.start, gap.end))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </Section>

      <Section title="Time entries" subtitle="Reported sessions, ordered by start time.">
        {summary.sessions.length === 0 ? (
          <p className={styles.caption}>No entries recorded for this day.</p>
        ) : (
          <ul role="list" className={styles.sessions}>
            {summary.sessions.map((session) => (
              <SessionRow key={session.id} session={session} items={items} />
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          {canOpen('timeEditor') ? (
            <Button
              isDisabled={busy}
              onPress={() => {
                // loadCorrections also opens the Gaps & overlaps sheet.
                void toEditor
                  .run({ type: 'timeEditor.setDay', day: review.selectedDay })
                  .then(() => toEditor.run({ type: 'timeEditor.loadCorrections' }));
                openPage('timeEditor');
              }}
            >
              Review gaps & overlaps in Time editor…
            </Button>
          ) : null}
          {canOpen('history') ? (
            <Button
              icon={HistoryIcon}
              onPress={() => {
                void toHistory
                  .run({ type: 'history.setRange', from: review.selectedDay, to: review.selectedDay })
                  .then(() => toHistory.run({ type: 'history.load' }));
                openPage('history');
              }}
            >
              Open this day in History
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="Finish the review">
        {reviewedAt ? (
          <p className={styles.reviewed} role="status">
            <SuccessIcon className={styles.successIcon} />
            {`Reviewed ${formatInstant(reviewedAt)}`}
          </p>
        ) : (
          <div className={styles.actions}>
            <Button
              variant="primary"
              icon={SuccessIcon}
              isDisabled={review.loading || !!review.issue || preview}
              isPending={mark.pending}
              onPress={() => void mark.run({ type: 'dayReview.markReviewed', day: review.selectedDay })}
            >
              Mark day reviewed
            </Button>
            {canSnooze ? (
              <Button isDisabled={preview} isPending={snooze.pending} onPress={() => void snooze.run({ type: 'dayReview.snooze' })}>
                Remind me in 30 minutes
              </Button>
            ) : null}
          </div>
        )}
        {mark.error ? <Banner tone="error">{mark.error.message}</Banner> : null}
        <p className={styles.caption}>This saves a local review status. It does not submit a timesheet or change any worklog.</p>
      </Section>

      <div className={styles.notes}>
        {review.syncedAt ? (
          <p>
            <ClockIcon className={styles.inlineIcon} />
            {`Worklogs synced ${formatInstant(review.syncedAt)}`}
          </p>
        ) : null}
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
    { id: 'dayReview.previous', label: 'Previous day', group: 'Actions', keywords: ['day review'], isDisabled: !day, onAction: () => changeDay(shiftDay(day, -1)) },
    { id: 'dayReview.next', label: 'Next day', group: 'Actions', keywords: ['day review'], isDisabled: !day || day >= today, onAction: () => changeDay(shiftDay(day, 1)) },
    { id: 'dayReview.today', label: 'Review today', group: 'Actions', keywords: ['day review'], isDisabled: day === today, onAction: () => changeDay(today) },
    {
      id: 'dayReview.markReviewed',
      label: 'Mark day reviewed',
      group: 'Actions',
      keywords: ['day review', 'finish'],
      isDisabled: !canMark,
      onAction: () => {
        if (review) void mark.run({ type: 'dayReview.markReviewed', day: review.selectedDay });
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
        <IconButton label="Previous day" icon={ChevronLeftIcon} onPress={() => changeDay(shiftDay(day, -1))} isDisabled={!day} />
        <DatePicker
          label="Review date"
          value={toCalendarDay(day)}
          maxValue={localToday()}
          onChange={(value) => {
            if (value) changeDay(value.toString());
          }}
        />
        <IconButton label="Next day" icon={ChevronRightIcon} onPress={() => changeDay(shiftDay(day, 1))} isDisabled={!day || day >= today} />
        <Button onPress={() => changeDay(today)} isDisabled={day === today}>
          Today
        </Button>
      </Card>

      {setDay.error ?? refresh.error ? <Banner tone="error">{(setDay.error ?? refresh.error)?.message}</Banner> : null}
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
