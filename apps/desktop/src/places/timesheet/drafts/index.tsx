import { useId, useState } from 'react';
import { announce } from '../../../components/Announcer';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card, Heading } from '../../../components/Card';
import { EmptyState, Skeleton } from '../../../components/EmptyState';
import { OfflineDraftsIcon, PlayIcon, PlusIcon, StopIcon, WarningIcon } from '../../../components/icons';
import { ProgressBar } from '../../../components/Progress';
import { Switch } from '../../../components/Toggles';
import type { OfflineDraft, OfflineDraftView, OfflineSlice, WorkItemsSlice } from '../../../ipc/contract';
import { ActivityChip, activityColorIndex, ActivityPill, useActivityColors } from '../../../features/activity';
import { DeleteDraftButton, focusAfterDelete } from '../../../features/offline/DeleteDraft';
import { useEngineDraft } from '../../../features/ticketContext/drafts';
import { DeleteLocalTimer } from '../../../features/tracking/DeleteLocalTimer';
import { deviceName, formatClockTime, parseInstant, secondsBetween } from '../../../features/ticketContext/format';
import { useCommands } from '../../../shortcuts/hooks';
import { useAction, useLiveSeconds, useSlice } from '../../../state/hooks';
import { cx } from '../../../utils/cx';
import { dateFormat, t } from '../../../i18n';
import { formatClock, formatShortDuration, formatSpokenDuration } from '../../../utils/duration';
import { OfflineIcon } from '../icons';
import { TimesheetHeader } from '../TimesheetHeader';
import { DraftEditor, StartLocalSheet } from './DraftSheets';
import { draftHeading, draftTitleParts, isRunning, newPastDraft, STATUS_LABELS, STATUS_TONES } from './labels';
import { ReviewCard } from './ReviewCard';
import styles from './OfflineDrafts.module.css';
import shared from '../timesheet.module.css';

/** Drafts rendered at once; "Show more" adds this many. */
export const DRAFT_PAGE_SIZE = 50;

/** "#4821 Checkout: …": the ticket number in the accent colour, then the ticket's name or the draft's title. */
function DraftTitle({ draft, items }: { draft: OfflineDraftView; items: WorkItemsSlice | undefined }) {
  const { ticket, name } = draftTitleParts(draft, items);
  return (
    <>
      {ticket ? <span className={styles.ticket}>{ticket}</span> : null}
      {ticket && name ? ' ' : null}
      {name}
    </>
  );
}

function LocalTimer({
  active,
  offline,
  items,
  colorIndex,
  activityName,
  onAddPast,
}: {
  active: OfflineDraftView;
  offline: OfflineSlice;
  items: WorkItemsSlice | undefined;
  colorIndex: number;
  activityName: string | null;
  onAddPast: (() => void) | null;
}) {
  const stop = useAction();
  const seconds = useLiveSeconds(0, active.start, true);
  const otherWorkspace = active.workspace !== offline.workspace;
  const { ticket, name } = draftTitleParts(active, otherWorkspace ? undefined : items);
  const meta = [ticket, activityName, t('since {time}', { time: formatClockTime(parseInstant(active.start)) })].filter(Boolean).join(' · ');
  return (
    <>
      <div className={styles.timerText}>
        <p className={styles.timerTitle}>
          <ActivityPill colorIndex={colorIndex} className={styles.timerPill} />
          <span>{name ?? ticket}</span>
        </p>
        <p className={styles.caption}>{meta}</p>
      </div>
      {/* A timer region: read on request, never announced every second. */}
      <p role="timer" aria-label={t('Elapsed {duration}', { duration: formatSpokenDuration(seconds) })} className={styles.clock}>
        {formatClock(seconds)}
      </p>
      {active.ticketId && active.comment ? <p className={styles.caption}>{t('Comment: {comment}', { comment: active.comment })}</p> : null}
      <div className={styles.timerButtons}>
        {onAddPast ? <Button onPress={onAddPast}>{t('Add past time…')}</Button> : null}
        <Button
          variant="primary"
          isDisabled={offline.working}
          isPending={stop.pending}
          onPress={() =>
            void stop.run({ type: 'offline.stopLocal' }).then((result) => {
              if (result.ok) announce(t('Local timer stopped.'));
            })
          }
        >
          {t('Stop local timer')}
        </Button>
      </div>
      <p className={styles.caption}>{t('Time continues through sleep and restarts. A 7pace timer may still be running on the server.')}</p>
      <DeleteLocalTimer draftId={active.id} isDisabled={offline.working || stop.pending} size="small" />
      {otherWorkspace ? (
        <p className={styles.warningLine}>
          <WarningIcon className={styles.warningIcon} />
          {t('This timer belongs to {workspace}. Stop it here, then switch workspace to upload it.', { workspace: active.workspace })}
        </p>
      ) : null}
      {stop.error ? <Banner tone="error">{stop.error.message}</Banner> : null}
    </>
  );
}

