import { useEffect } from 'react';
import { IconButton } from '../../components/Button';
import { Skeleton } from '../../components/EmptyState';
import { OfflineDraftsIcon } from '../../components/icons';
import { MiniTimerShell } from '../../layout/MiniTimerShell';
import { useSlice } from '../../state/hooks';
import { TRACKING_STATUS, type TrackingStatus } from '../../timer/status';
import { TimerDisplay } from '../../timer/TimerDisplay';
import { OpenPanelIcon } from '../tracking/icons';
import { togglePanelWindow } from '../tracking/platform';
import { sessionKey, trackingStatus, useLocalSeconds, useTrackingSeconds } from '../tracking/status';
import styles from './mini.module.css';

/** The status symbol and, for screen readers, its word, before the caption text. */
function Caption({ status, text, local }: { status: TrackingStatus; text: string; local: boolean }) {
  const info = TRACKING_STATUS[status];
  const Icon = local ? OfflineDraftsIcon : info.icon;
  return (
    <span className={styles.caption} title={text}>
      <Icon className={styles.captionIcon} />
      <span className="visually-hidden">{local ? 'Local tracking: ' : `${info.label}: `}</span>
      <span className={styles.captionText}>{text}</span>
    </span>
  );
}

/**
 * The floating mini timer (Windows replaces the tray title with it; optional on macOS): the
 * running clock and what it tracks, the local timer first when it leads. The window is a drag
 * region except its button; the button (or Return) opens the panel.
 */
export function MiniTimerView() {
  const tracking = useSlice('tracking');
  const connection = useSlice('connection');
  const remoteSeconds = useTrackingSeconds(tracking);
  const localSeconds = useLocalSeconds(tracking);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.repeat) return;
      // A focused button handles Return itself.
      if (event.target instanceof Element && event.target.closest('button')) return;
      event.preventDefault();
      togglePanelWindow();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openPanel = (
    <IconButton label="Show the Azure timetracker panel" icon={OpenPanelIcon} size="small" tooltip={false} onPress={togglePanelWindow} />
  );

  if (!tracking || !connection) {
    return (
      <MiniTimerShell actions={openPanel} caption={<span className={styles.caption}>Connecting…</span>}>
        <div data-tauri-drag-region="deep" className={styles.readout}>
          {/* The clock's place, busy until the engine reports the timer (never a made-up 0). */}
          <div role="timer" aria-label="Elapsed time" aria-busy="true">
            <Skeleton width="6rem" />
          </div>
        </div>
      </MiniTimerShell>
    );
  }

  const local = tracking.showsLocalTimer ? tracking.local : null;
  const paused = !tracking.running && tracking.paused ? tracking.paused : null;
  const status: TrackingStatus = local ? 'running' : trackingStatus(connection);
  const idle = !local && !tracking.running && !paused;
  const text = local
    ? local.title
    : tracking.running
      ? tracking.title
      : paused
        ? `Paused · ${paused.title}`
        : 'No timer running';

  return (
    <MiniTimerShell actions={openPanel} caption={<Caption status={status} text={text} local={local !== null} />}>
      <div data-tauri-drag-region="deep" className={styles.readout}>
        {idle ? (
          <p className={styles.idle}>No timer running</p>
        ) : (
          <TimerDisplay
            seconds={local ? localSeconds : remoteSeconds}
            status={status}
            sessionId={local ? local.draftId : sessionKey(tracking)}
            size="small"
            showRing={false}
            label={local ? 'Local timer' : 'Elapsed time'}
          />
        )}
      </div>
    </MiniTimerShell>
  );
}
