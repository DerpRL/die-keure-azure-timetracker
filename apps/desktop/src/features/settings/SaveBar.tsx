import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { CircleIcon, SuccessIcon } from '../../components/icons';
import type { KeyCombo } from '../../shortcuts/keys';
import { useSlice } from '../../state/hooks';
import { sectionTitle } from './sections';
import { useSettingsForm } from './SettingsForm';
import styles from './settings.module.css';

export const SAVE_SHORTCUT: KeyCombo = { key: 's', mod: true };

/** Save and Revert for the whole draft (1.14's bottom bar), with the outcome. */
export function SaveBar() {
  const form = useSettingsForm();
  const connection = useSlice('connection');
  const { dirty, saving, saved, busy, preview, os } = form;
  const mod = os === 'windows' ? 'Ctrl+S' : '⌘S';
  let state: string;
  if (saving) state = 'Saving…';
  else if (dirty) state = 'Unsaved changes';
  else if (saved) state = connection?.connected ? 'Settings saved · connection verified' : 'Settings saved';
  else state = 'No unsaved changes';
  return (
    <div className={styles.saveBar}>
      {form.showIssues ? (
        <Banner tone="error" title="Fix these settings before saving">
          <ul className={styles.issueList}>
            {form.issues.map((issue) => (
              <li key={issue.field}>
                {issue.message}{' '}
                <Button size="small" variant="plain" onPress={() => form.goTo(issue.section)}>
                  {`Go to ${sectionTitle(issue.section)}`}
                </Button>
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {form.saveError ? (
        <Banner tone="error" title="Settings were not saved">
          {form.saveError.message}
        </Banner>
      ) : null}
      <div className={styles.saveRow}>
        <p role="status" className={styles.saveState}>
          {saved && !dirty && !saving ? <SuccessIcon className={styles.statusIcon} /> : null}
          {dirty && !saving ? <CircleIcon className={styles.statusIcon} /> : null}
          <span>{state}</span>
        </p>
        <Button onPress={form.revert} isDisabled={!dirty || saving}>
          Revert
        </Button>
        <Button
          variant="primary"
          onPress={() => void form.save()}
          isPending={saving}
          isDisabled={busy || preview}
          shortcut={SAVE_SHORTCUT}
          showShortcut
        >
          Save changes
        </Button>
      </div>
      <p className={styles.hint}>
        {preview
          ? 'Preview mode: saving settings and credentials is turned off.'
          : `${mod} saves all sections. Appearance, interruptions, quiet hours, Figma and launch-at-login changes apply immediately.`}
      </p>
    </div>
  );
}
