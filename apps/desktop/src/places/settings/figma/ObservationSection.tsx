import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { NumberField } from '../../../components/Fields';
import { CheckIcon, WarningIcon } from '../../../components/icons';
import { FigmaSourceIcon } from '../../../features/settings/icons';
import { FullRow, HintRow, InlineIssue, IssueRow, SectionFooter, SettingRow, SettingsSection, ToggleRow } from '../../../features/settings/SettingsSection';
import rowStyles from '../../../features/settings/settings.module.css';
import { StatusTiles } from '../../../features/settings/StatusTiles';
import type { FigmaPreferences, FigmaSlice } from '../../../ipc/contract';
import { useAction, useSlice } from '../../../state/hooks';
import { observationText } from './model';

export interface ObservationSectionProps {
  figma: FigmaSlice;
  /** Window titles only (Windows, experimental). */
  titleOnly: boolean;
}

/**
 * "Figma Desktop" (1.14 `FigmaSettingsView` on the Figma page): observation on or off, the
 * Accessibility permission, the current observation and the suggestion and history settings.
 * Changes save immediately (`figma.setPreferences`).
 */
export function ObservationSection({ figma, titleOnly }: ObservationSectionProps) {
  const app = useSlice('app');
  const save = useAction();
  const access = useAction();
  const recheck = useAction();
  const preferences = figma.preferences;
  const macos = !titleOnly && app?.os !== 'windows';
  const needsAccess = preferences.enabled && !figma.access;

  const update = (patch: Partial<FigmaPreferences>) => {
    const next = { ...preferences, ...patch };
    if (
      next.enabled === preferences.enabled &&
      next.dismissalMinutes === preferences.dismissalMinutes &&
      next.historyDays === preferences.historyDays
    ) {
      return;
    }
    void save.run({ type: 'figma.setPreferences', preferences: next });
  };

  return (
    <SettingsSection id="figma" subtitle="Suggest Design tracking when you switch files. Always confirm before a timer changes.">
      <ToggleRow
        title="Observe Figma files"
        help={
          macos
            ? 'Reads only file URLs and window titles on this Mac. No design content, Figma account, token or plugin. Browser tabs are not observed.'
            : 'Reads only window titles on this PC. No design content, Figma account, token or plugin. Browser tabs are not observed.'
        }
        isSelected={preferences.enabled}
        isDisabled={save.pending}
        onChange={(enabled) => update({ enabled })}
      />
      {titleOnly ? (
        <FullRow>
          <Banner tone="info" title="Title-only detection (experimental)" live="off">
            Figma files are recognised by their window title. Files with the same title share one entry and one ticket link, and they
            cannot be opened from here.
          </Banner>
        </FullRow>
      ) : null}
      {preferences.enabled && !figma.installed ? (
        <HintRow>Figma Desktop was not found on this computer. Files can still be opened in the browser.</HintRow>
      ) : null}
      {needsAccess ? (
        <SettingRow
          title={macos ? 'Accessibility permission' : 'Window access'}
          help={
            macos
              ? 'Enable Azure timetracker in System Settings → Privacy & Security → Accessibility, then return here. Already on? macOS ties the permission to the app’s signature, so after an update or with a local build, remove Azure timetracker with − and add it again.'
              : 'Allow Azure timetracker to read window titles, then return here.'
          }
          below={(access.error ?? recheck.error) ? <InlineIssue>{(access.error ?? recheck.error)?.message}</InlineIssue> : null}
        >
          <Button size="small" onPress={() => void access.run({ type: 'figma.requestAccess' })} isPending={access.pending}>
            {macos ? 'Allow Accessibility…' : 'Allow access…'}
          </Button>
          <Button size="small" variant="plain" onPress={() => void recheck.run({ type: 'figma.refreshAccess' })} isPending={recheck.pending}>
            Check permission again
          </Button>
        </SettingRow>
      ) : null}
      <SettingRow title="After I dismiss a suggestion, stay quiet for" help="Per file. Opening another linked file still suggests. 0 allows a new suggestion at the next activation.">
        {({ helpId }) => (
          <NumberField
            label="After I dismiss a suggestion, stay quiet for"
            hideLabel
            aria-describedby={helpId}
            unit="min"
            minValue={0}
            maxValue={120}
            value={preferences.dismissalMinutes}
            isDisabled={save.pending}
            onChange={(value) => {
              if (Number.isFinite(value)) update({ dismissalMinutes: Math.round(value) });
            }}
            formatOptions={{ maximumFractionDigits: 0 }}
            className={rowStyles.numberField}
          />
        )}
      </SettingRow>
      <SettingRow title="Keep context history for" help="Used to suggest the ticket for a file you opened before.">
        {({ helpId }) => (
          <NumberField
            label="Keep context history for"
            hideLabel
            aria-describedby={helpId}
            unit="days"
            minValue={1}
            maxValue={365}
            value={preferences.historyDays}
            isDisabled={save.pending}
            onChange={(value) => {
              if (Number.isFinite(value)) update({ historyDays: Math.round(value) });
            }}
            formatOptions={{ maximumFractionDigits: 0 }}
            className={rowStyles.numberField}
          />
        )}
      </SettingRow>
      {save.error ? <IssueRow>{save.error.message}</IssueRow> : null}
      <SectionFooter>Pausing branch watching (Git repositories) pauses Figma observations too. Changes here apply right away.</SectionFooter>
    </SettingsSection>
  );
}

/** The Figma view's status tiles: what is observed now, and the permission it needs. */
export function FigmaTiles({ figma, titleOnly }: ObservationSectionProps) {
  const app = useSlice('app');
  const macos = !titleOnly && app?.os !== 'windows';
  const enabled = figma.preferences.enabled;
  return (
    <StatusTiles
      label="Figma status"
      tiles={[
        {
          id: 'observation',
          icon: FigmaSourceIcon,
          tone: enabled ? (figma.currentFile ? 'success' : 'neutral') : 'neutral',
          title: enabled ? (figma.currentFile ? 'Observing Figma' : 'Waiting for Figma Desktop') : 'Observation is off',
          detail: enabled ? observationText(figma) : 'Turn it on below',
        },
        {
          id: 'access',
          icon: figma.access ? CheckIcon : WarningIcon,
          tone: figma.access ? 'success' : 'warning',
          title: macos ? (figma.access ? 'Accessibility allowed' : 'Accessibility needed') : figma.access ? 'Window access allowed' : 'Window access needed',
          detail: 'Needed to read window titles',
        },
      ]}
    />
  );
}
