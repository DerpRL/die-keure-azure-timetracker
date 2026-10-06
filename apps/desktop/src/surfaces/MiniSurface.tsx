import { MiniTimerShell } from '../layout/MiniTimerShell';
import { TrackingStatusLabel } from '../timer/status';
import { TimerDisplay } from '../timer/TimerDisplay';
import styles from './surfaces.module.css';

/** Floating mini timer placeholder (Windows replaces the menu-bar text with this window). */
export function MiniSurface() {
  return (
    <div className={styles.fill}>
      <MiniTimerShell caption={<TrackingStatusLabel status="stopped" label="No timer running" />}>
        <TimerDisplay seconds={0} status="stopped" sessionId="idle" size="small" showRing={false} />
      </MiniTimerShell>
    </div>
  );
}
