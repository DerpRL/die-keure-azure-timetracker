import { AwarenessSection, WorkAppsSection } from '../../../features/settings/AwarenessSection';
import { DayReviewSection } from '../../../features/settings/DayReviewSection';
import { TimerSection } from '../../../features/settings/TrackingSection';

/** Settings → Reminders (design "S4d"): timer defaults, time awareness, work apps and the day review. */
export function RemindersView() {
  return (
    <>
      <TimerSection />
      <AwarenessSection />
      <WorkAppsSection />
      <DayReviewSection />
    </>
  );
}
