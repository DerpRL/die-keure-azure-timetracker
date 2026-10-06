import { useEffect } from 'react';
import { useSlice } from '../../state/hooks';
import { preferencesEqual } from '../../theme/preferences';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Applies the saved appearance (`interface` slice) to this window's theme, so every window
 * follows a change made in Settings or onboarding. Renders nothing.
 */
export function InterfaceSync() {
  const saved = useSlice('interface');
  const { preferences, setPreferences } = useTheme();
  useEffect(() => {
    if (saved && !preferencesEqual(saved, preferences)) setPreferences(saved);
  }, [saved, preferences, setPreferences]);
  return null;
}
