import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { applyAppearance, readSystemAppearance, subscribeSystemAppearance } from './appearance';
import {
  DEFAULT_INTERFACE_PREFERENCES,
  resolveAppearance,
  type InterfacePreferences,
  type ResolvedAppearance,
  type SystemAppearance,
} from './preferences';

export interface ThemeContextValue {
  preferences: InterfacePreferences;
  setPreferences: (next: InterfacePreferences) => void;
  resolved: ResolvedAppearance;
  system: SystemAppearance;
  /** Forced reduced motion (true/false) or undefined to follow the OS. */
  reducedMotionOverride: boolean | undefined;
  setReducedMotionOverride: (value: boolean | undefined) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Controlled preferences. Omit to let the provider own them (see `defaultPreferences`). */
  preferences?: InterfacePreferences;
  defaultPreferences?: InterfacePreferences;
  onPreferencesChange?: (next: InterfacePreferences) => void;
  /** Initial reduced-motion override (true/false); omit to follow the OS. The gallery changes it. */
  reducedMotion?: boolean;
  /**
   * Element that receives `data-theme`, `data-contrast` and `--ui-scale`. Defaults to <html>.
   * Pass `null` to provide context only.
   */
  target?: HTMLElement | null;
  children: ReactNode;
}

export function useSystemAppearance(): SystemAppearance {
  return useSyncExternalStore(subscribeSystemAppearance, readSystemAppearance, readSystemAppearance);
}

export function ThemeProvider({
  preferences: controlled,
  defaultPreferences = DEFAULT_INTERFACE_PREFERENCES,
  onPreferencesChange,
  reducedMotion,
  target,
  children,
}: ThemeProviderProps) {
  const [uncontrolled, setUncontrolled] = useState<InterfacePreferences>(defaultPreferences);
  const [reducedMotionOverride, setReducedMotionOverride] = useState<boolean | undefined>(reducedMotion);
  const preferences = controlled ?? uncontrolled;
  const system = useSystemAppearance();
  const resolved = useMemo(
    () => resolveAppearance(preferences, system, reducedMotionOverride),
    [preferences, system, reducedMotionOverride],
  );

  const setPreferences = useCallback(
    (next: InterfacePreferences) => {
      if (controlled === undefined) setUncontrolled(next);
      onPreferencesChange?.(next);
    },
    [controlled, onPreferencesChange],
  );

  useLayoutEffect(() => {
    if (target === null) return;
    applyAppearance(resolved, target ?? document.documentElement);
  }, [resolved, target]);

  const value = useMemo(
    () => ({ preferences, setPreferences, resolved, system, reducedMotionOverride, setReducedMotionOverride }),
    [preferences, setPreferences, resolved, system, reducedMotionOverride],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

/**
 * True when motion should be avoided: the OS asks for it or the app forces it. Works without a
 * provider by reading the media query directly.
 */
export function useReducedMotion(): boolean {
  const context = useContext(ThemeContext);
  const system = useSystemAppearance();
  return context ? context.resolved.reducedMotion : system.reducedMotion;
}
