import type { CSSProperties } from 'react';
import { Button } from '../../components/Button';
import { Skeleton } from '../../components/EmptyState';
import { PauseIcon, PlayIcon, StopIcon } from '../../components/icons';
import type { FlowSurface, Intent, TrackingSlice } from '../../ipc/contract';
import { useDateFormatter } from 'react-aria';
import { useSlice, useWorkItem } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { ActivityChip, activityColor, activityColorIndex, useActivityColors } from '../activity';
import { TimerDisplay } from '../../timer/TimerDisplay';
import { formatShortDuration } from '../../utils/duration';
import { TicketLink } from '../ticketContext/TicketLink';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { DeleteLocalTimer } from './DeleteLocalTimer';
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
import { t } from '../../i18n';

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
  return tracking.paused?.title || t('Paused tracking');
}

export interface CurrentTrackingProps {
  surface: TrackingSurface;
}

/** When the running session started: the confirmed elapsed time back from its confirmation. */
function sessionStart(tracking: TrackingSlice): Date | null {
  if (!tracking.running || !tracking.confirmedAt) return null;
  const confirmed = Date.parse(tracking.confirmedAt);
  if (!Number.isFinite(confirmed) || !Number.isFinite(tracking.elapsedBase)) return null;
  return new Date(confirmed - tracking.elapsedBase * 1000);
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
  const colors = useActivityColors();
  const clock = useDateFormatter({ hour: '2-digit', minute: '2-digit' });
  const clockWithDay = useDateFormatter({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (!tracking || !connection) {
    return (
      <div aria-busy="true" className={styles.stack}>
        <span role="status" className="visually-hidden">
          {t('Loading the current timer')}
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
      indicator="bar"
      className={styles.clock}
    />
  );

  const activityId = running ? tracking.activityId : (paused?.activityId ?? null);
  const activityName = running ? tracking.activityName : (paused?.activityName ?? null);
  const activityChip = activityName ? (
    <ActivityChip name={activityName} colorIndex={activityColorIndex(colors, activityId)} />
  ) : null;
  const started = sessionStart(tracking);
  // A session that began before today names its day: "since 6 Oct, 08:36".
  const startedToday = started ? started.toDateString() === new Date().toDateString() : false;
  const since = started ? t('since {time}', { time: (startedToday ? clock : clockWithDay).format(started) }) : null;

  const pauseStop = running ? (
    <>
      <Button
        icon={PauseIcon}
        isDisabled={writeDisabled}
        isPending={actions.isPending('pause')}
        onPress={() => void actions.run('pause', { type: 'tracking.pause' })}
      >
        {t('Pause')}
      </Button>
      <Button
        icon={StopIcon}
        isDisabled={writeDisabled}
        isPending={actions.isPending('stop')}
        onPress={() => void actions.run('stop', { type: 'tracking.stop' })}
      >
        {t('Stop')}
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
        {panel ? t('Resume…') : t('Resume tracking…')}
      </Button>
      <Button
        isDisabled={guards.busy}
        isPending={actions.isPending('discard')}
        onPress={() => void actions.run('discard', { type: 'tracking.discardPause' })}
      >
        {t('Clear pause')}
      </Button>
    </>
  ) : null;

  const switchTicket = !paused ? (
    <Button
      variant="primary"
      data-current-primary=""
      isDisabled={writeDisabled}
      isPending={actions.isPending('switch')}
      // The narrow panel says "Switch…" so the three buttons share one row (the name stays complete).
      aria-label={running && panel ? t('Switch ticket…') : undefined}
      onPress={() => void actions.run('switch', openFlow(surface))}
    >
      {running ? (panel ? t('Switch…') : t('Switch ticket…')) : t('Start tracking…')}
    </Button>
  ) : null;

  if (panel) {
    const today = totals?.today ?? null;
    const target = progress?.todayTarget ?? 0;
    const fraction = today !== null && target > 0 ? Math.min(1, today / target) : 0;
    const stale = !totalsConfirmed(connection, progress);
    const todayText = today !== null ? formatShortDuration(today) : '–';
    let barLabel =
      target > 0
        ? t('Today {today} of {target}', { today: todayText, target: formatShortDuration(target) })
        : t('Today {today}', { today: todayText });
    if (stale) barLabel = t('{label}, last known', { label: barLabel });
    if (activityName) barLabel = `${activityName}. ${barLabel}`;
    const small = { size: 'small' as const };
    return (
      <div className={cx(styles.stack, styles.panelBox)}>
        {running ? (
          <div className={styles.panelTitleRow}>
            <p className={styles.panelTitle}>{tracking.title}</p>
            {ticketId !== null && tracking.ticketUrl ? (
              <Button
                variant="plain"
                size="small"
                trailingIcon={OpenExternalIcon}
                className={styles.panelTicket}
                aria-label={t('#{id}, open in Azure DevOps', { id: ticketId })}
                onPress={() => openExternal(tracking.ticketUrl!)}
              >
                {`#${ticketId}`}
              </Button>
            ) : ticketId !== null ? (
              <span className={styles.panelTicket}>{`#${ticketId}`}</span>
            ) : null}
          </div>
        ) : paused ? (
          <div className={styles.summary}>
            <p className={styles.panelTitle}>
              {(paused.ticketId !== null ? `#${paused.ticketId} · ` : '') + (pausedItem?.title ?? pausedTitle(tracking))}
            </p>
            <p className={styles.caption}>{t('Paused · no new time is logged')}</p>
          </div>
        ) : null}
        <div className={styles.panelClockRow}>
          <TimerDisplay
            seconds={seconds}
            status={status}
            sessionId={sessionKey(tracking)}
            size="medium"
            showRing={false}
            className={cx(styles.panelClock, !running && styles.panelClockIdle)}
          />
          <span className={styles.panelToday}>
            <span className={styles.panelTodayLabel}>{t('Today')}</span>
            <span className={styles.panelTodayValue}>
              {todayText}
              {target > 0 ? <span className={styles.panelTodayTarget}>{` / ${formatShortDuration(target)}`}</span> : null}
            </span>
          </span>
        </div>
        <div
          role="img"
          aria-label={barLabel}
          className={cx(styles.panelBar, stale && styles.panelBarStale)}
          style={{ '--activity-color': activityId ? activityColor(colors, activityId) : 'var(--color-primary)' } as CSSProperties}
        >
          <span className={styles.panelBarFill} style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <div className={cx(styles.actions, running ? styles.panelActions : styles.panelActionsWide)}>
          {running ? (
            <>
              <Button
                {...small}
                isDisabled={writeDisabled}
                isPending={actions.isPending('pause')}
                onPress={() => void actions.run('pause', { type: 'tracking.pause' })}
              >
                {t('Pause')}
              </Button>
              <Button
                {...small}
                isDisabled={writeDisabled}
                isPending={actions.isPending('stop')}
                onPress={() => void actions.run('stop', { type: 'tracking.stop' })}
              >
                {t('Stop')}
              </Button>
            </>
          ) : null}
          {resume ?? (
            <Button
              {...small}
              variant="primary"
              icon={running ? undefined : PlayIcon}
              data-current-primary=""
              isDisabled={writeDisabled}
              isPending={actions.isPending('switch')}
              // "Switch…" fits three buttons on one row; the name stays complete.
              aria-label={running ? t('Switch ticket…') : undefined}
              onPress={() => void actions.run('switch', openFlow(surface))}
            >
              {running ? t('Switch…') : t('Start tracking…')}
            </Button>
          )}
        </div>
        <ActionError error={actions.error} />
        {actions.confirmation}
      </div>
    );
  }

  const eyebrow = running
    ? connection.connected
      ? t('Currently tracking')
      : t('Last known timer')
    : paused
      ? t('Paused · no time logged')
      : t('Ready when you are');
  const title = running ? tracking.title : paused ? (pausedItem?.title ?? pausedTitle(tracking)) : t('Your next focus starts here.');
  const remark = running ? tracking.remark : (paused?.remark ?? null);

  return (
    <div className={styles.timerCard}>
      <div className={styles.timerText}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <p className={styles.timerTitle}>{title}</p>
        <div className={styles.metaLine}>
          {ticketId !== null ? <TicketLink ticketId={ticketId} compact /> : null}
          {running || paused ? activityChip : null}
          {since ? <span>{since}</span> : null}
        </div>
        {ticketId === null ? (
          <p className={styles.caption}>
            {running || paused
              ? t('No Azure ticket · {remark}', { remark: remark ?? '' })
              : t('Choose a ticket, or switch branches to get a suggestion.')}
          </p>
        ) : null}
      </div>
      <div className={styles.timerSide}>
        {timer}
        {!running && !paused ? (
          <p className={styles.eyebrow}>{t('Today {today}', { today: formatShortDuration(tracking.todaySeconds) })}</p>
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
        detail={t('Not uploaded to 7pace')}
        size={panel ? 'medium' : 'large'}
        label={t('Local timer')}
      />
      <p className={styles.trackingTitle}>{local.title}</p>
      {local.otherWorkspace ? <p className={styles.warning}>{t('Workspace: {name}', { name: local.otherWorkspace })}</p> : null}
      {local.ticketId !== null && local.comment ? <p className={styles.caption}>{local.comment}</p> : null}
      {local.activityName ? <p className={styles.caption}>{local.activityName}</p> : null}
      <div className={styles.actions}>
        <Button onPress={() => openMainPage('offlineDrafts')}>{t('Review drafts')}</Button>
        <Button
          variant="primary"
          icon={StopIcon}
          isDisabled={offline?.working ?? false}
          isPending={actions.isPending('stopLocal')}
          onPress={() => void actions.run('stopLocal', { type: 'offline.stopLocal' })}
        >
          {t('Stop local timer')}
        </Button>
        <DeleteLocalTimer
          draftId={local.draftId}
          isDisabled={(offline?.working ?? false) || actions.isPending('stopLocal')}
        />
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
  return t('Local tracking · saved on {device}', { device: deviceName(app?.os) });
}
