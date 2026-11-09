import { useId, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { GridList, GridListItem, type Key, type Selection } from 'react-aria-components';
import { Badge, type Tone } from '../../components/Badge';
import { IconButton } from '../../components/Button';
import { SearchField } from '../../components/Fields';
import { SegmentedControl } from '../../components/Segmented';
import type { FlowSlice, Intent, ManualTrackingKind, WorkItem } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { ActionError, useIntents, useWriteGuards } from './actions';
import type { IconComponent } from '../../components/icons';
import { MeetingIcon, NoTicketIcon, StandupIcon, StarIcon, WorkIcon } from './icons';
import { useTicketSearch } from './TicketSearch';
import styles from './ticketPicker.module.css';
import { mark, t, tn } from '../../i18n';

/** The picker's search input, for focusing it. */
export const PICKER_SEARCH_SELECTOR = '[data-picker-search] input';

type Filter = 'all' | 'favorites' | 'recent';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: mark('All') },
  { id: 'favorites', label: mark('Favorites') },
  { id: 'recent', label: mark('Recent') },
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

/** Built when shown, so the titles follow the interface language. */
function noTicketRows(): Array<Extract<PickerRow, { kind: 'manual' }>> {
  return [
    { kind: 'manual', key: 'manual-activity', manual: 'activity', title: t('Work without a ticket'), meta: t('Any activity') },
    { kind: 'manual', key: 'manual-meeting', manual: 'meeting', title: t('Meeting without a ticket'), meta: t('Saved as Meeting') },
    { kind: 'manual', key: 'manual-standup', manual: 'standup', title: t('Daily stand-up'), meta: t('Standup activity only') },
  ];
}

/** Rows for work without an Azure ticket: the quick actions above the tickets. */
export function isTicketFree(row: PickerRow): boolean {
  return row.kind === 'manual' || row.kind === 'continue';
}

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
  branch: mark('suggested by your branch'),
  meeting: mark('suggested by your meeting'),
  figma: mark('suggested by Figma'),
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
    if (id === runningId) notes.push(t('tracking now'));
    if (suggestion?.ticketId === id) notes.push(t(SUGGESTED_BY[suggestion.kind] ?? mark('suggested')));
    if (favorite) notes.push(t('favorite'));
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
      title: title || cached?.title || t('Azure ticket #{id}', { id }),
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
      title: t('Continue without a ticket'),
      meta: suggestion.kind === 'figma' ? t('Design · {title}', { title: suggestion.title }) : t('For {title}', { title: suggestion.title }),
    });
  } else {
    rows.push(...noTicketRows());
  }
  if (draft && draftKey(flow) === 'draft') {
    rows.unshift({ kind: 'draft', key: 'draft', title: draft.remark ?? draft.title, meta: t('No Azure ticket') });
  }
  return rows;
}

/** A row the user chose whose draft the engine is still preparing. */
export interface PendingChoice {
  key: string;
  /** The primary button's label for it ("Track #4790"), shown while it is prepared. */
  label: string;
  /** Work without a ticket takes a comment; tickets and suggestions do not. */
  commentApplies: boolean;
}

/** What choosing `row` will offer, before its draft exists. */
export function pendingChoice(row: PickerRow): PendingChoice {
  return {
    key: row.key,
    label: row.kind === 'ticket' ? t('Track #{id}', { id: row.ticketId }) : t('Start tracking'),
    commentApplies: row.kind === 'manual',
  };
}

/** How long a choice the engine accepted stays shown before its draft's slice must be in. */
export const PENDING_GRACE_MS = 1000;

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
        label={favorite ? t('Remove favorite ticket #{id}', { id: ticketId }) : t('Save favorite ticket #{id}', { id: ticketId })}
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

function PickerRowItem({ row }: { row: PickerRow }) {
  return (
    <GridListItem
      id={row.key}
      textValue={row.kind === 'ticket' ? `#${row.ticketId} ${row.title}` : row.title}
      className={cx(styles.row, row.kind !== 'ticket' && styles.rowNoTicket)}
    >
      <RowContent row={row} />
    </GridListItem>
  );
}

