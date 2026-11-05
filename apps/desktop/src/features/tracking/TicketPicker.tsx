import { useRef, useState } from 'react';
import { GridList, GridListItem, type Key } from 'react-aria-components';
import { Badge, type Tone } from '../../components/Badge';
import { IconButton } from '../../components/Button';
import { SearchField } from '../../components/Fields';
import { SegmentedControl } from '../../components/Segmented';
import type { FlowSlice, Intent, ManualTrackingKind, WorkItem } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { ActionError, useIntents, useWriteGuards } from './actions';
import { StarIcon } from './icons';
import { useTicketSearch } from './TicketSearch';
import styles from './ticketPicker.module.css';

/** The picker's search input, for focusing it. */
export const PICKER_SEARCH_SELECTOR = '[data-picker-search] input';

type Filter = 'all' | 'favorites' | 'recent';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
];

/** One row of the ticket list: an Azure ticket, or a way to work without one. */
export type PickerRow =
  | {
      kind: 'ticket';
      key: string;
      ticketId: number;
      title: string;
      type: string | null;
      notes: string[];
      /** Quick tickets have a star; search results and the running ticket do not. */
      favorite: boolean | null;
    }
  | { kind: 'manual'; key: string; manual: ManualTrackingKind; title: string; meta: string }
  | { kind: 'continue'; key: string; title: string; meta: string }
  /** A ticket-free draft that none of the rows above describes (a meeting return, a resume). */
  | { kind: 'draft'; key: string; title: string; meta: string };

const ticketKey = (id: number) => `ticket-${id}`;

const NO_TICKET_ROWS: ReadonlyArray<Extract<PickerRow, { kind: 'manual' }>> = [
  { kind: 'manual', key: 'manual-activity', manual: 'activity', title: 'Work without a ticket', meta: 'Any activity, no ticket number' },
  { kind: 'manual', key: 'manual-meeting', manual: 'meeting', title: 'Meeting without a ticket', meta: 'Saved as Meeting' },
  { kind: 'manual', key: 'manual-standup', manual: 'standup', title: 'Daily stand-up', meta: 'Standup activity only' },
];

/** The row the engine's draft stands for. */
export function draftKey(flow: FlowSlice): string | null {
  const draft = flow.draft;
  if (!draft) return null;
  if (draft.manual) return `manual-${draft.manual}`;
  if (draft.item) return ticketKey(draft.item.id);
  return flow.selectedSuggestion ? 'continue' : 'draft';
}

/** The tag before the title: Azure's work item type, shortened like the 2.2 design. */
export function typeTag(type: string | null): { label: string; tone: Tone } {
  switch (type) {
    case 'Bug':
      return { label: 'Bug', tone: 'danger' };
    case 'User Story':
    case 'Story':
      return { label: 'Story', tone: 'info' };
    case 'Product Backlog Item':
      return { label: 'PBI', tone: 'info' };
    case 'Feature':
    case 'Epic':
      return { label: type, tone: 'accent' };
    case null:
      return { label: 'Ticket', tone: 'neutral' };
    default:
      return { label: type, tone: 'neutral' };
  }
}

const SUGGESTED_BY: Record<string, string> = {
  branch: 'suggested by your branch',
  meeting: 'suggested by your meeting',
  figma: 'suggested by Figma',
};

/**
 * The rows, in order: the draft's and the suggestion's ticket when the list would not show them,
 * then the search results (while searching) or the running ticket and the quick tickets, then
 * the ticket-free choices.
 */
