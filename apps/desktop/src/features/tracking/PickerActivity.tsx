import { useId, type ReactNode } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { CalendarIcon } from '../../components/icons';
import { Switch } from '../../components/Toggles';
import type { ActivityType, DraftView, FlowSlice } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { ActivitySwatch, activityColorIndex, useActivityColors } from '../activity';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { COMMENT_HINT, COMMENT_PLACEHOLDER, type ActivityForm, type SharedChoice } from './ActivityChooser';
import { ReturnIcon } from './icons';
import { useTrackingSeconds } from './status';
import styles from './ticketPicker.module.css';
import tracking from './tracking.module.css';

/** The activity shown before a draft exists: the user's choice, else the saved default. */
export function activityBeforeDraft(flow: FlowSlice, chosen: string | null): string {
  const ids = flow.activityTypes.map((activity) => activity.id);
  if (chosen !== null && ids.includes(chosen)) return chosen;
  return ids.includes(flow.defaultActivityId) ? flow.defaultActivityId : '';
}

function ActivityRows({
  activities,
  value,
  onChange,
  isDisabled,
}: {
  activities: ActivityType[];
  value: string;
  onChange: (id: string) => void;
  isDisabled: boolean;
}) {
  const colors = useActivityColors();
  const labelId = useId();
  return (
    <div className={styles.section}>
      <span id={labelId} className={styles.sectionLabel}>
        Activity
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        value={value || null}
        onChange={onChange}
        isDisabled={isDisabled}
        className={styles.activities}
      >
        {activities.map((activity) => (
          <Radio key={activity.id} value={activity.id} className={styles.activity}>
            <ActivitySwatch colorIndex={activityColorIndex(colors, activity.id)} className={styles.activityDot} />
            <span className={styles.activityName}>{activity.name ?? activity.id}</span>
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * What pressing the primary button does to the running timer: "Your timer on #4821 stops when
 * you press Track #4790 and is saved as 1h 23m." Its own component, so only it re-renders with
 * the clock.
 */
function StartNote({ draft, label }: { draft: DraftView | null; label: string }) {
  const slice = useSlice('tracking');
  const seconds = useTrackingSeconds(slice);
  let note: string;
  if (draft && (draft.resume || draft.source === 'meetingReturn')) note = 'Resume starts a new session. Paused time is not logged.';
  else if (!slice?.running) note = `The timer starts when you press ${label}.`;
  else {
    const current = slice.ticketId !== null ? `Your timer on #${slice.ticketId}` : 'Your current timer';
    note = `${current} stops when you press ${label} and is saved as ${formatShortDuration(seconds)}.`;
  }
  return <p className={styles.note}>{note}</p>;
}

export interface PickerActivityProps {
  flow: FlowSlice;
  /** The draft's form; `null` before a row is chosen and while a new choice is prepared. */
  form: ActivityForm | null;
  /** The picker's activity and comment, kept across drafts. */
  choice: SharedChoice;
  /** The primary button's label, for the note. */
  label: string;
  /** A new row is being prepared: the engine is busy for it, so nothing greys out meanwhile. */
  switching: boolean;
  /** The chosen row takes a comment (work without a ticket, or nothing chosen yet). */
  commentApplies: boolean;
}

/**
 * The picker's right column (2.2 "15 · Ticket picker"): the activities as rows, the comment and
 * what starting does. It is there from the start, with the saved default activity selected, and
 * stays mounted while the user moves between rows, so switching tickets changes only what the
 * new draft changes. The draft's extras (the ticket switch, a meeting or Figma line, a required
 * activity) appear above the activities when it has them.
 */
export function PickerActivity({ flow, form, choice, label, switching, commentApplies }: PickerActivityProps) {
  const { busy } = useWriteGuards();
  const actions = useIntents();
  const draft = form?.draft ?? null;
  // While a new row is prepared the engine reports busy for it; that is not a reason to lock.
  const locked = busy && !switching;
  const activities = form ? form.activities : flow.activityTypes;
  const activityId = form ? form.activityId : activityBeforeDraft(flow, choice.activityId);
  const trackingComment = draft ? (form!.includeTicket ? draft.commentWithTicket : draft.commentWithoutTicket) : null;

  let activityField: ReactNode;
  if (flow.loadingActivities) {
    activityField = (
      <p role="status" className={styles.placeholder}>
        Loading 7pace activities…
      </p>
    );
  } else if (flow.activityError) {
    activityField = (
      <div className={styles.section}>
        <p role="alert" className={styles.warning}>
          {flow.activityError}
        </p>
        <div className={tracking.row}>
          <Button
            size="small"
            isDisabled={locked}
            isPending={actions.isPending('reload')}
            onPress={() => void actions.run('reload', { type: 'tracking.reloadActivities' })}
          >
            Reload activity types
          </Button>
        </div>
      </div>
    );
  } else if (flow.activityTypes.length === 0 && flow.activitiesLoaded) {
    activityField = (
      <p className={styles.placeholder}>No activity types are configured in 7pace. Its workspace default will be used.</p>
    );
  } else {
    activityField = (
      <ActivityRows
        activities={activities}
        value={activityId}
        onChange={form ? form.setActivityId : choice.setActivityId}
        isDisabled={locked}
      />
    );
  }

  const manual = draft?.manual ?? null;
  let commentHint: string;
  if (manual) commentHint = COMMENT_HINT[manual];
  else if (commentApplies) commentHint = 'Saved with work without a ticket.';
  else commentHint = 'Comments apply only to work without a ticket.';

  return (
    <div className={styles.chooser}>
      {draft?.source === 'meetingReturn' ? (
        <p className={tracking.caption}>
          <ReturnIcon className={tracking.inlineIcon} /> Return to your previous work
        </p>
      ) : null}
      {draft?.meetingTitle ? (
        <p className={tracking.caption}>
          <CalendarIcon className={tracking.inlineIcon} /> {draft.meetingTitle}
        </p>
      ) : null}
      {draft && !form!.includeTicket && draft.item ? <p className={tracking.caption}>No Azure ticket</p> : null}
      {draft && !draft.manual && trackingComment ? <p className={tracking.caption}>Comment: {trackingComment}</p> : null}

      {draft?.allowsNoTicket ? (
        <div className={tracking.stack}>
          {draft.item ? (
            <Switch
              isSelected={form!.includeTicket}
              onChange={form!.setIncludeTicket}
              isDisabled={locked}
              description="Optional. Turn off to track only the activity and comment."
            >
              {`Use Azure ticket #${draft.item.id}`}
            </Switch>
          ) : null}
          {draft.canChooseTicket ? (
            <div className={tracking.row}>
              <Button
                variant="plain"
                size="small"
                isDisabled={locked}
                isPending={actions.isPending('another')}
                onPress={() => void actions.run('another', { type: 'tracking.chooseSuggestionTicket', draftId: draft.id })}
              >
                {draft.item ? 'Choose another ticket…' : 'Choose a ticket instead…'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft?.requiredActivity ? (
        <p role="alert" className={styles.warning}>
          {draft.requiredActivity}
        </p>
      ) : null}

      {activityField}

      {draft?.isFigma ? (
        <div className={tracking.stack}>
          <div className={tracking.row}>
            <Button
              size="small"
              isDisabled={locked}
              isPending={actions.isPending('different')}
              onPress={() => void actions.run('different', { type: 'tracking.chooseDifferentWork' })}
            >
              Choose different work…
            </Button>
          </div>
          <p className={tracking.caption}>The Figma file name is saved as the 7pace comment.</p>
        </div>
      ) : null}

      <TextField
        label="Comment (optional)"
        value={form && manual ? form.comment : (choice.comment ?? '')}
        onChange={choice.setComment}
        placeholder={manual ? COMMENT_PLACEHOLDER[manual] : 'What are you working on?'}
        description={commentHint}
        isDisabled={locked || !commentApplies}
        multiline
        rows={2}
      />

      <StartNote draft={draft} label={label} />
      {form?.actions.isPending('start') ? (
        <p role="status" className={tracking.caption}>
          Starting tracking…
        </p>
      ) : null}
      <ActionError error={form?.actions.error ?? actions.error} />
      {form?.actions.confirmation}
      {actions.confirmation}
    </div>
  );
}
