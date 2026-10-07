import { Button } from '../../components/Button';
import { Skeleton } from '../../components/EmptyState';
import { PauseIcon, PlayIcon, StopIcon } from '../../components/icons';
import type { FlowSurface, Intent, TrackingSlice } from '../../ipc/contract';
import { useSlice, useWorkItem } from '../../state/hooks';
import { TimerDisplay } from '../../timer/TimerDisplay';
import { formatShortDuration } from '../../utils/duration';
import { TicketLink } from '../ticketContext/TicketLink';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { OpenExternalIcon } from './icons';
import { openExternal, openMainPage } from './platform';
import {
  deviceName,
  sessionKey,
  totalsConfirmed,
  trackingStatus,
  useLocalSeconds,
  useProgressSeconds,
  useTrackingSeconds,
} from './status';
import styles from './tracking.module.css';

export type TrackingSurface = 'panel' | 'main';

/** The intent that opens the ticket search on this surface. */
export function openFlow(surface: TrackingSurface): Intent {
  return surface === 'panel' ? { type: 'tracking.beginPanel', branchId: null } : { type: 'tracking.openPicker' };
}

/** The engine's name for this surface, sent with prompt and resume actions (`surface`). */
export function flowSurface(surface: TrackingSurface): FlowSurface {
  return surface === 'panel' ? 'panel' : 'picker';
}

/** The paused session's title as 1.14 showed it ("#4790 · Title" in the panel). */
function pausedTitle(tracking: TrackingSlice): string {
  return tracking.paused?.title || 'Paused tracking';
}

export interface CurrentTrackingProps {
  surface: TrackingSurface;
}

/**
 * The 7pace timer: clock, what runs, and Stop / Pause / Switch, or Resume / Clear pause for a
 * paused session (1.14 `MenuPanel` "Current tracking" and the Overview timer card). Every button
 * that writes is disabled while the engine is busy or 7pace is unreachable.
 */
export function CurrentTracking({ surface }: CurrentTrackingProps) {
  const tracking = useSlice('tracking');
  const connection = useSlice('connection');
  const progress = useSlice('progress');
  const seconds = useTrackingSeconds(tracking);
  const totals = useProgressSeconds(progress);
  const guards = useWriteGuards();
  const actions = useIntents();
  const pausedItem = useWorkItem(tracking?.paused?.ticketId);

  if (!tracking || !connection) {
    return (
      <div aria-busy="true" className={styles.stack}>
        <span role="status" className="visually-hidden">
          Loading the current timer
        </span>
        <Skeleton shape="rect" height="4rem" />
        <Skeleton lines={2} />
      </div>
    );
  }

  const status = trackingStatus(connection);
  const running = tracking.running;
  const paused = !running && tracking.paused ? tracking.paused : null;
  const writeDisabled = guards.busy || !guards.connected;
  const panel = surface === 'panel';
  const ticketId = running ? tracking.ticketId : (paused?.ticketId ?? null);

  const timer = (
    <TimerDisplay
      seconds={seconds}
      status={status}
      sessionId={sessionKey(tracking)}
      todaySeconds={totals?.today ?? null}
      dailyTargetSeconds={progress?.todayTarget ?? 0}
      totalsConfirmed={totalsConfirmed(connection, progress)}
      size={panel ? 'medium' : 'large'}
    />
  );

  const pauseStop = running ? (
    <>
      <Button
        icon={PauseIcon}
        isDisabled={writeDisabled}
        isPending={actions.isPending('pause')}
        onPress={() => void actions.run('pause', { type: 'tracking.pause' })}
      >
        Pause
      </Button>
      <Button
        icon={StopIcon}
        isDisabled={writeDisabled}
        isPending={actions.isPending('stop')}
        onPress={() => void actions.run('stop', { type: 'tracking.stop' })}
      >
        Stop
      </Button>
    </>
  ) : null;

  const resume = paused ? (
    <>
      <Button
        variant="primary"
        icon={PlayIcon}
        data-current-primary=""
        isDisabled={writeDisabled}
        isPending={actions.isPending('resume')}
        onPress={() => void actions.run('resume', { type: 'tracking.resume', surface: flowSurface(surface) })}
      >
        {panel ? 'Resume…' : 'Resume tracking…'}
      </Button>
      <Button
        isDisabled={guards.busy}
        isPending={actions.isPending('discard')}
        onPress={() => void actions.run('discard', { type: 'tracking.discardPause' })}
      >
        Clear pause
      </Button>
    </>
  ) : null;

  const switchTicket = !paused ? (
    <Button
      variant="primary"
      data-current-primary=""
      isDisabled={writeDisabled}
      isPending={actions.isPending('switch')}
      onPress={() => void actions.run('switch', openFlow(surface))}
    >
      {running ? 'Switch ticket…' : 'Start tracking…'}
    </Button>
  ) : null;

  if (panel) {
    return (
      <div className={styles.stack}>
        {timer}
        {running ? (
          <div className={styles.summary}>
            {ticketId !== null && tracking.ticketUrl ? (
              <Button
                variant="plain"
                size="small"
                trailingIcon={OpenExternalIcon}
                className={styles.ticketLink}
                aria-label={`#${ticketId}, open in Azure DevOps`}
                onPress={() => openExternal(tracking.ticketUrl!)}
              >
                {`#${ticketId}`}
              </Button>
            ) : null}
            <p className={styles.trackingTitle}>{tracking.title}</p>
            {tracking.activityName ? <p className={styles.caption}>{tracking.activityName}</p> : null}
            {tracking.remark && tracking.remark !== tracking.title ? (
              <p className={styles.caption}>{tracking.remark}</p>
            ) : null}
          </div>
        ) : paused ? (
          <div className={styles.summary}>
            <p className={styles.trackingTitle}>
              {(paused.ticketId !== null ? `#${paused.ticketId} · ` : '') + (pausedItem?.title ?? pausedTitle(tracking))}
            </p>
            <p className={styles.caption}>Paused · no new time is logged</p>
          </div>
        ) : (
          <p className={styles.caption}>No timer running</p>
        )}
        <div className={styles.actions}>
          {resume ?? switchTicket}
          {pauseStop ? <div className={styles.trailing}>{pauseStop}</div> : null}
        </div>
        <ActionError error={actions.error} />
        {actions.confirmation}
      </div>
    );
  }

  const eyebrow = running
    ? connection.connected
      ? 'Currently tracking'
      : 'Last known timer'
    : paused
      ? 'Paused · no time logged'
      : 'Ready when you are';
  const title = running ? tracking.title : paused ? (pausedItem?.title ?? pausedTitle(tracking)) : 'Your next focus starts here.';
  const remark = running ? tracking.remark : (paused?.remark ?? null);

  return (
    <div className={styles.timerCard}>
      <div className={styles.timerText}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <p className={styles.timerTitle}>{title}</p>
        {ticketId !== null ? (
          <div className={styles.row}>
            <TicketLink ticketId={ticketId} compact />
          </div>
        ) : (
          <p className={styles.caption}>
            {running || paused
              ? `No Azure ticket · ${remark ?? ''}`
              : 'Choose a ticket, or switch branches to get a suggestion.'}
          </p>
        )}
        {running && tracking.activityName ? <p className={styles.caption}>{tracking.activityName}</p> : null}
        {paused?.activityName ? <p className={styles.caption}>{paused.activityName}</p> : null}
      </div>
      <div className={styles.timerSide}>
        {timer}
        {!running && !paused ? (
          <p className={styles.eyebrow}>{`Today ${formatShortDuration(tracking.todaySeconds)}`}</p>
        ) : null}
        <div className={styles.actions}>
          {resume}
          {pauseStop}
          {switchTicket}
        </div>
      </div>
      <ActionError error={actions.error} />
      {actions.confirmation}
    </div>
  );
}

