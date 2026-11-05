import { AzureSection, ConnectionCardSection, SevenPaceSection, useAccountsUnconfigured } from '../../../features/settings/ConnectionSection';
import { FirstRunSteps } from '../../../features/onboarding/FirstRunSteps';
import { osWords } from '../../../features/settings/labels';
import { useSettingsForm } from '../../../features/settings/SettingsForm';
import { LockIcon } from '../icons';
import styles from '../settings.module.css';

/** Settings → Azure DevOps & 7pace (design "S4b · Settings — Accounts"). */
export function AccountsView() {
  const { os } = useSettingsForm();
  const unconfigured = useAccountsUnconfigured();
  const words = osWords(os);
  return (
    <>
      {unconfigured ? <FirstRunSteps os={os} /> : null}
      <AzureSection />
      <SevenPaceSection />
      <ConnectionCardSection />
      <p className={styles.footnote}>
        <LockIcon />
        <span>{`Tokens stay in ${words.credentials}. Your Git repositories stay untouched.`}</span>
      </p>
    </>
  );
}
