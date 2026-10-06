import { useContext } from 'react';
import { Button } from '../../components/Button';
import { NumberField } from '../../components/Fields';
import { KeyboardIcon } from '../../components/icons';
import { Switch } from '../../components/Toggles';
import type { Cadences } from '../../ipc/contract';
import { ShortcutContext } from '../../shortcuts/hooks';
import { UpdateSettings } from '../updates/UpdateSettings';
import { AppearanceSettings } from './AppearanceForm';
import { FigmaSettings } from './FigmaSettings';
import { osWords } from './labels';
import { Divider, Hint, InlineIssue, SettingsCard, SettingsGroup, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { useLaunchAtLogin } from './useLaunchAtLogin';
import { CADENCE_BOUNDS, issueFor } from './validation';
import styles from './settings.module.css';

/** Settings → Tracking → Figma Desktop (applies immediately). */
export function FigmaSection() {
  return (
    <SettingsSection id="figma" subtitle="Suggest Design tracking when you switch files. Always confirm before a timer changes.">
      <FigmaSettings />
    </SettingsSection>
  );
}

/** Settings → Appearance (applies immediately). */
export function AppearanceSection() {
  const { os } = useSettingsForm();
  return (
    <SettingsSection id="appearance">
      <AppearanceSettings os={os} />
    </SettingsSection>
  );
}

/** Settings → App → Window and startup: launch at login (immediate) and the mini timer. */
export function WindowSection() {
  const { draft, update, os } = useSettingsForm();
  const launch = useLaunchAtLogin();
  const words = osWords(os);
  return (
    <SettingsSection id="window" subtitle={`How Azure timetracker works on your ${words.device}.`}>
      <Switch
        isSelected={launch.enabled ?? false}
        isDisabled={!launch.available || launch.pending}
        onChange={launch.set}
        description={launch.available ? 'Applies immediately.' : 'Available in the desktop app.'}
      >
        Open Azure timetracker at login
      </Switch>
      {launch.error ? <InlineIssue>{launch.error}</InlineIssue> : null}
      <Switch
        isSelected={draft.miniTimer}
        onChange={(miniTimer) => update((current) => ({ ...current, miniTimer }))}
        description={
          os === 'windows'
            ? 'A small always-on-top window with the elapsed time, because the notification area shows no clock.'
            : 'A small always-on-top window with the elapsed time, next to the menu-bar clock.'
        }
      >
        Show the mini timer
      </Switch>
      <Hint>{`The app stays in the ${words.trayPlace} when its window closes. Quitting leaves the 7pace timer running.`}</Hint>
    </SettingsSection>
  );
}

/**
 * Settings → App → App updates: the updater's own section (`UpdateSettings`, with its h2 and
 * the saved state of automatic checks) plus the draft switch it points to.
 */
export function UpdatesSection() {
  const { draft, update } = useSettingsForm();
  const seconds = draft.cadences.updateCheckSeconds;
  return (
    <SettingsCard id="updates">
      <UpdateSettings />
      <Divider />
      <Switch
        isSelected={draft.automaticUpdateChecks}
        onChange={(automaticUpdateChecks) => update((current) => ({ ...current, automaticUpdateChecks }))}
        description={`Checks the update feed every ${seconds} seconds once saved. Change the interval in Advanced.`}
      >
        Check for updates automatically
      </Switch>
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

/** Settings → Advanced: the polling cadences within the Rust bounds. */
export function AdvancedSection() {
  const { draft, update, issues, app } = useSettingsForm();
  const issue = issueFor(issues, 'cadences');
  const calendar = app?.features.calendar ?? true;
  const cadences = draft.cadences;
  const isDefault = (Object.keys(DEFAULT_CADENCES) as Array<keyof Cadences>).every((key) => cadences[key] === DEFAULT_CADENCES[key]);
  return (
    <SettingsSection id="advanced" subtitle="How often the app checks things. Shorter intervals react faster and use a little more energy.">
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
      <Hint>The 7pace timer refresh is under Tracking → Refresh 7pace. Server rate limits are always respected.</Hint>
      <div className={styles.row}>
        <Button isDisabled={isDefault} onPress={() => update((current) => ({ ...current, cadences: { ...DEFAULT_CADENCES } }))}>
          Restore default intervals
        </Button>
      </div>
    </SettingsSection>
  );
}

/** Settings → App → About: version, system, keyboard and storage notes. */
export function AboutSection() {
  const { app, os } = useSettingsForm();
  const shortcuts = useContext(ShortcutContext);
  const words = osWords(os);
  const mod = os === 'windows' ? 'Ctrl+' : '⌘';
  return (
    <SettingsSection id="about">
      <dl className={styles.levels}>
        <dt>Version</dt>
        <dd>{app ? `Azure timetracker ${app.version}` : 'Azure timetracker'}</dd>
        <dt>System</dt>
        <dd>{words.name}</dd>
      </dl>
      <Divider />
      <SettingsGroup title="Keyboard navigation">
        <Hint>
          {`${mod}1–${mod}9 and ${mod}0 open the pages in sidebar order. ${mod}K opens the command palette and ? lists every shortcut. ${mod}S saves Settings.`}
        </Hint>
        <Hint>Every action is reachable with Tab and the arrow keys; buttons show a visible focus ring.</Hint>
        {shortcuts ? (
          <div className={styles.row}>
            <Button icon={KeyboardIcon} onPress={shortcuts.openCheatSheet}>
              Show keyboard shortcuts
            </Button>
          </div>
        ) : null}
      </SettingsGroup>
      <Divider />
      <Hint>
        {`Credentials are kept in ${os === 'windows' ? words.credentials : 'macOS Keychain'}. Day review status is stored only on this ${words.device}.`}
      </Hint>
    </SettingsSection>
  );
}
