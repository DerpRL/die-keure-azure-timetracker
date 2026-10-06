import { MiniTimerShell } from '../../layout/MiniTimerShell';
import { TrackingStatusLabel } from '../../timer/status';
import { TimerDisplay } from '../../timer/TimerDisplay';

/** The floating mini timer window. Placeholder until built. */
export function MiniTimerView() {
  return (
    <MiniTimerShell caption={<TrackingStatusLabel status="stopped" label="No timer running" />}>
      <TimerDisplay seconds={0} status="stopped" sessionId="idle" size="small" showRing={false} />
    </MiniTimerShell>
  );
}
