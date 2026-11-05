import { useEffect, useState } from 'react';
import { TextField } from '../../components/Fields';
import { Select } from '../../components/Pickers';
import type { ShortcutStatus } from '../../ipc/shell';
import { useAction, useSlice } from '../../state/hooks';
import { POLL_LABELS } from './labels';
import { fallbackShortcut, readShortcut } from './platform';
import { Divider, Hint, InlineIssue, SettingsSection, ToggleRow } from './SettingsSection';
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
  const [result, setResult] = useState<{ key: string; text: string | null; invalid: boolean } | null>(null);
  const key = `${branch}\u0000${pattern}`;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void run({ type: 'settings.testBranchPattern', branch, pattern }).then((outcome) => {
        if (!active) return;
        if (outcome.ok) setResult({ key, text: outcome.value.text, invalid: !outcome.value.valid });
        else setResult({ key, text: outcome.error.message, invalid: true });
      });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [branch, pattern, key, run]);
  // A result for older input is not shown as current.
  const current = result?.key === key ? result : null;
  return { text: current?.text ?? null, invalid: current?.invalid ?? false, testing: current === null };
}

/** The rule table of the design's "Branch rules" card: what each kind of branch suggests. */
function RuleTable() {
  return (
    <table className={styles.rules}>
      <thead>
        <tr>
          <th scope="col">Branch</th>
          <th scope="col">Suggests</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code className={styles.code}>{TEST_BRANCH}</code>
          </td>
          <td>
            Track ticket <b>#33624</b>
          </td>
        </tr>
        <tr>
          <td>
            <code className={styles.code}>develop</code> · <code className={styles.code}>long-feature/*</code>
          </td>
          <td>Pause, stop or keep tracking</td>
        </tr>
        <tr>
          <td>Detached HEAD</td>
          <td>Nothing</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Settings → Git repositories → Branch rules: what a branch suggests, the pattern and its tester. */
export function BranchRulesSection() {
  const { draft, update } = useSettingsForm();
  const [branch, setBranch] = useState('feature/AB#4790-vat-number');
  const test = useBranchPatternTest(branch, draft.branchPattern);
  return (
    <SettingsSection id="branchRules">
      <RuleTable />
      <TextField
        label="Ticket number pattern"
        description="A regular expression. The first capture group is the ticket number."
        value={draft.branchPattern}
        onChange={(branchPattern) => update((current) => ({ ...current, branchPattern }))}
        placeholder="Regular expression"
        isInvalid={test.invalid}
        errorMessage={test.invalid ? (test.text ?? undefined) : undefined}
        className={styles.mono}
        autoComplete="off"
        spellCheck="false"
      />
      <div className={styles.testerRow}>
        <TextField label="Try a branch name" value={branch} onChange={setBranch} className={styles.mono} autoComplete="off" spellCheck="false" />
        <p className={styles.testerResult}>
          <span className="visually-hidden">Result: </span>
          <output aria-live="polite" className={test.invalid ? styles.resultBad : test.testing ? styles.resultPending : styles.resultGood}>
            {test.testing ? 'Testing…' : test.text}
          </output>
        </p>
      </div>
      <Divider />
      <ToggleRow
        title="Open the activity chooser for a new branch"
        help="Only while no timer runs, after connecting. Every timer still starts after you choose its activity and confirm."
        isSelected={draft.autoStartWhenIdle}
        onChange={(autoStartWhenIdle) => update((current) => ({ ...current, autoStartWhenIdle }))}
      />
      <Hint>
        {`Local branch checks run every ${draft.cadences.probeSeconds} ${draft.cadences.probeSeconds === 1 ? 'second' : 'seconds'}.`}
      </Hint>
    </SettingsSection>
  );
}

/** How often the 7pace timer is refreshed (Advanced). */
export function PollSelect() {
  const { draft, update } = useSettingsForm();
  const pollOptions = (POLL_CHOICES as readonly number[]).includes(draft.pollSeconds)
    ? POLL_CHOICES
    : [...POLL_CHOICES, draft.pollSeconds].sort((a, b) => a - b);
  return (
    <Select
      label="Refresh 7pace"
      description="Server rate limits are always respected."
      items={pollOptions.map((seconds) => ({ id: seconds, label: POLL_LABELS[seconds] ?? `Every ${seconds} seconds` }))}
      selectedKey={draft.pollSeconds}
      onSelectionChange={(key) => {
        if (typeof key === 'number') update((current) => ({ ...current, pollSeconds: key }));
      }}
      width="narrow"
    />
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

/** The quick-switch shortcut (App card). */
export function QuickSwitch() {
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
    <div className={styles.group}>
      <ToggleRow
        title={`Quick switch from any app · ${label}`}
        help={`${spokenAccelerator(accelerator, os)} opens ticket search with favorites and recent tickets. Choose an activity before switching.`}
        isSelected={draft.quickSwitchEnabled}
        onChange={(quickSwitchEnabled) => update((current) => ({ ...current, quickSwitchEnabled }))}
      />
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
      {status.issue ? <InlineIssue tone="warning">{status.issue}</InlineIssue> : null}
    </div>
  );
}

/** Settings → Targets & reminders → Timer & reminders: the default activity and ticket reminders. */
export function TimerSection() {
  const { draft, update } = useSettingsForm();
  const flow = useSlice('flow');
  const activities = flow?.activityTypes ?? [];
  return (
    <SettingsSection id="tracking" subtitle="Nothing starts a timer until you choose an activity and confirm.">
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
      <ToggleRow
        title="Remind me when the tracked ticket is completed"
        help="Checks Azure about once a minute while tracking (needs an Azure PAT with Work Items read access). You choose Keep tracking, Stop or Switch ticket."
        isSelected={draft.completionReminders}
        onChange={(completionReminders) => update((current) => ({ ...current, completionReminders }))}
      />
    </SettingsSection>
  );
}
