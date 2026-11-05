import { useId, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Skeleton } from '../../components/EmptyState';
import { ClockIcon, PauseIcon, StopIcon, SuccessIcon, WarningIcon } from '../../components/icons';
import { deviceName } from '../../features/tracking/status';
import { formatInstant } from '../../features/ticketContext/format';
import type { DayReviewSlice, OfflineDraftView, ReviewSession } from '../../ipc/contract';
import { useNavigation } from '../../layout/NavigationContext';
import { useAction, useSlice } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { formatShortDuration } from '../../utils/duration';
import { findOverlaps, formatTime, formatWeekday, plural, sessionSeconds, type Overlap } from './model';
import styles from './today.module.css';

export type LoadedReview = DayReviewSlice & { summary: NonNullable<DayReviewSlice['summary']> };

/** The review's sessions as spans, for overlaps. */
export function sessionSpans(sessions: readonly ReviewSession[]) {
  return sessions.flatMap((session) => {
    const start = Date.parse(session.start);
    const end = Date.parse(session.end);
    return Number.isNaN(start) || Number.isNaN(end) ? [] : [{ id: session.id, start, end }];
  });
}

/** Overlaps between saved entries; the running timer is not an entry yet (as on the timeline). */
export function reviewOverlaps(review: LoadedReview): Overlap[] {
  return findOverlaps(sessionSpans(review.summary.sessions.filter((session) => !session.isRunning)));
}

function gapSeconds(review: LoadedReview): number {
  return review.summary.gaps.reduce((sum, gap) => sum + Math.max(0, (Date.parse(gap.end) - Date.parse(gap.start)) / 1000), 0);
}

function overlapSeconds(overlaps: readonly Overlap[]): number {
  return overlaps.reduce((sum, overlap) => sum + (overlap.end - overlap.start) / 1000, 0);
}

/**
 * Opens the reviewed day in the Timesheet's Day view: with the Gaps & overlaps corrections
 * (`corrections`), or filtered to a ticket. `null` when the Day view is hidden.
 */
export function useOpenDayInTimesheet(): ((day: string, options?: { corrections?: boolean; filter?: string }) => void) | null {
  const navigation = useNavigation();
  const editor = useAction();
  const target = { place: 'timesheet', view: 'day' } as const;
  if (!navigation?.canNavigate(target)) return null;
  return (day, { corrections = false, filter } = {}) => {
    void editor.run({ type: 'timeEditor.setDay', day }).then(() => {
      if (corrections) return editor.run({ type: 'timeEditor.loadCorrections' });
      if (filter !== undefined) return editor.run({ type: 'timeEditor.setFilter', text: filter });
      return undefined;
    });
    navigation.navigate(target);
  };
}

type Tone = 'ok' | 'warn' | 'info';

function CheckLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = tone === 'ok' ? SuccessIcon : tone === 'warn' ? WarningIcon : ClockIcon;
  return (
    <li className={styles.checkLine}>
      <Icon className={cx(styles.checkIcon, styles[`check-${tone}`])} />
      <span>{children}</span>
    </li>
  );
}

function MarkReviewed({ review, label, large = false }: { review: DayReviewSlice; label: string; large?: boolean }) {
  const app = useSlice('app');
  const mark = useAction();
  const reviewedAt = review.record?.reviewedAt ?? null;
  if (reviewedAt) {
    return (
      <p role="status" className={styles.reviewed}>
        <SuccessIcon className={cx(styles.checkIcon, styles['check-ok'])} />
        {`Reviewed ${formatInstant(reviewedAt)}`}
      </p>
    );
  }
  const canMark = !!review.summary && !review.loading && !review.issue && !app?.preview;
  return (
    <>
      <Button
        variant={large ? 'primary' : 'secondary'}
        size={large ? 'large' : 'medium'}
        icon={large ? SuccessIcon : undefined}
        fullWidth
        isDisabled={!canMark}
        isPending={mark.pending}
        onPress={() => void mark.run({ type: 'dayReview.markReviewed', day: review.selectedDay })}
      >
        {label}
      </Button>
      {mark.error ? <Banner tone="error">{mark.error.message}</Banner> : null}
    </>
  );
}

