import { useContext, useState } from 'react';
import { announce } from '../../components/Announcer';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { NumberField } from '../../components/Fields';
import { CheckIcon, ExternalLinkIcon, KeyboardIcon, WarningIcon } from '../../components/icons';
import { KeyboardShortcut } from '../../components/KeyboardShortcut';
import { ProgressBar } from '../../components/Progress';
import { SegmentedControl } from '../../components/Segmented';
import type { Cadences, InterfacePreferences } from '../../ipc/contract';
import { revealDataDirectory } from '../../ipc/shell';
import { SETTINGS_SHORTCUT } from '../../layout/AppShell';
import type { KeyCombo } from '../../shortcuts/keys';
import { ShortcutContext } from '../../shortcuts/hooks';
import { PALETTE_SHORTCUT } from '../../shortcuts/ShortcutProvider';
import { useAction, useSlice } from '../../state/hooks';
import {
  CONTRAST_LABELS,
  CONTRAST_PREFERENCES,
  DEFAULT_INTERFACE_PREFERENCES,
  preferencesEqual,
  SCALE_PREFERENCES,
  scaleLabel,
  THEME_LABELS,
  THEME_PREFERENCES,
} from '../../theme/preferences';
import { chooseSavePath } from '../ticketContext/native';
import { openDownloadsPage } from '../updates/api';
import { ACTION_LABELS, canCheck, downloadPercent, downloadText, formatDate, formatDateTime, updateAction } from '../updates/model';
import { useUpdateActions, useUpdateStatus } from '../updates/useUpdateStatus';
import { useInterfacePreferences } from './AppearanceForm';
import { osWords } from './labels';
import { SAVE_SHORTCUT } from './SaveBar';
import {
  FullRow,
  Hint,
  HintRow,
  InlineIssue,
  IssueRow,
  SettingRow,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
} from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { PollSelect, QuickSwitch } from './TrackingSection';
import { useLaunchAtLogin } from './useLaunchAtLogin';
import { CADENCE_BOUNDS, issueFor } from './validation';
import styles from './settings.module.css';

/** Settings → Appearance & shortcuts → Appearance: theme, size and contrast, applied right away. */
export function AppearanceSection() {
  const { os } = useSettingsForm();
  const { preferences, apply, error } = useInterfacePreferences();
  const words = osWords(os);
  const set = (patch: Partial<InterfacePreferences>) => apply({ ...preferences, ...patch });
  return (
    <SettingsSection
      id="appearance"
      actions={
        <>
          <Badge tone="neutral">Applies right away</Badge>
          <Button
            size="small"
            variant="plain"
            onPress={() => apply({ ...DEFAULT_INTERFACE_PREFERENCES })}
            isDisabled={preferencesEqual(preferences, DEFAULT_INTERFACE_PREFERENCES)}
          >
            Reset
          </Button>
        </>
      }
    >
      <SettingRow title="Theme" help={`System follows your ${words.device}’s Light, Dark or automatic appearance.`}>
        <SegmentedControl
          label="Theme"
          hideLabel
          options={THEME_PREFERENCES.map((theme) => ({ id: theme, label: THEME_LABELS[theme] }))}
          selectedKey={preferences.theme}
          onSelectionChange={(theme) => set({ theme })}
        />
      </SettingRow>
      <SettingRow
        title="Text and control size"
        help={`Text, buttons and charts resize together.${os === 'macos' ? ' The menu-bar clock stays its normal size.' : ''}`}
      >
        <SegmentedControl
          label="Text and control size"
          hideLabel
          options={SCALE_PREFERENCES.map((scale) => ({ id: String(scale), label: scaleLabel(scale) }))}
          selectedKey={String(preferences.scale)}
          onSelectionChange={(value) => set({ scale: Number(value) as InterfacePreferences['scale'] })}
        />
      </SettingRow>
      <SettingRow
        title="Contrast"
        help={
          os === 'windows'
            ? 'Increased adds stronger borders and darker secondary text. System follows Windows contrast settings.'
            : 'Increased adds stronger borders and darker secondary text. System follows Increase contrast in macOS.'
        }
      >
        <SegmentedControl
          label="Contrast"
          hideLabel
          options={CONTRAST_PREFERENCES.map((id) => ({ id, label: CONTRAST_LABELS[id] }))}
          selectedKey={preferences.contrast}
          onSelectionChange={(contrast) => set({ contrast })}
        />
      </SettingRow>
      {error ? <IssueRow>{error.message}</IssueRow> : null}
    </SettingsSection>
  );
}

