import { useEffect, useId, useRef, useState } from 'react';
import type { Key } from 'react-aria-components';
import { Button, IconButton } from '../../components/Button';
import { Heading, type HeadingLevel } from '../../components/Card';
import { ComboBox, PickerItem } from '../../components/Pickers';
import type { FlowSlice, ManualTrackingKind, QuickTicketView, WorkItem } from '../../ipc/contract';
import { useAction, useWorkItem } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { StarIcon } from './icons';
import styles from './tracking.module.css';

/** Wait this long after the last keystroke before asking the engine to search. */
export const SEARCH_DEBOUNCE_MS = 250;

/** The search field's container; the panel focuses the input inside it. */
export const TICKET_SEARCH_SELECTOR = '[data-ticket-search] input';

function itemLabel(item: WorkItem): string {
  return `#${item.id} ${item.title}`;
}

function itemDescription(item: WorkItem): string {
  return [`#${item.id}`, item.type ?? 'Work item', item.teamProject].filter(Boolean).join(' · ');
}

/**
 * Ticket search (react-aria combobox). Typing sends `tracking.search` after a short pause; the
 * engine looks up `#123` directly and publishes the results in `flow.search`. Choosing a result
 * sends `tracking.chooseTicket`, which only prepares a draft: nothing starts yet.
 */
