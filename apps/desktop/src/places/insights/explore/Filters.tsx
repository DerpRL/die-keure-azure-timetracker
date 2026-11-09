import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { SearchField } from '../../../components/Fields';
import { CloseIcon } from '../../../components/icons';
import { ComboBox, PickerItem, Select } from '../../../components/Pickers';
import { t } from '../../../i18n';
import type { ExplorerFilter, StatisticsSlice } from '../../../ipc/contract';
import { useAction } from '../../../state/hooks';
import { cx } from '../../../utils/cx';
import { filterChips, isFilterActive, taskLabel } from './model';
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

interface FilterProps {
  slice: StatisticsSlice;
  /** Hide the visible label (the header's compact pickers); the accessible name stays. */
  hideLabel?: boolean;
  className?: string;
}

/** Shows the engine's refusal of a filter change next to the control. */
function FilterError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className={styles.inlineError}>
      {message}
    </p>
  ) : null;
}

/**
 * Search in ticket number, title, comment and activity (1.14 `filters`). The engine owns the
 * filter; the text is a draft until typing pauses.
 */
export function SearchFilter({ slice, hideLabel = false, className }: FilterProps) {
  const update = useAction();
  const { run } = update;
  const { filter } = slice;
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

  return (
    <div className={cx(styles.searchField, className)}>
      <SearchField
        label={t('Search')}
        hideLabel={hideLabel}
        placeholder={t('Search ticket, title or comment')}
        value={draft}
        onChange={(value) => setSearch((state) => ({ ...state, draft: value }))}
      />
      <FilterError message={update.error?.message} />
    </div>
  );
}

/** "All activities" or one activity of the period. */
export function ActivityFilter({ slice, hideLabel = false, className }: FilterProps) {
  const update = useAction();
  const { filter } = slice;
  const activities = [
    { id: ALL_ACTIVITIES, label: t('All activities') },
    ...slice.availableActivities.map((activity) => ({ id: activity.id, label: activity.name })),
    ...(filter.activityId !== null && !slice.availableActivities.some((activity) => activity.id === filter.activityId)
      ? [{ id: filter.activityId, label: t('Selected activity (no entries)') }]
      : []),
  ];
  return (
    <div className={cx(styles.activityField, className)}>
      <Select
        label={t('Activity')}
        hideLabel={hideLabel}
        width="auto"
        items={activities}
        selectedKey={filter.activityId ?? ALL_ACTIVITIES}
        onSelectionChange={(key) => {
          if (key === null) return;
          const activityId = key === ALL_ACTIVITIES ? null : String(key);
          if (activityId !== filter.activityId) void update.run({ type: 'statistics.setFilter', filter: { ...filter, activityId } });
        }}
      />
      <FilterError message={update.error?.message} />
    </div>
  );
}

/** Any ticket (or ticket-free task) of the whole period, also while another one is filtered. */
export function TicketFilter({ slice, hideLabel = false, className }: FilterProps) {
  const update = useAction();
  const { filter } = slice;
  const tasks = slice.availableTasks.map((task) => ({ id: task.id, label: taskLabel(task) }));
  return (
    <div className={cx(styles.activityField, className)}>
      <ComboBox
        label={t('Ticket')}
        hideLabel={hideLabel}
        width="auto"
        placeholder={t('All tickets')}
        defaultItems={tasks}
        selectedKey={filter.taskId}
        emptyMessage={t('No ticket in this period matches')}
        onSelectionChange={(key) => {
          const taskId = key === null ? null : String(key);
          if (taskId !== filter.taskId) void update.run({ type: 'statistics.setFilter', filter: { ...filter, taskId } });
        }}
      >
        {(task) => (
          <PickerItem id={task.id} textValue={task.label}>
            {task.label}
          </PickerItem>
        )}
      </ComboBox>
      <FilterError message={update.error?.message} />
    </div>
  );
}

/** Every active filter as a removable chip, and "Clear filters". Nothing without filters. */
export function FilterChips({ slice }: { slice: StatisticsSlice }) {
  const update = useAction();
  const { run } = update;
  const { filter } = slice;
  const send = (next: ExplorerFilter) => void run({ type: 'statistics.setFilter', filter: next });
  const chips = filterChips(filter, slice.availableTasks, slice.availableActivities);
  if (chips.length === 0 && !isFilterActive(filter)) return null;
  return (
    <div className={styles.chipRow}>
      {chips.length > 0 ? (
        <ul role="list" aria-label={t('Active filters')} className={styles.chips}>
          {chips.map((chip) => (
            <li key={chip.id}>
              <Button
                size="small"
                trailingIcon={CloseIcon}
                className={styles.chip}
                aria-label={t('{filter}, remove filter', { filter: chip.label })}
                onPress={() => send(chip.without)}
              >
                {chip.label}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button size="small" variant="plain" className={styles.clearFilters} onPress={() => void run({ type: 'statistics.clearFilters' })}>
        {t('Clear filters')}
      </Button>
      <FilterError message={update.error?.message} />
    </div>
  );
}
