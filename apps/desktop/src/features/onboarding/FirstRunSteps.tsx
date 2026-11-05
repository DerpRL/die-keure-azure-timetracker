import { useId } from 'react';
import { Card } from '../../components/Card';
import { CheckIcon } from '../../components/icons';
import { cx } from '../../utils/cx';
import styles from './onboarding.module.css';

export type SetupStep = 'appearance' | 'accounts';

/** The first-run steps that exist: the appearance screen, then the accounts in Settings. */
const STEPS: ReadonlyArray<{ id: SetupStep; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'accounts', label: 'Accounts' },
];

/**
 * The setup steps as pills (design "S8 · Onboarding"): finished steps with a check, the current
 * one highlighted and marked `aria-current="step"`.
 */
export function SetupSteps({ current }: { current: SetupStep }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Setup steps" className={styles.steps}>
      {STEPS.map((step, position) => {
        const done = position < index;
        const active = position === index;
        return (
          <li key={step.id} aria-current={active ? 'step' : undefined} className={cx(styles.step, done && styles.stepDone, active && styles.stepCurrent)}>
            <span className={styles.stepMark} aria-hidden="true">
              {done ? <CheckIcon /> : position + 1}
            </span>
            {step.label}
            {done ? <span className="visually-hidden"> (done)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Settings → Azure DevOps & 7pace on the first run (design "S8 · Onboarding — connect
 * accounts"): where the setup is and what the two accounts are for, above the account cards.
 */
export function FirstRunSteps({ os }: { os: 'macos' | 'windows' }) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} padding="large" className={styles.firstRun}>
      <SetupSteps current="accounts" />
      <h3 id={titleId} className={styles.firstRunTitle}>
        Connect your accounts to start tracking
      </h3>
      <p className={styles.subtitle}>
        {`Azure DevOps shows your tickets. 7pace stores your time. Both tokens are kept in ${os === 'windows' ? 'Windows Credential Manager' : 'your Mac’s Keychain'}. Save changes when both are filled in.`}
      </p>
    </Card>
  );
}
