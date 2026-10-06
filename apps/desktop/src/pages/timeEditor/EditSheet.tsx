import type { ZonedDateTime } from '@internationalized/date';
import { useState, type ReactNode } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { Dialog } from '../../components/Dialog';
import { TextField } from '../../components/Fields';
import { SuccessIcon } from '../../components/icons';
import { Select, type PickerOption } from '../../components/Pickers';
import { ProgressBar } from '../../components/Progress';
import { SegmentedControl } from '../../components/Segmented';
import type { ActivityType, Interval, TimeEditMode, TimeEditorSlice, WorkLog, WorkItemsSlice } from '../../ipc/contract';
import { useEngineDraft } from '../../features/ticketContext/drafts';
import { formatDateTime, logStart, parseInstant, timeEditorTitle, toZoned } from '../../features/ticketContext/format';
import { useAction } from '../../state/hooks';
import { CONFIRM_TITLES, MODE_TITLES, SAVE_LABELS } from './labels';
import { CorrectionPlanPreview, OverlapNotice, PlanResult } from './PlanPreview';
import styles from './TimeEditor.module.css';

/** Select keys cannot be empty: this one stands for "no activity" (`""` on the wire). */
const DEFAULT_ACTIVITY = '__default__';

function activityOptions(activities: readonly ActivityType[], original: ActivityType | null | undefined, defaultLabel: string): PickerOption[] {
  const options: PickerOption[] = [{ id: DEFAULT_ACTIVITY, label: defaultLabel }];
  if (original?.id && !activities.some((activity) => activity.id === original.id)) {
    options.push({ id: original.id, label: original.name ?? 'Original activity' });
  }
  for (const activity of activities) options.push({ id: activity.id, label: activity.name ?? 'Activity' });
  return options;
}

const absolute = (value: ZonedDateTime | null) => (value ? value.toAbsoluteString() : null);

interface SecondEntry {
  at: string;
  ticket: string;
  comment: string;
  activityId: string;
}

