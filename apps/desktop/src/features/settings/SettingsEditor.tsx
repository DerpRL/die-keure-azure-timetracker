import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { Key } from 'react-aria-components';
import { Badge } from '../../components/Badge';
import { ErrorIcon } from '../../components/icons';
import { Tab, TabList, TabPanel, TabsRoot } from '../../components/Segmented';
import type { SettingsSlice } from '../../ipc/contract';
import { useCommand, useCommands, useSaveShortcut } from '../../shortcuts/hooks';
import { useSlice } from '../../state/hooks';
import { useReducedMotion } from '../../theme/ThemeProvider';
import { AboutSection, AdvancedSection, AppearanceSection, FigmaSection, UpdatesSection, WindowSection } from './AppSections';
import { AwarenessSection } from './AwarenessSection';
import { ConnectionSection } from './ConnectionSection';
import { DayReviewSection } from './DayReviewSection';
import { FeaturesSection } from './FeaturesSection';
import { CalendarSection, MeetingSuggestionsSection, MicrophoneSection } from './MeetingsSections';
import { NotificationsSection } from './NotificationsSection';
import { SaveBar } from './SaveBar';
import {
  categoryOf,
  DEFAULT_CATEGORY,
  parseSettingsHash,
  sectionAnchorId,
  SETTINGS_CATEGORIES,
  settingsHash,
  type SettingsCategoryId,
  type SettingsSectionId,
} from './sections';
import { SettingsFormContext, type SettingsFormValue } from './SettingsForm';
import { TargetsSection } from './TargetsSection';
import { TrackingSection } from './TrackingSection';
import { useSettingsDraft } from './useSettingsDraft';
import styles from './settings.module.css';

const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  connection: ConnectionSection,
  tracking: TrackingSection,
  awareness: AwarenessSection,
  targets: TargetsSection,
  figma: FigmaSection,
  calendar: CalendarSection,
  meetings: MeetingSuggestionsSection,
  microphone: MicrophoneSection,
  dayReview: DayReviewSection,
  notifications: NotificationsSection,
  features: FeaturesSection,
  appearance: AppearanceSection,
  window: WindowSection,
  updates: UpdatesSection,
  about: AboutSection,
  advanced: AdvancedSection,
};

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

/** The Settings form: category list, the selected category's sections and the save bar. */
export function SettingsEditor({ settings }: { settings: SettingsSlice }) {
  const app = useSlice('app');
  const draft = useSettingsDraft(settings.configuration);
  const reducedMotion = useReducedMotion();
  const os = app?.os === 'windows' ? 'windows' : 'macos';
  const calendar = app?.features.calendar ?? true;

  const categories = useMemo(
    () =>
      SETTINGS_CATEGORIES.map((category) => ({
        ...category,
        sections: category.sections.filter((section) => !section.needsCalendar || calendar),
      })).filter((category) => category.sections.length > 0),
    [calendar],
  );

  const initial = useMemo(() => parseSettingsHash(currentHash()), []);
  const [category, setCategory] = useState<SettingsCategoryId>(initial?.category ?? DEFAULT_CATEGORY);
  // The section a link, the palette or the issue summary asked for; scrolled to after render.
  const target = useRef<SettingsSectionId | null>(initial?.section ?? null);
  const [scrollRequest, setScrollRequest] = useState(0);

  const goTo = useCallback((section: SettingsSectionId) => {
    target.current = section;
    setCategory(categoryOf(section));
    setScrollRequest((count) => count + 1);
  }, []);

  // `#settings/<section>` links while the page is open (`openSettingsSection`).
  useEffect(() => {
    const onHash = () => {
      const location = parseSettingsHash(currentHash());
      if (!location) return;
      if (location.section) goTo(location.section);
      else setCategory(location.category);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [goTo]);

  // Keep the address in step, so the selected category survives leaving and reopening the page.
  useEffect(() => {
    const hash = settingsHash(category);
    const current = parseSettingsHash(currentHash());
    if (current?.category !== category) window.history.replaceState(window.history.state, '', hash);
  }, [category]);

  useEffect(() => {
    const section = target.current;
    if (!section) return;
    target.current = null;
    const element = document.getElementById(sectionAnchorId(section));
    if (!element) return;
    element.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    element.focus({ preventScroll: true });
  }, [category, scrollRequest, reducedMotion]);

  // A category hidden on this OS (Meetings on Windows has only the microphone left; none vanish).
  const selected = categories.some((entry) => entry.id === category) ? category : DEFAULT_CATEGORY;

  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const value: SettingsFormValue = { ...draft, settings, app, os, busy, preview, goTo };

  useSaveShortcut(() => void draft.save(), { isDisabled: busy || preview || draft.saving, label: 'Save settings' });
  useCommand({
    id: 'settings.revert',
    label: 'Revert settings changes',
    group: 'Actions',
    isDisabled: !draft.dirty,
    onAction: draft.revert,
  });
  useCommands(
    categories.flatMap((entry) =>
      entry.sections.map((section) => ({
        id: `settings.section.${section.id}`,
        label: `Settings: ${section.title}`,
        group: 'Pages' as const,
        keywords: ['settings', 'preferences', entry.title.toLowerCase()],
        onAction: () => goTo(section.id),
      })),
    ),
  );

  const issueCount = (id: SettingsCategoryId) =>
    draft.issues.filter((issue) => categories.find((entry) => entry.id === id)?.sections.some((section) => section.id === issue.section)).length;

  return (
    <SettingsFormContext.Provider value={value}>
      <TabsRoot
        orientation="vertical"
        selectedKey={selected}
        onSelectionChange={(key: Key) => setCategory(key as SettingsCategoryId)}
        className={styles.layout}
      >
        <TabList aria-label="Settings categories" className={styles.categoryList}>
          {categories.map((entry) => {
            const count = issueCount(entry.id);
            return (
              <Tab
                key={entry.id}
                id={entry.id}
                className={styles.category}
                // "Tracking, 1 problem": the visible label stays first (WCAG 2.5.3).
                aria-label={count > 0 ? `${entry.title}, ${count} ${count === 1 ? 'problem' : 'problems'}` : undefined}
              >
                <span>{entry.title}</span>
                {count > 0 ? (
                  <Badge tone="danger" icon={ErrorIcon} className={styles.categoryBadge}>
                    {count}
                  </Badge>
                ) : null}
              </Tab>
            );
          })}
        </TabList>
        <div className={styles.content}>
          {categories.map((entry) => (
            <TabPanel key={entry.id} id={entry.id} className={styles.panel}>
              {entry.sections.map((section) => {
                const Section = SECTION_COMPONENTS[section.id];
                return <Section key={section.id} />;
              })}
            </TabPanel>
          ))}
          <SaveBar />
        </div>
      </TabsRoot>
    </SettingsFormContext.Provider>
  );
}
