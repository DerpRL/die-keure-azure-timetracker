import { useId, useState } from 'react';
import { announce } from '../../components/Announcer';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card, Heading } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { OfflineDraftsIcon, RunningIcon, SuccessIcon, WarningIcon } from '../../components/icons';
import { ProgressBar } from '../../components/Progress';
import { Switch } from '../../components/Toggles';
import type { OfflineDraft, OfflineDraftView, OfflineSlice, WorkItemsSlice } from '../../ipc/contract';
import { useEngineDraft } from '../../features/ticketContext/drafts';
import { deviceName, formatInstant, secondsBetween } from '../../features/ticketContext/format';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useLiveSeconds, useSlice } from '../../state/hooks';
import { formatClock, formatSpokenDuration } from '../../utils/duration';
import { DraftEditor, StartLocalSheet } from './DraftSheets';
import { draftHeading, isRunning, STATUS_TONES } from './labels';
import { ReviewCard } from './ReviewCard';
import styles from './OfflineDrafts.module.css';

/** Drafts rendered at once; "Show more" adds this many. */
export const DRAFT_PAGE_SIZE = 50;

function LocalTimer({ active, offline, items, device }: { active: OfflineDraftView; offline: OfflineSlice; items: WorkItemsSlice | undefined; device: string }) {
  const stop = useAction();
  const seconds = useLiveSeconds(0, active.start, true);
  const otherWorkspace = active.workspace !== offline.workspace;
  return (
    <div className={styles.localTimer}>
      <Heading level={2} className={styles.sectionTitle}>
        {`Local tracking · saved on ${device}`}
      </Heading>
      <div className={styles.timerRow}>
        <div className={styles.timerText}>
          <p className={styles.timerTitle}>{`Local timer · ${draftHeading(active, otherWorkspace ? undefined : items)}`}</p>
          {active.ticketId && active.comment ? <p className={styles.caption}>{active.comment}</p> : null}
          <p className={styles.caption}>Not uploaded to 7pace</p>
        </div>
        {/* A timer region: read on request, never announced every second. */}
        <p role="timer" aria-label={`Elapsed ${formatSpokenDuration(seconds)}`} className={styles.clock}>
          {formatClock(seconds)}
        </p>
        <Button
          variant="primary"
          isDisabled={offline.working}
          isPending={stop.pending}
          onPress={() =>
            void stop.run({ type: 'offline.stopLocal' }).then((result) => {
              if (result.ok) announce('Local timer stopped.');
            })
          }
        >
          Stop local timer
        </Button>
      </div>
      {otherWorkspace ? (
        <p className={styles.warningLine}>
          <WarningIcon className={styles.warningIcon} />
          {`This timer belongs to ${active.workspace}. Stop it here, then switch workspace to upload it.`}
        </p>
      ) : null}
      <p className={styles.caption}>Time continues through sleep and restarts. Adjust it before uploading.</p>
      {stop.error ? <Banner tone="error">{stop.error.message}</Banner> : null}
    </div>
  );
}

