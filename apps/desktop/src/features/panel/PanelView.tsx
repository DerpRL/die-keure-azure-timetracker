import { Button } from '../../components/Button';
import { DayReviewIcon, OverviewIcon, PowerIcon, SettingsIcon } from '../../components/icons';
import { PanelSection, PanelSectionGrid, PanelShell } from '../../layout/PanelShell';
import { TrackingStatusLabel } from '../../timer/status';
import { TimerDisplay } from '../../timer/TimerDisplay';

/** The tray panel (1.14 menu panel). Placeholder until built: the static structure only. */
export function PanelView() {
  return (
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
        <Button variant="primary" isDisabled>
          Start tracking…
        </Button>
      </PanelSection>
    </PanelShell>
  );
}
