import { useCallback, useEffect, useState } from 'react';
import { announce } from '../../components/Announcer';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { KeyboardShortcut } from '../../components/KeyboardShortcut';
import { Select } from '../../components/Pickers';
import type { ShortcutStatus } from '../../ipc/shell';
import type { KeyCombo } from '../../shortcuts/keys';
import { useAction, useSlice } from '../../state/hooks';
import { POLL_LABELS } from './labels';
import { fallbackShortcut, readShortcut } from './platform';
import { InlineIssue, IssueRow, SettingRow, SettingsSection, ToggleRow } from './SettingsSection';
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
    <div className={styles.tableScroll}>
      <table className={styles.rules}>
        <thead>
          <tr>
            <th scope="col">When you switch to</th>
            <th scope="col">The app suggests</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code className={styles.code}>{TEST_BRANCH}</code>
            </td>
            <td>
              <Badge tone="accent">Track ticket #33624</Badge>
            </td>
          </tr>
          <tr>
            <td>
              <code className={styles.code}>develop</code> · <code className={styles.code}>main</code> ·{' '}
              <code className={styles.code}>long-feature/*</code>
            </td>
            <td>
              <Badge tone="neutral">Ask to pause, stop or keep tracking</Badge>
            </td>
          </tr>
          <tr>
            <td>Detached HEAD</td>
            <td>
              <Badge tone="neutral">Nothing</Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
      <SettingRow title="Ticket number pattern" help="Regular expression. The first group is the ticket number.">
        {({ helpId }) => (
          <TextField
            label="Ticket number pattern"
            hideLabel
            aria-describedby={helpId}
            value={draft.branchPattern}
            onChange={(branchPattern) => update((current) => ({ ...current, branchPattern }))}
            placeholder="Regular expression"
            isInvalid={test.invalid}
            errorMessage={test.invalid ? (test.text ?? undefined) : undefined}
            className={`${styles.mono} ${styles.fieldMedium}`}
            autoComplete="off"
            spellCheck="false"
          />
        )}
      </SettingRow>
      <SettingRow title="Try a branch name">
        <TextField
          label="Try a branch name"
          hideLabel
          value={branch}
          onChange={setBranch}
          className={`${styles.mono} ${styles.fieldMedium}`}
          autoComplete="off"
          spellCheck="false"
        />
        <output aria-live="polite" className={test.invalid ? styles.resultBad : test.testing ? styles.resultPending : styles.resultGood}>
          <span className="visually-hidden">Result: </span>
          {test.testing ? 'Testing…' : test.text}
        </output>
      </SettingRow>
      <ToggleRow
        title="Ask for an activity when the branch changes"
        help="Opens the activity chooser for a new branch while no timer runs. Every timer still starts after you choose its activity and confirm."
        isSelected={draft.autoStartWhenIdle}
        onChange={(autoStartWhenIdle) => update((current) => ({ ...current, autoStartWhenIdle }))}
      />
    </SettingsSection>
  );
}

/** How often the 7pace timer is refreshed (Updates & advanced → Sync intervals). */
export function PollSelect() {
  const { draft, update } = useSettingsForm();
  const pollOptions = (POLL_CHOICES as readonly number[]).includes(draft.pollSeconds)
    ? POLL_CHOICES
    : [...POLL_CHOICES, draft.pollSeconds].sort((a, b) => a - b);
  return (
    <SettingRow title="Timer status" help="The 7pace timer, so changes from the web show up here. Server rate limits are always respected.">
      {({ helpId }) => (
        <Select
          label="Refresh 7pace"
          hideLabel
          aria-describedby={helpId}
          items={pollOptions.map((seconds) => ({ id: seconds, label: POLL_LABELS[seconds] ?? `Every ${seconds} seconds` }))}
          selectedKey={draft.pollSeconds}
          onSelectionChange={(key) => {
            if (typeof key === 'number') update((current) => ({ ...current, pollSeconds: key }));
          }}
          className={styles.fieldNarrow}
        />
      )}
    </SettingRow>
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

/** An accelerator ("Control+Alt+T") as a key combo for `KeyboardShortcut`. */
export function acceleratorCombo(accelerator: string): KeyCombo {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase());
  const key = accelerator.split('+').pop()?.trim() ?? '';
  return {
    key: key.length === 1 ? key.toUpperCase() : key,
    ctrl: parts.includes('control') || parts.includes('ctrl'),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift'),
    mod: parts.some((part) => ['super', 'command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'meta'].includes(part)),
  };
}

/** The key part of an accelerator for a pressed key, or `null` for a modifier on its own. */
function acceleratorKey(event: KeyboardEvent): string | null {
  const { code } = event;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  const named: Record<string, string> = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/' };
  return named[code] ?? null;
}

/** The accelerator a key press makes ("Control+Alt+T"), or `null` until it has a modifier and a key. */
export function acceleratorFromEvent(event: KeyboardEvent, os: 'macos' | 'windows'): string | null {
  const key = acceleratorKey(event);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push(os === 'macos' ? 'Command' : 'Super');
  return parts.length > 0 ? [...parts, key].join('+') : null;
}

/** Records the next shortcut pressed while `recording`; Escape cancels. */
function useShortcutRecorder(os: 'macos' | 'windows', onRecord: (accelerator: string) => void) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(event, os);
      if (!accelerator) return;
      setRecording(false);
      onRecord(accelerator);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [recording, os, onRecord]);
  return { recording, setRecording };
}

/** Quick switch (Appearance & shortcuts → Shortcuts): on or off, and its recorded shortcut. */
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
  const looksInvalid = typed.trim() !== '' && !acceleratorLooksValid(typed);
  const record = useCallback(
    (quickSwitchShortcut: string) => {
      update((current) => ({ ...current, quickSwitchShortcut }));
      announce(`Quick switch shortcut set to ${spokenAccelerator(quickSwitchShortcut, os)}. Save changes to use it.`);
    },
    [update, os],
  );
  const recorder = useShortcutRecorder(os, record);
  return (
    <>
      <ToggleRow
        title="Quick switch ticket"
        help="Works everywhere, also when the app window is closed. Opens ticket search with favorites and recent tickets."
        isSelected={draft.quickSwitchEnabled}
        onChange={(quickSwitchEnabled) => update((current) => ({ ...current, quickSwitchEnabled }))}
      />
      <SettingRow
        sub
        title="Shortcut"
        help={typed.trim() === '' ? `The default, ${status.defaultLabel}.` : `Clear to use the default, ${status.defaultLabel}.`}
        dimmed={!draft.quickSwitchEnabled}
        below={
          <>
            {looksInvalid ? <InlineIssue tone="warning">Include at least one modifier key and one other key, such as {status.defaultAccelerator}.</InlineIssue> : null}
            {status.issue ? <InlineIssue tone="warning">{status.issue}</InlineIssue> : null}
          </>
        }
      >
        <span className={recorder.recording ? styles.recorderActive : styles.recorder}>
          {recorder.recording ? (
            <span aria-live="polite">Press the new shortcut, or Escape</span>
          ) : (
            <KeyboardShortcut shortcut={acceleratorCombo(accelerator)} variant="standalone" />
          )}
        </span>
        <Button size="small" onPress={() => recorder.setRecording((value) => !value)} isDisabled={!draft.quickSwitchEnabled}>
          {recorder.recording ? 'Cancel' : 'Record…'}
        </Button>
        <Button
          size="small"
          variant="plain"
          isDisabled={!draft.quickSwitchEnabled || typed.trim() === ''}
          onPress={() => update((current) => ({ ...current, quickSwitchShortcut: null }))}
        >
          Clear
        </Button>
      </SettingRow>
    </>
  );
}

