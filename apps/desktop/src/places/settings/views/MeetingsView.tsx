import { MeetingSuggestionsSection, MicrophoneSection } from '../../../features/settings/MeetingsSections';
import { useSlice } from '../../../state/hooks';

/** Settings → Meetings (design "S4c"): calendar meetings and calls without a calendar event. */
export function MeetingsView() {
  const app = useSlice('app');
  const calendar = app?.features.calendar ?? true;
  return (
    <>
      {calendar ? <MeetingSuggestionsSection /> : null}
      <MicrophoneSection />
    </>
  );
}
