import { AwarenessSection } from '../../../features/settings/AwarenessSection';
import { DayReviewSection } from '../../../features/settings/DayReviewSection';
import { MeetingSuggestionsSection, MicrophoneSection } from '../../../features/settings/MeetingsSections';
import { NotificationsSection } from '../../../features/settings/NotificationsSection';
import { DailyTargetsSection, HolidaysSection } from '../../../features/settings/TargetsSection';
import { TimerSection } from '../../../features/settings/TrackingSection';
import { useSlice } from '../../../state/hooks';

/**
 * Settings → Targets & reminders (design "S4c · Settings — Tracking"): daily targets, meetings,
 * the day check and notifications, then the cards the 1.14 Tracking settings had besides them.
 */
export function TrackingView() {
  const app = useSlice('app');
  const calendar = app?.features.calendar ?? true;
  return (
    <>
      <DailyTargetsSection />
      <HolidaysSection />
      {calendar ? <MeetingSuggestionsSection /> : null}
      <MicrophoneSection />
      <DayReviewSection />
      <NotificationsSection />
      <TimerSection />
      <AwarenessSection />
    </>
  );
}
