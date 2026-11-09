import { useLayoutEffect, useRef } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { SuccessIcon } from '../../components/icons';
import type { KeyCombo } from '../../shortcuts/keys';
import { useSlice } from '../../state/hooks';
import { sectionTitle } from './sections';
import { useSettingsForm } from './SettingsForm';
import { t, tn } from '../../i18n';
import styles from './settings.module.css';

export const SAVE_SHORTCUT: KeyCombo = { key: 's', mod: true };

/** The id of the Settings view's title, where focus goes when the save bar goes away. */
export const VIEW_TITLE_ID = 'settings-view-title';

/**
 * Save and Revert for the whole draft, shared by every Settings view (2.2 layout: "Unsaved
 * changes · ⌘S saves"), with the problems that block saving. Shown only while something is
 * unsaved (see `SettingsContent`).
 */
export function SaveBar() {
  const form = useSettingsForm();
  const bar = useRef<HTMLDivElement>(null);
  // Saving or reverting removes the bar: focus inside it moves to the view's title instead of
  // falling back to the page.
  useLayoutEffect(() => {
    const element = bar.current;
    return () => {
      if (element?.contains(document.activeElement)) document.getElementById(VIEW_TITLE_ID)?.focus({ preventScroll: true });
    };
  }, []);
  const connection = useSlice('connection');
  const { dirty, saving, saved, busy, preview, changes } = form;
  const count = changes.length;
  let state: string;
  if (saving) state = t('Saving…');
  else if (dirty) state = tn(count, '{count} unsaved change', '{count} unsaved changes');
  else if (saved) state = connection?.connected ? t('Settings saved · connection verified') : t('Settings saved');
  else state = t('No unsaved changes');
  // At most four names, then "and 3 more".
  const named =
    changes.length > 4 ? t('{names} and {count} more', { names: changes.slice(0, 4).join(', '), count: changes.length - 4 }) : changes.join(', ');
  return (
    <div ref={bar} className={styles.saveBar}>
      {form.showIssues ? (
        <Banner tone="error" title={t('Fix these settings before saving')}>
          <ul className={styles.issueList}>
            {form.issues.map((issue) => (
              <li key={issue.field}>
                {issue.message}{' '}
                <Button size="small" variant="plain" onPress={() => form.goTo(issue.section)}>
                  {t('Go to {section}', { section: sectionTitle(issue.section) })}
                </Button>
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {form.saveError ? (
        <Banner tone="error" title={t('Settings were not saved')}>
          {form.saveError.message}
        </Banner>
      ) : null}
      <div className={styles.saveRow}>
        <div className={styles.saveText}>
          <p role="status" className={styles.saveState}>
            {saved && !dirty && !saving ? <SuccessIcon className={styles.statusIcon} /> : null}
            <span className={styles.saveCount}>{state}</span>
            {dirty && !saving && named ? <span className={styles.saveNames}>{`· ${named}`}</span> : null}
          </p>
          {preview ? <p className={styles.saveNote}>{t('Preview mode: saving settings and credentials is turned off.')}</p> : null}
        </div>
        <div className={styles.saveButtons}>
          <Button size="small" variant="plain" onPress={form.revert} isDisabled={!dirty || saving} className={styles.saveRevert}>
            {t('Revert')}
          </Button>
          <Button
            size="small"
            onPress={() => void form.save()}
            isPending={saving}
            isDisabled={busy || preview}
            shortcut={SAVE_SHORTCUT}
            showShortcut
            className={styles.saveSubmit}
          >
            {t('Save changes')}
          </Button>
        </div>
      </div>
    </div>
  );
}
