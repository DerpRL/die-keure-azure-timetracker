import { useMemo, type ComponentType, type ReactNode } from 'react';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ErrorIcon } from '../../components/icons';
import { SaveBar } from '../../features/settings/SaveBar';
import { DRAFT_VIEWS, SETTINGS_SECTIONS, VIEW_INTROS } from '../../features/settings/sections';
import { useSettingsForm } from '../../features/settings/SettingsForm';
import { usePlaceView, type Navigation } from '../../layout/NavigationContext';
import type { SettingsView } from '../../layout/navigation';
import { useEngineStatus } from '../../state/EngineProvider';
import { useSlice } from '../../state/hooks';
import { WatchSwitch } from './git';
import { SettingsFormProvider } from './SettingsForm';
import { SettingsNav } from './SettingsNav';
import { AccountsView } from './views/AccountsView';
import { AppearanceView } from './views/AppearanceView';
import { CalendarsView } from './views/CalendarsView';
import { FigmaView } from './views/FigmaView';
import { GitView } from './views/GitView';
import { SourcesView } from './views/SourcesView';
import { TrackingView } from './views/TrackingView';
import styles from './settings.module.css';

const VIEWS: Record<SettingsView, ComponentType> = {
  accounts: AccountsView,
  tracking: TrackingView,
  sources: SourcesView,
  git: GitView,
  figma: FigmaView,
  calendars: CalendarsView,
  appearance: AppearanceView,
};

/** Controls next to a view's title (the Git view's "Watching" switch). */
const VIEW_ACTIONS: Partial<Record<SettingsView, () => ReactNode>> = {
  git: () => <WatchSwitch label="Watching" />,
};

function ViewIntro({ view }: { view: SettingsView }) {
  const intro = VIEW_INTROS[view];
  const actions = VIEW_ACTIONS[view]?.();
  return (
    <div className={styles.sectionHead}>
      <div className={styles.sectionHeadText}>
        <h2 className={styles.sectionTitle}>{intro.title}</h2>
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
  const View = VIEWS[view];
  // Views that edit the draft always show Save; the others when edits made elsewhere are unsaved.
  const showSave = DRAFT_VIEWS.includes(view) || form.dirty || form.showIssues;
  return (
    <SettingsLayout view={view} navigation={navigation} issueCounts={issueCounts}>
      <ViewIntro view={view} />
      <View />
      {showSave ? <SaveBar /> : null}
    </SettingsLayout>
  );
}

function SettingsLayout({
  view,
  navigation,
  issueCounts,
  children,
}: {
  view: SettingsView;
  navigation: Navigation;
  issueCounts?: Partial<Record<SettingsView, number>>;
  children: ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <div className={styles.navColumn}>
        <SettingsNav
          current={view}
          isPageVisible={navigation.isPageVisible}
          issueCounts={issueCounts}
          onSelect={(next) => navigation.navigate({ place: 'settings', view: next })}
        />
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

/**
 * Settings (2.2 layout "S4"): the Settings menu on the left (Account, Tracking, Sources, App) and
 * the chosen view, up to 860 px wide. One draft serves every view; appearance, Figma, quiet
 * hours, interruptions, repositories and launch at login apply immediately.
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