/** The quick actions' tiles: short titles under the "Without a ticket" label. */
const TILES: Record<ManualTrackingKind, { title: string; icon: IconComponent }> = {
  activity: { title: mark('Work'), icon: WorkIcon },
  meeting: { title: mark('Meeting'), icon: MeetingIcon },
  standup: { title: mark('Daily stand-up'), icon: StandupIcon },
};

function QuickTile({ row }: { row: PickerRow }) {
  const tile = row.kind === 'manual' ? { ...TILES[row.manual], title: t(TILES[row.manual].title) } : { title: row.title, icon: NoTicketIcon };
  const meta = row.kind === 'ticket' ? `#${row.ticketId}` : row.meta;
  const Icon = tile.icon;
  return (
    // The row's name stays the full title ("Meeting without a ticket") for screen readers.
    <GridListItem id={row.key} textValue={row.title} className={styles.tile}>
      <span className={styles.tileHead}>
        <Icon className={styles.tileIcon} />
        <span className={styles.radio} aria-hidden="true" />
      </span>
      <span className={styles.tileTitle}>{tile.title}</span>
      <span className={styles.rowMeta}>{meta}</span>
    </GridListItem>
  );
}

/** Focuses the selected row of the list in `container`, or else its first row. */
function focusRow(container: HTMLElement | null): boolean {
  const row =
    container?.querySelector<HTMLElement>('[role="row"][aria-selected="true"]') ??
    container?.querySelector<HTMLElement>('[role="row"][data-key]');
  row?.focus();
  return Boolean(row);
}

