import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { NumberField, TextField } from '../../components/Fields';
import { MinusIcon, PlusIcon } from '../../components/icons';
import type { WorkAwarenessPreferences } from '../../ipc/contract';
import { dispatch } from '../../ipc/engine';
import { workAppName } from './labels';
import { chooseApplications } from './platform';
import { FullRow, Hint, InlineIssue, IssueRow, SectionFooter, SettingRow, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { AWARENESS_MINUTES, issueFor } from './validation';
import { t } from '../../i18n';
import styles from './settings.module.css';

/** The executable name Windows matches work apps by (lower case, no folders). */
export function executableName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).toLowerCase();
}

/** The message of a rejected intent or a failed dialog. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return String(error);
}

/** Settings → Reminders → Work applications: the apps that count as work for forgotten-timer reminders. */
export function WorkAppsSection() {
  const { draft, update, os, settings } = useSettingsForm();
  const [entry, setEntry] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // Names of apps picked in this session (not saved yet), then what the engine found for saved
  // ones, then the built-in names, then the id.
  const [names, setNames] = useState<Record<string, string>>({});
  const saved = new Map(settings.workApps.map((app) => [app.id, app]));
  const nameOf = (id: string) => names[id] ?? saved.get(id)?.name ?? workAppName(id);
  const notInstalled = (id: string) => !(id in names) && saved.get(id)?.installed === false;
  const apps = draft.awareness.workAppIds;
  const setApps = (workAppIds: string[]) =>
    update((current) => ({ ...current, awareness: { ...current.awareness, workAppIds } }));
  const add = (ids: readonly string[]) => {
    const next = [...apps];
    for (const id of ids) if (id !== '' && !next.includes(id)) next.push(id);
    setApps(next);
  };
  const windows = os === 'windows';
  const typed = windows ? executableName(entry.trim()) : entry.trim();
  const choose = async () => {
    setIssue(null);
    setChoosing(true);
    try {
      const paths = await chooseApplications(windows ? 'windows' : 'macos');
      const picked: string[] = [];
      const failures: string[] = [];
      for (const path of paths) {
        try {
          const identity = await dispatch({ type: 'settings.resolveWorkApp', path });
          picked.push(identity.id);
          setNames((current) => ({ ...current, [identity.id]: identity.name }));
        } catch (error) {
          failures.push(messageOf(error));
        }
      }
      add(picked);
      if (failures.length > 0) setIssue(failures.join(' '));
    } catch (error) {
      setIssue(messageOf(error));
    } finally {
      setChoosing(false);
    }
  };
  return (
    <SettingsSection
      id="workApps"
      subtitle={t('Using one of these without a running timer starts the reminder above.')}
      actions={
        <Button size="small" icon={PlusIcon} onPress={() => void choose()} isPending={choosing}>
          {t('Add app…')}
        </Button>
      }
    >
      {apps.length === 0 ? (
        <FullRow>
          <Hint>{t('No work applications. Forgotten-timer reminders need at least one.')}</Hint>
        </FullRow>
      ) : (
        <ul role="list" aria-label={t('Work applications')} className={styles.appGrid}>
          {apps.map((id) => (
            <li key={id} className={styles.appRow}>
              <span className={styles.listText}>
                <span className={notInstalled(id) ? styles.appNameMuted : styles.appName}>{nameOf(id)}</span>
                {nameOf(id) !== id ? <span className={styles.listMeta}>{id}</span> : null}
              </span>
              <span className={styles.appActions}>
                {notInstalled(id) ? <Badge tone="neutral">{t('Not installed')}</Badge> : null}
                <Button
                  size="small"
                  variant="plain"
                  icon={MinusIcon}
                  aria-label={t('Remove {app} from work apps', { app: nameOf(id) })}
                  onPress={() => setApps(apps.filter((app) => app !== id))}
                >
                  {t('Remove')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <SettingRow title={windows ? t('Add by executable name') : t('Add by bundle identifier')} help={windows ? t('For example code.exe.') : t('For example com.microsoft.VSCode.')}>
        {({ helpId }) => (
          <>
            <TextField
              label={windows ? t('Executable name') : t('Bundle identifier')}
              hideLabel
              aria-describedby={helpId}
              value={entry}
              onChange={setEntry}
              autoComplete="off"
              spellCheck="false"
              className={`${styles.mono} ${styles.fieldMedium}`}
            />
            <Button
              size="small"
              isDisabled={typed === '' || apps.includes(typed)}
              onPress={() => {
                add([typed]);
                setEntry('');
              }}
            >
              {t('Add')}
            </Button>
          </>
        )}
      </SettingRow>
      {issue ? <IssueRow tone="warning">{issue}</IssueRow> : null}
    </SettingsSection>
  );
}

/** Settings → Reminders → Time awareness (1.14 `WorkAwarenessSettings`). */
export function AwarenessSection() {
  const { draft, update, issues } = useSettingsForm();
  const preferences = draft.awareness;
  const set = (patch: Partial<WorkAwarenessPreferences>) =>
    update((current) => ({ ...current, awareness: { ...current.awareness, ...patch } }));
  const issue = issueFor(issues, 'awareness');
  const outOfRange = (minutes: number) => !Number.isInteger(minutes) || minutes < AWARENESS_MINUTES.min || minutes > AWARENESS_MINUTES.max;
  const idleInvalid = outOfRange(preferences.idleMinutes);
  const forgottenInvalid = outOfRange(preferences.forgottenMinutes);
  return (
    <SettingsSection id="awareness" subtitle={t('Suggestions to review; your timer and recorded time only change when you confirm.')}>
      <ToggleRow
        title={t('Ask what I did after being away')}
        help={t('Lets you keep, drop or move the idle time.')}
        isSelected={preferences.idleEnabled}
        onChange={(idleEnabled) => set({ idleEnabled })}
      />
      <SettingRow sub title={t('After')} dimmed={!preferences.idleEnabled} below={idleInvalid && issue ? <InlineIssue>{issue}</InlineIssue> : null}>
        <NumberField
          label={t('Away minutes')}
          hideLabel
          unit={t('min')}
          minValue={AWARENESS_MINUTES.min}
          maxValue={AWARENESS_MINUTES.max}
          value={preferences.idleMinutes}
          onChange={(idleMinutes) => {
            if (Number.isFinite(idleMinutes)) set({ idleMinutes });
          }}
          isDisabled={!preferences.idleEnabled}
          isInvalid={idleInvalid}
          formatOptions={{ maximumFractionDigits: 0 }}
          className={styles.numberField}
        />
      </SettingRow>
      <ToggleRow
        title={t('Treat a locked screen as away')}
        help={t('Locking, sleep and inactive sessions count as away right away. A prompt appears when you return.')}
        isSelected={preferences.lockEnabled}
        onChange={(lockEnabled) => set({ lockEnabled })}
      />
      <ToggleRow
        title={t('Remind me to start a timer')}
        help={t('When you use a work app without a timer, inside your workday. Paused tracking, meetings and offline drafts suppress it.')}
        isSelected={preferences.forgottenEnabled}
        onChange={(forgottenEnabled) => set({ forgottenEnabled })}
      />
      <SettingRow
        sub
        title={t('After')}
        help={t('Counts only minutes in which you use a work app.')}
        dimmed={!preferences.forgottenEnabled}
        below={forgottenInvalid && issue ? <InlineIssue>{issue}</InlineIssue> : null}
      >
        {({ helpId }) => (
          <NumberField
            label={t('Active minutes')}
            hideLabel
            aria-describedby={helpId}
            unit={t('min')}
            minValue={AWARENESS_MINUTES.min}
            maxValue={AWARENESS_MINUTES.max}
            value={preferences.forgottenMinutes}
            onChange={(forgottenMinutes) => {
              if (Number.isFinite(forgottenMinutes)) set({ forgottenMinutes });
            }}
            isDisabled={!preferences.forgottenEnabled}
            isInvalid={forgottenInvalid}
            formatOptions={{ maximumFractionDigits: 0 }}
            className={styles.numberField}
          />
        )}
      </SettingRow>
      <SectionFooter>{t('Only input inactivity and the foreground app’s identity are read. No keystrokes, window titles, documents or screenshots.')}</SectionFooter>
    </SettingsSection>
  );
}
