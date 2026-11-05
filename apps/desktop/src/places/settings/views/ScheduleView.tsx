import { DailyTargetsSection, ExceptionsSection, HolidaysSection, WorkdaySection } from '../../../features/settings/TargetsSection';

/** Settings → Schedule & holidays (design "S4b"): the weekly target, workday, holidays and exceptions. */
export function ScheduleView() {
  return (
    <>
      <DailyTargetsSection />
      <WorkdaySection />
      <HolidaysSection />
      <ExceptionsSection />
    </>
  );
}
