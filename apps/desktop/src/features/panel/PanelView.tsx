import { useEffect, useRef } from 'react';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Skeleton } from '../../components/EmptyState';
import { CalendarIcon, OfflineDraftsIcon, PlayIcon, PowerIcon, SettingsIcon, StatisticsIcon, TableIcon } from '../../components/icons';
import type { Unlisten } from '../../ipc';
import { onPanelHidden, onPanelShown, onQuickSwitch } from '../../ipc/shell';
import { PanelNav, PanelSection, PanelShell } from '../../layout/PanelShell';
import { useCommand } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { TrackingStatusLabel } from '../../timer/status';
import { ConnectionHealth } from '../connection/ConnectionHealth';
import { PromptList, usePromptAnnouncements, usePromptItems } from '../prompts/PromptList';
import { CurrentTracking, LocalTimer, useLocalTimerTitle } from '../tracking/CurrentTracking';
import { SetupIcon } from '../tracking/icons';
import { focusFirst, useFocusRecovery } from '../tracking/focus';
import { closePanel, openMainPage, quitApp } from '../tracking/platform';
import { trackingStatus, useTrackingAnnouncements } from '../tracking/status';
import { TICKET_SEARCH_SELECTOR } from '../tracking/TicketSearch';
import { TrackingCommands } from '../tracking/TrackingCommands';
import { PanelTrackingFlow } from '../tracking/TrackingFlow';
import { UpdateNotice } from '../updates/UpdateNotice';
import styles from './panel.module.css';
import { t, tn } from '../../i18n';

const NEXT_ACTION_PRIMARY = '[data-next-action] [data-prompt-primary]:not([disabled])';
const FLOW_PRIMARY = '[data-tracking-flow] [data-prompt-primary]:not([disabled])';

/** Where focus goes when the focused control disappears (a prompt resolved, the choice ended). */
const FOCUS_FALLBACKS = [
  NEXT_ACTION_PRIMARY,
  TICKET_SEARCH_SELECTOR,
  FLOW_PRIMARY,
  '[data-tracking-flow] button:not([disabled])',
  '[data-current-primary]:not([disabled])',
] as const;

/** "A little setup. A lot less forgotten time." while no 7pace account is configured. */
function SetupCallToAction() {
  return (
    <section aria-labelledby="panel-setup-title" className={styles.setup} data-next-action="">
      <SetupIcon className={styles.setupIcon} />
      <div className={styles.setupText}>
        <h2 id="panel-setup-title" className={styles.setupTitle}>
          {t('A little setup. A lot less forgotten time.')}
        </h2>
        <p className={styles.caption}>
          {t('Connect 7pace, add your Azure PAT, and your branches will bring the right ticket to you.')}
        </p>
      </div>
      <Button variant="primary" data-prompt-primary="" onPress={() => openMainPage('settings')}>
        {t('Set up accounts')}
      </Button>
    </section>
  );
}

/** Favourite and recent tickets to start again (the engine's quick tickets), the running one left out. */
function PickUpAgain() {
  const flow = useSlice('flow');
  const tracking = useSlice('tracking');
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const running = tracking?.running ? tracking.ticketId : null;
  const tickets = (flow?.quickTickets ?? []).filter((ticket) => ticket.ticketId !== running).slice(0, 3);
  if (tickets.length === 0) return null;
  return (
    <section aria-labelledby="panel-pickup-title" className={styles.today}>
      <h2 id="panel-pickup-title" className={styles.eyebrow}>
        {t('Pick up again')}
      </h2>
      <ul role="list" className={styles.pickList}>
        {tickets.map((ticket) => (
          <li key={ticket.ticketId} className={styles.pickRow}>
            <div className={styles.pickText}>
              <p className={styles.pickTitle}>{ticket.title ?? t('Azure ticket #{id}', { id: ticket.ticketId })}</p>
              <p className={styles.pickMeta}>{`#${ticket.ticketId}${ticket.favorite ? ` · ${t('Favourite')}` : ''}`}</p>
            </div>
            <IconButton
              variant="secondary"
              size="small"
              icon={PlayIcon}
              label={t('Start timer on #{id}', { id: ticket.ticketId })}
              tooltip={false}
              isDisabled={busy || !connected}
              isPending={actions.isPending(`pick-${ticket.ticketId}`)}
              onPress={() =>
                void actions.run(`pick-${ticket.ticketId}`, {
                  type: 'tracking.chooseTicket',
                  ticketId: ticket.ticketId,
                  surface: 'panel',
                })
              }
            />
          </li>
        ))}
      </ul>
      {actions.confirmation}
    </section>
  );
}

