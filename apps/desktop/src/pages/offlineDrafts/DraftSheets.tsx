import { getLocalTimeZone, now as zonedNow, type ZonedDateTime } from '@internationalized/date';
import { useState } from 'react';
import { Banner } from '../../components/Banner';
import { DatePicker } from '../../components/DateFields';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/Fields';
import { Select, type PickerOption } from '../../components/Pickers';
import { Switch } from '../../components/Toggles';
import type { ActivityType, OfflineDraft } from '../../ipc/contract';
import { toZoned } from '../../features/ticketContext/format';
import { useAction } from '../../state/hooks';
import styles from './OfflineDrafts.module.css';

const MAX_TICKET = 2_147_483_647;

/** Empty, or a whole number from 1 to Int32.max (1.14 `validTicket`). */
export function parseTicket(text: string): { valid: boolean; ticketId: number | null } {
  const value = text.trim();
  if (!value) return { valid: true, ticketId: null };
  if (!/^\d+$/.test(value)) return { valid: false, ticketId: null };
  const ticket = Number(value);
  return ticket > 0 && ticket <= MAX_TICKET ? { valid: true, ticketId: ticket } : { valid: false, ticketId: null };
}

const TICKET_OR_COMMENT = 'Choose a ticket or add a comment for ticket-free work.';

function activityItems(activities: readonly ActivityType[], current: string): PickerOption[] {
  const items: PickerOption[] = activities.map((activity) => ({ id: activity.id, label: activity.name ?? activity.id }));
  if (current && !activities.some((activity) => activity.id === current)) items.push({ id: current, label: 'Previously selected activity' });
  return items;
}

interface Fields {
  ticket: string;
  comment: string;
  activity: string;
}

function DraftFields({
  fields,
  activities,
  onChange,
  isDisabled,
}: {
  fields: Fields;
  activities: readonly ActivityType[];
  onChange: (fields: Fields) => void;
  isDisabled: boolean;
}) {
  const ticket = parseTicket(fields.ticket);
  return (
    <>
      <TextField
        label="Azure ticket number (optional)"
        inputMode="numeric"
        value={fields.ticket}
        onChange={(value) => onChange({ ...fields, ticket: value })}
        isInvalid={!ticket.valid}
        errorMessage="Enter a ticket number from 1 to 2147483647, or leave it empty."
        isDisabled={isDisabled}
      />
      <TextField
        label="Comment (required without a ticket)"
        value={fields.comment}
        onChange={(value) => onChange({ ...fields, comment: value })}
        isDisabled={isDisabled}
      />
      <Select
        label="Activity"
        placeholder={activities.length === 0 ? 'Choose after reconnecting' : 'Choose an activity'}
        items={activityItems(activities, fields.activity)}
        selectedKey={fields.activity || null}
        onSelectionChange={(key) => onChange({ ...fields, activity: key === null ? '' : String(key) })}
        description="Activities are cached for this workspace. Reconnect and review to refresh them."
        isDisabled={isDisabled}
      />
    </>
  );
}

/** Drops empty optional keys: the engine reads a missing key as "none". */
function compact(draft: OfflineDraft): OfflineDraft {
  const result: OfflineDraft = { ...draft };
  if (result.end === null || result.end === undefined) delete result.end;
  if (result.ticketId === null || result.ticketId === undefined) delete result.ticketId;
  if (!result.activityId) delete result.activityId;
  if (!result.remoteId) delete result.remoteId;
  return result;
}

export interface DraftEditorProps {
  draft: OfflineDraft;
  activities: readonly ActivityType[];
  working: boolean;
  device: string;
  onClose: () => void;
}