function Unconfigured({ headingId, title }: { headingId: string; title: string }) {
  const navigation = useNavigation();
  return (
    <Card as="section" aria-labelledby={headingId} className={styles.cardStack}>
      <h2 id={headingId} className={styles.cardTitle}>
        {title}
      </h2>
      <p className={styles.caption}>Your day check uses your own 7pace worklogs. Connect your account to get started.</p>
      {navigation ? (
        <Button size="small" className={styles.alignStart} onPress={() => navigation.navigate({ place: 'settings', view: 'accounts' })}>
          Open Settings
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * "Day check" on today (2.2 Today): gaps, overlaps and the long-entry check so far, the engine's
 * Mark day reviewed and, when the review prompt allows it, a 30-minute snooze.
 */
export function TodayCheck({ review, today }: { review: DayReviewSlice | undefined; today: string }) {
  const headingId = useId();
  const prompts = useSlice('prompts');
  const tracking = useSlice('tracking');
  const snooze = useAction();
  const openDay = useOpenDayInTimesheet();
  const app = useSlice('app');

  if (review && !review.configured) return <Unconfigured headingId={headingId} title="Day check" />;
  if (!review || review.selectedDay !== today || (!review.summary && review.loading)) {
    return (
      <Card as="section" aria-labelledby={headingId} className={styles.cardStack}>
        <h2 id={headingId} className={styles.cardTitle}>
          Day check
        </h2>
        <div aria-busy="true">
          <span role="status" className="visually-hidden">
            Checking today’s worklogs
          </span>
          <Skeleton lines={3} />
        </div>
      </Card>
    );
  }

  const summary = review.summary;
  const lines: ReactNode[] = [];
  let hasIssues = false;
  if (summary) {
    const loaded = review as LoadedReview;
    if (summary.gapsUnavailable) {
      lines.push(
        <CheckLine key="gaps" tone="info">
          A gap estimate isn’t available right now
        </CheckLine>,
      );
    } else if (summary.gaps.length === 0) {
      lines.push(
        <CheckLine key="gaps" tone="ok">
          No gaps so far today
        </CheckLine>,
      );
    } else {
      hasIssues = true;
      lines.push(
        <CheckLine key="gaps" tone="warn">
          {`${plural(summary.gaps.length, 'possible gap', 'possible gaps')} · ${formatShortDuration(gapSeconds(loaded))}`}
        </CheckLine>,
      );
    }
    const overlaps = reviewOverlaps(loaded);
    if (overlaps.length === 0) {
      lines.push(
        <CheckLine key="overlaps" tone="ok">
          No overlaps
        </CheckLine>,
      );
    } else {
      hasIssues = true;
      lines.push(
        <CheckLine key="overlaps" tone="warn">
          {`${plural(overlaps.length, 'overlap', 'overlaps')} · ${formatShortDuration(overlapSeconds(overlaps))}`}
        </CheckLine>,
      );
    }
    const long = summary.sessions.filter((session) => session.isLong);
    const runningSession = summary.sessions.find((session) => session.isRunning);
    if (long.length > 0) {
      hasIssues = true;
      for (const session of long) {
        lines.push(
          <CheckLine key={`long-${session.id}`} tone="warn">
            {`Long entry · ${session.ticketId !== null ? `#${session.ticketId}` : session.title} · ${formatShortDuration(sessionSeconds(session))}`}
          </CheckLine>,
        );
      }
    } else if (runningSession && tracking?.running) {
      lines.push(
        <CheckLine key="long" tone="info">
          {`Timer at ${formatShortDuration(sessionSeconds(runningSession))}. You’ll get a long-entry check at ${formatShortDuration(review.longEntryMinutes * 60)}.`}
        </CheckLine>,
      );
    } else {
      lines.push(
        <CheckLine key="long" tone="ok">
          No long entries
        </CheckLine>,
      );
    }
    if (summary.timerUnconfirmed) {
      lines.push(
        <CheckLine key="unconfirmed" tone="info">
          The timer status is unconfirmed. Refresh before you finish.
        </CheckLine>,
      );
    }
  }
  const canSnooze = prompts?.dayReview?.day === today && prompts.dayReview.canSnooze;

  return (
    <Card as="section" aria-labelledby={headingId} className={styles.cardStack}>
      <h2 id={headingId} className={styles.cardTitle}>
        Day check
      </h2>
      {review.issue ? (
        <Banner tone="warning" title="Could not refresh worklogs" live="off">
          {review.issue}
        </Banner>
      ) : null}
      {lines.length > 0 ? (
        <ul role="list" className={styles.checkList}>
          {lines}
        </ul>
      ) : null}
      {hasIssues && openDay ? (
        <Button variant="plain" size="small" className={styles.alignStart} onPress={() => openDay(today, { corrections: true })}>
          Review gaps & overlaps…
        </Button>
      ) : null}
      <MarkReviewed review={review} label="Mark day reviewed" />
      {canSnooze ? (
        <Button
          size="small"
          isDisabled={app?.preview ?? false}
          isPending={snooze.pending}
          onPress={() => void snooze.run({ type: 'dayReview.snooze' })}
        >
          Remind me in 30 minutes
        </Button>
      ) : null}
    </Card>
  );
}

/** "Monday isn’t reviewed": the engine asks for a review of an earlier day. */
export function PreviousDayCard({ day, onReview }: { day: string; onReview: () => void }) {
  const headingId = useId();
  const weekday = formatWeekday(day);
  return (
    <Card as="section" aria-labelledby={headingId} className={cx(styles.cardStack, styles.warnCard)}>
      <h2 id={headingId} className={styles.cardTitle}>
        {`${weekday} isn’t reviewed`}
      </h2>
      <p className={styles.small}>Check its gaps, overlaps and long entries before you mark it reviewed.</p>
      <Button size="small" className={styles.alignStart} onPress={onReview}>
        {`Review ${weekday}`}
      </Button>
    </Card>
  );
}

/** Drafts saved on this device that 7pace doesn’t have yet (a running local timer excluded). */
export function pendingDrafts(drafts: readonly OfflineDraftView[] | undefined): OfflineDraftView[] {
  return (drafts ?? []).filter((draft) => !!draft.end && draft.status !== 'Synced to 7pace');
}

export function draftLine(draft: OfflineDraftView): string {
  return `${draft.title} · ${formatDayShortish(draft.start)} ${formatTime(draft.start)} – ${formatTime(draft.end ?? draft.start)}`;
}

function formatDayShortish(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { weekday: 'short' });
}

/** "Offline drafts" (2.2 Today): drafts waiting for 7pace, with a way to the Timesheet's Drafts view. */
export function OfflineDraftsCard() {
  const offline = useSlice('offline');
  const navigation = useNavigation();
  const headingId = useId();
  const drafts = pendingDrafts(offline?.drafts);
  if (drafts.length === 0) return null;
  const target = { place: 'timesheet', view: 'drafts' } as const;
  return (
    <Card as="section" aria-labelledby={headingId} className={styles.cardStack}>
      <div className={styles.cardHeadRow}>
        <h2 id={headingId} className={styles.cardTitle}>
          Offline drafts
        </h2>
        <Badge tone="accent" accessibleLabel={plural(drafts.length, 'draft', 'drafts')}>
          {String(drafts.length)}
        </Badge>
      </div>
      <p className={cx(styles.small, styles.muted)}>
        {drafts.length === 1 ? `${draftLine(drafts[0]!)} isn’t in 7pace yet.` : `${drafts.length} drafts aren’t in 7pace yet.`}
      </p>
      {navigation?.canNavigate(target) ? (
        <Button size="small" className={styles.alignStart} onPress={() => navigation.navigate(target)}>
          Open in Timesheet
        </Button>
      ) : null}
    </Card>
  );
}

/** One "needs a look" box in the review's Day check. */
function IssueBox({ tone, title, children, actions }: { tone: 'warn' | 'neutral' | 'danger' | 'accent'; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <li className={cx(styles.issue, styles[`issue-${tone}`])}>
      <h3 className={styles.issueTitle}>{title}</h3>
      {children}
      {actions ? <div className={styles.issueActions}>{actions}</div> : null}
    </li>
  );
}

/**
 * The past day's "Day check" (2.2 "Today — reviewing Monday"): the running timer, long entries,
 * possible gaps, overlaps and offline drafts of that day, each with the way to fix it, then Mark
 * <day> reviewed. Suggestions, not automatic corrections.
 */
export function ReviewCheck({ review, isToday }: { review: LoadedReview; isToday: boolean }) {
  const headingId = useId();
  const app = useSlice('app');
  const connection = useSlice('connection');
  const tracking = useSlice('tracking');
  const offline = useSlice('offline');
  const navigation = useNavigation();
  const pause = useAction();
  const stop = useAction();
  const reload = useAction();
  const openDay = useOpenDayInTimesheet();
  const { summary } = review;
  const day = review.selectedDay;
  const weekday = isToday ? 'day' : formatWeekday(day);
  const busy = app?.busy ?? false;
  const timerControlsDisabled = busy || connection?.health !== 'confirmed';
  const afterTracking = () => void reload.run({ type: 'dayReview.refresh' });
  const byId = new Map(summary.sessions.map((session) => [session.id, session]));
  const long = summary.sessions.filter((session) => session.isLong);
  const overlaps = reviewOverlaps(review);
  const drafts = pendingDrafts(offline?.drafts).filter((draft) => {
    const start = Date.parse(draft.start);
    const dayStart = Date.parse(summary.day);
    return start >= dayStart && start < dayStart + 86_400_000;
  });
  const draftsTarget = { place: 'timesheet', view: 'drafts' } as const;
  const shortName = (session: ReviewSession | undefined) =>
    session ? (session.ticketId !== null ? `#${session.ticketId}` : session.title) : 'An entry';

  return (
    <Card as="section" aria-labelledby={headingId} className={cx(styles.cardStack, styles.reviewCheck)}>
      <div>
        <h2 id={headingId} className={styles.cardTitle}>
          Day check
        </h2>
        <p className={styles.caption}>Suggestions, not automatic corrections.</p>
      </div>
      {review.issue ? (
        <Banner tone="warning" title="Could not refresh worklogs" live="off">
          <p>{review.issue}</p>
          <p>The entries shown are from the last successful sync.</p>
        </Banner>
      ) : null}
      <ul role="list" className={styles.issues}>
        {summary.timerRunning ? (
          <IssueBox
            tone="warn"
            title="Your timer is still running"
            actions={
              <>
                <Button
                  size="small"
                  icon={PauseIcon}
                  isDisabled={timerControlsDisabled}
                  isPending={pause.pending}
                  onPress={() => void pause.run({ type: 'tracking.pause' }).then(afterTracking)}
                >
                  Pause tracking
                </Button>
                <Button
                  size="small"
                  icon={StopIcon}
                  isDisabled={timerControlsDisabled}
                  isPending={stop.pending}
                  onPress={() => void stop.run({ type: 'tracking.stop' }).then(afterTracking)}
                >
                  Stop tracking
                </Button>
              </>
            }
          >
            <p className={styles.xs}>{`${tracking?.title ?? summary.sessions.find((session) => session.isRunning)?.title ?? ''}. Marking the day reviewed leaves it running.`}</p>
            {(pause.error ?? stop.error) ? <p role="alert" className={styles.xs}>{(pause.error ?? stop.error)?.message}</p> : null}
          </IssueBox>
        ) : null}
        {summary.timerUnconfirmed ? (
          <IssueBox tone="neutral" title="Timer status unconfirmed">
            <p className={styles.xs}>Reconnect or refresh before finishing.</p>
          </IssueBox>
        ) : null}
        {long.map((session) => (
          <IssueBox
            key={session.id}
            tone="warn"
            title={`Long entry · ${formatShortDuration(sessionSeconds(session))}`}
            actions={
              openDay ? (
                <Button
                  size="small"
                  onPress={() => openDay(day, { filter: session.ticketId !== null ? String(session.ticketId) : session.title })}
                >
                  Split in Timesheet…
                </Button>
              ) : null
            }
          >
            <p className={styles.xs}>{`${shortName(session)} from ${formatTime(session.start)} to ${formatTime(session.end)}. A forgotten timer, or one long session?`}</p>
          </IssueBox>
        ))}
        <IssueBox
          tone="neutral"
          title={
            summary.gapsUnavailable
              ? 'Possible gaps'
              : summary.gaps.length === 0
                ? 'No possible gaps'
                : `${plural(summary.gaps.length, 'possible gap', 'possible gaps')} · ${formatShortDuration(gapSeconds(review))}`
          }
          actions={
            !summary.gapsUnavailable && summary.gaps.length > 0 && openDay ? (
              <Button size="small" onPress={() => openDay(day, { corrections: true })}>
                Fill in Timesheet…
              </Button>
            ) : null
          }
        >
          <p className={cx(styles.xs, styles.muted)}>
            {summary.gapsUnavailable
              ? 'A reliable gap estimate is unavailable for this day. Refresh if the connection is out of date.'
              : summary.gaps.length === 0
                ? `No gaps of ${review.gapMinutes} minutes or longer in your workday.`
                : summary.gaps.map((gap) => `${formatTime(gap.start)} – ${formatTime(gap.end)}`).join(' and ')}
          </p>
        </IssueBox>
        {overlaps.length > 0 ? (
          <IssueBox
            tone="danger"
            title={`${overlaps.length === 1 ? 'Overlap' : plural(overlaps.length, 'overlap', 'overlaps')} · ${formatShortDuration(overlapSeconds(overlaps))}`}
            actions={
              openDay ? (
                <Button size="small" onPress={() => openDay(day, { corrections: true })}>
                  Fix overlap…
                </Button>
              ) : null
            }
          >
            {overlaps.map((overlap) => (
              <p key={`${overlap.first}-${overlap.second}`} className={styles.xs}>
                {`${shortName(byId.get(overlap.first))} and ${shortName(byId.get(overlap.second))} both cover ${formatTime(overlap.start)} – ${formatTime(overlap.end)}.`}
              </p>
            ))}
          </IssueBox>
        ) : null}
        {drafts.length > 0 ? (
          <IssueBox
            tone="accent"
            title={plural(drafts.length, 'offline draft', 'offline drafts')}
            actions={
              navigation?.canNavigate(draftsTarget) ? (
                <Button size="small" onPress={() => navigation.navigate(draftsTarget)}>
                  Review drafts
                </Button>
              ) : null
            }
          >
            {drafts.map((draft) => (
              <p key={draft.id} className={styles.xs}>{`${draftLine(draft)} isn’t in 7pace yet.`}</p>
            ))}
          </IssueBox>
        ) : null}
      </ul>
      <MarkReviewed review={review} label={isToday ? 'Mark day reviewed' : `Mark ${weekday} reviewed`} large />
      <p className={cx(styles.xs, styles.muted)}>{`Saves a review status on ${deviceName(app?.os)}. It doesn’t submit a timesheet.`}</p>
      <div className={styles.notes}>
        {review.syncedAt ? <p>{`Worklogs synced ${formatInstant(review.syncedAt)}`}</p> : null}
        {summary.omittedLogs > 0 ? (
          <p className={styles.warningText}>
            <WarningIcon className={styles.inlineIcon} />
            {summary.omittedLogs === 1
              ? '1 entry has an invalid date or duration and needs checking in 7pace.'
              : `${summary.omittedLogs} entries have an invalid date or duration and need checking in 7pace.`}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