/** Offline drafts waiting for review: a button with the count that opens them in Timesheet. */
function DraftsButton() {
  const offline = useSlice('offline');
  const count = offline?.readyCount ?? 0;
  if (count === 0) return null;
  return (
    <Button
      size="small"
      className={styles.draftsButton}
      aria-label={tn(count, '{count} offline draft, open in Timesheet', '{count} offline drafts, open in Timesheet')}
      onPress={() => openMainPage('timesheet/drafts')}
    >
      <span className={styles.draftsCount} aria-hidden="true">
        {count}
      </span>
      {count === 1 ? t('Offline draft') : t('Offline drafts')}
    </Button>
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
  const localTitle = useLocalTimerTitle();
  const cancel = useAction();
  const dismiss = useAction();
  const rootRef = useRef<HTMLDivElement>(null);
  usePromptAnnouncements(items);
  useTrackingAnnouncements();
  useFocusRecovery(rootRef, FOCUS_FALLBACKS);

  const flowActive = flow?.surface === 'panel';
  const { run: runCancel } = cancel;
  // As 1.14's Cancel: a start in flight cannot be cancelled from the chooser.
  const starting = flowActive && !!flow.draft && (app?.busy ?? false);

  useCommand({
    id: 'panel.escape',
    label: flowActive ? t('Cancel the tracking choice') : t('Hide the panel'),
    group: 'General',
    shortcut: { key: 'Escape' },
    allowInInputs: true,
    showInPalette: false,
    isDisabled: starting,
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
            focusFirst(root, [TICKET_SEARCH_SELECTOR, FLOW_PRIMARY]);
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
          {t('Loading')}
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
      <section aria-label={t('Next action')} data-next-action="">
        <PromptList items={[next]} surface="panel" headingLevel={2} label={t('Most urgent suggestion')} />
      </section>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <PanelShell
        status={
          <TrackingStatusLabel
            status={status}
            label={local ? t('Local tracking') : undefined}
            icon={local ? OfflineDraftsIcon : undefined}
          />
        }
        footer={
          <PanelNav
            items={[
              { id: 'today', label: t('Today'), icon: CalendarIcon, onPress: () => openMainPage('today') },
              { id: 'timesheet', label: t('Timesheet'), icon: TableIcon, onPress: () => openMainPage('timesheet') },
              { id: 'insights', label: t('Insights'), icon: StatisticsIcon, onPress: () => openMainPage('insights') },
              { id: 'settings', label: t('Settings'), icon: SettingsIcon, onPress: () => openMainPage('settings') },
              { id: 'quit', label: t('Quit'), icon: PowerIcon, onPress: quitApp, title: t('Quit app. The 7pace timer keeps running.') },
            ]}
            note={t('Quitting keeps the 7pace timer running.')}
          />
        }
      >
        <TrackingCommands surface="panel" />
        {/* 2.0 order: the quick switch or setup first; otherwise the timer leads, then the most
            urgent suggestion (still the "next action" for focus), then today or tickets to resume. */}
        {loading || flowActive || connection.health === 'unconfigured' ? nextAction : null}
        {!loading && !flowActive ? (
          <>
            {tracking.showsRemoteTimer ? (
              <section aria-label={t('Current tracking')}>
                <CurrentTracking surface="panel" />
              </section>
            ) : null}
            {tracking.local ? (
              <PanelSection title={localTitle}>
                <LocalTimer surface="panel" />
              </PanelSection>
            ) : null}
            {connection.health !== 'unconfigured' ? nextAction : null}
            {rest.length > 0 ? (
              <PanelSection
                title={t('More suggestions')}
                collapsible
                defaultExpanded={false}
                summary={t('{count} waiting', { count: rest.length })}
              >
                <PromptList items={rest} surface="panel" headingLevel={3} label={t('More suggestions')} />
              </PanelSection>
            ) : null}
            <PickUpAgain />
          </>
        ) : null}
        {error ? (
          <Banner
            tone="error"
            live="polite"
            onDismiss={() => void dismiss.run({ type: 'app.dismissError' })}
            dismissLabel={t('Dismiss error')}
          >
            {error}
          </Banner>
        ) : null}
        <section aria-label={t('Connection')} className={styles.statusRow}>
          <ConnectionHealth />
          {!loading && !flowActive ? <DraftsButton /> : null}
        </section>
        <UpdateNotice />
      </PanelShell>
    </div>
  );
}
