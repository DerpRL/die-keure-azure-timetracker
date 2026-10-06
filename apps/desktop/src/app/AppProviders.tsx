import type { ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { ToastProvider } from '../components/Toast';
import { ShortcutProvider } from '../shortcuts/ShortcutProvider';
import type { ShortcutInfo } from '../shortcuts/ShortcutCheatSheet';
import { DEFAULT_SHORTCUT_INFO } from '../shortcuts/ShortcutProvider';
import { ThemeProvider, type ThemeProviderProps } from '../theme/ThemeProvider';

export interface AppProvidersProps {
  children: ReactNode;
  theme?: Omit<ThemeProviderProps, 'children'>;
  /**
   * English only (rewrite plan §15.6). en-GB gives the 24-hour clock, day-month order and Monday
   * as the first day of the week that 1.14 users in Belgium see.
   */
  locale?: string;
  shortcutInfo?: readonly ShortcutInfo[];
  /** ⌘/Ctrl+K palette and `?` cheat sheet; off for the mini timer. */
  builtInShortcuts?: boolean;
}

/** Everything a surface needs: theme, locale, toasts and the shortcut registry. */
export function AppProviders({
  children,
  theme,
  locale = 'en-GB',
  shortcutInfo = DEFAULT_SHORTCUT_INFO,
  builtInShortcuts = true,
}: AppProvidersProps) {
  return (
    <ThemeProvider {...theme}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <ShortcutProvider info={shortcutInfo} builtIns={builtInShortcuts}>
            {children}
          </ShortcutProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