/** Settings → Appearance & shortcuts → Menu bar & windows: startup, the menu-bar timer and the mini timer. */
export function AppSection() {
  const { draft, update, os } = useSettingsForm();
  const launch = useLaunchAtLogin();
  const words = osWords(os);
  return (
    <SettingsSection id="app" title={os === 'windows' ? 'Notification area & windows' : 'Menu bar & windows'}>
      <ToggleRow
        title="Open at login"
        help={launch.available ? `Starts in the ${words.trayPlace}, without a window. Applies right away.` : 'Available in the desktop app.'}
        isSelected={launch.enabled ?? false}
        isDisabled={!launch.available || launch.pending}
        onChange={launch.set}
      />
      {launch.error ? <IssueRow>{launch.error}</IssueRow> : null}
      {os === 'macos' ? (
        <ToggleRow
          title="Show the timer in the menu bar"
          help="Shows “1:23:45” next to the icon while tracking. Off shows the icon only."
          isSelected={draft.menuBarTimer}
          onChange={(menuBarTimer) => update((current) => ({ ...current, menuBarTimer }))}
        />
      ) : null}
      <ToggleRow
        title="Floating mini timer"
        help={
          os === 'windows'
            ? 'A small timer that stays on top of other windows, because the notification area shows no clock.'
            : 'A small timer that stays on top of other windows.'
        }
        isSelected={draft.miniTimer}
        onChange={(miniTimer) => update((current) => ({ ...current, miniTimer }))}
      />
      <HintRow>{`The app stays in the ${words.trayPlace} when its window closes. Quitting leaves the 7pace timer running.`}</HintRow>
    </SettingsSection>
  );
}

/** Shortcuts that work while the app window is open, as listed in the design. */
const APP_SHORTCUTS: ReadonlyArray<{ label: string; shortcut: KeyCombo }> = [
  { label: 'Track a ticket', shortcut: { key: 'n', mod: true } },
  { label: 'Review today', shortcut: { key: 'd', mod: true, shift: true } },
  { label: 'Save changes', shortcut: SAVE_SHORTCUT },
  { label: 'Today · Timesheet · Insights', shortcut: { key: '1–3', mod: true } },
  { label: 'Settings', shortcut: SETTINGS_SHORTCUT },
];