/** Edit a local draft, or add past time (1.14 `OfflineDraftEditor`). Saves with `offline.save`. */
export function DraftEditor({ draft, activities, working, device, onClose }: DraftEditorProps) {
  const save = useAction();
  const running = !draft.end && draft.status === 'Local draft';
  const [fields, setFields] = useState<Fields>({
    ticket: draft.ticketId ? String(draft.ticketId) : '',
    comment: draft.comment,
    activity: draft.activityId ?? '',
  });
  const [start, setStart] = useState<ZonedDateTime | null>(() => toZoned(draft.start));
  const [end, setEnd] = useState<ZonedDateTime | null>(() => toZoned(draft.end));
  const [billable, setBillable] = useState(draft.billable);
  const [problem, setProblem] = useState<string | null>(null);
  const ticket = parseTicket(fields.ticket);
  const latest = zonedNow(getLocalTimeZone());

  const submit = async () => {
    if (ticket.ticketId === null && !fields.comment.trim()) {
      setProblem(TICKET_OR_COMMENT);
      return;
    }
    if (!start || (!running && !end)) {
      setProblem('Enter a start and an end time.');
      return;
    }
    setProblem(null);
    const next = compact({
      ...draft,
      ticketId: ticket.ticketId,
      comment: fields.comment,
      activityId: fields.activity || null,
      start: start.toAbsoluteString(),
      end: running ? null : (end?.toAbsoluteString() ?? null),
      billable,
    });
    const result = await save.run({ type: 'offline.save', draft: next });
    if (result.ok) onClose();
  };

  const error = problem ?? save.error?.message ?? null;
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={running ? 'Local timer' : 'Edit offline time'}
      description={`Saved on ${device} until you review and upload.`}
      presentation="sheet"
      primaryAction={{
        label: running ? 'Save local timer' : 'Save draft',
        onAction: () => void submit(),
        isDisabled: !ticket.valid || working || (activities.length > 0 && !fields.activity),
        isPending: save.pending,
      }}
    >
      <div className={styles.form}>
        <DraftFields fields={fields} activities={activities} onChange={setFields} isDisabled={working} />
        <div className={styles.fieldRow}>
          <DatePicker
            label="Start"
            value={start}
            onChange={setStart}
            maxValue={latest}
            granularity="minute"
            hourCycle={24}
            hideTimeZone
            isDisabled={working}
          />
          {running ? null : (
            <DatePicker
              label="End"
              value={end}
              onChange={setEnd}
              maxValue={latest}
              granularity="minute"
              hourCycle={24}
              hideTimeZone
              isDisabled={working}
            />
          )}
        </div>
        <Switch isSelected={billable} onChange={setBillable} isDisabled={working}>
          Billable time
        </Switch>
        {error ? <Banner tone="error">{error}</Banner> : null}
      </div>
    </Dialog>
  );
}

export interface StartLocalSheetProps {
  activities: readonly ActivityType[];
  initialTicketId: number | null;
  initialActivityId: string | null;
  working: boolean;
  device: string;
  onClose: () => void;
  onStarted: () => void;
}

/** Start the local timer with an optional ticket, a comment and an activity (`offline.startLocal`). */
export function StartLocalSheet({ activities, initialTicketId, initialActivityId, working, device, onClose, onStarted }: StartLocalSheetProps) {
  const start = useAction();
  const [fields, setFields] = useState<Fields>({
    ticket: initialTicketId ? String(initialTicketId) : '',
    comment: '',
    activity: initialActivityId && activities.some((activity) => activity.id === initialActivityId) ? initialActivityId : '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const ticket = parseTicket(fields.ticket);

  const submit = async () => {
    if (ticket.ticketId === null && !fields.comment.trim()) {
      setProblem(TICKET_OR_COMMENT);
      return;
    }
    setProblem(null);
    const result = await start.run({
      type: 'offline.startLocal',
      ticketId: ticket.ticketId,
      comment: fields.comment,
      activityId: fields.activity || null,
    });
    if (result.ok) {
      onStarted();
      onClose();
    }
  };

  const error = problem ?? start.error?.message ?? null;
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Start local timer"
      description={`Saved on ${device} until you review and upload. This does not change the 7pace timer.`}
      presentation="sheet"
      primaryAction={{
        label: 'Start local timer',
        onAction: () => void submit(),
        isDisabled: !ticket.valid || working || (activities.length > 0 && !fields.activity),
        isPending: start.pending,
      }}
    >
      <div className={styles.form}>
        <DraftFields fields={fields} activities={activities} onChange={setFields} isDisabled={working} />
        {error ? <Banner tone="error">{error}</Banner> : null}
      </div>
    </Dialog>
  );
}
