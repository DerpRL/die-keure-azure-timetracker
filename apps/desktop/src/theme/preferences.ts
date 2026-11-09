/**
 * Appearance preferences, mirroring Swift `InterfacePreferences` (1.14.2) and its JSON shape:
 * `{ "theme": "system" | "light" | "dark", "scale": 90 | 100 | 110 | 125 | 150,
 *    "contrast": "system" | "standard" | "increased", "language"?: "system" | "en" | "nl" }`.
 */
import { LANGUAGE_PREFERENCES, mark, type LanguagePreference } from '../i18n';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export const CONTRAST_PREFERENCES = ['system', 'standard', 'increased'] as const;
export const SCALE_PREFERENCES = [90, 100, 110, 125, 150] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ContrastPreference = (typeof CONTRAST_PREFERENCES)[number];
export type ScalePreference = (typeof SCALE_PREFERENCES)[number];

export interface InterfacePreferences {
  theme: ThemePreference;
  scale: ScalePreference;
  contrast: ContrastPreference;
  /** 2.6; missing means `system`. */
  language?: LanguagePreference;
}

export const DEFAULT_INTERFACE_PREFERENCES: Readonly<InterfacePreferences> = Object.freeze({
  theme: 'system',
  scale: 100,
  contrast: 'system',
});

/** English (`mark`): show with `t(THEME_LABELS[id])`. */
export const THEME_LABELS: Record<ThemePreference, string> = { system: mark('System'), light: mark('Light'), dark: mark('Dark') };
/** English (`mark`): show with `t(CONTRAST_LABELS[id])`. */
export const CONTRAST_LABELS: Record<ContrastPreference, string> = {
  system: mark('System'),
  standard: mark('Standard'),
  increased: mark('Increased'),
};
export function scaleLabel(scale: ScalePreference): string {
  return `${scale}%`;
}
export function scaleFactor(scale: ScalePreference): number {
  return scale / 100;
}

function oneOf<T extends string | number>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

/**
 * Tolerant decoding, like the Swift decoder: unsupported or missing values fall back to the
 * defaults instead of failing, so a future value never blocks loading the rest of the settings.
 */
export function parseInterfacePreferences(value: unknown): InterfacePreferences {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const language = oneOf<LanguagePreference>(LANGUAGE_PREFERENCES, record.language, 'system');
  return {
    theme: oneOf(THEME_PREFERENCES, record.theme, DEFAULT_INTERFACE_PREFERENCES.theme),
    scale: oneOf(SCALE_PREFERENCES, record.scale, DEFAULT_INTERFACE_PREFERENCES.scale),
    contrast: oneOf(CONTRAST_PREFERENCES, record.contrast, DEFAULT_INTERFACE_PREFERENCES.contrast),
    // Like the engine, `system` is left out.
    ...(language === 'system' ? {} : { language }),
  };
}

export function preferencesEqual(a: InterfacePreferences, b: InterfacePreferences): boolean {
  return a.theme === b.theme && a.scale === b.scale && a.contrast === b.contrast && (a.language ?? 'system') === (b.language ?? 'system');
}

/** What the operating system reports through media queries. */
export interface SystemAppearance {
  dark: boolean;
  increasedContrast: boolean;
  reducedMotion: boolean;
  forcedColors: boolean;
}

export const DEFAULT_SYSTEM_APPEARANCE: Readonly<SystemAppearance> = Object.freeze({
  dark: false,
  increasedContrast: false,
  reducedMotion: false,
  forcedColors: false,
});

/** The concrete appearance the UI renders with. */
export interface ResolvedAppearance {
  theme: 'light' | 'dark';
  contrast: 'standard' | 'increased';
  /** Root font-size factor, 0.9–1.5. */
  scale: number;
  reducedMotion: boolean;
  forcedColors: boolean;
}

export function isDark(preferences: InterfacePreferences, systemDark: boolean): boolean {
  return preferences.theme === 'dark' || (preferences.theme === 'system' && systemDark);
}

export function isIncreasedContrast(preferences: InterfacePreferences, systemIncreased: boolean): boolean {
  return preferences.contrast === 'increased' || (preferences.contrast === 'system' && systemIncreased);
}

export function resolveAppearance(
  preferences: InterfacePreferences,
  system: SystemAppearance,
  reducedMotionOverride?: boolean,
): ResolvedAppearance {
  return {
    theme: isDark(preferences, system.dark) ? 'dark' : 'light',
    contrast: isIncreasedContrast(preferences, system.increasedContrast) ? 'increased' : 'standard',
    scale: scaleFactor(preferences.scale),
    reducedMotion: reducedMotionOverride ?? system.reducedMotion,
    forcedColors: system.forcedColors,
  };
}
