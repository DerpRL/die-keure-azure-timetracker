import { CalendarListSection, CalendarSection } from '../../../features/settings/MeetingsSections';

/** Settings → Calendars (design "S4h"): access, events on Today and which calendars count. */
export function CalendarsView() {
  return (
    <>
      <CalendarSection />
      <CalendarListSection />
    </>
  );
}
