import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Section } from '../../components/Card';
import { NumberField } from '../../components/Fields';
import { Switch } from '../../components/Toggles';
import type { FigmaPreferences, FigmaSlice } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import { AccessIcon, LockedIcon } from './icons';
import { observationText } from './model';
import styles from './figma.module.css';

export interface ObservationSectionProps {
  figma: FigmaSlice;
  watching: boolean;
  /** Window titles only (Windows, experimental). */
  titleOnly: boolean;
}

/**
 * "Figma Desktop" (1.14 `FigmaSettingsView` on the Figma page): observation on or off, the
 * Accessibility permission, the current observation and the suggestion and history settings.
 * Changes save immediately (`figma.setPreferences`).
 */
export function ObservationSection({ figma, watching, titleOnly }: ObservationSectionProps) {
  const app = useSlice('app');
  const save = useAction();
  const access = useAction();
  const preferences = figma.preferences;
  const macos = !titleOnly && app?.os !== 'windows';
  const needsAccess = preferences.enabled && !figma.access;

  const update = (patch: Partial<FigmaPreferences>) => {
    const next = { ...preferences, ...patch };
    if (next.enabled === preferences.enabled && next.dismissalMinutes === preferences.dismissalMinutes && next.historyDays === preferences.historyDays) {
      return;
    }
    void save.run({ type: 'figma.setPreferences', preferences: next });
  };

  return (
    <Section
      title="Figma Desktop"
      subtitle="Suggest Design tracking when you switch files. Always confirm before a timer changes."
    >
      <Switch
        isSelected={preferences.enabled}
        isDisabled={save.pending}
        onChange={(enabled) => update({ enabled })}
        description={
          macos
            ? 'Reads only file URLs and window titles on this Mac. No design content, Figma account, token or plugin. Browser tabs are not observed.'
            : 'Reads only window titles on this PC. No design content, Figma account, token or plugin. Browser tabs are not observed.'
        }
      >
        Observe Figma files
      </Switch>
      {titleOnly ? (
        <Banner tone="info" title="Title-only detection (experimental)" live="off">
          Figma files are recognised by their window title. Files with the same title share one entry and one ticket
          link, and they cannot be opened from here.
        </Banner>
      ) : null}
      {preferences.enabled ? (
        <p className={styles.status}>
          {figma.access ? <AccessIcon /> : <LockedIcon />}
          <span>
            <span className="visually-hidden">Observation: </span>
            {observationText(figma, watching)}
          </span>
        </p>
      ) : null}
      {preferences.enabled && !figma.installed ? (
        <p className={styles.text}>Figma Desktop was not found on this computer. Files can still be opened in the browser.</p>
      ) : null}
      {needsAccess ? (
        <div className={styles.access}>
          <Button onPress={() => void access.run({ type: 'figma.requestAccess' })} isPending={access.pending}>
            {macos ? 'Allow Accessibility…' : 'Allow access…'}
          </Button>
          <p className={styles.text}>
            {macos
              ? 'Enable Azure timetracker in System Settings → Privacy & Security → Accessibility, then return here.'
              : 'Allow Azure timetracker to read window titles, then return here.'}
          </p>
          {access.error ? (
            <p role="alert" className={styles.error}>
              {access.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className={styles.fields}>
        <NumberField
          label="Keep tracking: suppress for"
          minValue={0}
          maxValue={120}
          value={preferences.dismissalMinutes}
          formatOptions={{ style: 'unit', unit: 'minute', unitDisplay: 'long' }}
          isDisabled={save.pending}
          onChange={(value) => {
            if (Number.isFinite(value)) update({ dismissalMinutes: Math.round(value) });
          }}
        />
        <NumberField
          label="Keep context history for"
          minValue={1}
          maxValue={365}
          value={preferences.historyDays}
          formatOptions={{ style: 'unit', unit: 'day', unitDisplay: 'long' }}
          isDisabled={save.pending}
          onChange={(value) => {
            if (Number.isFinite(value)) update({ historyDays: Math.round(value) });
          }}
        />
      </div>
      <p className={styles.text}>
        Zero suppression allows a new suggestion at the next activation. Pause watching in the sidebar pauses both Git
        and Figma observations. Changes here save immediately.
      </p>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {save.error.message}
        </p>
      ) : null}
    </Section>
  );
}
