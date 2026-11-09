import type { ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import type { HostOs } from '../../ipc/contract';
import { useFigmaPreferences } from './FigmaSettings';
import { FEATURES, pageShown, setPageShown, type FeatureDefinition, type FeatureGroup } from './features';
import { IssueRow, SectionFooter, SettingRow, SettingsGroup, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { useLaunchAtLogin, type LaunchAtLogin } from './useLaunchAtLogin';
import { mark, t } from '../../i18n';
import styles from './settings.module.css';

const GROUPS: readonly FeatureGroup[] = ['Tracking', 'Meetings', 'Views', 'App'];

const GROUP_LABELS: Record<FeatureGroup, string> = {
  Tracking: mark('Tracking'),
  Meetings: mark('Meetings'),
  Views: mark('Views'),
  App: mark('App'),
};

const GROUP_DESCRIPTIONS: Record<FeatureGroup, string> = {
  Tracking: mark('Suggestions and reminders while you work.'),
  Meetings: mark('Meeting suggestions from your calendar and microphone.'),
  Views: mark('Hide views you do not use. Today and Settings are always available.'),
  App: mark('How the app runs on this device.'),
};

/** The permission a module needs, as a chip ("Accessibility"), or nothing when it needs none. */
function permissionChip(feature: FeatureDefinition, os: HostOs): ReactNode {
  const permission = feature.permission(os);
  if (permission === 'None') return null;
  return <Badge tone="neutral">{t(permission)}</Badge>;
}

/** The privacy line and the permission chip, under a feature's description. */
function facts(feature: FeatureDefinition, os: HostOs): ReactNode {
  return (
    <>
      <span>{feature.privacy(os)}</span>
      {permissionChip(feature, os)}
    </>
  );
}

function FigmaFeature({ feature }: { feature: FeatureDefinition }) {
  const { os } = useSettingsForm();
  const figma = useFigmaPreferences();
  return (
    <>
      <ToggleRow
        title={t(feature.title)}
        help={t('Applies right away.')}
        extra={facts(feature, os)}
        isSelected={figma.preferences.enabled}
        onChange={(enabled) => figma.apply({ ...figma.preferences, enabled })}
      />
      {figma.error ? <IssueRow>{figma.error.message}</IssueRow> : null}
    </>
  );
}

function LaunchFeature({ feature, launch }: { feature: FeatureDefinition; launch: LaunchAtLogin }) {
  const { os } = useSettingsForm();
  return (
    <>
      <ToggleRow
        title={t(feature.title)}
        help={launch.available ? t('Applies right away.') : t('Available in the desktop app.')}
        extra={facts(feature, os)}
        isSelected={launch.enabled ?? false}
        isDisabled={!launch.available || launch.pending}
        onChange={launch.set}
      />
      {launch.error ? <IssueRow>{launch.error}</IssueRow> : null}
    </>
  );
}

function FeatureRow({ feature, launch }: { feature: FeatureDefinition; launch: LaunchAtLogin }) {
  const { draft, update, os, app } = useSettingsForm();
  const binding = feature.binding;
  const unavailable = feature.needsMicrophone === true && app?.features.microphone === false;
  switch (binding.kind) {
    case 'field':
      return (
        <ToggleRow
          title={t(feature.title)}
          help={unavailable ? t('Not available on this system.') : undefined}
          extra={facts(feature, os)}
          isSelected={binding.get(draft)}
          isDisabled={unavailable}
          onChange={(on) => update((current) => binding.set(current, on))}
        />
      );
    case 'page':
      return (
        <ToggleRow
          title={t(feature.title)}
          help={t(binding.where)}
          extra={facts(feature, os)}
          isSelected={pageShown(draft, binding.page)}
          onChange={(on) => update((current) => setPageShown(current, binding.page, on))}
        />
      );
    case 'figma':
      return <FigmaFeature feature={feature} />;
    case 'launchAtLogin':
      return <LaunchFeature feature={feature} launch={launch} />;
    case 'info':
      return (
        <SettingRow title={t(feature.title)} help={t(binding.text)} below={<p className={styles.rowExtra}>{facts(feature, os)}</p>}>
          <Badge tone="neutral">{t('Always on')}</Badge>
        </SettingRow>
      );
  }
}

/** Settings → Features & privacy: every module with its switch, what it reads and the permission it needs. */
export function FeaturesSection() {
  const { app, goTo } = useSettingsForm();
  const launch = useLaunchAtLogin();
  const calendar = app?.features.calendar ?? true;
  const visible = FEATURES.filter((feature) => !feature.needsCalendar || calendar);
  return (
    <SettingsSection id="features" subtitle={t('Saved with Save changes, except Figma and Launch at login, which apply right away.')}>
      {GROUPS.map((group) => {
        const rows = visible.filter((feature) => feature.group === group);
        if (rows.length === 0) return null;
        return (
          <SettingsGroup key={group} title={t(GROUP_LABELS[group])} description={t(GROUP_DESCRIPTIONS[group])}>
            {rows.map((feature) => (
              <FeatureRow key={feature.id} feature={feature} launch={launch} />
            ))}
          </SettingsGroup>
        );
      })}
      <SectionFooter
        actions={
          <Button size="small" variant="plain" onPress={() => goTo('about')}>
            {t('What is stored where')}
          </Button>
        }
      >
        {t('Nothing is sent anywhere except to Azure DevOps and 7pace.')}
      </SectionFooter>
    </SettingsSection>
  );
}
