import { useState } from 'react';
import { announce } from '../../components/Announcer';
import { Button } from '../../components/Button';
import { SuccessIcon } from '../../components/icons';
import { useAction } from '../../state/hooks';
import { osWords } from './labels';
import { InlineIssue } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import styles from './settings.module.css';

interface Outcome {
  tone: 'success' | 'error';
  message: string;
  /** The organization, project and typed token it is about; edits make it stale. */
  key: string;
}

const keyOf = (organization: string, project: string, token: string) => `${organization}\u0000${project}\u0000${token}`;

/**
 * Test and save for the Azure personal access token: `settings.testAzurePat` checks the token
 * against the organization and project as typed, and only a working token is saved, with the
 * organization and project, through `settings.save`. Enter in the token field does the same
 * (`onEnter` of the field). Other unsaved edits stay in the draft.
 */
export function useAzureTokenTest() {
  const { draft, azurePat, settings, busy, preview, os, saveAzure } = useSettingsForm();
  const test = useAction();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const organization = draft.organization.trim();
  const project = draft.project.trim();
  const token = azurePat.trim();
  const hasToken = token !== '' || settings.hasAzurePat;
  const canRun = !busy && !preview && !pending && organization !== '' && hasToken;

  const run = async () => {
    if (!canRun) return;
    setPending(true);
    setOutcome(null);
    const finish = (next: Outcome) => {
      setPending(false);
      setOutcome(next);
      announce(next.message, next.tone === 'error' ? 'assertive' : 'polite');
    };
    const tested = await test.run({ type: 'settings.testAzurePat', organization, project, azurePat: token });
    if (!tested.ok) {
      finish({ tone: 'error', message: tested.error.message, key: keyOf(organization, project, token) });
      return;
    }
    const saved = await saveAzure({ organization, project });
    if (!saved.ok) {
      finish({
        tone: 'error',
        message: `The token works, but it was not saved. ${saved.error.message}`,
        key: keyOf(organization, project, token),
      });
      return;
    }
    const where = project === '' ? `“${organization}”` : `“${organization}”, project “${project}”`;
    finish({
      tone: 'success',
      message: `The token works for ${where} and is saved in ${osWords(os).credentials}.`,
      // The field is cleared after saving.
      key: keyOf(organization, project, ''),
    });
  };

  const current = outcome?.key === keyOf(organization, project, token) ? outcome : null;
  return { run, canRun, pending, outcome: current, organization, hasToken, preview };
}

export function AzureTokenTest({ tester }: { tester: ReturnType<typeof useAzureTokenTest> }) {
  const { run, canRun, pending, outcome, organization, hasToken, preview } = tester;
  const { settings } = useSettingsForm();
  const hint = preview
    ? 'Preview mode: testing tokens is turned off.'
    : organization === ''
      ? 'Enter your organization to test the token.'
      : !hasToken
        ? 'Paste a token to test it.'
        : null;
  return (
    <div className={styles.tokenTest}>
      <div className={styles.row}>
        <Button variant={settings.hasAzurePat ? 'secondary' : 'primary'} onPress={() => void run()} isPending={pending} isDisabled={!canRun}>
          Test and save
        </Button>
        {pending ? <span className={styles.hint}>Checking the token with Azure DevOps…</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      {outcome?.tone === 'success' ? (
        <p className={`${styles.status} ${styles.success}`}>
          <SuccessIcon className={styles.statusIcon} />
          <span>{outcome.message}</span>
        </p>
      ) : outcome ? (
        <InlineIssue>{outcome.message}</InlineIssue>
      ) : null}
    </div>
  );
}
