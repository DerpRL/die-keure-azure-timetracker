import { useEffect, useState } from 'react';
import { TextField } from '../../components/Fields';
import { Select } from '../../components/Pickers';
import { Switch } from '../../components/Toggles';
import type { ShortcutStatus } from '../../ipc/shell';
import { useAction, useSlice } from '../../state/hooks';
import { POLL_LABELS } from './labels';
import { fallbackShortcut, readShortcut } from './platform';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { POLL_CHOICES } from './validation';
import styles from './settings.module.css';

/** `Select` keys cannot be empty; "" (use the 7pace default) maps to this key. */
export const DEFAULT_ACTIVITY_KEY = '__default__';

export interface ActivityChoice {
  id: string;
  label: string;
}

/** Activity options with a first "default" entry, keeping an unknown stored id selectable. */
export function activityOptions(
  activities: ReadonlyArray<{ id: string; name?: string | null }>,
  defaultLabel: string,
  selected: string,
): ActivityChoice[] {
  const options = [{ id: DEFAULT_ACTIVITY_KEY, label: defaultLabel }, ...activities.map((item) => ({ id: item.id, label: item.name ?? item.id }))];
  if (selected !== '' && !activities.some((item) => item.id === selected)) options.push({ id: selected, label: selected });
  return options;
}

export const TEST_BRANCH = 'feature/33624-improve-loading';

/** The 1.14 live tester: runs `settings.testBranchPattern` shortly after the user stops typing. */
function useBranchPatternTest(branch: string, pattern: string) {
  const { run } = useAction();
  const [result, setResult] = useState<{ key: string; text: string; failed: boolean } | null>(null);
  const key = `${branch}\u0000${pattern}`;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void run({ type: 'settings.testBranchPattern', branch, pattern }).then((outcome) => {
        if (!active) return;
        if (outcome.ok) setResult(typeof outcome.value === 'string' ? { key, text: outcome.value, failed: false } : null);
        else setResult({ key, text: outcome.error.message, failed: true });
      });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [branch, pattern, key, run]);
  // A result for older input is not shown as current.
  const current = result?.key === key ? result : null;
  // `BranchTicket::tester_result` prefixes compile errors with "Invalid pattern:".
  const invalid = current ? current.failed || current.text.startsWith('Invalid pattern') : false;
  return { text: current?.text ?? null, invalid, testing: current === null };
}

function BranchDetection() {
  const { draft, update } = useSettingsForm();
  const [branch, setBranch] = useState(TEST_BRANCH);
  const test = useBranchPatternTest(branch, draft.branchPattern);
  const pollOptions = (POLL_CHOICES as readonly number[]).includes(draft.pollSeconds)
    ? POLL_CHOICES
    : [...POLL_CHOICES, draft.pollSeconds].sort((a, b) => a - b);
  return (
    <SettingsGroup title="Branch detection">
      <Switch isSelected={draft.watchEnabled} onChange={(watchEnabled) => update((current) => ({ ...current, watchEnabled }))}>
        Watch repositories for branch changes
      </Switch>
      <Switch
        isSelected={draft.autoStartWhenIdle}
        onChange={(autoStartWhenIdle) => update((current) => ({ ...current, autoStartWhenIdle }))}
        description="Every timer starts after you choose its activity and confirm. This option opens the chooser for a new branch change after connecting, not app startup."
      >
        Automatically open the activity chooser when no timer is running
      </Switch>
      <TextField
        label="Ticket pattern"
        description="A regular expression. The first capture group is the ticket number. Supports feature/123-name and featute/123-name."
        value={draft.branchPattern}
        onChange={(branchPattern) => update((current) => ({ ...current, branchPattern }))}
        placeholder="Regular expression"
        isInvalid={test.invalid}
        errorMessage={test.invalid ? (test.text ?? undefined) : undefined}
        className={styles.mono}
        autoComplete="off"
        spellCheck="false"
      />
      <div className={styles.fieldRow}>
        <TextField
          label="Try a branch name"
          value={branch}
          onChange={setBranch}
          className={styles.mono}
          autoComplete="off"
          spellCheck="false"
        />
        <p className={styles.narrow}>
          <span className="visually-hidden">Result: </span>
          <output aria-live="polite" className={test.invalid ? styles.issue : undefined}>
            {test.testing ? 'Testing…' : test.text}
          </output>
        </p>
      </div>
      <Select
        label="Refresh 7pace"
        items={pollOptions.map((seconds) => ({ id: seconds, label: POLL_LABELS[seconds] ?? `Every ${seconds} seconds` }))}
        selectedKey={draft.pollSeconds}
        onSelectionChange={(key) => {
          if (typeof key === 'number') update((current) => ({ ...current, pollSeconds: key }));
        }}
        width="narrow"
      />
      <Hint>
        {`Local branch checks run every ${draft.cadences.probeSeconds} ${draft.cadences.probeSeconds === 1 ? 'second' : 'seconds'}. Server rate limits are respected.`}
      </Hint>
    </SettingsGroup>
  );
}

const MODIFIERS = /^(control|ctrl|alt|option|shift|super|command|cmd|commandorcontrol|cmdorctrl|meta)$/i;

