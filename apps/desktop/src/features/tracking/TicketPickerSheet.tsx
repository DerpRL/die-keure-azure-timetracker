import { Dialog } from '../../components/Dialog';
import { useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { useTrackingSeconds } from './status';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { ActivityChooser, startLabel, useActivityForm } from './ActivityChooser';
import { TicketCommands } from './TicketCommands';
import { TrackingCommands } from './TrackingCommands';
import { TicketStep } from './TrackingFlow';

/**
 * The main window's ticket picker and activity chooser (1.14 `TicketPicker` / `ActivityPicker`
 * sheet), shown while `flow.surface` is `picker`. Focus is trapped inside and returns to the
 * control that opened it. Cancel and Escape send `tracking.closePicker`; Return starts only from
 * the activity step, as the default button did in 1.14.
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

  const tracking = useSlice('tracking');
  const seconds = useTrackingSeconds(tracking);
  const running = tracking?.running ? tracking : null;
  const switching = running && running.ticketId !== null;

  // 2.2 "S6 · Ticket picker": while a timer runs, the picker says what starting will stop.
  const title = draft ? 'Choose an activity' : switching ? 'Switch ticket' : 'Choose a ticket';
  const description = draft
    ? 'Review the activity before starting this session.'
    : suggestion
      ? `For ${suggestion.title}`
      : switching
        ? `Stops #${running.ticketId} at ${formatShortDuration(seconds)} and starts the new one`
        : 'Search Azure tickets by number or title.';

  return (
    <>
      <TrackingCommands surface="main" />
      <TicketCommands />
      <Dialog
        isOpen={open}
        onOpenChange={(next) => {
          // While a write runs the sheet stays (1.14 `interactiveDismissDisabled(busy)`).
          if (!next && !busy) void close.run('close', { type: 'tracking.closePicker' });
        }}
        title={title}
        description={description}
        presentation="drawer"
        showCloseButton
        primaryAction={
          draft && form
            ? {
                label: startLabel(draft, 'sheet'),
                onAction: form.start,
                isDisabled: !form.canStart,
                isPending: form.actions.isPending('start'),
              }
            : undefined
        }
      >
        {open && flow ? (
          <>
            {draft && form ? (
              <ActivityChooser flow={flow} form={form} variant="sheet" />
            ) : (
              <TicketStep flow={flow} variant="sheet" headingLevel={3} autoFocus />
            )}
            <ActionError error={close.error} />
          </>
        ) : null}
      </Dialog>
    </>
  );
}
