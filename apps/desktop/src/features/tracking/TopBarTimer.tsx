import type { CSSProperties } from 'react';
import { Button, IconButton } from '../../components/Button';
import { PauseIcon, PlayIcon, StopIcon } from '../../components/icons';
import { useSlice, useWorkItem } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { formatClock } from '../../utils/duration';
import { activityColor, useActivityColors } from '../activity';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { flowSurface, openFlow } from './CurrentTracking';
import { useTrackingSeconds } from './status';
import styles from './TopBarTimer.module.css';
import { t } from '../../i18n';

type Tint = CSSProperties & { '--activity-color': string };

/**
 * The 7pace timer in the main window's top bar, so it stays in reach on every view (2.2 layout):
 * what runs, the clock and Pause / Stop; Resume for a paused session; Start tracking… otherwise.
 * The clock is plain text, not a live region: nothing is announced per second.
 */
export function TopBarTimer() {
  const tracking = useSlice('tracking');
  const seconds = useTrackingSeconds(tracking);
  const guards = useWriteGuards();
  const actions = useIntents();
  const colors = useActivityColors();
  const pausedItem = useWorkItem(tracking?.paused?.ticketId);
  if (!tracking) return null;

  const writeDisabled = guards.busy || !guards.connected;
  const running = tracking.running;
  const paused = !running && tracking.paused ? tracking.paused : null;

  if (!running && !paused) {
    return (
      <div className={styles.slot}>
        <Button
          variant="primary"
          icon={PlayIcon}
          isDisabled={guards.busy}
          isPending={actions.isPending('start')}
          shortcut={{ key: 'n', mod: true }}
          onPress={() => void actions.run('start', openFlow('main'))}
        >
          {t('Start tracking…')}
        </Button>
        <ActionError error={actions.error} className={styles.error} />
        {actions.confirmation}
      </div>
    );
  }

  const ticketId = running ? tracking.ticketId : paused!.ticketId;
  const title = running ? tracking.title : (pausedItem?.title ?? paused!.title ?? t('Paused tracking'));
  const label = `${ticketId !== null ? `#${ticketId} ` : ''}${title}`;
  const activityId = running ? tracking.activityId : paused!.activityId;
  const tint: Tint = { '--activity-color': activityColor(colors, activityId) };

  return (
    <div className={styles.slot}>
      <div
        role="group"
        aria-label={running ? t('Running timer') : t('Paused timer')}
        className={cx(styles.timer, paused && styles.paused)}
        style={tint}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.title} title={label}>
          {label}
        </span>
        <span className={styles.clock}>{running ? formatClock(seconds) : t('Paused')}</span>
        {running ? (
          <>
            <IconButton
              label={t('Pause timer')}
              icon={PauseIcon}
              variant="secondary"
              size="small"
              className={styles.control}
              isDisabled={writeDisabled}
              isPending={actions.isPending('pause')}
              onPress={() => void actions.run('pause', { type: 'tracking.pause' })}
            />
            <IconButton
              label={t('Stop timer')}
              icon={StopIcon}
              variant="secondary"
              size="small"
              className={styles.control}
              isDisabled={writeDisabled}
              isPending={actions.isPending('stop')}
              onPress={() => void actions.run('stop', { type: 'tracking.stop' })}
            />
          </>
        ) : (
          <IconButton
            label={t('Resume tracking…')}
            icon={PlayIcon}
            variant="secondary"
            size="small"
            className={styles.control}
            isDisabled={writeDisabled}
            isPending={actions.isPending('resume')}
            onPress={() => void actions.run('resume', { type: 'tracking.resume', surface: flowSurface('main') })}
          />
        )}
      </div>
      <ActionError error={actions.error} className={styles.error} />
      {actions.confirmation}
    </div>
  );
}
