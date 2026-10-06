import { Button } from '../components/Button';
import { DayReviewIcon, OverviewIcon, PowerIcon, SettingsIcon } from '../components/icons';
import { PanelSection, PanelSectionGrid, PanelShell } from '../layout/PanelShell';
import { TrackingStatusLabel } from '../timer/status';
import { TimerDisplay } from '../timer/TimerDisplay';
import styles from './surfaces.module.css';

/** Tray panel placeholder: the structure of 1.14's menu panel, without engine data yet. */
export function PanelSurface() {
  return (
    <div className={styles.fill}>
      <PanelShell
        status={<TrackingStatusLabel status="stopped" />}
        footer={
          <PanelSectionGrid
            links={[
              { id: 'overview', label: 'Overview', icon: OverviewIcon, onPress: () => {} },
              { id: 'dayReview', label: 'Day review', icon: DayReviewIcon, onPress: () => {} },
              { id: 'settings', label: 'Settings', icon: SettingsIcon, onPress: () => {} },
              {
                id: 'quit',
                label: 'Quit app',
                icon: PowerIcon,
                onPress: () => {},
                description: 'Quitting leaves the 7pace timer running',
              },
            ]}
          />
        }
      >
        <PanelSection title="Current tracking">
          <TimerDisplay seconds={0} status="stopped" sessionId="idle" dailyTargetSeconds={27360} todaySeconds={null} />
          <p className={styles.muted}>No timer running</p>
          <div className={styles.row}>
            <Button variant="primary" isDisabled>
              Start tracking…
            </Button>
          </div>
        </PanelSection>
      </PanelShell>
    </div>
  );
}
