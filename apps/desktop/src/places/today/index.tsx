import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DayReviewIcon, SuccessIcon } from '../../components/icons';
import { seriesColor } from '../../charts/palette';
import { activityColorIndex, useActivityColors } from '../../features/activity';
import { useFocusRecovery } from '../../features/tracking/focus';
import { SetupIcon } from '../../features/tracking/icons';
import { useProgressSeconds, useTrackingAnnouncements, useTrackingSeconds } from '../../features/tracking/status';
import { localToday } from '../../features/ticketContext/format';
import { usePlaceView } from '../../layout/NavigationContext';
import { PlaceBody, PlaceHeader } from '../../layout/Place';
import { useCommands, useRefreshShortcut } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { OfflineDraftsCard, PreviousDayCard, ReviewCheck, TodayCheck, type LoadedReview } from './DayCheck';
import { formatDayTitle, sessionSeconds, shiftDay, useActivityIndex } from './model';
import { TimePerTicket } from './TimePerTicket';
import { TrackingNow } from './TrackingNow';
import { Suggestions } from './Suggestions';
import { YourDayCalendarOnly, YourDayReview, YourDayToday } from './YourDay';
import styles from './today.module.css';

/** Where focus goes when a resolved suggestion takes the focused button with it. */
const FOCUS_FALLBACKS = ['[data-prompt-primary]:not([disabled])', '[data-current-primary]:not([disabled])'] as const;

type Segment = { key: string; seconds: number; color: string };