/** True when the accelerator has a modifier and a key, so it never captures plain typing. */
export function acceleratorLooksValid(accelerator: string): boolean {
  const parts = accelerator.split('+').map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => part === '')) return false;
  const key = parts[parts.length - 1] ?? '';
  return parts.slice(0, -1).every((part) => MODIFIERS.test(part)) && !MODIFIERS.test(key);
}

/** "Control+Alt+T" → "Control Option T" (macOS) / "Ctrl Alt T" (Windows), for the explanation. */
export function spokenAccelerator(accelerator: string, os: 'macos' | 'windows'): string {
  const names: Record<string, string> =
    os === 'macos'
      ? { control: 'Control', ctrl: 'Control', alt: 'Option', option: 'Option', shift: 'Shift', super: 'Command', command: 'Command', cmd: 'Command', commandorcontrol: 'Command', cmdorctrl: 'Command', meta: 'Command' }
      : { control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Windows', command: 'Ctrl', cmd: 'Ctrl', commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl', meta: 'Windows' };
  return accelerator
    .split('+')
    .map((part) => names[part.trim().toLowerCase()] ?? part.trim().toUpperCase())
    .join(' + ');
}

function QuickSwitch() {
  const { draft, update, os, settings } = useSettingsForm();
  const [status, setStatus] = useState<ShortcutStatus>(() => fallbackShortcut(os));
  const stored = settings.configuration;
  // The shell re-registers the shortcut when the saved settings change; read the outcome again.
  useEffect(() => {
    let active = true;
    readShortcut(os).then(
      (next) => {
        if (active) setStatus(next);
      },
      () => {
        if (active) setStatus(fallbackShortcut(os));
      },
    );
    return () => {
      active = false;
    };
  }, [os, stored.quickSwitchEnabled, stored.quickSwitchShortcut]);

  const typed = draft.quickSwitchShortcut ?? '';
  const accelerator = typed.trim() || status.defaultAccelerator;
  const label = typed.trim() ? typed.trim() : (status.label ?? status.defaultLabel);
  const looksInvalid = typed.trim() !== '' && !acceleratorLooksValid(typed);
  return (
    <SettingsGroup title="Quick switch">
      <Switch
        isSelected={draft.quickSwitchEnabled}
        onChange={(quickSwitchEnabled) => update((current) => ({ ...current, quickSwitchEnabled }))}
      >
        {`Quick switch from any app · ${label}`}
      </Switch>
      <TextField
        label="Quick switch shortcut"
        description={`Leave blank to use ${status.defaultLabel}. Write it as modifiers and a key, such as ${status.defaultAccelerator}.`}
        placeholder={status.defaultAccelerator}
        value={typed}
        onChange={(value) => update((current) => ({ ...current, quickSwitchShortcut: value.trim() === '' ? null : value }))}
        isDisabled={!draft.quickSwitchEnabled}
        width="narrow"
        autoComplete="off"
        spellCheck="false"
      />
      {looksInvalid ? <InlineIssue tone="warning">Include at least one modifier key and one other key, such as {status.defaultAccelerator}.</InlineIssue> : null}
      <Hint>
        {`${spokenAccelerator(accelerator, os)} opens ticket search with favorites and recent tickets. Choose an activity before switching.`}
      </Hint>
      {status.issue ? <InlineIssue tone="warning">{status.issue}</InlineIssue> : null}
    </SettingsGroup>
  );
}

/** Settings → Tracking (1.14 default activity, `branchSection` and quick switch). */
export function TrackingSection() {
  const { draft, update } = useSettingsForm();
  const flow = useSlice('flow');
  const activities = flow?.activityTypes ?? [];
  return (
    <SettingsSection id="tracking" subtitle="Nothing starts a timer until you choose an activity and confirm.">
      <SettingsGroup title="Default activity">
        {activities.length > 0 ? (
          <Select
            label="Default activity"
            items={activityOptions(activities, 'Use 7pace default', draft.activityTypeId)}
            selectedKey={draft.activityTypeId === '' ? DEFAULT_ACTIVITY_KEY : draft.activityTypeId}
            onSelectionChange={(key) =>
              update((current) => ({ ...current, activityTypeId: key === DEFAULT_ACTIVITY_KEY || key === null ? '' : String(key) }))
            }
            width="narrow"
          />
        ) : (
          <TextField
            label="Activity type ID"
            description="Optional. Only needed if your organization requires a specific activity."
            placeholder="Use 7pace default"
            value={draft.activityTypeId}
            onChange={(activityTypeId) => update((current) => ({ ...current, activityTypeId }))}
            width="narrow"
            autoComplete="off"
          />
        )}
        {flow?.activityError ? <InlineIssue tone="warning">{flow.activityError}</InlineIssue> : null}
      </SettingsGroup>
      <Divider />
      <BranchDetection />
      <Divider />
      <SettingsGroup title="Ticket reminders">
        <Switch
          isSelected={draft.completionReminders}
          onChange={(completionReminders) => update((current) => ({ ...current, completionReminders }))}
          description="Checks Azure about once a minute while tracking. Requires an Azure PAT with Work Items read access. Choose Keep tracking, Stop or Switch ticket when a ticket enters a completed workflow state."
        >
          Remind me when the tracked ticket is completed
        </Switch>
      </SettingsGroup>
      <Divider />
      <QuickSwitch />
    </SettingsSection>
  );
}
