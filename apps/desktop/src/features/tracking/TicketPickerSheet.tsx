import { useEffect, useRef, useState, type RefObject } from 'react';
import { Dialog } from '../../components/Dialog';
import { KeyboardShortcut } from '../../components/KeyboardShortcut';
import type { KeyCombo } from '../../shortcuts/keys';
import { matchesKeyCombo } from '../../shortcuts/keys';
import { getPlatform } from '../../shortcuts/platform';
import { useSlice } from '../../state/hooks';
import { formatClock } from '../../utils/duration';
import { useTrackingSeconds } from './status';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { startLabel, useActivityForm, type SharedChoice } from './ActivityChooser';
import { PickerActivity } from './PickerActivity';
import { TicketCommands } from './TicketCommands';
import { draftKey, PickerTickets, type PendingChoice } from './TicketPicker';
import { TrackingCommands } from './TrackingCommands';
import styles from './ticketPicker.module.css';

/** ⌘Return / Ctrl+Return starts from anywhere in the picker, as the footer hint says. */
const START_SHORTCUT: KeyCombo = { key: 'Enter', mod: true };

/** A switch that takes longer than this shows the primary button's spinner. */
export const SLOW_SWITCH_MS = 1000;

/**
 * Starts the draft on ⌘Return / Ctrl+Return while focus is anywhere in the picker, also in the
 * search, the list and the comment, which use Return themselves.
 */
function useStartShortcut(anchor: RefObject<HTMLElement | null>, start: (() => void) | undefined, open: boolean) {
  const latest = useRef(start);
  useEffect(() => {
    latest.current = start;
  });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesKeyCombo(event, START_SHORTCUT, getPlatform())) return;
      const dialog = anchor.current?.closest('[role="dialog"]');
      if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [anchor, open]);
}

/** `on`, once it has stayed on for `ms`. */
function useLateFlag(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [on, ms]);
  return on && late;
}

const NO_CHOICE = { activityId: null, comment: null } as const;

/**
 * The main window's ticket picker (2.2 "15 · Ticket picker"), shown while `flow.surface` is
 * `picker`: a centred dialog with the tickets on the left and the activity on the right.
 * Choosing a row prepares the engine's draft; nothing changes in 7pace until the primary button
 * (or ⌘Return) starts it. Focus is trapped inside and returns to the control that opened it.
 * Cancel, × and Escape send `tracking.closePicker`.
 *
 * Moving to another row is one choice for the user but several steps for the engine (let go of
 * the draft, prepare the new one, busy meanwhile). The dialog shows the new row as chosen at
 * once and keeps the activity column, its choice and the buttons as they are until the new
 * draft is in, so only the selection and the button's label change.
 *
 * Also registers the main window's Tracking commands (this component is always mounted there).
 */
export function TicketPickerSheet() {
  const flow = useSlice('flow');
  const { busy } = useWriteGuards();
  const close = useIntents();
  const open = flow?.surface === 'picker';
  const draft = open ? (flow?.draft ?? null) : null;
  const suggestion = flow?.selectedSuggestion ?? null;
  const anchor = useRef<HTMLDivElement>(null);

  // The activity and comment outlive drafts: switching tickets keeps what the user chose.
  const [chosen, setChosen] = useState<{ activityId: string | null; comment: string | null }>(NO_CHOICE);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  // A closed picker starts from scratch next time.
  if (!open && (pending !== null || chosen !== NO_CHOICE)) {
    setPending(null);
    setChosen(NO_CHOICE);
  }
  const choice: SharedChoice = {
    ...chosen,
    setActivityId: (activityId) => setChosen((current) => ({ ...current, activityId })),
    setComment: (comment) => setChosen((current) => ({ ...current, comment })),
  };
  const form = useActivityForm(flow, draft, choice);
  const switching = open && flow !== undefined && pending !== null && draftKey(flow) !== pending.key;
  const slowSwitch = useLateFlag(switching, SLOW_SWITCH_MS);
  const start = switching ? undefined : form?.start;
  useStartShortcut(anchor, start, open);

  const tracking = useSlice('tracking');
  const seconds = useTrackingSeconds(tracking);
  const running = tracking?.running ? tracking : null;
  const replacing = running !== null && running.ticketId !== null;

  // 2.2 "S6 · Ticket picker": while a timer runs, the picker says what is running.
  const title = replacing ? 'Switch ticket' : 'Choose a ticket';
  const unchanged = 'Nothing changes in 7pace until you confirm.';
  const description = suggestion ? (
    `For ${suggestion.title}. ${unchanged}`
  ) : replacing ? (
    <>
      Now tracking <strong>#{running.ticketId}</strong> · {formatClock(seconds)}. {unchanged}
    </>
  ) : (
    `Search Azure tickets by number or title. ${unchanged}`
  );

  let label = 'Start tracking';
  if (switching && pending) label = pending.label;
  else if (draft && form) label = startLabel(draft, 'picker', form.includeTicket);
  const commentApplies = switching && pending ? pending.commentApplies : draft ? draft.manual !== null : true;

  return (
    <>
      <TrackingCommands surface="main" />
      <TicketCommands />
      <Dialog
        isOpen={open}
        onOpenChange={(next) => {
          // While a write runs the picker stays (1.14 `interactiveDismissDisabled(busy)`).
          if (!next && !busy) void close.run('close', { type: 'tracking.closePicker' });
        }}
        title={title}
        description={description}
        size="wide"
        showCloseButton
        bodyClassName={styles.body}
        secondaryActions={
          <span className={styles.hint}>
            <KeyboardShortcut shortcut={START_SHORTCUT} />
            <span>Start tracking</span>
          </span>
        }
        primaryAction={{
          label,
          // While the new row is prepared the button keeps its look; a press then does nothing.
          onAction: () => start?.(),
          isDisabled: switching ? false : !form?.canStart,
          isPending: slowSwitch || (form?.actions.isPending('start') ?? false),
        }}
      >
        {open && flow ? (
          <div ref={anchor} className={styles.columns}>
            <PickerTickets flow={flow} pending={pending} setPending={setPending} switching={switching} />
            <div className={styles.side}>
              <PickerActivity
                flow={flow}
                form={form}
                choice={choice}
                label={label}
                switching={switching}
                commentApplies={commentApplies}
              />
              <ActionError error={close.error} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
