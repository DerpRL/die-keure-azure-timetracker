import { AdvancedSection, AppearanceSection, AppSection, UpdatesSection } from '../../../features/settings/AppSections';
import { FeaturesSection } from '../../../features/settings/FeaturesSection';

/** Settings → Appearance & app (design "S4e"): appearance, the app, updates, features and advanced. */
export function AppearanceView() {
  return (
    <>
      <AppearanceSection />
      <AppSection />
      <UpdatesSection />
      <FeaturesSection />
      <AdvancedSection />
    </>
  );
}
