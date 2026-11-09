import { getLocalTimeZone, now as zonedNow, type ZonedDateTime } from '@internationalized/date';
import { useState } from 'react';
import { Banner } from '../../../components/Banner';
import { DatePicker } from '../../../components/DateFields';
import { Dialog } from '../../../components/Dialog';
import { Switch } from '../../../components/Toggles';
import type { ActivityType } from '../../../ipc/contract';
import { toZoned } from '../../../features/ticketContext/format';
import { useAction } from '../../../state/hooks';
import { t } from '../../../i18n';
import { DraftFields, parseTicket, TICKET_OR_COMMENT, type Fields } from '../drafts/DraftSheets';
import styles from '../drafts/OfflineDrafts.module.css';

export interface NewEntryDialogProps {
  /** The dragged span, in epoch milliseconds. */
  start: number;
  end: number;
  activities: readonly ActivityType[];
  /** Preselected when it is one of `activities` (the saved default activity). */
  defaultActivityId: string | null;
  /** A 7pace write is running elsewhere: the entry cannot be added now. */
  busy: boolean;
  onClose: () => void;
}

/**
 * A new 7pace entry for a span dragged on the week calendar (`timeEditor.create`). It is written
 * at once, journalled, and can be undone from Recent edits; times stay editable before saving.
 */
export function NewEntryDialog({ start: initialStart, end: initialEnd, activities, defaultActivityId, busy, onClose }: NewEntryDialogProps) {
  const create = useAction();
  const [fields, setFields] = useState<Fields>({
    ticket: '',
    comment: '',
    activity: defaultActivityId && activities.some((activity) => activity.id === defaultActivityId) ? defaultActivityId : '',
  });
  const [start, setStart] = useState<ZonedDateTime | null>(() => toZoned(new Date(initialStart).toISOString()));
  const [end, setEnd] = useState<ZonedDateTime | null>(() => toZoned(new Date(initialEnd).toISOString()));
  const [billable, setBillable] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ticket = parseTicket(fields.ticket);
  const latest = zonedNow(getLocalTimeZone());

  const submit = async () => {
    if (ticket.ticketId === null && !fields.comment.trim()) {
      setProblem(t(TICKET_OR_COMMENT));
      return;
    }
    if (!start || !end || end.compare(start) <= 0) {
      setProblem(t('Choose an end after the start.'));
      return;
    }
    setProblem(null);
    const result = await create.run({
      type: 'timeEditor.create',
      start: start.toAbsoluteString(),
      end: end.toAbsoluteString(),
      ticketId: ticket.ticketId,
      comment: fields.comment.trim(),
      activityId: fields.activity || null,
      billable,
    });
    if (result.ok) onClose();
  };

  const error = problem ?? create.error?.message ?? null;
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !create.pending) onClose();
      }}
      title={t('Add time to 7pace')}
      description={t('The entry is saved in 7pace right away. You can undo it from Recent edits.')}
      primaryAction={{
        label: t('Add entry'),
        onAction: () => void submit(),
        isDisabled: !ticket.valid || busy || (activities.length > 0 && !fields.activity),
        isPending: create.pending,
      }}
    >
      <div className={styles.form}>
        <div className={styles.fieldRow}>
          <DatePicker
            label={t('Start')}
            value={start}
            onChange={setStart}
            maxValue={latest}
            granularity="minute"
            hourCycle={24}
            hideTimeZone
            isDisabled={create.pending}
          />
          <DatePicker
            label={t('End')}
            value={end}
            onChange={setEnd}
            maxValue={latest}
            granularity="minute"
            hourCycle={24}
            hideTimeZone
            isDisabled={create.pending}
          />
        </div>
        <DraftFields
          fields={fields}
          activities={activities}
          onChange={setFields}
          isDisabled={create.pending}
          activityDescription={t('The 7pace activity for this entry.')}
        />
        <Switch isSelected={billable} onChange={setBillable} isDisabled={create.pending}>
          {t('Billable time')}
        </Switch>
        {busy ? <Banner tone="info">{t('Another 7pace change is still running. Wait for it to finish.')}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
      </div>
    </Dialog>
  );
}