/** Start and End of the entry, with dates so an edit can cross midnight. */
function EditTimes({
  start,
  end,
  isDisabled,
  onChange,
}: {
  start: string | null;
  end: string | null;
  isDisabled: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const [startValue, setStartValue] = useState(() => toZoned(start));
  const [endValue, setEndValue] = useState(() => toZoned(end));
  const send = (nextStart: ZonedDateTime | null, nextEnd: ZonedDateTime | null) => {
    const a = absolute(nextStart);
    const b = absolute(nextEnd);
    if (a && b) onChange(a, b);
  };
  return (
    <div className={styles.fieldRow}>
      <DatePicker
        label="Start"
        value={startValue}
        onChange={(value) => {
          setStartValue(value);
          send(value, endValue);
        }}
        granularity="minute"
        hourCycle={24}
        hideTimeZone
        isDisabled={isDisabled}
      />
      <DatePicker
        label="End"
        value={endValue}
        onChange={(value) => {
          setEndValue(value);
          send(startValue, value);
        }}
        granularity="minute"
        hourCycle={24}
        hideTimeZone
        isDisabled={isDisabled}
      />
    </div>
  );
}

/** The second entry of a split, or the separate idle entry of a guided correction. */
function SecondEntryFields({
  initial,
  original,
  activities,
  isDisabled,
  labels,
  showSplitAt,
  intro,
  onChange,
}: {
  initial: SecondEntry;
  original: ActivityType | null | undefined;
  activities: readonly ActivityType[];
  isDisabled: boolean;
  labels: { ticket: string; ticketPlaceholder?: string; comment: string; commentPlaceholder?: string; defaultActivity: string };
  showSplitAt: boolean;
  /** Shown between "Split at" and the second entry's fields. */
  intro?: ReactNode;
  onChange: (entry: SecondEntry) => void;
}) {
  const [entry, setEntry] = useState(initial);
  const [at, setAt] = useState(() => toZoned(initial.at));
  const update = (patch: Partial<SecondEntry>) => {
    const next = { ...entry, ...patch };
    setEntry(next);
    onChange(next);
  };
  return (
    <>
      {showSplitAt ? (
        <DatePicker
          label="Split at"
          value={at}
          onChange={(value) => {
            setAt(value);
            const instant = absolute(value);
            if (instant) update({ at: instant });
          }}
          granularity="minute"
          hourCycle={24}
          hideTimeZone
          isDisabled={isDisabled}
        />
      ) : null}
      {intro}
      <TextField
        label={labels.ticket}
        placeholder={labels.ticketPlaceholder}
        inputMode="numeric"
        value={entry.ticket}
        onChange={(ticket) => update({ ticket })}
        isDisabled={isDisabled}
      />
      <TextField
        label={labels.comment}
        placeholder={labels.commentPlaceholder}
        value={entry.comment}
        onChange={(comment) => update({ comment })}
        isDisabled={isDisabled}
      />
      <Select
        label="Activity"
        items={activityOptions(activities, original, labels.defaultActivity)}
        selectedKey={entry.activityId || DEFAULT_ACTIVITY}
        onSelectionChange={(key) => update({ activityId: key === DEFAULT_ACTIVITY || key === null ? '' : String(key) })}
        isDisabled={isDisabled}
      />
    </>
  );
}

function IdleSection({
  interval,
  editor,
  activities,
  isDisabled,
}: {
  interval: Interval;
  editor: TimeEditorSlice & { selected: WorkLog };
  activities: readonly ActivityType[];
  isDisabled: boolean;
}) {
  const separateAction = useAction();
  const split = useAction();
  const [separate, setSeparate] = useEngineDraft(editor.separateIdle);
  return (
    <div className={styles.group}>
      <div>
        <Heading level={3} className={styles.groupTitle}>
          Idle interval
        </Heading>
        <p className={styles.caption}>{`${formatDateTime(parseInstant(interval.start))} → ${formatDateTime(parseInstant(interval.end))}`}</p>
      </div>
      <SegmentedControl
        label="How to handle idle time"
        options={[
          { id: 'remove', label: 'Remove idle time' },
          { id: 'separate', label: 'Separate into its own entry' },
        ]}
        selectedKey={separate ? 'separate' : 'remove'}
        onSelectionChange={(key) => {
          const next = key === 'separate';
          setSeparate(next);
          void separateAction.run({ type: 'timeEditor.setSeparateIdle', separate: next });
        }}
        isDisabled={isDisabled}
      />
      <p className={styles.caption}>Work before and after the interval stays recorded. The timer is paused; resume it when you are ready.</p>
      {separate ? (
        <SecondEntryFields
          initial={{
            at: editor.splitAt ?? interval.start,
            ticket: editor.secondTicket,
            comment: editor.secondComment,
            activityId: editor.secondActivity,
          }}
          original={editor.selected.activityType}
          activities={activities}
          isDisabled={isDisabled}
          showSplitAt={false}
          labels={{
            ticket: 'Ticket number (optional)',
            comment: 'Comment for the separate entry',
            defaultActivity: '7pace default',
          }}
          onChange={({ ticket, comment, activityId }) =>
            void split.run({ type: 'timeEditor.setSecondEntry', ticket, comment, activityId })
          }
        />
      ) : null}
    </div>
  );
}

export interface EditSheetProps {
  editor: TimeEditorSlice & { selected: WorkLog };
  items: WorkItemsSlice | undefined;
  activities: readonly ActivityType[];
  busy: boolean;
  preview: boolean;
}

/**
 * The edit sheet (1.14 `editSheet`): guided correction, edit time, split, merge or undo for the
 * selected entry, with the plan preview, the validation issue and the overlap review. Saving asks
 * for an explicit confirmation before `timeEditor.save`.
 */
export function EditSheet({ editor, items, activities, busy, preview }: EditSheetProps) {
  const cancel = useAction();
  const mode = useAction();
  const times = useAction();
  const split = useAction();
  const check = useAction();
  const save = useAction();
  const reload = useAction();
  const [confirming, setConfirming] = useState(false);
  const [operation, setOperation] = useEngineDraft<TimeEditMode>(editor.mode);

  const log = editor.selected;
  const locked = editor.working || busy || editor.needsReload;
  const saveDisabled =
    preview || busy || editor.working || editor.needsReload || editor.requiresReview || !!editor.journalIssue || !!editor.validationIssue || !editor.plan;
  const issue = editor.issue ?? save.error?.message ?? check.error?.message ?? null;
  const formKey = `${log.id}:${log.timestamp}:${log.length}`;
  const start = logStart(log);

  const close = () => {
    if (editor.working || busy) return;
    void cancel.run({ type: 'timeEditor.cancel' });
  };

  const confirmSave = async () => {
    await save.run({ type: 'timeEditor.save' });
    setConfirming(false);
  };

  return (
    <>
      <Dialog
        isOpen
        onOpenChange={() => {}}
        onCancel={close}
        title={`${MODE_TITLES[editor.mode]} · recorded time`}
        description={timeEditorTitle(log, items)}
        presentation="sheet"
        size="large"
        cancelLabel={null}
        primaryAction={{ label: SAVE_LABELS[editor.mode], onAction: () => setConfirming(true), isDisabled: saveDisabled }}
        secondaryActions={
          <>
            <Button onPress={close} isDisabled={editor.working || busy}>
              Cancel edit
            </Button>
            {editor.needsReload ? (
              <Button
                isPending={reload.pending}
                isDisabled={editor.working || busy}
                onPress={() => void reload.run({ type: 'timeEditor.select', logId: log.id })}
              >
                Reload entry
              </Button>
            ) : null}
            <Button
              isPending={check.pending}
              isDisabled={busy || editor.working || editor.needsReload || !!editor.validationIssue}
              onPress={() => void check.run({ type: 'timeEditor.checkOverlaps' })}
            >
              Check overlaps
            </Button>
          </>
        }
      >
        <div className={styles.sheetBody}>
          {editor.mode === 'edit' || editor.mode === 'split' ? (
            <SegmentedControl
              label="Operation"
              options={[
                { id: 'edit', label: 'Edit time' },
                { id: 'split', label: 'Split entry' },
              ]}
              selectedKey={operation === 'split' ? 'split' : 'edit'}
              onSelectionChange={(key) => {
                setOperation(key);
                void mode.run({ type: 'timeEditor.setMode', mode: key });
              }}
              isDisabled={locked}
            />
          ) : null}

          {editor.mode === 'guided' && editor.idleInterval ? (
            <IdleSection key={formKey} interval={editor.idleInterval} editor={editor} activities={activities} isDisabled={locked} />
          ) : null}

          {editor.mode === 'edit' ? (
            <EditTimes
              key={formKey}
              start={editor.start ?? start?.toISOString() ?? null}
              end={editor.end}
              isDisabled={locked}
              onChange={(nextStart, nextEnd) => void times.run({ type: 'timeEditor.setTimes', start: nextStart, end: nextEnd })}
            />
          ) : null}

          {editor.mode === 'split' ? (
            <div className={styles.group}>
              <SecondEntryFields
                key={formKey}
                initial={{
                  at: editor.splitAt ?? start?.toISOString() ?? log.timestamp,
                  ticket: editor.secondTicket,
                  comment: editor.secondComment,
                  activityId: editor.secondActivity,
                }}
                original={log.activityType}
                activities={activities}
                isDisabled={locked}
                showSplitAt
                labels={{
                  ticket: 'Ticket',
                  ticketPlaceholder: 'Azure ticket number (optional)',
                  comment: 'Comment',
                  defaultActivity: 'Default activity',
                }}
                intro={
                  <div>
                    <Heading level={3} className={styles.groupTitle}>
                      Second entry
                    </Heading>
                    <p className={styles.caption}>The first part keeps its original ticket and activity.</p>
                  </div>
                }
                onChange={(entry) => void split.run({ type: 'timeEditor.setSplit', ...entry })}
              />
            </div>
          ) : null}

          {editor.plan ? (
            <>
              {editor.mode === 'guided' ? <CorrectionPlanPreview plan={editor.plan} /> : null}
              <PlanResult plan={editor.plan}>
                {editor.mode === 'merge' ? (
                  <p className={styles.caption}>
                    The first entry is extended and the other selected entries are removed. Total recorded and billable time stay the
                    same.
                  </p>
                ) : null}
                {editor.mode === 'undo' ? (
                  <p className={styles.caption}>
                    Restores the previous values after checking for newer changes. Removed entries are recreated with new IDs; their
                    original server audit timestamps cannot be restored.
                  </p>
                ) : null}
              </PlanResult>
            </>
          ) : null}

          <div role="status" className={styles.reviewArea}>
            {editor.validationIssue ? (
              <Banner tone="warning" live="off">
                {editor.validationIssue}
              </Banner>
            ) : editor.review ? (
              editor.review.conflicts.length === 0 && !editor.review.overlapIssue ? (
                <p className={styles.success}>
                  <SuccessIcon className={styles.successIcon} />
                  No overlapping entries found
                </p>
              ) : (
                <OverlapNotice conflicts={editor.review.conflicts} issue={editor.review.overlapIssue} />
              )
            ) : editor.loadedConflicts.length > 0 ? (
              <OverlapNotice conflicts={editor.loadedConflicts} issue={null} />
            ) : null}
          </div>

          <p className={styles.caption}>
            Overlaps are checked again when saving. Check overlaps is optional and also includes entries from other dates.
          </p>
          {editor.requiresReview ? (
            <Banner tone="warning" live="off">
              An earlier change needs review. Open Recent edits before making another change.
            </Banner>
          ) : null}
          {editor.journalIssue ? (
            <Banner tone="warning" live="off">
              {editor.journalIssue}
            </Banner>
          ) : null}
          {issue ? <Banner tone="error">{issue}</Banner> : null}
          {editor.working || busy ? <ProgressBar label="Checking 7pace…" isIndeterminate /> : null}
        </div>
      </Dialog>

      <Dialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        role="alertdialog"
        size="small"
        title={CONFIRM_TITLES[editor.mode]}
        description="The entries are read from 7pace again first, and nothing is written if they changed on the server. You can undo the result from Recent edits."
        cancelLabel="Keep editing"
        primaryAction={{
          label: SAVE_LABELS[editor.mode],
          onAction: () => void confirmSave(),
          isPending: save.pending,
          isDisabled: saveDisabled,
        }}
      />
    </>
  );
}
