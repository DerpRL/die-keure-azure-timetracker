import { useEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ErrorIcon } from '../../components/icons';
import { useToast } from '../../components/Toast';
import { SaveBar, VIEW_TITLE_ID } from '../../features/settings/SaveBar';
import { SETTINGS_SECTIONS, VIEW_INTROS, type SettingsSectionDefinition, type SettingsSectionId } from '../../features/settings/sections';
import { useSettingsForm } from '../../features/settings/SettingsForm';
import { usePlaceView, type Navigation } from '../../layout/NavigationContext';
import type { SettingsView } from '../../layout/navigation';
import { useEngineStatus } from '../../state/EngineProvider';
import { useSlice } from '../../state/hooks';
import { WatchSwitch } from './git';
import { SettingsFormProvider, useVisibleSections } from './SettingsForm';
import { SettingsNav } from './SettingsNav';
import { TestConnectionsButton } from '../../features/settings/ConnectionSection';
import { AboutView } from './views/AboutView';
import { AccountsView } from './views/AccountsView';
import { AdvancedView } from './views/AdvancedView';
import { AppearanceView } from './views/AppearanceView';
import { CalendarsView } from './views/CalendarsView';
import { FeaturesView } from './views/FeaturesView';
import { FigmaView } from './views/FigmaView';
import { GitView } from './views/GitView';
import { MeetingsView } from './views/MeetingsView';
import { NotificationsView } from './views/NotificationsView';
import { RemindersView } from './views/RemindersView';
import { ScheduleView } from './views/ScheduleView';
import { SourcesView } from './views/SourcesView';
import styles from './settings.module.css';

const VIEWS: Record<SettingsView, ComponentType> = {
  accounts: AccountsView,
  schedule: ScheduleView,
  meetings: MeetingsView,
  reminders: RemindersView,
  notifications: NotificationsView,
  sources: SourcesView,
  git: GitView,
  figma: FigmaView,
  calendars: CalendarsView,
  appearance: AppearanceView,
  features: FeaturesView,
  advanced: AdvancedView,
  about: AboutView,
};

/** Controls next to a view's title (design: "Test both connections", the Git "Watching" switch). */
const VIEW_ACTIONS: Partial<Record<SettingsView, () => ReactNode>> = {
  accounts: () => <TestConnectionsButton />,
  git: () => <GitWatchHeader />,
};

/** "Checks every 2 s" and the watch switch, next to the Git repositories title. */
function GitWatchHeader() {
  const { draft } = useSettingsForm();
  return (
    <>
      <span className={styles.headerMeta}>{`Checks every ${draft.cadences.probeSeconds} s`}</span>
      <WatchSwitch label="Watch repositories" compact />
    </>
  );
}

function ViewIntro({ view }: { view: SettingsView }) {
  const intro = VIEW_INTROS[view];
  const actions = VIEW_ACTIONS[view]?.();
  return (
    <div className={styles.sectionHead}>
      <div className={styles.sectionHeadText}>
        <h2 id={VIEW_TITLE_ID} tabIndex={-1} className={styles.sectionTitle}>
          {intro.title}
        </h2>
        <p className={styles.sectionLead}>{intro.lead}</p>
      </div>
      {actions ? <div className={styles.sectionHeadActions}>{actions}</div> : null}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className={styles.loading}>
      <Skeleton shape="rect" height="2.5rem" width="12rem" />
      <Skeleton lines={4} />
      <Skeleton shape="rect" height="10rem" />
    </div>
  );
}

/** The menu (with problem counts) and the chosen view with the shared save bar. */
function SettingsContent({ view, navigation }: { view: SettingsView; navigation: Navigation }) {
  const form = useSettingsForm();
  const issueCounts = useMemo(() => {
    const counts: Partial<Record<SettingsView, number>> = {};
    for (const issue of form.issues) {
      const owner = SETTINGS_SECTIONS.find((section) => section.id === issue.section)?.view;
      if (owner) counts[owner] = (counts[owner] ?? 0) + 1;
    }
    return counts;
  }, [form.issues]);
  const sections = useVisibleSections(navigation.isPageVisible);
  const View = VIEWS[view];
  // The save bar asks to save only what is unsaved: an edit that differs from the saved settings
  // or a typed token. It stays while saving and when saving failed, and goes away once the
  // edits are saved or undone.
  const showSave = form.dirty || form.showIssues || form.saving || form.saveError !== null;
  useSavedToast(form.saved);
  return (
    <SettingsLayout view={view} navigation={navigation} issueCounts={issueCounts} sections={sections} onFind={form.goTo}>
      <ViewIntro view={view} />
      <View />
      {showSave ? <SaveBar /> : null}
    </SettingsLayout>
  );
}

/** "Settings saved" once a save succeeds: the save bar it came from goes away. */
function useSavedToast(saved: boolean) {
  const toast = useToast();
  const connection = useSlice('connection');
  const connected = connection?.connected ?? false;
  const previous = useRef(saved);
  useEffect(() => {
    if (saved && !previous.current) {
      toast.show({ title: connected ? 'Settings saved · connection verified' : 'Settings saved', tone: 'success' });
    }
    previous.current = saved;
  }, [saved, connected, toast]);
}

function SettingsLayout({
  view,
  navigation,
  issueCounts,
  sections,
  onFind,
  children,
}: {
  view: SettingsView;
  navigation: Navigation;
  issueCounts?: Partial<Record<SettingsView, number>>;
  sections?: readonly SettingsSectionDefinition[];
  onFind?: (section: SettingsSectionId) => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <div className={styles.navColumn}>
        <SettingsNav
          current={view}
          isPageVisible={navigation.isPageVisible}
          issueCounts={issueCounts}
          sections={sections}
          onFind={onFind}
          onSelect={(next) => navigation.navigate({ place: 'settings', view: next })}
        />
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

/**
 * Settings (2.4 layout "S4"): the Settings menu with search on the left (Account, Tracking,
 * Sources, App: 13 views) and the chosen view, up to 920 px wide. One draft serves every view;
 * appearance, Figma, quiet hours, prompts, repositories and launch at login apply immediately.
 */
export default function SettingsPlace() {
  const { view, navigation } = usePlaceView<SettingsView>('settings');
  const settings = useSlice('settings');
  const status = useEngineStatus();
  if (settings) {
    return (
      <SettingsFormProvider settings={settings} view={view} navigation={navigation}>
        <SettingsContent view={view} navigation={navigation} />
      </SettingsFormProvider>
    );
  }
  return (
    <SettingsLayout view={view} navigation={navigation}>
      {status === 'failed' ? (
        <EmptyState
          icon={ErrorIcon}
          title="Settings are unavailable"
          description="Azure timetracker could not reach its engine, so your settings cannot be shown or saved. Quit and reopen the app."
          headingLevel={2}
        />
      ) : (
        <LoadingRegion label="Loading settings" isLoading placeholder={<SettingsSkeleton />}>
          {null}
        </LoadingRegion>
      )}
    </SettingsLayout>
  );
}
