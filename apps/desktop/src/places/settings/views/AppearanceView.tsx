import { AppearanceSection, AppSection, ShortcutsSection } from '../../../features/settings/AppSections';

/** Settings → Appearance & shortcuts (design "S4i"). */
export function AppearanceView() {
  return (
    <>
      <AppearanceSection />
      <AppSection />
      <ShortcutsSection />
    </>
  );
}
