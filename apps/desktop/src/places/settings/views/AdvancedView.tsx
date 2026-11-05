import { DataSection, ResetSection, SyncIntervalsSection, UpdatesSection } from '../../../features/settings/AppSections';

/** Settings → Updates & advanced (design "S4k"): updates, sync intervals, local data and reset. */
export function AdvancedView() {
  return (
    <>
      <UpdatesSection />
      <SyncIntervalsSection />
      <DataSection />
      <ResetSection />
    </>
  );
}
