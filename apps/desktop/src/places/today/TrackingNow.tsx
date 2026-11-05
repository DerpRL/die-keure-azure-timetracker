import { useId } from 'react';
import { useDateFormatter } from 'react-aria';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Skeleton } from '../../components/EmptyState';
import { PlayIcon } from '../../components/icons';
import { ActivityChip, activityColorIndex, useActivityColors } from '../../features/activity';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { ActionError, useIntents, useWriteGuards } from '../../features/tracking/actions';
import { LocalTimer, flowSurface, openFlow, useLocalTimerTitle } from '../../features/tracking/CurrentTracking';
import { useTrackingSeconds } from '../../features/tracking/status';
import type { TrackingSlice } from '../../ipc/contract';
import { useSlice, useWorkItem } from '../../state/hooks';
import { formatClock, formatShortDuration } from '../../utils/duration';
import styles from './today.module.css';

/** When the running session started: the confirmed elapsed time back from its confirmation. */
function sessionStart(tracking: TrackingSlice): Date | null {
  if (!tracking.running || !tracking.confirmedAt) return null;
  const confirmed = Date.parse(tracking.confirmedAt);
  if (!Number.isFinite(confirmed) || !Number.isFinite(tracking.elapsedBase)) return null;
  return new Date(confirmed - tracking.elapsedBase * 1000);
}

/**
 * "Tracking now" (2.2 Today): what runs, the clock and Pause / Stop / Switch…; Resume or Clear
 * pause for a paused session; Start tracking… when nothing runs. The offline local timer, when
 * there is one, follows in the same card. Writes are disabled while busy or disconnected.
 */
export function TrackingNow() {
  const tracking = useSlice('tracking');
  const connection = useSlice('connection');
  const seconds = useTrackingSeconds(tracking);
  const guards = useWriteGuards();
  const actions = useIntents();
  const colors = useActivityColors();
  const pausedItem = useWorkItem(tracking?.paused?.ticketId);
  const localTitle = useLocalTimerTitle();
  const headingId = useId();
  const localHeadingId = useId();
  const clock = useDateFormatter({ hour: '2-digit', minute: '2-digit' });
  const clockWithDay = useDateFormatter({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (!tracking || !connection) {
    return (
      <Card as="section" aria-labelledby={headingId} className={styles.cardStack}>
        <h2 id={headingId} className={styles.eyebrow}>
          Tracking now
        </h2>
        <div aria-busy="true">
          <span role="status" className="visually-hidden">
            Loading the current timer
          </span>
          <Skeleton shape="rect" height="3rem" />
        </div>
      </Card>
    );
  }

  const running = tracking.running;
  const paused = !running && tracking.paused ? tracking.paused : null;
  const writeDisabled = guards.busy || !guards.connected;
  const ticketId = running ? tracking.ticketId : (paused?.ticketId ?? null);
  const activityId = running ? tracking.activityId : (paused?.activityId ?? null);
  const activityName = running ? tracking.activityName : (paused?.activityName ?? null);
  const started = sessionStart(tracking);
  const startedToday = started ? started.toDateString() === new Date().toDateString() : false;
  const since = started ? `since ${(startedToday ? clock : clockWithDay).format(started)}` : null;
  const showRemote = tracking.showsRemoteTimer !== false;

  const eyebrow = running
    ? connection.connected
      ? 'Tracking now'
      : 'Last known timer'
    : paused
      ? 'Paused · no time logged'
      : 'Not tracking';
  const title = running ? tracking.title : paused ? (pausedItem?.title ?? paused.title ?? 'Paused tracking') : 'Ready when you are';
  const remark = running ? tracking.remark : (paused?.remark ?? null);

  return (
    <Card as="section" aria-labelledby={headingId} className={styles.cardStack}>
      {showRemote ? (
        <>
          <div className={styles.cardHeadRow}>
            <h2 id={headingId} className={styles.eyebrow}>
              {eyebrow}
            </h2>
            {(running || paused) && activityName ? (
              <ActivityChip name={activityName} colorIndex={activityColorIndex(colors, activityId)} />
            ) : null}
          </div>
          <div className={styles.nowText}>
            <p className={styles.nowTitle}>{title}</p>
            <p className={styles.nowMeta}>
              {ticketId !== null ? <TicketLink ticketId={ticketId} compact /> : null}
              {ticketId !== null && since ? ' · ' : null}
              {since}
              {!running && !paused ? `Today ${formatShortDuration(tracking.todaySeconds)}` : null}
            </p>
            {(running || paused) && ticketId === null && remark ? <p className={styles.caption}>{`No Azure ticket · ${remark}`}</p> : null}
          </div>
          <span className={styles.bigClock}>{paused ? 'Paused' : formatClock(running ? seconds : 0)}</span>
          {running ? (
            <div className={styles.threeButtons}>
              <Button
                isDisabled={writeDisabled}
                isPending={actions.isPending('pause')}
                onPress={() => void actions.run('pause', { type: 'tracking.pause' })}
              >
                Pause
              </Button>
              <Button
                isDisabled={writeDisabled}
                isPending={actions.isPending('stop')}
                onPress={() => void actions.run('stop', { type: 'tracking.stop' })}
              >
                Stop
              </Button>
              <Button
                variant="primary"
                data-current-primary=""
                isDisabled={writeDisabled}
                isPending={actions.isPending('switch')}
                aria-label="Switch ticket…"
                onPress={() => void actions.run('switch', openFlow('main'))}
              >
                Switch…
              </Button>
            </div>
          ) : paused ? (
            <div className={styles.twoButtons}>
              <Button
                variant="primary"
                data-current-primary=""
                isDisabled={writeDisabled}
                isPending={actions.isPending('resume')}
                onPress={() => void actions.run('resume', { type: 'tracking.resume', surface: flowSurface('main') })}
              >
                Resume…
              </Button>
              <Button
                isDisabled={guards.busy}
                isPending={actions.isPending('discard')}
                onPress={() => void actions.run('discard', { type: 'tracking.discardPause' })}
              >
                Clear pause
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              icon={PlayIcon}
              data-current-primary=""
              fullWidth
              isDisabled={writeDisabled}
              isPending={actions.isPending('switch')}
              onPress={() => void actions.run('switch', openFlow('main'))}
            >
              Start tracking…
            </Button>
          )}
          <ActionError error={actions.error} />
          {actions.confirmation}
        </>
      ) : (
        <h2 id={headingId} className={styles.eyebrow}>
          Tracking now
        </h2>
      )}
      {tracking.local ? (
        <section aria-labelledby={localHeadingId} className={styles.localTimer}>
          <h3 id={localHeadingId} className={styles.subTitle}>
            {localTitle}
          </h3>
          <LocalTimer surface="main" />
        </section>
      ) : null}
    </Card>
  );
}
