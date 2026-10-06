import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Section } from '../../components/Card';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { CheckIcon, MinusIcon } from '../../components/icons';
import { useSlice } from '../../state/hooks';
import { everyText } from './model';
import { UpdateDetails } from './UpdateDetails';
import { useUpdateStatus } from './useUpdateStatus';
import styles from './updates.module.css';

/**
 * The App updates section of Settings (1.14 `UpdateSettingsView`). Automatic checks are the saved
 * `automaticUpdateChecks` setting, changed with the Settings form, so this section only shows
 * it; "Check for updates" and the install action work right away.
 */
export function UpdateSettings() {
  const { status, error } = useUpdateStatus();
  const settings = useSlice('settings');
  const automatic = settings?.configuration.automaticUpdateChecks ?? status?.automatic ?? true;
  const every = everyText(settings?.configuration.cadences.updateCheckSeconds ?? 60);

  return (
    <Section title="App updates" subtitle="Get new versions from the public GitHub repository." variant="plain">
      <div className={styles.setting}>
        <p className={styles.settingRow}>
          Automatic checks
          <Badge tone={automatic ? 'success' : 'neutral'} icon={automatic ? CheckIcon : MinusIcon}>
            {automatic ? 'On' : 'Off'}
          </Badge>
        </p>
        <p className={styles.hint}>
          {automatic
            ? `Checks at startup and ${every}. Downloading and restarting always require your choice.`
            : 'The app only checks when you choose Check for updates. Downloading and restarting always require your choice.'}
        </p>
        <p className={styles.hint}>
          Turn this on or off with “Check for updates automatically” in these settings, then save your changes.
        </p>
      </div>
      {error && !status ? (
        <Banner tone="warning" title="Update status is unavailable" live="off">
          {error}
        </Banner>
      ) : (
        <LoadingRegion label="Loading update status" isLoading={!status} placeholder={<Skeleton lines={3} />}>
          {status ? <UpdateDetails status={status} headingLevel={3} /> : null}
        </LoadingRegion>
      )}
    </Section>
  );
}
