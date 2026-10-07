import { useState } from 'react';
import { Button } from '../../components/Button';
import { NumberField, TextField } from '../../components/Fields';
import { MinusIcon, PlusIcon } from '../../components/icons';
import { Switch } from '../../components/Toggles';
import type { WorkAwarenessPreferences } from '../../ipc/contract';
import { dispatch } from '../../ipc/engine';
import { workAppName } from './labels';
import { chooseApplications } from './platform';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { AWARENESS_MINUTES, issueFor } from './validation';
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

function WorkApps() {
  const { draft, update, os } = useSettingsForm();
  const [entry, setEntry] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // Names of apps picked in this session. Stored ids have no name lookup, so others show the id.
  const [names, setNames] = useState<Record<string, string>>({});
  const nameOf = (id: string) => names[id] ?? workAppName(id);
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
    <SettingsGroup title="Work applications">
      {apps.length === 0 ? (
        <Hint>No work applications. Forgotten-timer reminders need at least one.</Hint>
      ) : (
        <ul role="list" className={styles.list}>
          {apps.map((id) => (
            <li key={id} className={styles.listItem}>
              <span className={styles.listText}>
                <span>{nameOf(id)}</span>
                {nameOf(id) !== id ? <span className={styles.listMeta}>{id}</span> : null}
              </span>
              <Button
                size="small"
                variant="plain"
                icon={MinusIcon}
                aria-label={`Remove ${nameOf(id)} from work apps`}
                onPress={() => setApps(apps.filter((app) => app !== id))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.fieldRow}>
        <TextField
          label={windows ? 'Executable name' : 'Bundle identifier'}
          description={windows ? 'For example code.exe.' : 'For example com.microsoft.VSCode.'}
          value={entry}
          onChange={setEntry}
          autoComplete="off"
          spellCheck="false"
          className={styles.mono}
        />
        <div className={styles.row}>
          <Button
            icon={PlusIcon}
            isDisabled={typed === '' || apps.includes(typed)}
            onPress={() => {
              add([typed]);
              setEntry('');
            }}
          >
            Add work application
          </Button>
          <Button onPress={() => void choose()} isPending={choosing}>
            Choose applications…
          </Button>
        </div>
      </div>
      {issue ? <InlineIssue tone="warning">{issue}</InlineIssue> : null}
    </SettingsGroup>
  );
}

/** Settings → Tracking → Time awareness (1.14 `WorkAwarenessSettings`). */
export function AwarenessSection() {
  const { draft, update, issues, os } = useSettingsForm();
  const preferences = draft.awareness;
  const set = (patch: Partial<WorkAwarenessPreferences>) =>
    update((current) => ({ ...current, awareness: { ...current.awareness, ...patch } }));
  const issue = issueFor(issues, 'awareness');
  const idleInvalid = !Number.isInteger(preferences.idleMinutes) || preferences.idleMinutes < AWARENESS_MINUTES.min || preferences.idleMinutes > AWARENESS_MINUTES.max;
  const forgottenInvalid =
    !Number.isInteger(preferences.forgottenMinutes) ||
    preferences.forgottenMinutes < AWARENESS_MINUTES.min ||
    preferences.forgottenMinutes > AWARENESS_MINUTES.max;
  return (
    <SettingsSection id="awareness" subtitle="Review suggestions before changing your timer or recorded time.">
      <Switch isSelected={preferences.idleEnabled} onChange={(idleEnabled) => set({ idleEnabled })}>
        Suggest reviewing time after inactivity
      </Switch>
      <NumberField
        label="Inactivity threshold"
        unit="minutes"
        minValue={AWARENESS_MINUTES.min}
        maxValue={AWARENESS_MINUTES.max}
        value={preferences.idleMinutes}
        onChange={(idleMinutes) => {
          if (Number.isFinite(idleMinutes)) set({ idleMinutes });
        }}
        isDisabled={!preferences.idleEnabled}
        isInvalid={idleInvalid}
        errorMessage={idleInvalid ? issue : undefined}
        formatOptions={{ maximumFractionDigits: 0 }}
      />
      <Switch isSelected={preferences.lockEnabled} onChange={(lockEnabled) => set({ lockEnabled })}>
        Detect screen lock, sleep and inactive sessions
      </Switch>
      <Hint>
        A prompt appears when you return. Reading without input may count as idle; detected meetings suppress passive inactivity
        prompts. Your timer keeps running until you choose an action.
      </Hint>
      <Divider />
      <Switch isSelected={preferences.forgottenEnabled} onChange={(forgottenEnabled) => set({ forgottenEnabled })}>
        Remind me when I work without a timer
      </Switch>
      <NumberField
        label="Remind after"
        unit="active minutes"
        minValue={AWARENESS_MINUTES.min}
        maxValue={AWARENESS_MINUTES.max}
        value={preferences.forgottenMinutes}
        onChange={(forgottenMinutes) => {
          if (Number.isFinite(forgottenMinutes)) set({ forgottenMinutes });
        }}
        isDisabled={!preferences.forgottenEnabled}
        isInvalid={forgottenInvalid}
        errorMessage={forgottenInvalid ? issue : undefined}
        formatOptions={{ maximumFractionDigits: 0 }}
      />
      <Hint>
        Uses the workday start/end times in Day review and your scheduled working days. Paused tracking, detected meetings and a
        running offline draft suppress reminders.
      </Hint>
      <WorkApps />
      <Hint>
        {os === 'windows'
          ? 'Only elapsed input inactivity and the foreground app’s identity are read. No keystrokes, window titles, documents or screenshots are collected. Lock events use Windows session notifications.'
          : 'Only elapsed input inactivity and the foreground app’s identity are read. No keystrokes, window titles, documents or screenshots are collected. Lock events use macOS notifications with sleep/session fallback.'}
      </Hint>
    </SettingsSection>
  );
}
