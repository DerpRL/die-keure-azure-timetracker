import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Heading, type HeadingLevel } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { SearchIcon } from '../../components/icons';
import type { FlowSlice } from '../../ipc/contract';
import { getShortcut } from '../../ipc/shell';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { ActivityChooser, startLabel, useActivityForm } from './ActivityChooser';
import { ManualChoices, QuickTickets, SuggestionWithoutTicket, TicketSearchField } from './TicketSearch';
import styles from './tracking.module.css';

export interface TicketStepProps {
  flow: FlowSlice;
  variant: 'panel' | 'sheet';
  /** Level of the step's own subsection headings. */
  headingLevel: HeadingLevel;
  autoFocus?: boolean;
}

/**
 * Step 1 (1.14 `TicketPicker` / `MenuTicketPicker`): a ticket-free choice, the ticket search and
 * the favourites and recent tickets. Choosing anything only prepares a draft.
 */
export function TicketStep({ flow, variant, headingLevel, autoFocus = false }: TicketStepProps) {
  const { connected } = useWriteGuards();
  const suggestion = flow.selectedSuggestion;
  const showQuick = flow.search.query.trim() === '';
  return (
    <div className={styles.flow}>
      {suggestion ? <SuggestionWithoutTicket flow={flow} /> : <ManualChoices headingLevel={headingLevel} />}
      <TicketSearchField flow={flow} autoFocus={autoFocus} />
      {showQuick ? <QuickTickets flow={flow} headingLevel={headingLevel} /> : null}
      {showQuick && flow.quickTickets.length === 0 ? (
        <EmptyState
          size="compact"
          icon={SearchIcon}
          headingLevel={headingLevel}
          title="One ticket at a time"
          description={
            connected ? 'Enter a ticket number or a few words from its title.' : 'Connect your account in Settings first.'
          }
        />
      ) : null}
      <p className={styles.caption}>
        {variant === 'sheet'
          ? 'Next, choose an activity type and confirm when to start.'
          : 'Next, choose the activity before starting.'}
      </p>
    </div>
  );
}

/** The quick-switch shortcut's label ("⌃⌥T"), when the shell has one registered. */
function useShortcutLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getShortcut().then(
      (status) => {
        if (!cancelled) setLabel(status.label);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return label;
}

/**
 * The tray panel's tracking flow while `flow.surface` is `panel`: the quick switch search, then
 * the activity chooser with Cancel and Start. Cancel sends `tracking.cancelPanel`.
 */
export function PanelTrackingFlow({ flow }: { flow: FlowSlice }) {
  const headingId = useId();
  const { busy } = useWriteGuards();
  const cancel = useIntents();
  const form = useActivityForm(flow, flow.draft);
  const shortcut = useShortcutLabel();
  const draft = flow.draft;

  const cancelButton = (
    <Button
      isDisabled={draft ? busy : false}
      isPending={cancel.isPending()}
      onPress={() => void cancel.run('cancel', { type: 'tracking.cancelPanel' })}
    >
      Cancel
    </Button>
  );

  if (draft && form) {
    return (
      <section aria-labelledby={headingId} className={styles.flow} data-tracking-flow="">
        <Heading level={2} id={headingId} className={styles.flowHeading}>
          Choose an activity
        </Heading>
        <ActivityChooser flow={flow} form={form} variant="panel" />
        <div className={styles.actions}>
          {cancelButton}
          <div className={styles.trailing}>
            <Button
              variant="primary"
              data-prompt-primary=""
              isDisabled={!form.canStart}
              isPending={form.actions.isPending('start')}
              onPress={form.start}
            >
              {startLabel(draft, 'panel')}
            </Button>
          </div>
        </div>
        <ActionError error={cancel.error} />
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className={styles.flow} data-tracking-flow="">
      <div className={styles.flowHeader}>
        <Heading level={2} id={headingId} className={styles.flowHeading}>
          Quick switch
        </Heading>
        {shortcut ? (
          <span className={styles.caption}>
            <span className="visually-hidden">Shortcut </span>
            {shortcut}
          </span>
        ) : null}
      </div>
      {flow.selectedSuggestion ? <p className={styles.caption}>For {flow.selectedSuggestion.title}</p> : null}
      <TicketStep flow={flow} variant="panel" headingLevel={3} autoFocus />
      <div className={styles.actions}>{cancelButton}</div>
      <ActionError error={cancel.error} />
    </section>
  );
}
