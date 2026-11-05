import { NotificationsSection, PromptsSection } from '../../../features/settings/NotificationsSection';

/** Settings → Notifications (design "S4e"): banners, quiet hours and how each prompt reaches you. */
export function NotificationsView() {
  return (
    <>
      <NotificationsSection />
      <PromptsSection />
    </>
  );
}