/** Settings → Appearance & shortcuts → Shortcuts: quick switch, the palette and the in-app keys. */
export function ShortcutsSection() {
  const shortcuts = useContext(ShortcutContext);
  return (
    <SettingsSection
      id="shortcuts"
      actions={
        shortcuts ? (
          <Button size="small" variant="plain" icon={KeyboardIcon} onPress={shortcuts.openCheatSheet}>
            All shortcuts
          </Button>
        ) : null
      }
    >
      <QuickSwitch />
      <SettingRow title="Command palette" help="Search tickets, entries and actions.">
        <KeyboardShortcut shortcut={PALETTE_SHORTCUT} variant="standalone" />
      </SettingRow>
      <SettingsGroup title="In the app window">
        <ul role="list" aria-label="Shortcuts in the app window" className={styles.rowList}>
          {APP_SHORTCUTS.map((entry) => (
            <li key={entry.label} className={styles.listRow}>
              <span>{entry.label}</span>
              <KeyboardShortcut shortcut={entry.shortcut} variant="standalone" />
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </SettingsSection>
  );
}

/** Settings → Updates & advanced → Updates: the version, a check, the offered release and automatic checks. */
export function UpdatesSection() {
  const { draft, update } = useSettingsForm();
  const app = useSlice('app');
  const { status, error } = useUpdateStatus();
  const actions = useUpdateActions();
  const [linkError, setLinkError] = useState<string | null>(null);
  const installed = status?.currentVersion || app?.version || '';
  const checked = formatDateTime(status?.checkedAt ?? null);
  const action = status ? updateAction(status) : null;
  const busy = app?.busy ?? false;
  const failed = status?.phase === 'failed';
  const percent = status ? downloadPercent(status) : null;
  const published = formatDate(status?.date ?? null);
  const chip = !status ? null : failed ? (
    <Badge tone="warning" icon={WarningIcon}>
      Check failed
    </Badge>
  ) : status.version ? (
    <Badge tone="accent">{`${status.version} available`}</Badge>
  ) : status.enabled && status.checkedAt ? (
    <Badge tone="success" icon={CheckIcon}>
      Up to date
    </Badge>
  ) : null;
  return (
    <SettingsSection id="updates">
      <SettingRow
        title={installed ? `Version ${installed}` : 'Azure timetracker'}
        help={[status?.message, checked ? `Last checked ${checked}` : null].filter(Boolean).join(' · ') || undefined}
      >
        {chip}
        <Button
          size="small"
          onPress={() =>
            void actions.check().then((result) => {
              // An offered update announces itself in the banner; say the other outcomes here.
              if (result && (result.phase === 'idle' || result.phase === 'failed')) announce(result.message);
            })
          }
          isDisabled={!canCheck(status) || actions.pending === 'install'}
          isPending={actions.pending === 'check' || status?.phase === 'checking'}
        >
          Check now
        </Button>
      </SettingRow>
      {status?.version ? (
        <FullRow className={styles.release}>
          <p className={styles.rowTitle}>{`Version ${status.version}`}</p>
          {published ? <Hint>{`Published ${published}`}</Hint> : null}
          {status.notes ? <p className={styles.releaseNotes}>{status.notes}</p> : null}
          {status.phase === 'downloading' && status ? (
            <ProgressBar
              label="Update download"
              value={percent ?? 0}
              isIndeterminate={percent === null}
              valueLabel={percent === null ? downloadText(status) : `${percent}% · ${downloadText(status)}`}
            />
          ) : null}
          {action ? (
            <div className={styles.buttonRow}>
              <Button
                variant="primary"
                size="small"
                onPress={() => void actions.install()}
                isDisabled={(action === 'restart' && busy) || actions.pending === 'check'}
                isPending={actions.pending === 'install'}
              >
                {ACTION_LABELS[action]}
              </Button>
              <Hint>Restarting keeps your 7pace timer running. Save any open edits first.</Hint>
            </div>
          ) : null}
        </FullRow>
      ) : null}
      {status?.phase === 'ready' && status.error ? <IssueRow tone="warning">{status.error}</IssueRow> : null}
      {error && !status ? <IssueRow tone="warning">{`Update status is unavailable: ${error}`}</IssueRow> : null}
      {actions.error ? <IssueRow>{actions.error}</IssueRow> : null}
      <ToggleRow
        title="Check for updates automatically"
        help="Checks at startup and regularly after that. You choose when to download and restart."
        isSelected={draft.automaticUpdateChecks}
        onChange={(automaticUpdateChecks) => update((current) => ({ ...current, automaticUpdateChecks }))}
      />
      <SettingRow
        title="Download manually"
        help="Every release is also on GitHub. Downloads are verified with the app’s release key."
        below={linkError ? <InlineIssue>{linkError}</InlineIssue> : null}
      >
        <Button
          size="small"
          variant="plain"
          trailingIcon={ExternalLinkIcon}
          onPress={() => {
            setLinkError(null);
            openDownloadsPage().catch((reason: unknown) => setLinkError(reason instanceof Error ? reason.message : String(reason)));
          }}
        >
          Open GitHub releases<span className="visually-hidden"> (opens in your browser)</span>
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

interface CadenceField {
  key: keyof Cadences;
  label: string;
  description: string;
  needsCalendar?: boolean;
}

const CADENCES: readonly CadenceField[] = [
  { key: 'probeSeconds', label: 'Local checks', description: 'Git branches, presence, microphone and Figma.' },
  { key: 'calendarSeconds', label: 'Calendar', description: 'Reading calendar events.', needsCalendar: true },
  { key: 'progressSeconds', label: 'Time totals', description: 'Today’s and this week’s totals from 7pace.' },
  { key: 'updateCheckSeconds', label: 'Update checks', description: 'Checking the update feed, when automatic checks are on.' },
];

/** `Cadences::default()`. */
const DEFAULT_CADENCES: Cadences = { probeSeconds: 2, calendarSeconds: 30, progressSeconds: 300, updateCheckSeconds: 60 };

/** "1–10 s", "60–3,600 s": the allowed range next to an interval. */
function rangeText(min: number, max: number): string {
  const format = new Intl.NumberFormat('en-GB');
  return `${format.format(min)}–${format.format(max)} s`;
}

/** Settings → Updates & advanced → Sync intervals: how often the app checks things. */
export function SyncIntervalsSection() {
  const { draft, update, issues, app } = useSettingsForm();
  const issue = issueFor(issues, 'cadences');
  const calendar = app?.features.calendar ?? true;
  const cadences = draft.cadences;
  const isDefault = (Object.keys(DEFAULT_CADENCES) as Array<keyof Cadences>).every((key) => cadences[key] === DEFAULT_CADENCES[key]);
  return (
    <SettingsSection
      id="advanced"
      subtitle="Shorter is fresher but sends more requests and uses a little more energy."
      actions={
        <Button
          size="small"
          variant="plain"
          isDisabled={isDefault}
          onPress={() => update((current) => ({ ...current, cadences: { ...DEFAULT_CADENCES } }))}
        >
          Restore defaults
        </Button>
      }
    >
      <PollSelect />
      {CADENCES.filter((field) => !field.needsCalendar || calendar).map((field) => {
        const bounds = CADENCE_BOUNDS[field.key];
        const value = cadences[field.key];
        const invalid = !Number.isInteger(value) || value < bounds.min || value > bounds.max;
        return (
          <SettingRow key={field.key} title={field.label} help={field.description}>
            {({ helpId }) => (
              <>
                <span className={styles.rangeHint}>{rangeText(bounds.min, bounds.max)}</span>
                <NumberField
                  label={field.label}
                  hideLabel
                  aria-describedby={helpId}
                  unit="s"
                  minValue={bounds.min}
                  maxValue={bounds.max}
                  value={value}
                  onChange={(next) => {
                    if (Number.isInteger(next)) update((current) => ({ ...current, cadences: { ...current.cadences, [field.key]: next } }));
                  }}
                  isInvalid={invalid}
                  formatOptions={{ maximumFractionDigits: 0 }}
                  className={styles.numberField}
                />
              </>
            )}
          </SettingRow>
        );
      })}
      {issue ? <IssueRow>{issue}</IssueRow> : null}
    </SettingsSection>
  );
}

/** `~/Library/…` for a folder in the home folder. */
function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '%USERPROFILE%');
}

/** Settings → Updates & advanced → Data on this Mac: the data folder, diagnostics and the onboarding. */
export function DataSection() {
  const { app, os, dirty, preview } = useSettingsForm();
  const onboarding = useAction();
  const diagnostics = useAction();
  const [revealError, setRevealError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const words = osWords(os);
  const folder = app?.dataDirectory ?? null;
  const [dialogError, setDialogError] = useState<string | null>(null);
  const saveLog = async () => {
    setSaved(null);
    setDialogError(null);
    let path: string | null = null;
    try {
      path = await chooseSavePath({
        defaultPath: 'azure-timetracker-diagnostics.txt',
        filters: [{ name: 'Text', extensions: ['txt'] }],
        title: 'Save diagnostics',
      });
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : String(reason));
    }
    if (!path) return;
    const result = await diagnostics.run({ type: 'app.saveDiagnostics', path });
    if (result.ok) setSaved(path);
  };
  return (
    <SettingsSection
      id="data"
      title={`Data on this ${words.device}`}
      subtitle={`Review status, drafts and suggestion history. Tokens are in ${words.credentials}.`}
    >
      <SettingRow title="Stored in" below={revealError ? <InlineIssue>{revealError}</InlineIssue> : null}>
        {folder ? <code className={styles.code}>{displayPath(folder)}</code> : <span className={styles.muted}>Not available in preview</span>}
        <Button
          size="small"
          isDisabled={!folder}
          onPress={() => {
            setRevealError(null);
            revealDataDirectory().catch((reason: unknown) => setRevealError(reason instanceof Error ? reason.message : String(reason)));
          }}
        >
          {os === 'windows' ? 'Show in Explorer' : 'Show in Finder'}
        </Button>
      </SettingRow>
      <SettingRow
        title="Diagnostics"
        help="A text file with the version, connection status and the app’s activity log. Never tokens."
        below={
          diagnostics.error || dialogError ? (
            <InlineIssue>{diagnostics.error?.message ?? dialogError}</InlineIssue>
          ) : saved ? (
            <p className={styles.success}>{`Saved to ${displayPath(saved)}`}</p>
          ) : null
        }
      >
        <Button size="small" onPress={() => void saveLog()} isPending={diagnostics.pending}>
          Save log…
        </Button>
      </SettingRow>
      <SettingRow
        title="Onboarding"
        help={
          preview
            ? 'Not available in preview mode.'
            : dirty
              ? 'Save or revert your changes first: the onboarding replaces this window until you finish it.'
              : 'Walk through the setup steps again. Your settings, accounts and any running timer stay.'
        }
        below={onboarding.error ? <InlineIssue>{onboarding.error.message}</InlineIssue> : null}
      >
        <Button
          size="small"
          isDisabled={dirty || preview}
          isPending={onboarding.pending}
          onPress={() => void onboarding.run({ type: 'app.restartOnboarding' })}
        >
          Show onboarding again
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

/** Settings → Updates & advanced → Reset: clears local history, never 7pace, Azure or unsent drafts. */
export function ResetSection() {
  const { os, preview, busy } = useSettingsForm();
  const reset = useAction();
  const [confirming, setConfirming] = useState(false);
  const words = osWords(os);
  return (
    <SettingsSection id="reset" tone="danger">
      <SettingRow
        title="Reset local data"
        help={`Removes day review status, Figma context history and drafts already sent to 7pace from this ${words.device}. Unsent drafts, settings and tokens stay; 7pace and Azure DevOps are not changed.`}
        below={reset.error ? <InlineIssue>{reset.error.message}</InlineIssue> : null}
      >
        <Button size="small" onPress={() => setConfirming(true)} isDisabled={preview || busy}>
          Reset…
        </Button>
      </SettingRow>
      <Dialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        role="alertdialog"
        size="small"
        title="Reset local data?"
        description={`Day review status, Figma context history and sent drafts are removed from this ${words.device}. Unsent drafts, your settings and tokens stay. This cannot be undone.`}
        primaryAction={{
          label: 'Reset local data',
          variant: 'destructive',
          isPending: reset.pending,
          onAction: () => {
            void reset.run({ type: 'app.resetLocalData' }).then((result) => {
              if (result.ok) setConfirming(false);
            });
          },
        }}
      />
    </SettingsSection>
  );
}