function RowContent({ row }: { row: PickerRow }) {
  const tag = row.kind === 'ticket' ? typeTag(row.type) : { label: t('None'), tone: 'neutral' as const };
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
 * The picker's ticket column (2.2 "15 · Ticket picker"): the search, the ticket-free quick
 * actions as three tiles side by side, then a filter for the quick tickets and the tickets to
 * choose from, which fill the rest of the column and scroll. The tiles and the tickets are two
 * lists with one selection: arrow keys move across the tiles, Down Arrow goes on to the tickets
 * and Up Arrow on the first ticket comes back. Choosing a row only prepares the engine's draft;
 * the activity column then belongs to it.
 *
 * The engine keeps one draft at a time and refuses a new choice while one exists, so choosing
 * another row first lets go of the current draft (`tracking.chooseSuggestionTicket` keeps a
 * suggestion, `tracking.chooseDifferentWork` otherwise). Both clear the search results, so an
 * active search is sent again.
 */
export interface PickerTicketsProps {
  flow: FlowSlice;
  /** The row being prepared, owned by the dialog so its other parts can follow it. */
  pending: PendingChoice | null;
  setPending: Dispatch<SetStateAction<PendingChoice | null>>;
  /** `pending` is still on its way to becoming the draft. */
  switching: boolean;
}

export function PickerTickets({ flow, pending, setPending, switching }: PickerTicketsProps) {
  const { busy, connected } = useWriteGuards();
  const tracking = useSlice('tracking');
  const workItems = useSlice('workItems');
  const search = useTicketSearch(flow);
  const choose = useIntents();
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const tilesLabel = useId();
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
    flow.search.results.length === 0 && switching && lastResults.query === flow.search.query
      ? lastResults.results
      : flow.search.results;

  const runningId = tracking?.running ? tracking.ticketId : null;
  const rows = pickerRows(flow, { query, results, filter, runningId, workItems });
  const ticketList = rows.filter((row) => !isTicketFree(row));
  const ticketFree = rows.filter(isTicketFree);
  const draft = flow.draft;
  // The chosen row is selected at once and stays so while its draft is prepared.
  const selectedKey = switching && pending ? pending.key : draftKey(flow);
  // The engine is busy preparing that row; only someone else's write locks the list.
  const disabled = !connected || (busy && !switching);

  const onSelectionChange = (keys: Selection) => {
    if (keys === 'all') return;
    const [key] = [...keys] as Key[];
    const row = rows.find((candidate) => candidate.key === key);
    if (row) onChoose(row);
  };
  const selectedIn = (list: PickerRow[]) => (selectedKey && list.some((row) => row.key === selectedKey) ? [selectedKey] : []);
  const disabledIn = (list: PickerRow[]) => (disabled ? list.map((row) => row.key) : []);
  // Down Arrow past the tiles goes on to the tickets; Up Arrow from the tiles back to the search.
  const onTilesKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown' && focusRow(listRef.current)) event.preventDefault();
    else if (event.key === 'ArrowUp') {
      event.preventDefault();
      tilesRef.current?.closest('[data-picker-column]')?.querySelector<HTMLElement>(PICKER_SEARCH_SELECTOR)?.focus();
    }
  };
  // Up Arrow on the first ticket goes back to the tiles.
  const onTicketsKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== 'ArrowUp') return;
    if (focusRow(tilesRef.current)) event.preventDefault();
  };

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
    const mine = pendingChoice(row);
    setPending(mine);
    const clear = () => setPending((current) => (current === mine ? null : current));
    // On success the draft's slice may arrive just after the reply; give it a moment.
    void choose.run('choose', ...intents).then((ok) => (ok ? setTimeout(clear, PENDING_GRACE_MS) : clear()));
  };

  const showFilter = !typed && flow.quickTickets.length > 0;
  const ticketRows = rows.filter((row) => row.kind === 'ticket').length;
  let listStatus: string | null = null;
  if (typed && waiting && ticketRows === 0) listStatus = t('Searching…');
  else if (typed && !waiting && !error && results.length === 0) listStatus = t('No matching tickets. Enter a ticket number or a few words from its title.');
  else if (!typed && filter === 'favorites' && ticketRows === 0) listStatus = t('No favorites yet. Star a ticket to keep it here.');
  else if (!typed && flow.quickTickets.length === 0)
    listStatus = connected ? t('Enter a ticket number or a few words from its title.') : t('Connect your account in Settings first.');

  return (
    <div className={styles.tickets} data-picker-column="">
      <div data-picker-search="" data-return-handled="">
        <SearchField
          label={t('Search tickets')}
          hideLabel
          placeholder={t('Search by #number or title')}
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
            // The selected row, wherever it is, or else the first tile.
            const selected = listRef.current?.querySelector<HTMLElement>('[role="row"][aria-selected="true"]');
            if (selected) selected.focus();
            else focusRow(tilesRef.current);
          }}
        />
      </div>
      {/* The wrappers only pass arrow keys the lists leave unhandled on to the next list. */}
      <div ref={tilesRef} role="presentation" className={styles.quick} data-return-handled="" onKeyDown={onTilesKeyDown}>
        <span id={tilesLabel} className={styles.sectionLabel}>
          {t('Without a ticket')}
        </span>
        <GridList
          aria-labelledby={tilesLabel}
          items={ticketFree}
          layout="grid"
          keyboardNavigationBehavior="tab"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selectedIn(ticketFree)}
          onSelectionChange={onSelectionChange}
          disabledKeys={disabledIn(ticketFree)}
          disabledBehavior="selection"
          className={styles.tiles}
        >
          {(row) => <QuickTile row={row} />}
        </GridList>
      </div>
      {showFilter ? (
        <SegmentedControl<Filter>
          label={t('Show tickets')}
          hideLabel
          size="small"
          options={FILTERS.map((option) => ({ ...option, label: t(option.label) }))}
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
          {tn(results.length, '{count} ticket found', '{count} tickets found')}
        </p>
      ) : null}
      <div ref={listRef} role="presentation" className={styles.listArea} data-return-handled="" onKeyDown={onTicketsKeyDown}>
        <GridList
          aria-label={t('Tickets')}
          items={ticketList}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selectedIn(ticketList)}
          onSelectionChange={onSelectionChange}
          disabledKeys={disabledIn(ticketList)}
          disabledBehavior="selection"
          className={styles.list}
        >
          {(row) => <PickerRowItem row={row} />}
        </GridList>
      </div>
      <ActionError error={search.error ?? choose.error} />
      {choose.confirmation}
    </div>
  );
}