/** "2h 23m of 7h 36m" and a bar split by activity (the bar repeats the text, so it is hidden). */
function DayProgress({ seconds, target, segments }: { seconds: number; target: number; segments: readonly Segment[] }) {
  const scale = Math.max(target, segments.reduce((sum, segment) => sum + segment.seconds, 0), 1);
  return (
    <div className={styles.progress}>
      <p className={styles.progressText}>
        <b>{formatShortDuration(seconds)}</b>
        {target > 0 ? <span className={styles.muted}>{` of ${formatShortDuration(target)}`}</span> : null}
      </p>
      {target > 0 ? (
        <div className={styles.bar} aria-hidden="true">
          {segments.map((segment) => (
            <span
              key={segment.key}
              style={{ width: `${(segment.seconds / scale) * 100}%`, '--segment': segment.color } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Today's progress from the progress slice, split by the activities of today's worklogs and the timer. */
function TodayProgress() {
  const progress = useSlice('progress');
  const history = useSlice('history');
  const tracking = useSlice('tracking');
  const totals = useProgressSeconds(progress);
  const running = useTrackingSeconds(tracking);
  const colors = useActivityColors();
  const todayLogs = history?.todayLogs;
  const timerRunning = tracking?.running ?? false;
  const timerActivity = tracking?.activityId ?? null;
  const segments = useMemo(() => {
    const perColor = new Map<number, number>();
    for (const log of todayLogs ?? []) {
      const index = activityColorIndex(colors, log.activityType?.id);
      perColor.set(index, (perColor.get(index) ?? 0) + Math.max(log.length, 0));
    }
    if (timerRunning) {
      const index = activityColorIndex(colors, timerActivity);
      perColor.set(index, (perColor.get(index) ?? 0) + running);
    }
    return [...perColor.entries()].map(([index, seconds]) => ({ key: String(index), seconds, color: seriesColor(index) }));
  }, [todayLogs, timerRunning, timerActivity, running, colors]);
  if (!totals || !progress) return null;
  return <DayProgress seconds={totals.today} target={progress.todayTarget} segments={segments} />;
}

/** "A little setup. A lot less forgotten time." until 7pace is connected. */
function SetupCard({ onSetUp }: { onSetUp: () => void }) {
  return (
    <Card className={styles.setup}>
      <SetupIcon className={styles.setupIcon} />
      <div className={styles.setupText}>
        <h2 className={styles.cardTitle}>A little setup. A lot less forgotten time.</h2>
        <p className={styles.caption}>Connect 7pace, add your Azure PAT, and your branches will bring the right ticket to you.</p>
      </div>
      <Button variant="primary" onPress={onSetUp}>
        Set up accounts
      </Button>
    </Card>
  );
}

/**
 * Today (2.2 layout "S1 · Today"): run your day. The timer and suggestions on the left, the day's
 * calendar and tracked time in the middle, the day check, an earlier day waiting for its review
 * and offline drafts on the right. The previous-day button opens a past day's review in place
 * ("S1b · Today — reviewing Monday").
 */
export default function TodayPlace() {
  const { navigation } = usePlaceView<'day'>('today');
  const review = useSlice('dayReview');
  const agenda = useSlice('agenda');
  const connection = useSlice('connection');
  const prompts = useSlice('prompts');
  const items = useSlice('workItems');
  const reviewAction = useAction();
  const agendaAction = useAction();
  const refresh = useAction();
  const colorOf = useActivityIndex();
  const rootRef = useRef<HTMLDivElement>(null);
  useTrackingAnnouncements();
  useFocusRecovery(rootRef, FOCUS_FALLBACKS);

  const today = localToday().toString();
  const [reviewDay, setReviewDay] = useState<string | null>(null);
  const day = reviewDay ?? today;
  const reviewing = reviewDay !== null;
  const reviewVisible = navigation.isPageVisible('dayReview');
  const agendaVisible = navigation.isPageVisible('agenda');
  const agendaReady = !!agenda && agenda.supported && agenda.access === 'authorized' && agenda.enabled;

  // Keep the engine's day review and agenda on the shown day, asking once per day. A day the
  // engine picks itself ("Open review" on a prompt) is followed instead of undone.
  const selected = review?.selectedDay;
  const agendaDay = agenda?.day;
  const requested = useRef<string | null>(null);
  const sentAgenda = useRef<string | null>(null);
  const { run: runReview } = reviewAction;
  const { run: runAgenda } = agendaAction;
  useEffect(() => {
    if (!reviewVisible || selected === undefined || requested.current === day) return;
    requested.current = day;
    if (selected !== day) void runReview({ type: 'dayReview.setDay', day });
  }, [day, selected, reviewVisible, runReview]);
  useEffect(() => {
    if (!agendaVisible || !agendaReady || agendaDay === undefined || sentAgenda.current === day) return;
    sentAgenda.current = day;
    if (agendaDay !== day) void runAgenda({ type: 'agenda.setDay', day });
  }, [day, agendaDay, agendaVisible, agendaReady, runAgenda]);
  const previousSelected = useRef(selected);
  useEffect(() => {
    if (selected === previousSelected.current) return;
    previousSelected.current = selected;
    if (!selected || requested.current === null || selected === requested.current) return;
    requested.current = selected;
    setReviewDay(selected >= today ? null : selected);
  }, [selected, today]);

  const changeDay = (next: string) => setReviewDay(next >= today ? null : next);
  const loaded: LoadedReview | null = review && review.selectedDay === day && review.summary ? (review as LoadedReview) : null;
  const canMark = !!loaded && !loaded.record?.reviewedAt && !loaded.loading && !loaded.issue;

  const doRefresh = () => {
    if (reviewing) void refresh.run({ type: 'dayReview.refresh' });
    else void refresh.run({ type: 'connection.refresh' });
  };
  useRefreshShortcut(doRefresh, {
    label: reviewing ? 'Refresh review' : 'Refresh',
    isDisabled: refresh.pending || (reviewing ? !review?.configured : !connection?.hasSevenPaceToken),
  });
  const markAction = useAction();
  useCommands([
    { id: 'today.previousDay', icon: ChevronLeftIcon, label: 'Previous day', group: 'Actions', keywords: ['day review', 'yesterday'], onAction: () => changeDay(shiftDay(day, -1)) },
    {
      id: 'today.nextDay',
      icon: ChevronRightIcon,
      label: 'Next day',
      group: 'Actions',
      keywords: ['day review'],
      isDisabled: !reviewing,
      onAction: () => changeDay(shiftDay(day, 1)),
    },
    { id: 'today.backToToday', icon: CalendarIcon, label: 'Back to today', group: 'Actions', isDisabled: !reviewing, onAction: () => changeDay(today) },
    {
      id: 'dayReview.markReviewed',
      icon: CheckIcon,
      label: reviewing ? 'Mark this day reviewed' : 'Mark day reviewed',
      group: 'Actions',
      keywords: ['day review', 'finish'],
      isDisabled: !reviewVisible || !canMark,
      onAction: () => {
        if (loaded) void markAction.run({ type: 'dayReview.markReviewed', day: loaded.selectedDay });
      },
    },
  ]);

  const previousButton = (
    <IconButton label="Previous day" icon={ChevronLeftIcon} variant="secondary" onPress={() => changeDay(shiftDay(day, -1))} />
  );
  const nextButton = (
    <IconButton label="Next day" icon={ChevronRightIcon} variant="secondary" isDisabled={!reviewing} onPress={() => changeDay(shiftDay(day, 1))} />
  );
  const errors = [reviewAction.error, agendaAction.error, refresh.error].filter(Boolean);
  const setup =
    connection && !connection.hasSevenPaceToken ? <SetupCard onSetUp={() => navigation.navigate({ place: 'settings', view: 'accounts' })} /> : null;

  if (!reviewing) {
    const pendingDay = prompts?.dayReview && prompts.dayReview.day < today ? prompts.dayReview.day : null;
    return (
      <PlaceBody>
        <div ref={rootRef} className={styles.root}>
          <PlaceHeader
            size="large"
            title={formatDayTitle(today)}
            before={previousButton}
            after={
              <>
                {nextButton}
                <Badge tone="accent">Today</Badge>
              </>
            }
            actions={<TodayProgress />}
          />
          {errors.map((error) => (
            <Banner key={error!.message} tone="error">
              {error!.message}
            </Banner>
          ))}
          {setup}
          <div className={styles.columns}>
            <div className={styles.left}>
              <TrackingNow />
              <Suggestions />
            </div>
            <div className={styles.middle}>
              <YourDayToday today={today} review={reviewVisible ? review : undefined} />
            </div>
            <div className={styles.right}>
              {reviewVisible ? <TodayCheck review={review} today={today} /> : null}
              {reviewVisible && pendingDay ? <PreviousDayCard day={pendingDay} onReview={() => changeDay(pendingDay)} /> : null}
              {navigation.isPageVisible('offlineDrafts') ? <OfflineDraftsCard /> : null}
            </div>
          </div>
        </div>
      </PlaceBody>
    );
  }

  const tracked = loaded ? loaded.summary.sessions.reduce((sum, session) => sum + sessionSeconds(session), 0) : 0;
  const segments: Segment[] = [];
  if (loaded) {
    const perColor = new Map<number, number>();
    for (const session of loaded.summary.sessions) {
      const index = colorOf(session.activity);
      perColor.set(index, (perColor.get(index) ?? 0) + sessionSeconds(session));
    }
    for (const [index, seconds] of perColor) segments.push({ key: String(index), seconds, color: seriesColor(index) });
  }
  const reviewedAt = loaded?.record?.reviewedAt ?? null;

  let content;
  if (!reviewVisible) {
    content = (
      <div className={styles.columns}>
        <div className={styles.middle}>
          <YourDayCalendarOnly day={day} />
        </div>
      </div>
    );
  } else if (review && !review.configured) {
    content = (
      <Card>
        <EmptyState
          icon={DayReviewIcon}
          headingLevel={2}
          title="Connect to review your day"
          description="Your review uses your own 7pace worklogs. Set up your account to get started."
          action={
            <Button variant="primary" onPress={() => navigation.navigate({ place: 'settings', view: 'accounts' })}>
              Open Settings
            </Button>
          }
        />
      </Card>
    );
  } else if (loaded) {
    content = (
      <div className={styles.columns}>
        <div className={styles.left}>
          <TimePerTicket day={day} sessions={loaded.summary.sessions} items={items} colorOf={colorOf} />
        </div>
        <div className={styles.middle}>
          <YourDayReview review={loaded} items={items} colorOf={colorOf} />
        </div>
        <div className={styles.rightWide}>
          <ReviewCheck review={loaded} isToday={false} />
        </div>
      </div>
    );
  } else if (review?.issue && !review.loading) {
    content = (
      <Banner tone="warning" title="Could not refresh worklogs">
        <p>{review.issue}</p>
        <Button size="small" onPress={() => void refresh.run({ type: 'dayReview.refresh' })}>
          Refresh review
        </Button>
      </Banner>
    );
  } else {
    content = (
      <div aria-busy="true" className={styles.loading}>
        <span role="status" className="visually-hidden">
          Loading the day’s worklogs…
        </span>
        <Skeleton shape="rect" height="6rem" />
        <Skeleton lines={4} />
      </div>
    );
  }

  return (
    <PlaceBody>
      <div ref={rootRef} className={styles.root}>
        <PlaceHeader
          size="large"
          title={formatDayTitle(day)}
          before={previousButton}
          after={
            <>
              {nextButton}
              {loaded && !loaded.loading ? (
                reviewedAt ? (
                  <Badge tone="success" icon={SuccessIcon}>
                    Reviewed
                  </Badge>
                ) : (
                  <Badge tone="warning">Not reviewed</Badge>
                )
              ) : null}
              <Button variant="plain" size="small" onPress={() => changeDay(today)}>
                Back to today
              </Button>
            </>
          }
          actions={loaded ? <DayProgress seconds={tracked} target={loaded.targetSeconds} segments={segments} /> : null}
        />
        {errors.map((error) => (
          <Banner key={error!.message} tone="error">
            {error!.message}
          </Banner>
        ))}
        {content}
      </div>
    </PlaceBody>
  );
}
