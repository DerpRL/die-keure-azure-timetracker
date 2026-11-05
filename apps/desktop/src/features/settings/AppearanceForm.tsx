import { useId } from 'react';
import { StatusDot } from '../../components/Badge';
import { SegmentedControl } from '../../components/Segmented';
import type { InterfacePreferences } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import {
  CONTRAST_LABELS,
  CONTRAST_PREFERENCES,
  resolveAppearance,
  SCALE_PREFERENCES,
  scaleLabel,
  THEME_LABELS,
  THEME_PREFERENCES,
  type ThemePreference,
} from '../../theme/preferences';
import { useSystemAppearance, useTheme } from '../../theme/ThemeProvider';
import { useImmediateValue } from './FigmaSettings';
import { osWords } from './labels';
import { Hint } from './SettingsSection';
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
  const captionId = useId();
  return (
    <figure className={styles.preview} data-theme={resolved.theme} data-contrast={resolved.contrast} aria-labelledby={captionId}>
      <figcaption id={captionId} className={styles.previewCaption}>
        Appearance preview
      </figcaption>
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
  /** Shows a sample card in the chosen theme under the controls (onboarding). */
  showPreview?: boolean;
}

/**
 * The theme as three cards with a swatch (the onboarding's first step): native radios, so
 * arrow keys move between them and screen readers hear "Dark, radio button, 3 of 3".
 */
function ThemeChoice({ value, onChange }: { value: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  const name = useId();
  return (
    <fieldset className={styles.themeChoices}>
      <legend className={styles.themeLegend}>Theme</legend>
      {THEME_PREFERENCES.map((theme) => (
        <label key={theme} className={styles.themeCard}>
          <input
            type="radio"
            name={name}
            value={theme}
            checked={value === theme}
            onChange={() => onChange(theme)}
            className={styles.themeInput}
          />
          <span aria-hidden="true" className={styles.themeSwatch}>
            {theme !== 'dark' ? <span className={styles.swatchLight} /> : null}
            {theme !== 'light' ? <span className={styles.swatchDark} /> : null}
          </span>
          <span>{THEME_LABELS[theme]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Theme, text and control size, and contrast, with their explanations. */
export function AppearanceForm({ preferences, onChange, os, showPreview = false }: AppearanceFormProps) {
  const words = osWords(os);
  return (
    <>
      <div className={styles.appearanceGroup}>
        <ThemeChoice value={preferences.theme} onChange={(theme) => onChange({ ...preferences, theme })} />
        <Hint>{`System follows your ${words.device}’s Light, Dark or automatic appearance.`}</Hint>
      </div>
      <div className={styles.segmentPair}>
        <div className={styles.appearanceGroup}>
          <SegmentedControl
            label="Text and control size"
            options={SCALE_PREFERENCES.map((scale) => ({ id: String(scale), label: scaleLabel(scale) }))}
            selectedKey={String(preferences.scale)}
            onSelectionChange={(value) => onChange({ ...preferences, scale: Number(value) as InterfacePreferences['scale'] })}
          />
          <Hint>
            Text, buttons and charts resize together; views reflow to keep every control within reach.
            {os === 'macos' ? ' The menu-bar clock stays its normal size.' : ''}
          </Hint>
        </div>
        <div className={styles.appearanceGroup}>
          <SegmentedControl
            label="Contrast"
            options={CONTRAST_PREFERENCES.map((id) => ({ id, label: CONTRAST_LABELS[id] }))}
            selectedKey={preferences.contrast}
            onSelectionChange={(contrast) => onChange({ ...preferences, contrast })}
          />
          <Hint>
            {os === 'windows'
              ? 'Increased strengthens text, accents and borders. System follows the contrast setting in Windows Accessibility settings.'
              : 'Increased strengthens text, accents and borders. System follows Increase contrast in macOS Accessibility settings.'}
          </Hint>
        </div>
      </div>
      {showPreview ? <AppearancePreview preferences={preferences} /> : null}
    </>
  );
}
