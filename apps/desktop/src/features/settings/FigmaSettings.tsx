import { useState } from 'react';
import { Button } from '../../components/Button';
import { NumberField } from '../../components/Fields';
import { InfoIcon, SuccessIcon } from '../../components/icons';
import { Switch } from '../../components/Toggles';
import type { FigmaPreferences } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import { deepEqual } from './configDraft';
import { figmaStatusText } from './labels';
import { Hint, InlineIssue } from './SettingsSection';
import { FIGMA_DISMISSAL_MINUTES, FIGMA_HISTORY_DAYS } from './validation';
import styles from './settings.module.css';

/**
 * A setting that applies immediately through its own intent: shows the user's choice at once
 * and follows the slice again as soon as a new value arrives (or the intent fails).
 */
export function useImmediateValue<T>(stored: T): [T, (next: T) => void, () => void] {
  const [state, setState] = useState<{ stored: T; local: T | null }>({ stored, local: null });
  let current = state;
  if (!deepEqual(stored, state.stored)) {
    current = { stored, local: null };
    setState(current);
  }
  const value = current.local ?? stored;
  const set = (next: T) => setState((previous) => ({ ...previous, local: next }));
  const reset = () => setState((previous) => ({ ...previous, local: null }));
  return [value, set, reset];
}

/** `FigmaPreferences::default()`, until the settings slice arrives. */
const FALLBACK: FigmaPreferences = { enabled: false, dismissalMinutes: 15, historyDays: 30 };

/** The Figma preferences with `figma.setPreferences` (immediate, outside the Settings draft). */
export function useFigmaPreferences() {
  const settings = useSlice('settings');
  const figma = useSlice('figma');
  const action = useAction();
  const stored = settings?.configuration.figma ?? figma?.preferences ?? FALLBACK;
  const [preferences, setLocal, reset] = useImmediateValue(stored);
  const apply = (next: FigmaPreferences) => {
    setLocal(next);
    void action.run({ type: 'figma.setPreferences', preferences: next }).then((result) => {
      if (!result.ok) reset();
    });
  };
  return { preferences, apply, error: action.error };
}

/**
 * 1.14 `FigmaSettingsView`. Applies immediately through `figma.setPreferences`; Save never
 * overwrites these values. `onboarding` hides the suppression and history settings.
 */
export function FigmaSettings({ onboarding = false }: { onboarding?: boolean }) {
  const figma = useSlice('figma');
  const app = useSlice('app');
  const access = useAction();
  const { preferences, apply, error } = useFigmaPreferences();
  const titleOnly = figma?.titleOnly ?? app?.features.figmaTitleOnly ?? false;
  const macos = (app?.os ?? 'macos') === 'macos';
  const hasAccess = figma?.access ?? false;
  return (
    <>
      <Switch isSelected={preferences.enabled} onChange={(enabled) => apply({ ...preferences, enabled })}>
        Observe Figma files
      </Switch>
      <Hint>
        {titleOnly
          ? 'Reads only Figma window titles on this PC. No design content, Figma account, token or plugin. Browser tabs are not observed. Window-title detection is experimental.'
          : 'Reads only file URLs and window titles on this Mac. No design content, Figma account, token or plugin. Browser tabs are not observed.'}
      </Hint>
      {preferences.enabled && figma ? (
        <p className={styles.status}>
          {hasAccess || !macos ? <SuccessIcon className={styles.statusIcon} /> : <InfoIcon className={styles.statusIcon} />}
          <span>{figmaStatusText(figma.status, figma.currentFile)}</span>
        </p>
      ) : null}
      {preferences.enabled && macos && !hasAccess ? (
        <>
          <div className={styles.row}>
            <Button onPress={() => void access.run({ type: 'figma.requestAccess' })} isPending={access.pending}>
              Allow Accessibility…
            </Button>
          </div>
          <Hint>
            Enable Azure timetracker in System Settings → Privacy & Security → Accessibility, then return here. The status updates
            automatically.
          </Hint>
        </>
      ) : null}
      {!onboarding ? (
        <>
          <div className={styles.fieldRow}>
            <NumberField
              label="Keep tracking: suppress suggestions for"
              unit="minutes"
              minValue={FIGMA_DISMISSAL_MINUTES.min}
              maxValue={FIGMA_DISMISSAL_MINUTES.max}
              value={preferences.dismissalMinutes}
              onChange={(dismissalMinutes) => {
                if (Number.isInteger(dismissalMinutes) && dismissalMinutes !== preferences.dismissalMinutes) {
                  apply({ ...preferences, dismissalMinutes });
                }
              }}
              formatOptions={{ maximumFractionDigits: 0 }}
            />
            <NumberField
              label="Keep context history for"
              unit="days"
              minValue={FIGMA_HISTORY_DAYS.min}
              maxValue={FIGMA_HISTORY_DAYS.max}
              value={preferences.historyDays}
              onChange={(historyDays) => {
                if (Number.isInteger(historyDays) && historyDays !== preferences.historyDays) apply({ ...preferences, historyDays });
              }}
              formatOptions={{ maximumFractionDigits: 0 }}
            />
          </div>
          <Hint>
            Zero suppression allows a new suggestion at the next activation. Pause watching in the sidebar pauses both Git and Figma
            observations. Changes here save immediately.
          </Hint>
        </>
      ) : null}
      {error ? <InlineIssue>{error.message}</InlineIssue> : null}
      {access.error ? <InlineIssue>{access.error.message}</InlineIssue> : null}
    </>
  );
}
