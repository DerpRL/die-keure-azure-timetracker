import { useEffect, useRef } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Skeleton } from '../../components/EmptyState';
import { DayReviewIcon, OfflineDraftsIcon, OverviewIcon, PowerIcon, SettingsIcon } from '../../components/icons';
import type { Unlisten } from '../../ipc';
import { onPanelHidden, onPanelShown, onQuickSwitch } from '../../ipc/shell';
import { PanelSection, PanelSectionGrid, PanelShell } from '../../layout/PanelShell';
import { useCommand } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { TrackingStatusLabel } from '../../timer/status';
import { ConnectionHealth } from '../connection/ConnectionHealth';
import { TargetProgress, useProgressSummary } from '../progress/TargetProgress';
import { PromptList, usePromptAnnouncements, usePromptItems } from '../prompts/PromptList';
import { CurrentTracking, LocalTimer, useLocalTimerTitle } from '../tracking/CurrentTracking';
import { SetupIcon } from '../tracking/icons';
import { closePanel, openMainPage, quitApp } from '../tracking/platform';
import { trackingStatus, useTrackingAnnouncements } from '../tracking/status';
import { TICKET_SEARCH_SELECTOR } from '../tracking/TicketSearch';
import { TrackingCommands } from '../tracking/TrackingCommands';
import { PanelTrackingFlow } from '../tracking/TrackingFlow';
import { UpdateNotice } from '../updates/UpdateNotice';
import styles from './panel.module.css';

const NEXT_ACTION_PRIMARY = '[data-next-action] [data-prompt-primary]:not([disabled])';

function focusFirst(root: HTMLElement | null, selectors: readonly string[]): boolean {
  if (!root) return false;
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) {
      element.focus();
      return true;
    }
  }
  return false;
}

/** "A little setup. A lot less forgotten time." while no 7pace account is configured. */
function SetupCallToAction() {
  return (
    <section aria-labelledby="panel-setup-title" className={styles.setup} data-next-action="">
      <SetupIcon className={styles.setupIcon} />
      <div className={styles.setupText}>
        <h2 id="panel-setup-title" className={styles.setupTitle}>
          A little setup. A lot less forgotten time.
        </h2>
        <p className={styles.caption}>
          Connect 7pace, add your Azure PAT, and your branches will bring the right ticket to you.
        </p>
      </div>
      <Button variant="primary" data-prompt-primary="" onPress={() => openMainPage('settings')}>
        Set up accounts
      </Button>
    </section>
  );
}

/**
 * The tray panel (1.14 `MenuPanel`, 420 × 640). One "next action" comes first: the tracking
 * choice while the quick switch is open, the setup call to action, or the most urgent prompt.
 * Then the current timer, the local timer, the other suggestions, progress and the connection,
 * with the section grid at the end. Escape cancels the tracking choice, otherwise hides the panel.
 */
