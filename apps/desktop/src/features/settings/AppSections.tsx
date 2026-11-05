import { useContext } from 'react';
import { Button } from '../../components/Button';
import { NumberField } from '../../components/Fields';
import { KeyboardIcon } from '../../components/icons';
import type { Cadences } from '../../ipc/contract';
import { ShortcutContext } from '../../shortcuts/hooks';
import { useAction } from '../../state/hooks';
import { KeyboardShortcut } from '../../components/KeyboardShortcut';
import { PALETTE_SHORTCUT } from '../../shortcuts/ShortcutProvider';
import { UpdateSettings } from '../updates/UpdateSettings';
import { AppearanceSettings } from './AppearanceForm';
import { osWords } from './labels';
import { Divider, Hint, InlineIssue, SettingRow, SettingsCard, SettingsGroup, SettingsSection, ToggleRow } from './SettingsSection';
import { PollSelect, QuickSwitch } from './TrackingSection';
import { useSettingsForm } from './SettingsForm';
import { useLaunchAtLogin } from './useLaunchAtLogin';
import { CADENCE_BOUNDS, issueFor } from './validation';
import styles from './settings.module.css';

/** Settings → Appearance & app → Appearance (applies immediately). */
export function AppearanceSection() {
  const { os } = useSettingsForm();
  return (
    <SettingsSection id="appearance">
      <AppearanceSettings os={os} />
    </SettingsSection>
  );
}

/** Settings → Appearance & app → App: startup, the mini timer, the palette and quick switch. */
export function AppSection() {
  const { draft, update, os } = useSettingsForm();
  const launch = useLaunchAtLogin();
  const words = osWords(os);
  return (
    <SettingsSection id="app">
      <ToggleRow
        title="Open at login"
        help={launch.available ? `Starts in the ${words.trayPlace}, without a window. Applies right away.` : 'Available in the desktop app.'}
        isSelected={launch.enabled ?? false}
        isDisabled={!launch.available || launch.pending}
        onChange={launch.set}
      />
      {launch.error ? <InlineIssue>{launch.error}</InlineIssue> : null}
      <ToggleRow
        title="Floating mini timer"
        help={
          os === 'windows'
            ? 'Stays on top of other windows, because the notification area shows no clock.'
            : 'Stays on top of other windows, next to the menu-bar clock.'
        }
        isSelected={draft.miniTimer}
        onChange={(miniTimer) => update((current) => ({ ...current, miniTimer }))}
      />
      <SettingRow title="Open the command palette" help="Works whenever the app window is open.">
        <KeyboardShortcut shortcut={PALETTE_SHORTCUT} variant="standalone" />
      </SettingRow>
      <Divider />
      <QuickSwitch />
      <Hint>{`The app stays in the ${words.trayPlace} when its window closes. Quitting leaves the 7pace timer running.`}</Hint>
    </SettingsSection>
  );
}

/**
 * Settings → Appearance & app → App updates: the updater's own section (`UpdateSettings`, with
 * its h3 and the saved state of automatic checks) plus the draft switch it points to.
 */
export function UpdatesSection() {
  const { draft, update } = useSettingsForm();
  const seconds = draft.cadences.updateCheckSeconds;
  return (
    <SettingsCard id="updates">
      <UpdateSettings headingLevel={3} />
      <Divider />
      <ToggleRow
        title="Check for updates automatically"
        help={`Checks the update feed every ${seconds} seconds once saved. Change the interval under Advanced.`}
        isSelected={draft.automaticUpdateChecks}
        onChange={(automaticUpdateChecks) => update((current) => ({ ...current, automaticUpdateChecks }))}
      />
    </SettingsCard>
  );
}

interface CadenceField {
  key: keyof Cadences;
  label: string;
  description: string;
  needsCalendar?: boolean;
}

