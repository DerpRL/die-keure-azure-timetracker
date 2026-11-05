import { AccountTiles, AzureSection, SevenPaceSection, useAccountsUnconfigured } from '../../../features/settings/ConnectionSection';
import { FirstRunSteps } from '../../../features/onboarding/FirstRunSteps';
import { osWords } from '../../../features/settings/labels';
import { useSettingsForm } from '../../../features/settings/SettingsForm';
import { ShieldIcon } from '../../../features/settings/icons';
import styles from '../settings.module.css';

/** Settings → Azure DevOps & 7pace (design "S4a"): status tiles, Azure DevOps and 7pace. */
export function AccountsView() {
  const { os } = useSettingsForm();
  const unconfigured = useAccountsUnconfigured();
  const words = osWords(os);
  return (
    <>
      {unconfigured ? <FirstRunSteps os={os} /> : null}
      <AccountTiles />
      <AzureSection />
      <SevenPaceSection />
      <p className={styles.footnote}>
        <ShieldIcon />
        <span>{`Tokens stay in ${words.credentials}. Your Git repositories are never changed.`}</span>
      </p>
    </>
  );
}