export function PanelView() {
  const flow = useSlice('flow');
  const tracking = useSlice('tracking');
  const connection = useSlice('connection');
  const app = useSlice('app');
  const items = usePromptItems('panel');
  const progressSummary = useProgressSummary();
  const localTitle = useLocalTimerTitle();
  const cancel = useAction();
  const dismiss = useAction();
  const rootRef = useRef<HTMLDivElement>(null);
  usePromptAnnouncements(items);
  useTrackingAnnouncements();

  const flowActive = flow?.surface === 'panel';
  const { run: runCancel } = cancel;

  useCommand({
    id: 'panel.escape',
    label: flowActive ? 'Cancel the tracking choice' : 'Hide the panel',
    group: 'General',
    shortcut: { key: 'Escape' },
    allowInInputs: true,
    showInPalette: false,
    onAction: () => {
      if (flowActive) void runCancel({ type: 'tracking.cancelPanel' });
      else closePanel();
    },
  });

  // Shell events: focus on show, the quick-switch shortcut, and 1.x's cancel-on-close.
  const flowActiveRef = useRef(flowActive);
  const searchFocusRequested = useRef(0);
  useEffect(() => {
    flowActiveRef.current = flowActive;
  });
  useEffect(() => {
    // A quick switch focuses the search as soon as the engine shows it (within a few seconds).
    if (!searchFocusRequested.current) return;
    if (Date.now() - searchFocusRequested.current > 3000) {
      searchFocusRequested.current = 0;
      return;
    }
    if (focusFirst(rootRef.current, [TICKET_SEARCH_SELECTOR])) searchFocusRequested.current = 0;
  });
  useEffect(() => {
    let cancelled = false;
    const stops: Unlisten[] = [];
    const keep = (subscription: Promise<Unlisten>) => {
      subscription.then(
        (stop) => (cancelled ? stop() : stops.push(stop)),
        () => {},
      );
    };
    keep(
      onPanelShown(({ focused }) => {
        if (!focused) return;
        requestAnimationFrame(() => {
          const root = rootRef.current;
          if (flowActiveRef.current) {
            focusFirst(root, [TICKET_SEARCH_SELECTOR, '[data-tracking-flow] [data-prompt-primary]:not([disabled])']);
          } else {
            focusFirst(root, [NEXT_ACTION_PRIMARY]);
          }
        });
      }),
    );
    keep(
      onQuickSwitch(() => {
        searchFocusRequested.current = Date.now();
        if (focusFirst(rootRef.current, [TICKET_SEARCH_SELECTOR])) searchFocusRequested.current = 0;
      }),
    );
    keep(
      onPanelHidden(() => {
        if (flowActiveRef.current) void runCancel({ type: 'tracking.cancelPanel' });
      }),
    );
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
  }, [runCancel]);

  const status = trackingStatus(connection);
  const local = tracking?.showsLocalTimer ?? false;
  const loading = !flow || !tracking || !connection || !items;
  const [next, ...rest] = items ?? [];
  const error = app?.error && app.error !== connection?.connectionIssue ? app.error : null;

  let nextAction = null;
  if (loading) {
    nextAction = (
      <div aria-busy="true" className={styles.loading}>
        <span role="status" className="visually-hidden">
          Loading
        </span>
        <Skeleton shape="rect" height="5rem" />
        <Skeleton lines={2} />
      </div>
    );
  } else if (flowActive) {
    nextAction = <PanelTrackingFlow flow={flow} />;
  } else if (connection.health === 'unconfigured') {
    nextAction = <SetupCallToAction />;
  } else if (next) {
    nextAction = (
      <section aria-label="Next action" data-next-action="">
        <PromptList items={[next]} surface="panel" headingLevel={2} label="Most urgent suggestion" />
      </section>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <PanelShell
        status={
          <TrackingStatusLabel
            status={status}
            label={local ? 'Local tracking' : undefined}
            icon={local ? OfflineDraftsIcon : undefined}
          />
        }
        footer={
          <PanelSectionGrid
            links={[
              { id: 'overview', label: 'Overview', icon: OverviewIcon, onPress: () => openMainPage('overview') },
              { id: 'dayReview', label: 'Day review', icon: DayReviewIcon, onPress: () => openMainPage('dayReview') },
              { id: 'settings', label: 'Settings', icon: SettingsIcon, onPress: () => openMainPage('settings') },
              {
                id: 'quit',
                label: 'Quit app',
                icon: PowerIcon,
                onPress: quitApp,
                description: 'Quitting leaves the 7pace timer running',
              },
            ]}
          />
        }
      >
        <TrackingCommands surface="panel" />
        {nextAction}
        {!loading && !flowActive ? (
          <>
            {tracking.showsRemoteTimer ? (
              <PanelSection title="Current tracking">
                <CurrentTracking surface="panel" />
              </PanelSection>
            ) : null}
            {tracking.local ? (
              <PanelSection title={localTitle}>
                <LocalTimer surface="panel" />
              </PanelSection>
            ) : null}
            {rest.length > 0 ? (
              <PanelSection
                title="More suggestions"
                collapsible
                defaultExpanded={false}
                summary={`${rest.length} waiting`}
              >
                <PromptList items={rest} surface="panel" headingLevel={3} label="More suggestions" />
              </PanelSection>
            ) : null}
            <PanelSection title="Progress" collapsible defaultExpanded={false} summary={progressSummary}>
              <TargetProgress compact />
            </PanelSection>
          </>
        ) : null}
        {error ? (
          <Banner
            tone="error"
            live="polite"
            onDismiss={() => void dismiss.run({ type: 'app.dismissError' })}
            dismissLabel="Dismiss error"
          >
            {error}
          </Banner>
        ) : null}
        <section aria-label="Connection">
          <ConnectionHealth />
        </section>
        <UpdateNotice />
      </PanelShell>
    </div>
  );
}
