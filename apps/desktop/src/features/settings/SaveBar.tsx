import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { CircleIcon, SuccessIcon } from '../../components/icons';
import type { KeyCombo } from '../../shortcuts/keys';
import { useSlice } from '../../state/hooks';
import { sectionTitle } from './sections';
import { useSettingsForm } from './SettingsForm';
import styles from './settings.module.css';

export const SAVE_SHORTCUT: KeyCombo = { key: 's', mod: true };

/**
 * Save and Revert for the whole draft, shared by every Settings view (2.2 layout: "No unsaved
 * changes · ⌘S saves"), with the outcome and the problems that block saving.
 */
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
        <div className={styles.saveText}>
          <p role="status" className={styles.saveState}>
            {saved && !dirty && !saving ? <SuccessIcon className={styles.statusIcon} /> : null}
            {dirty && !saving ? <CircleIcon className={styles.statusIcon} /> : null}
            <span>{state}</span>
            <span className={styles.saveHint} aria-hidden="true">{` · ${mod} saves`}</span>
          </p>
          {preview ? <p className={styles.hint}>Preview mode: saving settings and credentials is turned off.</p> : null}
        </div>
        <div className={styles.saveButtons}>
          <Button onPress={form.revert} isDisabled={!dirty || saving}>
            Revert
          </Button>
          <Button
            variant="primary"
            onPress={() => void form.save()}
            isPending={saving}
            isDisabled={busy || preview}
            shortcut={SAVE_SHORTCUT}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
