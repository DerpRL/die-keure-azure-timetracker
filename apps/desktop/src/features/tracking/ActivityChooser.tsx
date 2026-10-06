import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { CalendarIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import { Switch } from '../../components/Toggles';
import type { ActivityType, DraftView, FlowSlice, ManualTrackingKind } from '../../ipc/contract';
import { ActionError, useIntents, useWriteGuards, type IntentRunner } from './actions';
import { ReturnIcon } from './icons';
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

  const activityOk =
    flow.activityTypes.length === 0 ? draft.allowedActivityIds.length === 0 : ids.includes(activityId);
  const canStart =
    flow.activitiesLoaded &&
    !flow.loadingActivities &&
    !guards.busy &&
    guards.connected &&
    !guards.preview &&
    !draft.requiredActivity &&
    activityOk &&
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
        // Ticket-free starts send what the user typed; suggestions send their default remark.
        comment: draft.manual ? comment.trim() : draft.defaultComment,
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
  /** `sheet` uses the main window's longer 1.14 labels ("Start tracking"). */
  variant: 'panel' | 'sheet';
}

/**
 * Activity chooser (1.14 `ActivityPicker` / `MenuActivityPicker`): what will be tracked, the
 * activity, the optional comment and ticket. Nothing starts until Start is pressed.
 */
export function ActivityChooser({ flow, form, variant }: ActivityChooserProps) {
  const { busy, running } = useWriteGuards();
  const switching = useIntents();
  const { draft, includeTicket } = form;
  const sheet = variant === 'sheet';
  const item = includeTicket ? draft.item : null;
  const title = includeTicket ? draft.title : draft.defaultComment || draft.title;
  const suggestion = flow.selectedSuggestion;
  const startLabel = sheet ? 'Start tracking' : 'Start';
  const resuming = draft.resume || draft.source === 'meetingReturn';

  let activityField: ReactNode;
  if (flow.loadingActivities) {
    activityField = (
      <p role="status" className={styles.caption}>
        {sheet ? 'Loading 7pace activities…' : 'Loading activities…'}
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
            onPress={() => void switching.run('reload', { type: 'connection.retry' })}
          >
            {sheet ? 'Reload activity types' : 'Reload activities'}
          </Button>
        </div>
      </div>
    );
  } else if (flow.activityTypes.length === 0 && flow.activitiesLoaded) {
    activityField = (
      <p className={styles.caption}>
        {sheet
          ? 'No activity types are configured in 7pace. Its workspace default will be used.'
          : '7pace’s workspace default activity will be used.'}
      </p>
    );
  } else if (form.activities.length > 0) {
    activityField = (
      <Select
        label={sheet ? 'Activity type' : 'Activity'}
        placeholder="Choose an activity"
        items={form.activities.map((activity) => ({ id: activity.id, label: activity.name ?? activity.id }))}
        selectedKey={form.activityId || null}
        onSelectionChange={(key) => form.setActivityId(key === null ? '' : String(key))}
        isDisabled={busy}
        description={sheet ? 'This applies to this session. Your saved default stays the same.' : undefined}
      />
    );
  }

  return (
    <div className={styles.flow}>
      <div className={styles.draftSummary}>
        {draft.source === 'meetingReturn' ? (
          <p className={styles.caption}>
            <ReturnIcon className={styles.inlineIcon} /> Return to your previous work
          </p>
        ) : null}
        {suggestion?.kind === 'meeting' ? (
          <p className={styles.caption}>
            <CalendarIcon className={styles.inlineIcon} /> {suggestion.title}
          </p>
        ) : null}
        <p className={styles.ticketNumber}>{item ? `#${item.id} · ${item.type ?? 'Work item'}` : 'No Azure ticket'}</p>
        <p className={styles.draftTitle}>{title}</p>
        {!draft.manual && draft.defaultComment ? <p className={styles.caption}>Comment: {draft.defaultComment}</p> : null}
        {item?.teamProject ? <p className={styles.caption}>{item.teamProject}</p> : null}
      </div>

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
        </div>
      ) : null}

      {draft.requiredActivity ? (
        <p role="alert" className={styles.warning}>
          {draft.requiredActivity}
        </p>
      ) : null}

      {activityField}

      {draft.source === 'figma' ? (
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
        />
      ) : null}

      <p className={styles.caption}>
        {resuming
          ? 'Resume starts a new session. Paused time is not logged.'
          : running
            ? `Your current timer continues until you press ${startLabel}.`
            : `The timer starts when you press ${startLabel}.`}
      </p>
      {busy || form.actions.isPending('start') ? (
        <p role="status" className={styles.caption}>
          {sheet ? 'Starting tracking…' : 'Starting…'}
        </p>
      ) : null}
      <ActionError error={form.actions.error ?? switching.error} />
      {form.actions.confirmation}
      {switching.confirmation}
    </div>
  );
}

/** The label of the chooser's primary button. */
export function startLabel(draft: DraftView, variant: 'panel' | 'sheet'): string {
  const resume = draft.resume || draft.source === 'meetingReturn';
  if (variant === 'sheet') return resume ? 'Resume tracking' : 'Start tracking';
  return resume ? 'Resume' : 'Start';
}
