import { usePlaceView } from '../../layout/NavigationContext';
import type { TimesheetView } from '../../layout/navigation';
import { PlaceBody } from '../../layout/Place';
import { DayView } from './day';
import { DraftsView } from './drafts';
import { ListView } from './list';
import { WeekView } from './week/WeekView';

/**
 * Timesheet (2.2 layout): fix and check your time. Week (calendar), Day (the 1.14 Time editor),
 * List (the 1.14 History) and Drafts (the 1.14 Offline drafts), switched in each view's header.
 */
export default function TimesheetPlace() {
  const { view } = usePlaceView<TimesheetView>('timesheet');
  return (
    <PlaceBody>
      {view === 'week' ? <WeekView /> : view === 'day' ? <DayView /> : view === 'list' ? <ListView /> : <DraftsView />}
    </PlaceBody>
  );
}