/** Settings → Reminders → Timer defaults: the default activity, ticket reminders and rounding. */
export function TimerSection() {
  const { draft, update } = useSettingsForm();
  const flow = useSlice('flow');
  const activities = flow?.activityTypes ?? [];
  return (
    <SettingsSection
      id="tracking"
      subtitle="Nothing starts a timer until you choose an activity and confirm. Only quarter-hour rounding changes what is saved to 7pace."
    >
      {activities.length > 0 ? (
        <SettingRow title="Activity for new timers" help="Used when a source does not suggest one.">
          {({ helpId }) => (
            <Select
              label="Default activity"
              hideLabel
              aria-describedby={helpId}
              items={activityOptions(activities, 'Use 7pace default', draft.activityTypeId)}
              selectedKey={draft.activityTypeId === '' ? DEFAULT_ACTIVITY_KEY : draft.activityTypeId}
              onSelectionChange={(key) =>
                update((current) => ({ ...current, activityTypeId: key === DEFAULT_ACTIVITY_KEY || key === null ? '' : String(key) }))
              }
              className={styles.fieldMedium}
            />
          )}
        </SettingRow>
      ) : (
        <SettingRow title="Activity type ID" help="Optional. Only needed if your organization requires a specific activity.">
          {({ helpId }) => (
            <TextField
              label="Activity type ID"
              hideLabel
              aria-describedby={helpId}
              placeholder="Use 7pace default"
              value={draft.activityTypeId}
              onChange={(activityTypeId) => update((current) => ({ ...current, activityTypeId }))}
              autoComplete="off"
              className={styles.fieldMedium}
            />
          )}
        </SettingRow>
      )}
      {flow?.activityError ? <IssueRow tone="warning">{flow.activityError}</IssueRow> : null}
      <ToggleRow
        title="Tell me when my ticket is closed"
        help="If the ticket you track is set to Done or Closed in Azure DevOps, offer to switch. Checks about once a minute while tracking (needs an Azure PAT)."
        isSelected={draft.completionReminders}
        onChange={(completionReminders) => update((current) => ({ ...current, completionReminders }))}
      />
      <ToggleRow
        title="Round saved time to the nearest quarter hour"
        help="1h 5m is saved as 1h, 1h 12m as 1h 15m, and anything shorter than 7m 30s as 15m. Applies when the app saves time to 7pace: stopped timers, offline drafts and Time editor changes. Entries already in 7pace stay as they are."
        isSelected={draft.roundToQuarterHours}
        onChange={(roundToQuarterHours) => update((current) => ({ ...current, roundToQuarterHours }))}
      />
    </SettingsSection>
  );
}
