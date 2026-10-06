import type { ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Switch } from '../../components/Toggles';
import type { HostOs } from '../../ipc/contract';
import { useFigmaPreferences } from './FigmaSettings';
import { FEATURES, pageShown, setPageShown, type FeatureDefinition, type FeatureGroup } from './features';
import { Hint, InlineIssue, SettingsGroup, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { useLaunchAtLogin, type LaunchAtLogin } from './useLaunchAtLogin';
import styles from './settings.module.css';

const GROUPS: readonly FeatureGroup[] = ['Tracking', 'Meetings', 'Pages', 'App'];

const GROUP_DESCRIPTIONS: Record<FeatureGroup, string> = {
  Tracking: 'Suggestions and reminders while you work.',
  Meetings: 'Meeting suggestions from your calendar and microphone.',
  Pages: 'Hide pages you do not use. Overview and Settings are always available.',
  App: 'How the app runs on this device.',
};

/** The privacy line and permission, linked to the switch as its description. */
function facts(feature: FeatureDefinition, os: HostOs, note?: string): ReactNode {
  return (
    <span className={styles.featureFacts}>
      {note ? <span className={styles.featureNote}>{note}</span> : null}
      <span className={styles.factLabel}>Privacy</span>
      <span>{feature.privacy(os)}</span>
      <span className={styles.factLabel}>Permission</span>
      <span>{feature.permission(os)}</span>
    </span>
  );
}

function FigmaFeature({ feature }: { feature: FeatureDefinition }) {
  const { os } = useSettingsForm();
  const figma = useFigmaPreferences();
  return (
    <>
      <Switch
        isSelected={figma.preferences.enabled}
        onChange={(enabled) => figma.apply({ ...figma.preferences, enabled })}
        description={facts(feature, os, 'Applies immediately.')}
      >
        {feature.title}
      </Switch>
      {figma.error ? <InlineIssue>{figma.error.message}</InlineIssue> : null}
    </>
  );
}

function LaunchFeature({ feature, launch }: { feature: FeatureDefinition; launch: LaunchAtLogin }) {
  const { os } = useSettingsForm();
  return (
    <>
      <Switch
        isSelected={launch.enabled ?? false}
        isDisabled={!launch.available || launch.pending}
        onChange={launch.set}
        description={facts(feature, os, launch.available ? 'Applies immediately.' : 'Available in the desktop app.')}
      >
        {feature.title}
      </Switch>
      {launch.error ? <InlineIssue>{launch.error}</InlineIssue> : null}
    </>
  );
}

function FeatureRow({ feature, launch }: { feature: FeatureDefinition; launch: LaunchAtLogin }) {
  const { draft, update, os, app } = useSettingsForm();
  const binding = feature.binding;
  const unavailable = feature.needsMicrophone === true && app?.features.microphone === false;
  let control: ReactNode;
  switch (binding.kind) {
    case 'field':
      control = (
        <Switch
          isSelected={binding.get(draft)}
          isDisabled={unavailable}
          onChange={(on) => update((current) => binding.set(current, on))}
          description={facts(feature, os, unavailable ? 'Not available on this system.' : undefined)}
        >
          {feature.title}
        </Switch>
      );
      break;
    case 'page':
      control = (
        <Switch
          isSelected={pageShown(draft, binding.page)}
          onChange={(on) => update((current) => setPageShown(current, binding.page, on))}
          description={facts(feature, os, 'Shows the page in the sidebar.')}
        >
          {feature.title}
        </Switch>
      );
      break;
    case 'figma':
      control = <FigmaFeature feature={feature} />;
      break;
    case 'launchAtLogin':
      control = <LaunchFeature feature={feature} launch={launch} />;
      break;
    case 'info':
      control = (
        <>
          <p className={styles.row}>
            <span className={styles.groupTitle}>{feature.title}</span>
            <Badge tone="neutral">No switch</Badge>
          </p>
          <Hint>{binding.text}</Hint>
          <p className={styles.hint}>{facts(feature, os)}</p>
        </>
      );
      break;
  }
  return <li className={styles.feature}>{control}</li>;
}

/** Settings → Features (rewrite plan §9): every module with its switch, privacy and permission. */
export function FeaturesSection() {
  const { app } = useSettingsForm();
  const launch = useLaunchAtLogin();
  const calendar = app?.features.calendar ?? true;
  const visible = FEATURES.filter((feature) => !feature.needsCalendar || calendar);
  return (
    <SettingsSection
      id="features"
      subtitle="Turn modules on or off. Changes are saved with Save changes, except Figma context and Launch at login, which apply immediately."
    >
      {GROUPS.map((group) => {
        const rows = visible.filter((feature) => feature.group === group);
        if (rows.length === 0) return null;
        return (
          <SettingsGroup key={group} title={group} description={GROUP_DESCRIPTIONS[group]}>
            <ul role="list" className={styles.featureList}>
              {rows.map((feature) => (
                <FeatureRow key={feature.id} feature={feature} launch={launch} />
              ))}
            </ul>
          </SettingsGroup>
        );
      })}
    </SettingsSection>
  );
}
