import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SettingsFormContext, type SettingsFormValue } from '../../features/settings/SettingsForm';
import {
  parseSettingsHash,
  sectionAnchorId,
  SETTINGS_SECTIONS,
  viewOf,
  type SettingsSectionId,
} from '../../features/settings/sections';
import { withAccountDefaults } from '../../features/settings/accountDefaults';
import { useSettingsDraft } from '../../features/settings/useSettingsDraft';
import type { SettingsSlice } from '../../ipc/contract';
import { type Navigation } from '../../layout/NavigationContext';
import { PLACES, type SettingsView } from '../../layout/navigation';
import { useCommand, useCommands, useSaveShortcut } from '../../shortcuts/hooks';
import { useSlice } from '../../state/hooks';
import { useReducedMotion } from '../../theme/ThemeProvider';
import { ResetIcon } from '../../components/icons';

/** Whether a section is shown on this system and with these views. */
export function useSectionVisible(): (section: SettingsSectionId, isViewShown: (view: SettingsView) => boolean) => boolean {
  const app = useSlice('app');
  const calendar = app?.features.calendar ?? true;
  return useCallback(
    (section, isViewShown) => {
      const definition = SETTINGS_SECTIONS.find((entry) => entry.id === section);
      if (!definition) return false;
      if (definition.needsCalendar && !calendar) return false;
      return isViewShown(definition.view);
    },
    [calendar],
  );
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

function clearHash() {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
}

export interface SettingsFormProviderProps {
  settings: SettingsSlice;
  view: SettingsView;
  navigation: Navigation;
  children: ReactNode;
}

/**
 * One Settings draft for every view (switching views keeps unsaved edits), ⌘S / Ctrl+S, Revert,
 * a palette entry per card, `#settings/<section>` links and `goTo`, which shows a card's view
 * and moves focus to the card.
 */
export function SettingsFormProvider({ settings, view, navigation, children }: SettingsFormProviderProps) {
  const app = useSlice('app');
  const draft = useSettingsDraft(settings.configuration, withAccountDefaults);
  const reducedMotion = useReducedMotion();
  const sectionVisible = useSectionVisible();
  const os = app?.os === 'windows' ? 'windows' : 'macos';
  const { navigate, isPageVisible } = navigation;

  const isViewShown = useCallback(
    (candidate: SettingsView) => {
      const definition = PLACES.settings.views.find((entry) => entry.id === candidate);
      return !definition?.requires || isPageVisible(definition.requires);
    },
    [isPageVisible],
  );

  // The card a link, the palette or the issue summary asked for; focused after its view renders.
  const target = useRef<SettingsSectionId | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const goTo = useCallback(
    (section: SettingsSectionId) => {
      target.current = section;
      navigate({ place: 'settings', view: viewOf(section) });
      setScrollRequest((count) => count + 1);
    },
    [navigate],
  );

  // `#settings/<section|view>` (`openSettingsSection`): followed once, then cleared so returning
  // to Settings later does not jump back.
  useLayoutEffect(() => {
    const follow = () => {
      const location = parseSettingsHash(currentHash());
      if (!location) return;
      clearHash();
      if (location.section) goTo(location.section);
      else navigate({ place: 'settings', view: location.view });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [goTo, navigate]);

  useEffect(() => {
    const section = target.current;
    if (!section || viewOf(section) !== view) return;
    target.current = null;
    const element = document.getElementById(sectionAnchorId(section));
    if (!element) return;
    element.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    element.focus({ preventScroll: true });
  }, [view, scrollRequest, reducedMotion]);

  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const value: SettingsFormValue = { ...draft, settings, app, os, busy, preview, goTo };

  useSaveShortcut(() => void draft.save(), { isDisabled: busy || preview || draft.saving, label: 'Save settings' });
  useCommand({
    id: 'settings.revert',
    icon: ResetIcon,
    label: 'Revert settings changes',
    group: 'Actions',
    isDisabled: !draft.dirty,
    onAction: draft.revert,
  });
  const sectionCommands = useMemo(
    () =>
      SETTINGS_SECTIONS.filter((section) => sectionVisible(section.id, isViewShown)).map((section) => ({
        id: `settings.section.${section.id}`,
        label: `Settings: ${section.title}`,
        group: 'Pages' as const,
        // The Settings place's colour (AppShell's `PLACE_SWATCHES`).
        swatch: 'var(--chart-4)',
        keywords: ['settings', 'preferences'],
        onAction: () => goTo(section.id),
      })),
    [sectionVisible, isViewShown, goTo],
  );
  useCommands(sectionCommands);

  return <SettingsFormContext.Provider value={value}>{children}</SettingsFormContext.Provider>;
}