const CADENCES: readonly CadenceField[] = [
  { key: 'probeSeconds', label: 'Local checks', description: 'Git branches, presence, microphone and Figma. 1–10 seconds.' },
  { key: 'calendarSeconds', label: 'Calendar', description: 'Reading calendar events. 15–300 seconds.', needsCalendar: true },
  { key: 'progressSeconds', label: 'Time totals', description: 'Reloading today’s and this week’s totals. 60–3,600 seconds.' },
  { key: 'updateCheckSeconds', label: 'Update checks', description: 'Checking the update feed. 60–86,400 seconds.' },
];

/** `Cadences::default()`. */
const DEFAULT_CADENCES: Cadences = { probeSeconds: 2, calendarSeconds: 30, progressSeconds: 300, updateCheckSeconds: 60 };

/**
 * Settings → Appearance & app → Advanced: the version, keyboard help, the onboarding, how often
 * things are checked, and where data is kept. (No log export or local-data reset: the engine has
 * no such actions.)
 */
export function AdvancedSection() {
  const { draft, update, issues, app, os, dirty, preview } = useSettingsForm();
  const shortcuts = useContext(ShortcutContext);
  const onboarding = useAction();
  const issue = issueFor(issues, 'cadences');
  const calendar = app?.features.calendar ?? true;
  const cadences = draft.cadences;
  const words = osWords(os);
  const mod = os === 'windows' ? 'Ctrl+' : '⌘';
  const isDefault = (Object.keys(DEFAULT_CADENCES) as Array<keyof Cadences>).every((key) => cadences[key] === DEFAULT_CADENCES[key]);
  return (
    <SettingsSection id="advanced">
      <SettingRow title={app ? `Version ${app.version}` : 'Azure timetracker'} help={`${words.name} · Check for updates under App updates.`}>
        {shortcuts ? (
          <Button size="small" icon={KeyboardIcon} onPress={shortcuts.openCheatSheet}>
            Show keyboard shortcuts
          </Button>
        ) : null}
      </SettingRow>
      <Hint>{`${mod}1, ${mod}2 and ${mod}3 open Today, Timesheet and Insights; ${mod}, opens Settings and ${mod}K the command palette. ${mod}S saves Settings.`}</Hint>
      <SettingRow
        title="Onboarding"
        help={
          preview
            ? 'Not available in preview mode.'
            : dirty
              ? 'Save or revert your changes first: the onboarding replaces this window until you finish it.'
              : 'Walk through the first-run setup again. Your settings, accounts and any running timer stay as they are.'
        }
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
      {onboarding.error ? <InlineIssue>{onboarding.error.message}</InlineIssue> : null}
      <Divider />
      <SettingsGroup title="Polling intervals" description="How often the app checks things. Shorter intervals react faster and use a little more energy.">
        <PollSelect />
        <div className={styles.fieldRow}>
          {CADENCES.filter((field) => !field.needsCalendar || calendar).map((field) => {
            const bounds = CADENCE_BOUNDS[field.key];
            const value = cadences[field.key];
            const invalid = !Number.isInteger(value) || value < bounds.min || value > bounds.max;
            return (
              <NumberField
                key={field.key}
                label={field.label}
                description={field.description}
                unit="seconds"
                minValue={bounds.min}
                maxValue={bounds.max}
                value={value}
                onChange={(next) => {
                  if (Number.isInteger(next)) update((current) => ({ ...current, cadences: { ...current.cadences, [field.key]: next } }));
                }}
                isInvalid={invalid}
                formatOptions={{ maximumFractionDigits: 0 }}
                width="full"
              />
            );
          })}
        </div>
        {issue ? <InlineIssue>{issue}</InlineIssue> : null}
        <div className={styles.row}>
          <Button size="small" isDisabled={isDefault} onPress={() => update((current) => ({ ...current, cadences: { ...DEFAULT_CADENCES } }))}>
            Restore default intervals
          </Button>
        </div>
      </SettingsGroup>
      <Divider />
      <Hint>
        {`Tokens are kept in ${words.credentials}; your Git repositories stay untouched. Day review status, drafts and suggestions history are stored only on this ${words.device}.`}
      </Hint>
    </SettingsSection>
  );
}