/**
 * The running offline draft (1.14 `LocalTimerView`): saved on this device, not uploaded to 7pace
 * until reviewed in Offline drafts. Renders nothing without a local timer.
 */
export function LocalTimer({ surface }: { surface: TrackingSurface }) {
  const tracking = useSlice('tracking');
  const offline = useSlice('offline');
  const seconds = useLocalSeconds(tracking);
  const actions = useIntents();
  const local = tracking?.local;
  if (!local) return null;
  const panel = surface === 'panel';
  return (
    <div className={styles.stack}>
      <TimerDisplay
        seconds={seconds}
        status="running"
        sessionId={local.draftId}
        todaySeconds={null}
        dailyTargetSeconds={0}
        totalsConfirmed={false}
        detail="Not uploaded to 7pace"
        size={panel ? 'medium' : 'large'}
        label="Local timer"
      />
      <p className={styles.trackingTitle}>{local.title}</p>
      {local.ticketId !== null && local.comment ? <p className={styles.caption}>{local.comment}</p> : null}
      {local.activityName ? <p className={styles.caption}>{local.activityName}</p> : null}
      <div className={styles.actions}>
        <Button onPress={() => openMainPage('offlineDrafts')}>Review drafts</Button>
        <Button
          variant="primary"
          icon={StopIcon}
          isDisabled={offline?.working ?? false}
          isPending={actions.isPending('stopLocal')}
          onPress={() => void actions.run('stopLocal', { type: 'offline.stopLocal' })}
        >
          Stop local timer
        </Button>
      </div>
      {offline?.issue ? (
        <p role="alert" className={styles.warning}>
          {offline.issue}
        </p>
      ) : null}
      <ActionError error={actions.error} />
    </div>
  );
}

/** "Local tracking · saved on this Mac" (or "this computer" on Windows). */
export function useLocalTimerTitle(): string {
  const app = useSlice('app');
  return `Local tracking · saved on ${deviceName(app?.os)}`;
}