function DraftRow({
  draft,
  items,
  disabled,
  canReview,
  onEdit,
  onRemove,
}: {
  draft: OfflineDraftView;
  items: WorkItemsSlice | undefined;
  disabled: boolean;
  canReview: boolean;
  onEdit: (draft: OfflineDraft) => void;
  onRemove: (draft: OfflineDraft) => void;
}) {
  const review = useAction();
  const running = isRunning(draft);
  const sending = draft.status === 'Check 7pace before retrying';
  const synced = draft.status === 'Synced to 7pace';
  const title = draftHeading(draft, items);
  return (
    <li className={styles.draft}>
      <div className={styles.draftText}>
        <Heading level={3} className={styles.draftTitle}>
          {title}
        </Heading>
        <p>{`${formatInstant(draft.start)} → ${draft.end ? formatInstant(draft.end) : 'Running locally'}`}</p>
        <p className={styles.badges}>
          {running ? (
            <Badge tone="running" icon={RunningIcon}>
              Running locally
            </Badge>
          ) : (
            <Badge tone={STATUS_TONES[draft.status]} icon={sending ? WarningIcon : synced ? SuccessIcon : undefined}>
              {draft.status}
            </Badge>
          )}
          {draft.end ? <span className={styles.mono}>{formatClock(secondsBetween(draft.start, draft.end))}</span> : null}
        </p>
        {draft.remoteId ? <p className={styles.selectable}>{`7pace entry: ${draft.remoteId}`}</p> : null}
        {review.error ? <Banner tone="error">{review.error.message}</Banner> : null}
      </div>
      <div className={styles.actions}>
        {draft.status === 'Local draft' ? (
          <Button size="small" isDisabled={disabled} onPress={() => onEdit(draft)} aria-label={`Edit, ${title}`}>
            Edit
          </Button>
        ) : null}
        {!running && !synced ? (
          <Button
            size="small"
            isDisabled={disabled || !canReview}
            isPending={review.pending}
            onPress={() => void review.run({ type: 'offline.review', draftId: draft.id })}
            aria-label={`Review, ${title}`}
          >
            Review
          </Button>
        ) : null}
        {!sending ? (
          <Button size="small" variant="plain" isDisabled={disabled} onPress={() => onRemove(draft)} aria-label={`Remove, ${title}`}>
            Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function newPastDraft(workspace: string): OfflineDraft {
  const end = new Date();
  end.setSeconds(0, 0);
  const start = new Date(end.getTime() - 3600 * 1000);
  return {
    id: crypto.randomUUID(),
    workspace,
    start: start.toISOString(),
    end: end.toISOString(),
    comment: '',
    billable: false,
    status: 'Local draft',
  };
}

/**
 * Offline drafts (1.14 `OfflineDraftView`): the local timer, drafts kept on this device, the
 * review against 7pace and the upload. Nothing reaches 7pace without Review and a confirmed upload.
 */
export default function OfflineDraftsPage() {
  const offline = useSlice('offline');
  const app = useSlice('app');
  const tracking = useSlice('tracking');
  const settings = useSlice('settings');
  const items = useSlice('workItems');
  const reconnect = useAction();
  const showSynced = useAction();
  const remove = useAction();
  const [editing, setEditing] = useState<OfflineDraft | null>(null);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<OfflineDraft | null>(null);
  const [visible, setVisible] = useState(DRAFT_PAGE_SIZE);
  const [synced, setSynced] = useEngineDraft(offline?.showSynced ?? false);
  const headingId = useId();

  const canStart = !!offline && offline.canCreate && !offline.active;
  const canAdd = !!offline && offline.canCreate;
  const stopLocal = useAction();

  useCommands([
    { id: 'offline.start', label: 'Start local timer…', group: 'Tracking', keywords: ['offline', 'local'], isDisabled: !canStart, onAction: () => setStarting(true) },
    {
      id: 'offline.stop',
      label: 'Stop local timer',
      group: 'Tracking',
      keywords: ['offline', 'local'],
      isDisabled: !offline?.active || offline.working,
      onAction: () =>
        void stopLocal.run({ type: 'offline.stopLocal' }).then((result) => {
          if (result.ok) announce('Local timer stopped.');
        }),
    },
    {
      id: 'offline.addPast',
      label: 'Add past time…',
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
      <div className={styles.page} aria-busy="true">
        <span role="status" className="visually-hidden">
          Loading offline drafts
        </span>
        <Skeleton lines={2} />
        <Skeleton shape="rect" height="12rem" />
      </div>
    );
  }

  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const device = deviceName(app?.os);
  const configured = offline.configured;
  const rowsDisabled = offline.working || busy;
  const shown = offline.drafts.slice(0, visible);

  return (
    <div className={styles.page}>
      <p className={styles.intro}>Track locally, then review and upload when you reconnect.</p>

      <Card className={styles.card}>
        <p className={styles.caption}>
          {`Drafts stay on ${device} until you upload them. They are excluded from confirmed totals and statistics. A remote 7pace timer may still be running while you are offline.`}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" isDisabled={!canStart} onPress={() => setStarting(true)}>
            Start local timer…
          </Button>
          <Button isDisabled={!canAdd} onPress={() => setEditing(newPastDraft(offline.workspace))}>
            Add past time…
          </Button>
          <span className={styles.spacer} />
          <Button isDisabled={busy || offline.working} isPending={reconnect.pending} onPress={() => void reconnect.run({ type: 'connection.retry' })}>
            Reconnect
          </Button>
        </div>
        {!offline.workspace ? (
          <p className={styles.warningLine}>
            <WarningIcon className={styles.warningIcon} />
            Save your 7pace workspace URL in Settings first. Credentials are only needed for uploading.
          </p>
        ) : null}
        {offline.active ? <LocalTimer active={offline.active} offline={offline} items={items} device={device} /> : null}
      </Card>

      {offline.issue ? <Banner tone="warning">{offline.issue}</Banner> : null}
      {offline.message ? <Banner tone="info">{offline.message}</Banner> : null}
      {reconnect.error ?? remove.error ?? showSynced.error ? (
        <Banner tone="error">{(reconnect.error ?? remove.error ?? showSynced.error)?.message}</Banner>
      ) : null}
      {offline.working ? <ProgressBar label="Checking with 7pace…" isIndeterminate /> : null}
      {offline.review ? (
        <ReviewCard
          review={offline.review}
          title={offline.drafts.find((entry) => entry.id === offline.review?.draft.id)?.title ?? 'draft'}
          activities={offline.activities}
          disabled={rowsDisabled || preview}
        />
      ) : null}

      <section aria-labelledby={headingId} className={styles.list}>
        <div className={styles.listHeader}>
          <Heading level={2} id={headingId} className={styles.sectionTitle}>
            {`This workspace · ${offline.readyCount} awaiting review`}
          </Heading>
          <Switch
            isSelected={synced}
            onChange={(show) => {
              setSynced(show);
              void showSynced.run({ type: 'offline.setShowSynced', show });
            }}
          >
            Show synced
          </Switch>
        </div>
        {offline.drafts.length === 0 ? (
          <Card>
            <EmptyState
              icon={OfflineDraftsIcon}
              title="No offline drafts"
              description="Start a local timer or add time you worked while disconnected."
            />
          </Card>
        ) : (
          <ul role="list" className={styles.drafts}>
            {shown.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                items={items}
                disabled={rowsDisabled}
                canReview={configured}
                onEdit={setEditing}
                onRemove={setRemoving}
              />
            ))}
          </ul>
        )}
        {offline.drafts.length > shown.length ? (
          <div className={styles.more}>
            <span className={styles.caption}>{`Showing ${shown.length} of ${offline.drafts.length} drafts`}</span>
            <Button onPress={() => setVisible((count) => count + DRAFT_PAGE_SIZE)}>Show more drafts</Button>
          </div>
        ) : null}
      </section>

      {starting ? (
        <StartLocalSheet
          activities={offline.activities}
          initialTicketId={tracking?.ticketId ?? null}
          initialActivityId={settings?.configuration.activityTypeId || null}
          working={offline.working}
          device={device}
          onClose={() => setStarting(false)}
          onStarted={() => announce('Local timer started.')}
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
        />
      ) : null}
      <Dialog
        isOpen={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        role="alertdialog"
        size="small"
        title="Remove this local record?"
        description="Entries already in 7pace will stay there."
        primaryAction={{
          label: 'Remove local record',
          variant: 'destructive',
          isPending: remove.pending,
          onAction: () => {
            const target = removing;
            if (!target) return;
            void remove.run({ type: 'offline.remove', draftId: target.id }).then(() => setRemoving(null));
          },
        }}
      />
    </div>
  );
}
