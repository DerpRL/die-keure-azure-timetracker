import { useId, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button, IconButton } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { CloseIcon } from '../../../components/icons';
import { ProgressBar } from '../../../components/Progress';
import { ActivityChip, activityColorIndex, useActivityColors } from '../../../features/activity';
import { formatClockTime, formatDayLong } from '../../../features/ticketContext/format';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import { useAction, useSlice } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import { t } from '../../../i18n';
import { canSave, EditTimes, SaveConfirmation } from '../day/EditSheet';
import type { WeekBlock } from './weekModel';
import styles from './week.module.css';

export interface SelectedEntryProps {
  block: WeekBlock;
  onClose: () => void;
  /** Split, Check overlaps and the rest of the edit sheet. */
  onMoreOptions: () => void;
  /** Opens the entry's day in the Day view. */
  onOpenDay: () => void;
}

function durationOf(start: string | null, end: string | null, fallback: number): number {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(b - a, 0) / 1000 : fallback;
}

/**
 * The block chosen in the week (2.2 "Selected entry"): the ticket, activity, date and comment,
 * with Start and End editable through the time editor (`timeEditor.select`, `setTimes`, then a
 * confirmed `save`). Split and the overlap check stay in the full edit sheet ("More options…").
 */
export function SelectedEntry({ block, onClose, onMoreOptions, onOpenDay }: SelectedEntryProps) {
  const editor = useSlice('timeEditor');
  const app = useSlice('app');
  const colors = useActivityColors();
  const times = useAction();
  const save = useAction();
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();

  const busy = app?.busy ?? false;
  const preview = app?.preview ?? false;
  const editable = block.kind === 'log' && !block.locked;
  const loaded = editable && editor?.selected?.id === block.id ? editor : null;
  const editing = loaded && loaded.mode === 'edit' ? loaded : null;
  const locked = !!loaded && (loaded.working || busy || loaded.needsReload);
  const seconds = editing ? durationOf(editing.start, editing.end, (block.end - block.start) / 1000) : (block.end - block.start) / 1000;
  const issue = loaded?.issue ?? save.error?.message ?? times.error?.message ?? null;

  return (
    <Card as="section" aria-labelledby={headingId} className={styles.card}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('Selected entry')}
        </h2>
        <IconButton label={t('Close selected entry')} icon={CloseIcon} size="small" variant="secondary" tooltip={false} onPress={onClose} />
      </div>

      <div className={styles.fieldLabel}>{t('Ticket')}</div>
      <div className={styles.ticketBox}>
        <span className={styles.ticketTitle}>{block.title}</span>
        <span className={styles.caption}>
          {block.ticketId !== null ? <TicketLink ticketId={block.ticketId} compact /> : t('No Azure ticket')}
        </span>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt className={styles.fieldLabel}>{t('Activity')}</dt>
          <dd>
            {block.activityName ? (
              <ActivityChip name={block.activityName} colorIndex={activityColorIndex(colors, block.activityId)} />
            ) : (
              t('Default activity')
            )}
          </dd>
        </div>
        <div>
          <dt className={styles.fieldLabel}>{t('Date')}</dt>
          <dd>{formatDayLong(block.day)}</dd>
        </div>
        {!editing ? (
          <div>
            <dt className={styles.fieldLabel}>{t('Time')}</dt>
            <dd className={styles.mono}>
              {block.kind === 'running'
                ? t('{start} – now', { start: formatClockTime(new Date(block.start)) })
                : `${formatClockTime(new Date(block.start))} – ${formatClockTime(new Date(block.end))}`}
            </dd>
          </div>
        ) : null}
      </dl>

      {editing ? (
        <EditTimes
          key={`${editing.selected?.id}:${editing.selected?.timestamp}:${editing.selected?.length}`}
          start={editing.start}
          end={editing.end}
          isDisabled={locked}
          onChange={(start, end) => void times.run({ type: 'timeEditor.setTimes', start, end })}
        />
      ) : null}

      <p className={styles.caption}>
        {t('Duration')} <span className={styles.strong}>{formatShortDuration(seconds)}</span>
      </p>
      {block.comment ? (
        <p className={styles.caption}>
          {t('Comment')} <span className={styles.strong}>{block.comment}</span>
        </p>
      ) : null}

      {block.kind === 'running' ? (
        <p className={styles.caption}>{t('The 7pace timer is still running. Stop it before you change its time.')}</p>
      ) : block.locked ? (
        <p className={styles.caption}>{t('7pace doesn’t allow editing this entry.')}</p>
      ) : !loaded ? (
        <ProgressBar label={t('Loading the entry from 7pace…')} isIndeterminate />
      ) : null}

      {editing?.validationIssue ? (
        <Banner tone="warning" live="off">
          {editing.validationIssue}
        </Banner>
      ) : null}
      {editing?.requiresReview ? (
        <Banner tone="warning" live="off">
          {t('An earlier change needs review. Open Recent edits in the Day view before making another change.')}
        </Banner>
      ) : null}
      {issue ? <Banner tone="error">{issue}</Banner> : null}

      <div className={styles.buttons}>
        <div className={styles.buttonGroup}>
          {editable ? (
            <Button size="small" isDisabled={!loaded || locked} onPress={onMoreOptions}>
              {t('More options…')}
            </Button>
          ) : null}
          <Button size="small" variant="plain" onPress={onOpenDay}>
            {t('Open day')}
          </Button>
        </div>
        {editable ? (
          <Button variant="primary" isDisabled={!editing || !canSave(editing, busy, preview)} onPress={() => setConfirming(true)}>
            {t('Save to 7pace')}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <SaveConfirmation
          isOpen={confirming}
          onOpenChange={setConfirming}
          mode={editing.mode}
          isPending={save.pending}
          isDisabled={!canSave(editing, busy, preview)}
          onConfirm={() =>
            void save.run({ type: 'timeEditor.save' }).then(() => {
              setConfirming(false);
            })
          }
        />
      ) : null}
    </Card>
  );
}
