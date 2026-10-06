import { useEffect, useId, useRef } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ClockIcon } from '../../components/icons';
import type { KeyCombo } from '../../shortcuts/keys';
import { useCommand } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { AppearanceForm, useInterfacePreferences } from '../settings/AppearanceForm';
import { FigmaSettings } from '../settings/FigmaSettings';
import { InlineIssue } from '../settings/SettingsSection';
import styles from './onboarding.module.css';

export const CONTINUE_SHORTCUT: KeyCombo = { key: 'Enter', mod: true };

/**
 * First-run appearance onboarding (1.14 `AppearanceOnboardingView`): choose Light, Dark or
 * System, the UI scale and contrast, and whether to observe Figma, then continue to setup.
 */
export function AppearanceOnboarding() {
  const app = useSlice('app');
  const os = app?.os === 'windows' ? 'windows' : 'macos';
  const { preferences, apply, error } = useInterfacePreferences();
  const finish = useAction();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // Start reading at the title: this screen replaces the whole window.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const busy = finish.pending;
  const proceed = () => {
    if (!busy) void finish.run({ type: 'app.finishOnboarding' });
  };
  useCommand({
    id: 'onboarding.continue',
    label: 'Continue to setup',
    group: 'Actions',
    shortcut: CONTINUE_SHORTCUT,
    allowInInputs: true,
    isDisabled: busy,
    onAction: proceed,
  });

  return (
    <main className={styles.page} aria-labelledby={titleId}>
      <div className={styles.column}>
        <p className={styles.brand}>
          <ClockIcon />
          <span>Azure timetracker</span>
        </p>
        <header className={styles.header}>
          <h1 id={titleId} ref={heading} tabIndex={-1} className={styles.title}>
            Make yourself comfortable
          </h1>
          <p className={styles.subtitle}>
            Choose Light, Dark or System before connecting your accounts. You can change these choices later in Settings →
            Appearance.
          </p>
        </header>
        <Card as="section" aria-labelledby={`${titleId}-appearance`} padding="large" className={styles.card}>
          <h2 id={`${titleId}-appearance`} className={styles.cardTitle}>
            Appearance & readability
          </h2>
          <AppearanceForm preferences={preferences} onChange={apply} os={os} />
          {error ? <InlineIssue>{error.message}</InlineIssue> : null}
        </Card>
        <Card as="section" aria-labelledby={`${titleId}-figma`} padding="large" className={styles.card}>
          <h2 id={`${titleId}-figma`} className={styles.cardTitle}>
            Figma Desktop
          </h2>
          <p className={styles.cardSubtitle}>Suggest Design tracking when you switch files. Always confirm before a timer changes.</p>
          <FigmaSettings onboarding />
        </Card>
        {finish.error ? (
          <Banner tone="error" title="Setup could not continue">
            {finish.error.message}
          </Banner>
        ) : app?.error ? (
          <Banner tone="warning" live="polite">
            {app.error}
          </Banner>
        ) : null}
        <div className={styles.footer}>
          <p className={styles.next}>Next: connect Azure DevOps and 7pace.</p>
          <Button variant="primary" size="large" onPress={proceed} isPending={busy} shortcut={CONTINUE_SHORTCUT} showShortcut>
            Continue to setup
          </Button>
        </div>
        <p className={styles.note}>
          {os === 'windows'
            ? 'Azure timetracker lives in the notification area. After setup, use its icon in the taskbar corner to open it.'
            : 'Azure timetracker lives in the menu bar. After setup, use the clock at the top of your screen to open it.'}
        </p>
      </div>
    </main>
  );
}
