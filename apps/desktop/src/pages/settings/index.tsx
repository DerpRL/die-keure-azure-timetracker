import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ErrorIcon } from '../../components/icons';
import { SettingsEditor } from '../../features/settings/SettingsEditor';
import styles from '../../features/settings/settings.module.css';
import { useEngineStatus } from '../../state/EngineProvider';
import { useSlice } from '../../state/hooks';

function SettingsSkeleton() {
  return (
    <div className={styles.loading}>
      <Skeleton shape="rect" height="2.5rem" width="12rem" />
      <Skeleton lines={4} />
      <Skeleton shape="rect" height="10rem" />
    </div>
  );
}

/**
 * Settings page (main window, 1.14 `SettingsPage`). Categories on the left, the category's
 * sections on the right and one Save for the draft. Appearance, interruptions, quiet hours,
 * Figma and launch at login apply immediately.
 */
export default function SettingsPage() {
  const settings = useSlice('settings');
  const status = useEngineStatus();
  if (settings) return <SettingsEditor settings={settings} />;
  if (status === 'failed') {
    return (
      <EmptyState
        icon={ErrorIcon}
        title="Settings are unavailable"
        description="Azure timetracker could not reach its engine, so your settings cannot be shown or saved. Quit and reopen the app."
        headingLevel={2}
      />
    );
  }
  return (
    <LoadingRegion label="Loading settings" isLoading placeholder={<SettingsSkeleton />}>
      {null}
    </LoadingRegion>
  );
}
