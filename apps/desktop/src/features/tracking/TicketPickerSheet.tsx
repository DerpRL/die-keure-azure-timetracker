import { useEffect, useRef, type RefObject } from 'react';
import { Dialog } from '../../components/Dialog';
import { KeyboardShortcut } from '../../components/KeyboardShortcut';
import type { KeyCombo } from '../../shortcuts/keys';
import { matchesKeyCombo } from '../../shortcuts/keys';
import { getPlatform } from '../../shortcuts/platform';
import { useSlice } from '../../state/hooks';
import { formatClock } from '../../utils/duration';
import { useTrackingSeconds } from './status';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { ActivityChooser, startLabel, useActivityForm, type ActivityForm } from './ActivityChooser';
import { TicketCommands } from './TicketCommands';
import { PickerTickets } from './TicketPicker';
import { TrackingCommands } from './TrackingCommands';
import styles from './ticketPicker.module.css';

/** ⌘Return / Ctrl+Return starts from anywhere in the picker, as the footer hint says. */
const START_SHORTCUT: KeyCombo = { key: 'Enter', mod: true };

/**
 * Starts the draft on ⌘Return / Ctrl+Return while focus is anywhere in the picker, also in the
 * search, the list and the comment, which use Return themselves.
 */
function useStartShortcut(anchor: RefObject<HTMLElement | null>, form: ActivityForm | null, open: boolean) {
  const start = useRef(form?.start);
  useEffect(() => {
    start.current = form?.start;
  });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesKeyCombo(event, START_SHORTCUT, getPlatform())) return;
      const dialog = anchor.current?.closest('[role="dialog"]');
      if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      start.current?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [anchor, open]);
}

/**
 * The main window's ticket picker (2.2 "15 · Ticket picker"), shown while `flow.surface` is
 * `picker`: a centred dialog with the tickets on the left and the chosen draft's activity on the
 * right. Choosing a row prepares the engine's draft; nothing changes in 7pace until the primary
 * button (or ⌘Return) starts it. Focus is trapped inside and returns to the control that opened
 * it. Cancel, × and Escape send `tracking.closePicker`.
 *
 * Also registers the main window's Tracking commands (this component is always mounted there).
 */
export function TicketPickerSheet() {
  const flow = useSlice('flow');
  const { busy } = useWriteGuards();
  const close = useIntents();
  const open = flow?.surface === 'picker';
  const draft = open ? (flow?.draft ?? null) : null;
  const form = useActivityForm(flow, draft);
  const suggestion = flow?.selectedSuggestion ?? null;
  const anchor = useRef<HTMLDivElement>(null);
  useStartShortcut(anchor, form, open);

  const tracking = useSlice('tracking');
  const seconds = useTrackingSeconds(tracking);
  const running = tracking?.running ? tracking : null;
  const switching = running !== null && running.ticketId !== null;

  // 2.2 "S6 · Ticket picker": while a timer runs, the picker says what is running.
  const title = switching ? 'Switch ticket' : 'Choose a ticket';
  const unchanged = 'Nothing changes in 7pace until you confirm.';
  const description = suggestion ? (
    `For ${suggestion.title}. ${unchanged}`
  ) : switching ? (
    <>
      Now tracking <strong>#{running.ticketId}</strong> · {formatClock(seconds)}. {unchanged}
    </>
  ) : (
    `Search Azure tickets by number or title. ${unchanged}`
  );

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
          label: draft && form ? startLabel(draft, 'picker', form.includeTicket) : 'Start tracking',
          onAction: () => form?.start(),
          isDisabled: !form?.canStart,
          isPending: form?.actions.isPending('start') ?? false,
        }}
      >
        {open && flow ? (
          <div ref={anchor} className={styles.columns}>
            <PickerTickets flow={flow} />
            <div className={styles.side}>
              {draft && form ? (
                <ActivityChooser flow={flow} form={form} variant="picker" />
              ) : (
                <p className={styles.placeholder}>Choose a ticket, or work without one, to pick its activity.</p>
              )}
              <ActionError error={close.error} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