export function TicketSearchField({ flow, autoFocus = false }: { flow: FlowSlice; autoFocus?: boolean }) {
  const search = useAction();
  const choose = useIntents();
  const [query, setQuery] = useState(flow.search.query);
  const sent = useRef(flow.search.query);
  // The combobox writes the chosen option's text into the field; that is not a new search.
  const chosenText = useRef<string | null>(null);
  const { run } = search;

  useEffect(() => {
    if (query === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = query;
      void run({ type: 'tracking.search', query });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  const { results, searching, error } = flow.search;
  const typed = query.trim().length > 0;
  const items = typed ? results : [];
  // Until the engine answers the latest text, the list is not "empty" yet.
  const waiting = searching || flow.search.query.trim() !== query.trim();
  const emptyMessage = waiting
    ? 'Searching…'
    : (error ?? 'No matching tickets. Enter a ticket number or a few words from its title.');

  const onSelectionChange = (key: Key | null) => {
    if (key === null) return;
    const item = items.find((result) => result.id === Number(key));
    if (!item) return;
    chosenText.current = itemLabel(item);
    void choose.run('choose', { type: 'tracking.chooseTicket', ticketId: item.id });
  };

  const onInputChange = (text: string) => {
    if (chosenText.current !== null && text === chosenText.current) {
      chosenText.current = null;
      return;
    }
    chosenText.current = null;
    setQuery(text);
  };

  return (
    <div className={styles.stack} data-ticket-search="">
      <ComboBox<WorkItem>
        label="Ticket number or title"
        placeholder="#4821 or a few words"
        items={items}
        inputValue={query}
        onInputChange={onInputChange}
        selectedKey={null}
        onSelectionChange={onSelectionChange}
        menuTrigger="input"
        isLoading={searching}
        emptyMessage={emptyMessage}
        autoFocus={autoFocus}
        description="Choose a result to pick its activity next."
      >
        {(item) => (
          <PickerItem id={item.id} textValue={itemLabel(item)} description={itemDescription(item)}>
            {item.title}
          </PickerItem>
        )}
      </ComboBox>
      {typed && searching ? (
        <p role="status" className={styles.caption}>
          Searching…
        </p>
      ) : null}
      {typed && error && !searching ? (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      ) : null}
      {typed && !searching && !error && results.length > 0 ? (
        <p role="status" className="visually-hidden">
          {results.length === 1 ? '1 ticket found' : `${results.length} tickets found`}
        </p>
      ) : null}
      <ActionError error={search.error ?? choose.error} />
      {choose.confirmation}
    </div>
  );
}

function QuickTicketRow({ ticket, disabled }: { ticket: QuickTicketView; disabled: boolean }) {
  const item = useWorkItem(ticket.ticketId);
  const actions = useIntents();
  const title = ticket.title ?? item?.title ?? `Azure ticket #${ticket.ticketId}`;
  const favoriteLabel = `${ticket.favorite ? 'Remove favorite' : 'Save favorite'} ticket #${ticket.ticketId}`;
  return (
    <li className={styles.quickItem}>
      <Button
        variant="plain"
        className={styles.quickButton}
        isDisabled={disabled}
        isPending={actions.isPending('choose')}
        onPress={() => void actions.run('choose', { type: 'tracking.chooseTicket', ticketId: ticket.ticketId })}
        aria-label={`#${ticket.ticketId} ${title}`}
      >
        <span className={styles.quickText}>
          <span className={styles.ticketNumber}>#{ticket.ticketId}</span>
          <span className={styles.quickTitle}>{title}</span>
        </span>
      </Button>
      <IconButton
        label={favoriteLabel}
        icon={StarIcon}
        className={cx(styles.favorite, ticket.favorite && styles.favoriteOn)}
        isPending={actions.isPending('favorite')}
        onPress={() => void actions.run('favorite', { type: 'quick.toggleFavorite', ticketId: ticket.ticketId })}
      />
      <ActionError error={actions.error} className={styles.rowError} />
    </li>
  );
}

/** "Favorites & recent tickets": favourites first, each with a star to keep or drop it. */
export function QuickTickets({ flow, headingLevel }: { flow: FlowSlice; headingLevel: HeadingLevel }) {
  const { busy, connected } = useWriteGuards();
  // The engine orders favourites first; keep that order stable even for an older engine.
  const headingId = useId();
  const tickets = [...flow.quickTickets].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  if (tickets.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={styles.stack}>
      <Heading level={headingLevel} id={headingId} className={styles.subheading}>
        Favorites & recent tickets
      </Heading>
      <ul role="list" className={styles.quickList}>
        {tickets.map((ticket) => (
          <QuickTicketRow key={ticket.ticketId} ticket={ticket} disabled={busy || !connected} />
        ))}
      </ul>
    </section>
  );
}

const MANUAL_KINDS: ReadonlyArray<{ kind: ManualTrackingKind; label: string }> = [
  { kind: 'meeting', label: 'Meeting' },
  { kind: 'standup', label: 'Stand-up' },
  { kind: 'activity', label: 'Other activity' },
];

/** "Track without a ticket": Meeting, Stand-up or Other activity (1.14 `ManualTrackingChoices`). */
export function ManualChoices({ headingLevel }: { headingLevel: HeadingLevel }) {
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.stack}>
      <Heading level={headingLevel} id={headingId} className={styles.subheading}>
        Track without a ticket
      </Heading>
      <div className={styles.row}>
        {MANUAL_KINDS.map(({ kind, label }) => (
          <Button
            key={kind}
            size="small"
            isDisabled={busy || !connected}
            isPending={actions.isPending(kind)}
            onPress={() => void actions.run(kind, { type: 'tracking.chooseManual', kind })}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className={styles.caption}>Choose an activity. No ticket number or title needed.</p>
      <ActionError error={actions.error} />
      {actions.confirmation}
    </section>
  );
}

/** For a branch, meeting or Figma suggestion: start without choosing a ticket. */
export function SuggestionWithoutTicket({ flow }: { flow: FlowSlice }) {
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const suggestion = flow.selectedSuggestion;
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <Button
          isDisabled={busy || !connected}
          isPending={actions.isPending()}
          onPress={() => void actions.run('continue', { type: 'tracking.continueWithoutTicket' })}
        >
          Continue without a ticket…
        </Button>
      </div>
      <p className={styles.caption}>
        {suggestion?.kind === 'figma'
          ? `Design · ${suggestion.title}`
          : 'Choose an activity and confirm Start. An Azure ticket is optional.'}
      </p>
      <ActionError error={actions.error} />
    </div>
  );
}