export function pickerRows(
  flow: FlowSlice,
  options: {
    query: string;
    results: WorkItem[];
    filter: Filter;
    runningId: number | null;
    workItems: Record<string, WorkItem> | undefined;
  },
): PickerRow[] {
  const { query, results, filter, runningId, workItems } = options;
  const suggestion = flow.selectedSuggestion;
  const draft = flow.draft;
  const rows: PickerRow[] = [];
  const seen = new Set<number>();

  const notesFor = (id: number, favorite: boolean | null) => {
    const notes: string[] = [];
    if (id === runningId) notes.push('tracking now');
    if (suggestion?.ticketId === id) notes.push(SUGGESTED_BY[suggestion.kind] ?? 'suggested');
    if (favorite) notes.push('favorite');
    return notes;
  };
  const addTicket = (id: number, title: string | null, type: string | null, favorite: boolean | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    const cached = workItems?.[String(id)];
    rows.push({
      kind: 'ticket',
      key: ticketKey(id),
      ticketId: id,
      title: title || cached?.title || `Azure ticket #${id}`,
      type: type ?? cached?.type ?? null,
      notes: notesFor(id, favorite),
      favorite,
    });
  };

  const searching = query.trim() !== '';
  if (searching) {
    for (const item of results) addTicket(item.id, item.title, item.type ?? null, null);
  } else {
    // The engine orders favourites first; keep that order stable even for an older engine.
    const quick = [...flow.quickTickets].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    const shown = quick.filter((ticket) =>
      filter === 'all' ? true : filter === 'favorites' ? ticket.favorite : !ticket.favorite,
    );
    if (filter === 'all' && runningId !== null && !quick.some((ticket) => ticket.ticketId === runningId)) {
      addTicket(runningId, null, null, null);
    }
    if (filter === 'all' && suggestion?.ticketId != null) addTicket(suggestion.ticketId, null, null, null);
    for (const ticket of shown) addTicket(ticket.ticketId, ticket.title, null, ticket.favorite);
  }

  // What the draft is for stays visible and selected, whatever the list shows.
  if (draft?.item && !seen.has(draft.item.id)) {
    const quick = flow.quickTickets.find((ticket) => ticket.ticketId === draft.item!.id);
    const before = rows.length;
    addTicket(draft.item.id, draft.item.title, draft.item.type ?? null, quick ? quick.favorite : null);
    rows.unshift(...rows.splice(before, 1));
  }

  if (suggestion) {
    rows.push({
      kind: 'continue',
      key: 'continue',
      title: 'Continue without a ticket',
      meta: suggestion.kind === 'figma' ? `Design · ${suggestion.title}` : `For ${suggestion.title}`,
    });
  } else {
    rows.push(...NO_TICKET_ROWS);
  }
  if (draft && draftKey(flow) === 'draft') {
    rows.unshift({ kind: 'draft', key: 'draft', title: draft.remark ?? draft.title, meta: 'No Azure ticket' });
  }
  return rows;
}

/** The intent that prepares a draft for `row`; `null` for a row that only shows the draft. */
function chooseIntent(row: PickerRow): Intent | null {
  switch (row.kind) {
    case 'ticket':
      return { type: 'tracking.chooseTicket', ticketId: row.ticketId };
    case 'manual':
      return { type: 'tracking.chooseManual', kind: row.manual };
    case 'continue':
      return { type: 'tracking.continueWithoutTicket' };
    case 'draft':
      return null;
  }
}

function FavoriteButton({ ticketId, favorite }: { ticketId: number; favorite: boolean }) {
  const actions = useIntents();
  return (
    <>
      <IconButton
        label={`${favorite ? 'Remove favorite' : 'Save favorite'} ticket #${ticketId}`}
        icon={StarIcon}
        size="small"
        className={cx(styles.favorite, favorite && styles.favoriteOn)}
        isPending={actions.isPending()}
        onPress={() => void actions.run('favorite', { type: 'quick.toggleFavorite', ticketId })}
      />
      <ActionError error={actions.error} className={styles.rowError} />
    </>
  );
}

function RowContent({ row }: { row: PickerRow }) {
  const tag = row.kind === 'ticket' ? typeTag(row.type) : { label: 'None', tone: 'neutral' as const };
  const meta = row.kind === 'ticket' ? [`#${row.ticketId}`, ...row.notes].join(' · ') : row.meta;
  return (
    <>
      <Badge tone={tag.tone} className={styles.tag}>
        {tag.label}
      </Badge>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{row.title}</span>
        <span className={styles.rowMeta}>{meta}</span>
      </span>
      {row.kind === 'ticket' && row.favorite !== null ? <FavoriteButton ticketId={row.ticketId} favorite={row.favorite} /> : null}
      <span className={styles.radio} aria-hidden="true" />
    </>
  );
}

/**
 * The picker's ticket column (2.2 "15 · Ticket picker"): the search, a filter for the quick
 * tickets and one list of rows to choose from, ending with the ticket-free choices. Choosing a
 * row only prepares the engine's draft; the activity column then belongs to it.
 *
 * The engine keeps one draft at a time and refuses a new choice while one exists, so choosing
 * another row first lets go of the current draft (`tracking.chooseSuggestionTicket` keeps a
 * suggestion, `tracking.chooseDifferentWork` otherwise). Both clear the search results, so an
 * active search is sent again.
 */
