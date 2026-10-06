import { SegmentedControl } from '../components/Segmented';
import {
  CONTRAST_LABELS,
  CONTRAST_PREFERENCES,
  SCALE_PREFERENCES,
  scaleLabel,
  THEME_LABELS,
  THEME_PREFERENCES,
  type InterfacePreferences,
} from './preferences';
import { useTheme } from './ThemeProvider';
import styles from './AppearanceControls.module.css';

export interface AppearanceControlsProps {
  /** Defaults to the theme context, so the controls apply immediately (as in 1.14). */
  preferences?: InterfacePreferences;
  onChange?: (next: InterfacePreferences) => void;
  layout?: 'stacked' | 'inline';
  size?: 'small' | 'medium';
}

/** The three segmented pickers from Settings → Appearance: appearance, UI scale and contrast. */
export function AppearanceControls({ preferences: given, onChange, layout = 'stacked', size = 'medium' }: AppearanceControlsProps) {
  const theme = useTheme();
  const preferences = given ?? theme.preferences;
  const update = (next: InterfacePreferences) => (onChange ?? theme.setPreferences)(next);
  return (
    <div className={layout === 'inline' ? styles.inline : styles.stacked}>
      <SegmentedControl
        label="Appearance"
        size={size}
        selectedKey={preferences.theme}
        onSelectionChange={(value) => update({ ...preferences, theme: value })}
        options={THEME_PREFERENCES.map((id) => ({ id, label: THEME_LABELS[id] }))}
      />
      <SegmentedControl
        label="UI scale"
        size={size}
        selectedKey={String(preferences.scale)}
        onSelectionChange={(value) => update({ ...preferences, scale: Number(value) as InterfacePreferences['scale'] })}
        options={SCALE_PREFERENCES.map((scale) => ({ id: String(scale), label: scaleLabel(scale) }))}
      />
      <SegmentedControl
        label="UI contrast"
        size={size}
        selectedKey={preferences.contrast}
        onSelectionChange={(value) => update({ ...preferences, contrast: value })}
        options={CONTRAST_PREFERENCES.map((id) => ({ id, label: CONTRAST_LABELS[id] }))}
      />
    </div>
  );
}