function DraftRow({
  draft,
  items,
  colorIndex,
  activityName,
  disabled,
  canReview,
  onEdit,
  onDeleted,
}: {
  draft: OfflineDraftView;
  items: WorkItemsSlice | undefined;
  colorIndex: number;
  activityName: string | null;
  disabled: boolean;
  canReview: boolean;
  onEdit: (draft: OfflineDraft) => void;
  onDeleted: () => void;
}) {
  const review = useAction();
  const running = isRunning(draft);
  const sending = draft.status === 'Check 7pace before retrying';
  const synced = draft.status === 'Synced to 7pace';
  const title = draftHeading(draft, items);
  return (
    <li className={cx(styles.draft, sending && styles.flagged)}>
      <ActivityPill colorIndex={colorIndex} className={styles.draftPill} />
      <div className={styles.draftText}>
        <Heading level={3} className={styles.draftTitle}>
          <DraftTitle draft={draft} items={items} />
        </Heading>
        <p className={styles.meta}>
          <span className={styles.mono}>{draftRange(draft)}</span>
          {running ? (
            <Badge tone="success">{t('Running locally')}</Badge>
          ) : draft.status === 'Local draft' && activityName ? (
            <ActivityChip name={activityName} colorIndex={colorIndex} />
          ) : (
            <Badge tone={STATUS_TONES[draft.status]}>{t(STATUS_LABELS[draft.status] ?? draft.status)}</Badge>
          )}
        </p>
        {draft.remoteId ? <p className={styles.selectable}>{t('7pace entry: {id}', { id: draft.remoteId })}</p> : null}
        {review.error ? <Banner tone="error">{review.error.message}</Banner> : null}
      </div>
      <span className={styles.duration}>{draft.end ? formatShortDuration(secondsBetween(draft.start, draft.end)) : ''}</span>
      <div className={cx(styles.rowActions, shared.noWrap)}>
        {draft.status === 'Local draft' ? (
          <Button size="small" isDisabled={disabled} onPress={() => onEdit(draft)} aria-label={t('Edit, {title}', { title })}>
            {t('Edit')}
          </Button>
        ) : null}
        {!running && !synced ? (
          <Button
            size="small"
            variant={sending ? 'secondary' : 'primary'}
            isDisabled={disabled || !canReview}
            isPending={review.pending}
            onPress={() => void review.run({ type: 'offline.review', draftId: draft.id })}
            aria-label={t('Review, {title}', { title })}
          >
            {t('Review')}
          </Button>
        ) : null}
        <DeleteDraftButton draft={draft} name={title} label={t('Delete…')} isDisabled={disabled} onDeleted={onDeleted} />
      </div>
    </li>
  );
}

/** "Mon 5 Oct · 18:00 – 19:15", or "… · running" for the local timer. */
function draftRange(draft: OfflineDraftView): string {
  const start = parseInstant(draft.start);
  if (!start) return draft.start;
  const day = dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const end = parseInstant(draft.end);
  return `${day} · ${formatClockTime(start)} – ${end ? formatClockTime(end) : t('running')}`;
}

/**
 * Timesheet · Drafts (2.2 "S2d", the 1.14 Offline drafts): the local timer, drafts kept on this
 * device, the review against 7pace and the upload, and the offline banner while 7pace can't be
 * reached. Nothing reaches 7pace without Review and a confirmed upload.
 */
