import { useId } from 'react';
import { Card } from '../../components/Card';
import { CheckIcon } from '../../components/icons';
import { cx } from '../../utils/cx';
import styles from './onboarding.module.css';

export type SetupStep = 'appearance' | 'accounts' | 'sources' | 'calendars';

export interface SetupStepDefinition {
  id: SetupStep;
  /** The short name in the step pills. */
  label: string;
}

/**
 * The onboarding's steps in order. Calendars exist on macOS only, so Windows has three
 * (`setupSteps`).
 */
export const SETUP_STEPS: readonly SetupStepDefinition[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'accounts', label: 'Azure & 7pace' },
  { id: 'sources', label: 'Git & Figma' },
  { id: 'calendars', label: 'Calendars' },
];

export function setupSteps(calendar: boolean): readonly SetupStepDefinition[] {
  return calendar ? SETUP_STEPS : SETUP_STEPS.filter((step) => step.id !== 'calendars');
}

/**
 * The setup steps as pills (design "S8 · Onboarding"): finished steps with a check, the current
 * one highlighted and marked `aria-current="step"`.
 */
export function SetupSteps({ steps, current }: { steps: readonly SetupStepDefinition[]; current: SetupStep }) {
  const index = steps.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Setup steps" className={styles.steps}>
      {steps.map((step, position) => {
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
 * Settings → Azure DevOps & 7pace while no 7pace workspace is saved (the onboarding was finished
 * before 2.2, or the workspace was removed): what the two accounts are for, above their cards.
 */
export function FirstRunSteps({ os }: { os: 'macos' | 'windows' }) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} padding="large" className={styles.firstRun}>
      <h3 id={titleId} className={styles.firstRunTitle}>
        Connect your accounts to start tracking
      </h3>
      <p className={styles.subtitle}>
        {`Azure DevOps shows your tickets. 7pace stores your time. Both tokens are kept in ${os === 'windows' ? 'Windows Credential Manager' : 'your Mac’s Keychain'}. Save changes when both are filled in.`}
      </p>
    </Card>
  );
}