export function PickerTickets({ flow }: { flow: FlowSlice }) {
  const { busy, connected } = useWriteGuards();
  const tracking = useSlice('tracking');
  const workItems = useSlice('workItems');
  const search = useTicketSearch(flow);
  const choose = useIntents();
  const [filter, setFilter] = useState<Filter>('all');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The last results, kept on screen while a new choice has cleared them and the search that
  // follows it has not answered yet.
  const [lastResults, setLastResults] = useState<{ query: string; results: WorkItem[] }>({ query: '', results: [] });
  if (flow.search.results.length > 0 && lastResults.results !== flow.search.results) {
    setLastResults({ query: flow.search.query, results: flow.search.results });
  }

  const { query, setQuery, waiting } = search;
  const typed = query.trim() !== '';
  const { searching, error } = flow.search;
  const results =
    flow.search.results.length === 0 && choose.isPending() && lastResults.query === flow.search.query
      ? lastResults.results
      : flow.search.results;

  const runningId = tracking?.running ? tracking.ticketId : null;
  const rows = pickerRows(flow, { query, results, filter, runningId, workItems });
  const draft = flow.draft;
  const selectedKey = pendingKey ?? draftKey(flow);
  const disabled = busy || !connected;

  const onChoose = (row: PickerRow) => {
    if (row.key === draftKey(flow) || choose.inFlight()) return;
    const intent = chooseIntent(row);
    if (!intent) return;
    const intents: Intent[] = [];
    if (draft) {
      intents.push(
        flow.selectedSuggestion && draft.canChooseTicket
          ? { type: 'tracking.chooseSuggestionTicket', draftId: draft.id }
          : { type: 'tracking.chooseDifferentWork' },
      );
      if (flow.search.query.trim() !== '') intents.push({ type: 'tracking.search', query: flow.search.query });
    }
    intents.push(intent);
    setPendingKey(row.key);
    void choose.run('choose', ...intents).finally(() => setPendingKey(null));
  };

  const showFilter = !typed && flow.quickTickets.length > 0;
  const ticketRows = rows.filter((row) => row.kind === 'ticket').length;
  let listStatus: string | null = null;
  if (typed && waiting && ticketRows === 0) listStatus = 'Searching…';
  else if (typed && !waiting && !error && results.length === 0) listStatus = 'No matching tickets. Enter a ticket number or a few words from its title.';
  else if (!typed && filter === 'favorites' && ticketRows === 0) listStatus = 'No favorites yet. Star a ticket to keep it here.';
  else if (!typed && flow.quickTickets.length === 0)
    listStatus = connected ? 'Enter a ticket number or a few words from its title.' : 'Connect your account in Settings first.';

  return (
    <div className={styles.tickets}>
      <div data-picker-search="" data-return-handled="">
        <SearchField
          label="Search tickets"
          hideLabel
          placeholder="Search by #number or title"
          value={query}
          onChange={setQuery}
          autoFocus
          onKeyDown={(event) => {
            // Down Arrow moves from the search into the list, like a native picker.
            if (event.key !== 'ArrowDown') {
              event.continuePropagation();
              return;
            }
            event.preventDefault();
            const row =
              listRef.current?.querySelector<HTMLElement>('[role="row"][aria-selected="true"]') ??
              listRef.current?.querySelector<HTMLElement>('[role="row"]');
            row?.focus();
          }}
        />
      </div>
      {showFilter ? (
        <SegmentedControl<Filter>
          label="Show tickets"
          hideLabel
          size="small"
          options={FILTERS}
          selectedKey={filter}
          onSelectionChange={setFilter}
          className={styles.filter}
        />
      ) : null}
      {typed && error && !searching ? (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      ) : null}
      {listStatus ? (
        <p role="status" className={styles.status}>
          {listStatus}
        </p>
      ) : typed && !waiting && results.length > 0 ? (
        <p role="status" className="visually-hidden">
          {results.length === 1 ? '1 ticket found' : `${results.length} tickets found`}
        </p>
      ) : null}
      <div ref={listRef} className={styles.listScroll} data-return-handled="">
        <GridList
          aria-label="Tickets"
          items={rows}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selectedKey ? [selectedKey] : []}
          onSelectionChange={(keys) => {
            if (keys === 'all') return;
            const [key] = [...keys] as Key[];
            const row = rows.find((candidate) => candidate.key === key);
            if (row) onChoose(row);
          }}
          disabledKeys={disabled ? rows.map((row) => row.key) : []}
          disabledBehavior="selection"
          className={styles.list}
        >
          {(row) => (
            <GridListItem
              id={row.key}
              textValue={row.kind === 'ticket' ? `#${row.ticketId} ${row.title}` : row.title}
              className={cx(styles.row, row.kind !== 'ticket' && styles.rowNoTicket)}
              data-pending={pendingKey === row.key || undefined}
            >
              <RowContent row={row} />
            </GridListItem>
          )}
        </GridList>
      </div>
      <ActionError error={search.error ?? choose.error} />
      {choose.confirmation}
    </div>
  );
}