export function DraftsView() {
  const offline = useSlice('offline');
  const app = useSlice('app');
  const tracking = useSlice('tracking');
  const settings = useSlice('settings');
  const items = useSlice('workItems');
  const reconnect = useAction();
  const showSynced = useAction();
  const [editing, setEditing] = useState<OfflineDraft | null>(null);
  const [starting, setStarting] = useState(false);
  const [visible, setVisible] = useState(DRAFT_PAGE_SIZE);
  const [synced, setSynced] = useEngineDraft(offline?.showSynced ?? false);
  const headingId = useId();
  const timerId = useId();
  const connection = useSlice('connection');
  const colors = useActivityColors();

  const canStart = !!offline && offline.canCreate && !offline.active;
  const canAdd = !!offline && offline.canCreate;
  const stopLocal = useAction();

  useCommands([
    { id: 'offline.start', icon: PlayIcon, label: t('Start local timer…'), group: 'Tracking', keywords: ['offline', 'local'], isDisabled: !canStart, onAction: () => setStarting(true) },
    {
      id: 'offline.stop',
      icon: StopIcon,
      label: t('Stop local timer'),
      group: 'Tracking',
      keywords: ['offline', 'local'],
      isDisabled: !offline?.active || offline.working,
      onAction: () =>
        void stopLocal.run({ type: 'offline.stopLocal' }).then((result) => {
          if (result.ok) announce(t('Local timer stopped.'));
        }),
    },
    {
      id: 'offline.addPast',
      icon: PlusIcon,
      label: t('Add past time…'),
      group: 'Actions',
      keywords: ['offline', 'draft'],
      isDisabled: !canAdd,
      onAction: () => {
        if (offline) setEditing(newPastDraft(offline.workspace));
      },
    },
  ]);

  if (!offline) {
    return (
      <>
        <TimesheetHeader view="drafts" title={t('Offline drafts')} />
        <div className={styles.page} aria-busy="true">
          <span role="status" className="visually-hidden">
            {t('Loading offline drafts')}
          </span>
          <Skeleton lines={2} />
          <Skeleton shape="rect" height="12rem" />
        </div>
      </>
    );
  }

  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const device = deviceName(app?.os);
  const configured = offline.configured;
  const rowsDisabled = offline.working || busy;
  const shown = offline.drafts.slice(0, visible);
  const offlineNow = !!connection && !connection.connected;
  const activityName = (id: string | null | undefined) => (id ? (offline.activities.find((activity) => activity.id === id)?.name ?? null) : null);
  const editingView = editing ? offline.drafts.find((draft) => draft.id === editing.id) : undefined;
  // A deleted draft takes its row, and the focused button, with it: continue from the list.
  const focusList = () => focusAfterDelete(() => document.getElementById(headingId));
  const addPast = canAdd ? () => setEditing(newPastDraft(offline.workspace)) : null;

  return (
    <>
      {offlineNow ? (
        <div role="status" className={styles.offlineBanner}>
          <span className={styles.offlineText}>
            <OfflineIcon className={styles.offlineIcon} />
            {t('You’re offline. 7pace can’t be reached, so new time is saved on {device} as drafts.', { device })}
          </span>
          <Button size="small" isDisabled={busy || offline.working} isPending={reconnect.pending} onPress={() => void reconnect.run({ type: 'connection.retry' })}>
            {t('Try to reconnect')}
          </Button>
        </div>
      ) : null}
      <TimesheetHeader view="drafts" title={t('Offline drafts')} subtitle={t('Drafts are left out of totals and Insights until you upload them.')} />

      {offline.issue ? <Banner tone="warning">{offline.issue}</Banner> : null}
      {offline.message ? <Banner tone="info">{offline.message}</Banner> : null}
      {reconnect.error ?? showSynced.error ? (
        <Banner tone="error">{(reconnect.error ?? showSynced.error)?.message}</Banner>
      ) : null}
      {offline.working ? <ProgressBar label={t('Checking with 7pace…')} isIndeterminate /> : null}
      {offline.review ? (
        <ReviewCard
          review={offline.review}
          title={offline.drafts.find((entry) => entry.id === offline.review?.draft.id)?.title ?? t('draft')}
          activities={offline.activities}
          disabled={rowsDisabled || preview}
          onDeleted={focusList}
        />
      ) : null}

      <div className={styles.columns}>
        <Card as="section" aria-labelledby={timerId} className={cx(styles.localCard, shared.noWrap)}>
          <div className={styles.cardHead}>
            <Heading level={2} id={timerId} className={styles.sectionTitle}>
              {t('Local timer')}
            </Heading>
            {offline.active ? <Badge tone="success">{t('Running on {device}', { device })}</Badge> : null}
          </div>
          {!offline.workspace ? (
            <p className={styles.warningLine}>
              <WarningIcon className={styles.warningIcon} />
              {t('Save your 7pace workspace URL in Settings first. Credentials are only needed for uploading.')}
            </p>
          ) : null}
          {offline.active ? (
            <LocalTimer
              active={offline.active}
              offline={offline}
              items={items}
              colorIndex={activityColorIndex(colors, offline.active.activityId)}
              activityName={activityName(offline.active.activityId)}
              onAddPast={addPast}
            />
          ) : (
            <>
              <p className={styles.caption}>{t('Track on {device} while 7pace can’t be reached, or add time you worked while disconnected. Drafts stay on {device} until you upload them.', { device })}</p>
              <div className={styles.timerButtons}>
                <Button isDisabled={!canAdd} onPress={() => setEditing(newPastDraft(offline.workspace))}>
                  {t('Add past time…')}
                </Button>
                <Button variant="primary" isDisabled={!canStart} onPress={() => setStarting(true)}>
                  {t('Start local timer…')}
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card as="section" padding="none" aria-labelledby={headingId} className={styles.listCard}>
          <div className={styles.listHeader}>
            <Heading level={2} id={headingId} tabIndex={-1} className={styles.sectionTitle}>
              {t('Waiting for review · {count}', { count: offline.readyCount })}
            </Heading>
            <Switch
              isSelected={synced}
              onChange={(show) => {
                setSynced(show);
                void showSynced.run({ type: 'offline.setShowSynced', show });
              }}
            >
              {t('Show uploaded')}
            </Switch>
          </div>
          {offline.drafts.length === 0 ? (
            <EmptyState
              icon={OfflineDraftsIcon}
              title={t('No offline drafts')}
              description={t('Start a local timer or add time you worked while disconnected.')}
            />
          ) : (
            <ul role="list" className={styles.drafts}>
              {shown.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  items={items}
                  colorIndex={activityColorIndex(colors, draft.activityId)}
                  activityName={activityName(draft.activityId)}
                  disabled={rowsDisabled}
                  canReview={configured}
                  onEdit={setEditing}
                  onDeleted={focusList}
                />
              ))}
            </ul>
          )}
          {offline.drafts.length > shown.length ? (
            <div className={styles.more}>
              <span className={styles.caption}>{t('Showing {shown} of {total} drafts', { shown: shown.length, total: offline.drafts.length })}</span>
              <Button onPress={() => setVisible((count) => count + DRAFT_PAGE_SIZE)}>{t('Show more drafts')}</Button>
            </div>
          ) : null}
          <div className={styles.listFooter}>
            <span className={styles.caption}>{t('Review compares a draft with 7pace before it is uploaded. Nothing reaches 7pace without your confirmation.')}</span>
          </div>
        </Card>
      </div>

      {starting ? (
        <StartLocalSheet
          activities={offline.activities}
          initialTicketId={tracking?.ticketId ?? null}
          initialActivityId={settings?.configuration.activityTypeId || null}
          working={offline.working}
          device={device}
          onClose={() => setStarting(false)}
          onStarted={() => announce(t('Local timer started.'))}
        />
      ) : null}
      {editing ? (
        <DraftEditor
          key={editing.id}
          draft={editing}
          activities={offline.activities}
          working={offline.working}
          device={device}
          onClose={() => setEditing(null)}
          deletion={editingView ? { name: draftHeading(editingView, items), onDeleted: focusList } : undefined}
        />
      ) : null}
    </>
  );
}
