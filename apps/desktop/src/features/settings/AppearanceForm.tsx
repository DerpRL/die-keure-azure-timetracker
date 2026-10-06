import { Button } from '../../components/Button';
import { StatusDot } from '../../components/Badge';
import { InfoIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import type { InterfacePreferences } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import {
  CONTRAST_LABELS,
  CONTRAST_PREFERENCES,
  DEFAULT_INTERFACE_PREFERENCES,
  preferencesEqual,
  resolveAppearance,
  SCALE_PREFERENCES,
  scaleLabel,
  THEME_LABELS,
  THEME_PREFERENCES,
} from '../../theme/preferences';
import { useSystemAppearance, useTheme } from '../../theme/ThemeProvider';
import { useImmediateValue } from './FigmaSettings';
import { osWords } from './labels';
import { Hint, InlineIssue } from './SettingsSection';
import styles from './settings.module.css';

/**
 * The saved appearance with `app.setInterface` (immediate, outside the Settings draft). The
 * window's theme follows the `interface` slice (`InterfaceSync`); the preview follows the choice
 * at once.
 */
export function useInterfacePreferences() {
  const saved = useSlice('interface');
  const theme = useTheme();
  const action = useAction();
  const [preferences, setLocal, reset] = useImmediateValue<InterfacePreferences>(saved ?? theme.preferences);
  const apply = (next: InterfacePreferences) => {
    setLocal(next);
    void action.run({ type: 'app.setInterface', preferences: next }).then((result) => {
      if (!result.ok) reset();
    });
  };
  return { preferences, apply, error: action.error };
}

/** A sample of the app in the chosen theme and contrast (1.14 "Example: tracking is active"). */
export function AppearancePreview({ preferences }: { preferences: InterfacePreferences }) {
  const system = useSystemAppearance();
  const resolved = resolveAppearance(preferences, system);
  return (
    <figure className={styles.preview} data-theme={resolved.theme} data-contrast={resolved.contrast}>
      <figcaption className={styles.previewCaption}>Appearance preview</figcaption>
      <div className={styles.previewCard}>
        <span className={styles.previewPrimary}>
          <StatusDot tone="running" label="Running" />
          Example: tracking is active
        </span>
        <span className={styles.previewSecondary}>Secondary text</span>
        <span className={styles.previewButton} aria-hidden="true">
          Start
        </span>
      </div>
    </figure>
  );
}

export interface AppearanceFormProps {
  preferences: InterfacePreferences;
  onChange: (next: InterfacePreferences) => void;
  os: 'macos' | 'windows';
}

/** 1.14 `AppearancePreferencesView`: appearance, UI scale and contrast with their explanations. */
export function AppearanceForm({ preferences, onChange, os }: AppearanceFormProps) {
  const words = osWords(os);
  return (
    <>
      <div className={styles.appearanceGroup}>
        <SegmentedControl
          label="Appearance"
          options={THEME_PREFERENCES.map((id) => ({ id, label: THEME_LABELS[id] }))}
          selectedKey={preferences.theme}
          onSelectionChange={(theme) => onChange({ ...preferences, theme })}
        />
        <Hint>{`System follows your ${words.device}’s Light, Dark or automatic appearance.`}</Hint>
      </div>
      <div className={styles.appearanceGroup}>
        <SegmentedControl
          label="UI scale"
          options={SCALE_PREFERENCES.map((scale) => ({ id: String(scale), label: scaleLabel(scale) }))}
          selectedKey={String(preferences.scale)}
          onSelectionChange={(value) => onChange({ ...preferences, scale: Number(value) as InterfacePreferences['scale'] })}
        />
        <Hint>
          Resize text, buttons and charts together. Pages reflow to keep every control within reach.
          {os === 'macos' ? ' The menu-bar clock stays its normal size.' : ''}
        </Hint>
      </div>
      <div className={styles.appearanceGroup}>
        <SegmentedControl
          label="UI contrast"
          options={CONTRAST_PREFERENCES.map((id) => ({ id, label: CONTRAST_LABELS[id] }))}
          selectedKey={preferences.contrast}
          onSelectionChange={(contrast) => onChange({ ...preferences, contrast })}
        />
        <Hint>
          {os === 'windows'
            ? 'Increased strengthens text, accents and section borders. System follows the contrast setting in Windows Accessibility settings.'
            : 'Increased strengthens text, accents and section borders. System follows Increase contrast in macOS Accessibility settings.'}
        </Hint>
      </div>
      <AppearancePreview preferences={preferences} />
    </>
  );
}

/** Settings → Appearance: applies immediately, never through Save. */
export function AppearanceSettings({ os }: { os: 'macos' | 'windows' }) {
  const { preferences, apply, error } = useInterfacePreferences();
  const words = osWords(os);
  return (
    <>
      <p className={styles.status}>
        <InfoIcon className={styles.statusIcon} />
        <span>{`Changes apply immediately and are saved on this ${words.device}.`}</span>
      </p>
      <AppearanceForm preferences={preferences} onChange={apply} os={os} />
      {error ? <InlineIssue>{error.message}</InlineIssue> : null}
      <div className={styles.row}>
        <Button
          onPress={() => apply({ ...DEFAULT_INTERFACE_PREFERENCES })}
          isDisabled={preferencesEqual(preferences, DEFAULT_INTERFACE_PREFERENCES)}
        >
          Reset appearance defaults
        </Button>
      </div>
    </>
  );
}
