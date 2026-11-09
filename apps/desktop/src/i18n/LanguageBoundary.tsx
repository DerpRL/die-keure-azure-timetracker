import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { useAction } from '../state/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { locale, noteLanguageRemount, resolveLanguage, setLanguage } from './index';

function subscribeLanguages(onChange: () => void): () => void {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

/** The system's first language as the web view reports it (`navigator.language`). */
export function useSystemLanguageTag(): string {
  return useSyncExternalStore(
    subscribeLanguages,
    () => navigator.language,
    () => 'en-GB',
  );
}

/**
 * Applies the interface language (the saved appearance's `language`, or the system's) to this
 * window: `t` translates to it, React Aria formats dates in its locale, and the children remount
 * when it changes so every label is built again. Tells the engine the system language, which
 * it uses for its own text (prompts, errors, notifications, the tray) while the preference is
 * `system`.
 */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const { preferences } = useTheme();
  const systemTag = useSystemLanguageTag();
  const language = resolveLanguage(preferences.language, systemTag);
  // Before the children render, so plain functions translate too.
  setLanguage(language);
  // React's "adjust state while rendering" pattern: noted once per change, before the remount.
  const [shown, setShown] = useState(language);
  if (shown !== language) {
    setShown(language);
    noteLanguageRemount();
  }

  useEffect(() => {
    document.documentElement.lang = locale(language);
  }, [language]);

  const { run } = useAction();
  useEffect(() => {
    void run({ type: 'app.setSystemLanguage', tag: systemTag });
  }, [run, systemTag]);

  return (
    <I18nProvider locale={locale(language)}>
      <Fragment key={language}>{children}</Fragment>
    </I18nProvider>
  );
}
