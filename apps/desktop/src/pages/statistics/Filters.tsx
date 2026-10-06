import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { SearchField } from '../../components/Fields';
import { CloseIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import type { ExplorerFilter, StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { filterChips, isFilterActive } from './model';
import styles from './Statistics.module.css';

const ALL_ACTIVITIES = '__all__';
/** Typing pauses this long before the search reaches the engine. */
export const SEARCH_DEBOUNCE_MS = 300;

interface SearchDraft {
  /** What the field shows. */
  draft: string;
  /** The engine's query when the draft was last reconciled. */
  base: string;
  /** The last query this field sent, so its own echo does not reset typing in progress. */
  sent: string | null;
}

/**
 * Search, activity and "Clear filters" (1.14 `filters`), with every active filter as a removable
 * chip. The engine owns the filter; the search text is a draft until typing pauses.
 */
export function Filters({ slice }: { slice: StatisticsSlice }) {
  const update = useAction();
  const { run } = update;
  const { filter } = slice;
  const send = (next: ExplorerFilter) => void run({ type: 'statistics.setFilter', filter: next });

  const [search, setSearch] = useState<SearchDraft>({ draft: filter.query, base: filter.query, sent: null });
  let current = search;
  if (filter.query !== search.base) {
    // A new query from the engine: our own debounced text arriving, or Clear filters / a chip.
    current =
      filter.query === search.sent
        ? { draft: search.draft, base: filter.query, sent: null }
        : { draft: filter.query, base: filter.query, sent: null };
    setSearch(current);
  }
  const { draft, sent } = current;

  useEffect(() => {
    if (draft === filter.query || draft === sent) return;
    const timer = setTimeout(() => {
      setSearch((state) => ({ ...state, sent: draft }));
      void run({ type: 'statistics.setFilter', filter: { ...filter, query: draft } });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, sent, filter, run]);

  const activities = [
    { id: ALL_ACTIVITIES, label: 'All activities' },
    ...slice.availableActivities.map((activity) => ({ id: activity.id, label: activity.name })),
    ...(filter.activityId !== null && !slice.availableActivities.some((activity) => activity.id === filter.activityId)
      ? [{ id: filter.activityId, label: 'Selected activity (no entries)' }]
      : []),
  ];
  const chips = filterChips(filter, slice.analysis, slice.availableActivities);
  const active = isFilterActive(filter);

  return (
    <div role="search" aria-label="Filter statistics" className={styles.filters}>
      <div className={styles.filterRow}>
        <SearchField
          label="Search"
          placeholder="Search ticket, title or comment"
          value={draft}
          onChange={(value) => setSearch((state) => ({ ...state, draft: value }))}
          className={styles.searchField}
        />
        <Select
          label="Activity"
          width="auto"
          className={styles.activityField}
          items={activities}
          selectedKey={filter.activityId ?? ALL_ACTIVITIES}
          onSelectionChange={(key) => {
            if (key === null) return;
            const activityId = key === ALL_ACTIVITIES ? null : String(key);
            if (activityId !== filter.activityId) send({ ...filter, activityId });
          }}
        />
        {active ? (
          <Button className={styles.clearFilters} onPress={() => void run({ type: 'statistics.clearFilters' })}>
            Clear filters
          </Button>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <ul role="list" aria-label="Active filters" className={styles.chips}>
          {chips.map((chip) => (
            <li key={chip.id}>
              <Button
                size="small"
                trailingIcon={CloseIcon}
                className={styles.chip}
                aria-label={`${chip.label}, remove filter`}
                onPress={() => send(chip.without)}
              >
                {chip.label}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {update.error ? (
        <p role="alert" className={styles.inlineError}>
          {update.error.message}
        </p>
      ) : null}
    </div>
  );
}
