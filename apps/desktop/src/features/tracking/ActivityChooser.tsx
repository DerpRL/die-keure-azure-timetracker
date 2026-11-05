import { useId, useState, type ReactNode } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { CalendarIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import { Switch } from '../../components/Toggles';
import type { ActivityType, DraftView, FlowSlice, ManualTrackingKind } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { ActivitySwatch, activityColorIndex, useActivityColors } from '../activity';
import { ActionError, useIntents, useWriteGuards, type IntentRunner } from './actions';
import { ReturnIcon } from './icons';
import { useTrackingSeconds } from './status';
import picker from './ticketPicker.module.css';
import styles from './tracking.module.css';

interface FormState {
  draftId: string | null;
  /** `null` until the user picks one: the draft's preferred activity applies. */
  activityId: string | null;
  /** `null` until the user types: the draft's default comment applies. */
  comment: string | null;
  includeTicket: boolean;
}

const pristine = (draftId: string | null): FormState => ({ draftId, activityId: null, comment: null, includeTicket: true });

/** The activities this draft may start with (empty `allowedActivityIds` means any). */
export function allowedActivities(flow: FlowSlice, draft: DraftView): ActivityType[] {
  if (draft.allowedActivityIds.length === 0) return flow.activityTypes;
  return flow.activityTypes.filter((activity) => draft.allowedActivityIds.includes(activity.id));
}

export interface ActivityForm {
  draft: DraftView;
  activities: ActivityType[];
  activityId: string;
  setActivityId: (id: string) => void;
  comment: string;
  setComment: (comment: string) => void;
  includeTicket: boolean;
  setIncludeTicket: (include: boolean) => void;
  canStart: boolean;
  /** Sends `tracking.start` once, for this draft. Only ever called from a pressed button. */
  start: () => void;
  actions: IntentRunner;
}

/**
 * The chooser's form draft: the selected activity, the comment and "Use Azure ticket". Starts
 * from the draft's preferred activity and default comment, and resets for a new draft.
 */
export function useActivityForm(flow: FlowSlice | undefined, draft: DraftView | null): ActivityForm | null {
  const guards = useWriteGuards();
  const actions = useIntents();
  const [state, setState] = useState<FormState>(() => pristine(draft?.id ?? null));
  if (!flow || !draft) return null;
  // A different draft starts from its own defaults (no copy of engine state survives it).
  const current = state.draftId === draft.id ? state : pristine(draft.id);
  const activities = allowedActivities(flow, draft);
  const ids = activities.map((activity) => activity.id);
  const chosen = current.activityId ?? draft.preferredActivityId;
  // As in 1.14: a choice that is no longer offered falls back to the preferred one, then to none.
  const activityId = ids.includes(chosen) ? chosen : ids.includes(draft.preferredActivityId) ? draft.preferredActivityId : '';
  const comment = current.comment ?? draft.defaultComment;
  const includeTicket = draft.allowsNoTicket ? current.includeTicket : true;

  // The engine decides what may start (Swift `canStart`); the local guards only cover the time
  // until its next slice.
  const canStart =
    draft.startableActivityIds.includes(activityId) &&
    !guards.busy &&
    guards.connected &&
    !guards.preview &&
    !actions.isPending();

  return {
    draft,
    activities,
    activityId,
    setActivityId: (id) => setState({ ...current, activityId: id }),
    comment,
    setComment: (text) => setState({ ...current, comment: text }),
    includeTicket,
    setIncludeTicket: (include) => setState({ ...current, includeTicket: include }),
    canStart,
    start: () => {
      // A double click or a second Return must never send a second start.
      if (!canStart || actions.inFlight()) return;
      void actions.run('start', {
        type: 'tracking.start',
        draftId: draft.id,
        activityId,
        // Ticket-free starts send what the user typed; the engine adds a suggestion's own remark.
        comment: draft.manual ? comment.trim() : '',
        includeTicket,
      });
    },
    actions,
  };
}

const COMMENT_PLACEHOLDER: Record<ManualTrackingKind, string> = {
  standup: 'daily standup',
  meeting: 'Meeting',
  activity: 'Defaults to the activity name',
};

const COMMENT_HINT: Record<ManualTrackingKind, string> = {
  standup: 'Leave blank to use daily standup.',
  meeting: 'Leave blank to use the meeting or activity name.',
  activity: 'Leave blank to use the meeting or activity name.',
};

export interface ActivityChooserProps {
  flow: FlowSlice;
  form: ActivityForm;
  /**
   * `picker` is the main window's ticket picker column: the longer 1.14 labels ("Start
   * tracking"), the activities as a list of rows, and no summary (the ticket list shows the
   * choice).
   */
  variant: 'panel' | 'picker';
}

/** The picker's activities as rows with their colour (2.2 "15 · Ticket picker"). */
function ActivityRows({ form, isDisabled }: { form: ActivityForm; isDisabled: boolean }) {
  const colors = useActivityColors();
  const labelId = useId();
  return (
    <div className={picker.section}>
      <span id={labelId} className={picker.sectionLabel}>
        Activity
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        value={form.activityId || null}
        onChange={form.setActivityId}
        isDisabled={isDisabled}
        className={picker.activities}
      >
        {form.activities.map((activity) => (
          <Radio key={activity.id} value={activity.id} className={picker.activity}>
            <ActivitySwatch colorIndex={activityColorIndex(colors, activity.id)} className={picker.activityDot} />
            <span className={picker.activityName}>{activity.name ?? activity.id}</span>
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * What pressing the picker's primary button does to the running timer: "Your timer on #4821
 * stops when you press Track #4790 and is saved as 1h 23m." Its own component, so only the
 * picker re-renders with the clock.
 */
function StartNote({ draft, label }: { draft: DraftView; label: string }) {
  const tracking = useSlice('tracking');
  const seconds = useTrackingSeconds(tracking);
  let note: string;
  if (draft.resume || draft.source === 'meetingReturn') note = 'Resume starts a new session. Paused time is not logged.';
  else if (!tracking?.running) note = `The timer starts when you press ${label}.`;
  else {
    const current = tracking.ticketId !== null ? `Your timer on #${tracking.ticketId}` : 'Your current timer';
    note = `${current} stops when you press ${label} and is saved as ${formatShortDuration(seconds)}.`;
  }
  return <p className={picker.note}>{note}</p>;
}

/**
 * Activity chooser (1.14 `ActivityPicker` / `MenuActivityPicker`): what will be tracked, the
 * activity, the optional comment and ticket. Nothing starts until Start is pressed.
 */
export function ActivityChooser({ flow, form, variant }: ActivityChooserProps) {
  const { busy, running } = useWriteGuards();
  const switching = useIntents();
  const { draft, includeTicket } = form;
  const inPicker = variant === 'picker';
  const item = includeTicket ? draft.item : null;
  const title = includeTicket ? draft.title : (draft.remark ?? draft.title);
  const trackingComment = includeTicket ? draft.commentWithTicket : draft.commentWithoutTicket;
  const buttonLabel = startLabel(draft, variant, includeTicket);
  const resuming = draft.resume || draft.source === 'meetingReturn';

  let activityField: ReactNode;
  if (flow.loadingActivities) {
    activityField = (
      <p role="status" className={styles.caption}>
        {inPicker ? 'Loading 7pace activities…' : 'Loading activities…'}
      </p>
    );
  } else if (flow.activityError) {
    activityField = (
      <div className={styles.stack}>
        <p role="alert" className={styles.warning}>
          {flow.activityError}
        </p>
        <div className={styles.row}>
          <Button
            size="small"
            isDisabled={busy}
            isPending={switching.isPending('reload')}
            onPress={() => void switching.run('reload', { type: 'tracking.reloadActivities' })}
          >
            {inPicker ? 'Reload activity types' : 'Reload activities'}
          </Button>
        </div>
      </div>
    );
  } else if (flow.activityTypes.length === 0 && flow.activitiesLoaded) {
    activityField = (
      <p className={styles.caption}>
        {inPicker
          ? 'No activity types are configured in 7pace. Its workspace default will be used.'
          : '7pace’s workspace default activity will be used.'}
      </p>
    );
  } else if (form.activities.length > 0 && inPicker) {
    activityField = <ActivityRows form={form} isDisabled={busy} />;
  } else if (form.activities.length > 0) {
    activityField = (
      <Select
        label="Activity"
        placeholder="Choose an activity"
        items={form.activities.map((activity) => ({ id: activity.id, label: activity.name ?? activity.id }))}
        selectedKey={form.activityId || null}
        onSelectionChange={(key) => form.setActivityId(key === null ? '' : String(key))}
        isDisabled={busy}
      />
    );
  }

  const context = (
    <>
      {draft.source === 'meetingReturn' ? (
        <p className={styles.caption}>
          <ReturnIcon className={styles.inlineIcon} /> Return to your previous work
        </p>
      ) : null}
      {draft.meetingTitle ? (
        <p className={styles.caption}>
          <CalendarIcon className={styles.inlineIcon} /> {draft.meetingTitle}
        </p>
      ) : null}
    </>
  );

  return (
    <div className={inPicker ? picker.chooser : styles.flow}>
      {inPicker ? (
        // The ticket list shows what was chosen; only what it cannot show is repeated here.
        <>
          {context}
          {!includeTicket && draft.item ? <p className={styles.caption}>No Azure ticket</p> : null}
          {!draft.manual && trackingComment ? <p className={styles.caption}>Comment: {trackingComment}</p> : null}
        </>
      ) : (
        <div className={styles.draftSummary}>
          {context}
          <p className={styles.ticketNumber}>{item ? `#${item.id} · ${item.type ?? 'Work item'}` : 'No Azure ticket'}</p>
          <p className={styles.draftTitle}>{title}</p>
          {!draft.manual && trackingComment ? <p className={styles.caption}>Comment: {trackingComment}</p> : null}
          {item?.teamProject ? <p className={styles.caption}>{item.teamProject}</p> : null}
        </div>
      )}

      {draft.allowsNoTicket ? (
        <div className={styles.stack}>
          {draft.item ? (
            <Switch
              isSelected={includeTicket}
              onChange={form.setIncludeTicket}
              isDisabled={busy}
              description="Optional. Turn off to track only the activity and comment."
            >
              {`Use Azure ticket #${draft.item.id}`}
            </Switch>
          ) : null}
          {draft.canChooseTicket ? (
            <div className={styles.row}>
              <Button
                variant="plain"
                size="small"
                isDisabled={busy}
                isPending={switching.isPending('another')}
                onPress={() => void switching.run('another', { type: 'tracking.chooseSuggestionTicket', draftId: draft.id })}
              >
                {draft.item ? 'Choose another ticket…' : 'Choose a ticket instead…'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.requiredActivity ? (
        <p role="alert" className={styles.warning}>
          {draft.requiredActivity}
        </p>
      ) : null}

      {activityField}

      {draft.isFigma ? (
        <div className={styles.stack}>
          <div className={styles.row}>
            <Button
              size="small"
              isDisabled={busy}
              isPending={switching.isPending('different')}
              onPress={() => void switching.run('different', { type: 'tracking.chooseDifferentWork' })}
            >
              Choose different work…
            </Button>
          </div>
          <p className={styles.caption}>The Figma file name is saved as the 7pace comment.</p>
        </div>
      ) : null}

      {draft.manual ? (
        <TextField
          label="Comment (optional)"
          value={form.comment}
          onChange={form.setComment}
          placeholder={COMMENT_PLACEHOLDER[draft.manual]}
          description={COMMENT_HINT[draft.manual]}
          isDisabled={busy}
          multiline={inPicker}
          rows={2}
        />
      ) : null}

      {inPicker ? (
        <StartNote draft={draft} label={buttonLabel} />
      ) : (
        <p className={styles.caption}>
          {resuming
            ? 'Resume starts a new session. Paused time is not logged.'
            : running
              ? `Your current timer continues until you press ${buttonLabel}.`
              : `The timer starts when you press ${buttonLabel}.`}
        </p>
      )}
      {busy || form.actions.isPending('start') ? (
        <p role="status" className={styles.caption}>
          {inPicker ? 'Starting tracking…' : 'Starting…'}
        </p>
      ) : null}
      <ActionError error={form.actions.error ?? switching.error} />
      {form.actions.confirmation}
      {switching.confirmation}
    </div>
  );
}

/**
 * The label of the chooser's primary button. The picker names the ticket it will track
 * ("Track #4790"), as in the 2.2 design.
 */
export function startLabel(draft: DraftView, variant: 'panel' | 'picker', includeTicket = true): string {
  const resume = draft.resume || draft.source === 'meetingReturn';
  if (variant === 'picker') {
    if (resume) return 'Resume tracking';
    return includeTicket && draft.item ? `Track #${draft.item.id}` : 'Start tracking';
  }
  return resume ? 'Resume' : 'Start';
}
