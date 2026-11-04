import { startOfWeek } from '@internationalized/date';
import { useCallback, useId, useMemo, useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card, Heading } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { SearchField } from '../../components/Fields';
import { AttentionIcon, CircleIcon, HistoryIcon, InboxIcon, PlayIcon, SpinnerIcon } from '../../components/icons';
import { Tabs } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { seriesColor } from '../../charts/palette';
import type { AuditEntry, HistorySlice, WorkItemsSlice, WorkLog } from '../../ipc/contract';
import { ActivityChip, ActivityPill, activityColorIndex, stripWindow, useActivityColors } from '../../features/activity';
import { PageHeaderActions, PageRefresh } from '../../features/app/PageHeaderActions';
import { useEngineDraft } from '../../features/ticketContext/drafts';
import {
  formatClockTime,
  formatDayLong,
  formatInstant,
  historyTitle,
  localDayKey,
  localToday,
  logEnd,
  logStart,
  logTicket,
  toCalendarDay,
  totalLength,
} from '../../features/ticketContext/format';
import { chooseSavePath } from '../../features/ticketContext/native';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import styles from './History.module.css';

/** Worklogs rendered at once; "Show more" adds this many (long ranges stay fast). */
export const HISTORY_PAGE_SIZE = 150;
/** App activity entries rendered at once (the log keeps up to 2,000). */
export const AUDIT_PAGE_SIZE = 100;

type HistoryTab = 'worklogs' | 'activity';

type Preset = 'today' | 'thisWeek' | 'lastWeek';

const PRESETS: ReadonlyArray<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
];

/** The `from`/`to` days a quick range loads (weeks start on Monday, as in 1.14). */
function presetRange(which: Preset): { from: string; to: string } {
  const today = localToday();
  const monday = startOfWeek(today, 'en-GB');
  if (which === 'today') return { from: today.toString(), to: today.toString() };
  if (which === 'thisWeek') return { from: monday.toString(), to: today.toString() };
  return { from: monday.subtract({ weeks: 1 }).toString(), to: monday.subtract({ days: 1 }).toString() };
}

function matches(log: WorkLog, query: string, items: WorkItemsSlice | undefined): boolean {
  if (!query) return true;
  const ticket = log.workItemId ?? 0;
  const text = `${ticket} ${log.comment ?? ''} ${items?.[String(ticket)]?.title ?? ''}`;
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/** Palette index per worklog: the shared activity colours (same rule as Statistics). */
type ColorOf = (log: WorkLog) => number;

function useLogColors(logs: readonly WorkLog[]): ColorOf {
  const ids = useMemo(() => [...new Set(logs.map((log) => log.activityType?.id ?? '').filter(Boolean))].sort(), [logs]);
  const colors = useActivityColors(ids);
  return useCallback((log: WorkLog) => activityColorIndex(colors, log.activityType?.id), [colors]);
}

function LogRow({ log, items, trackDisabled, colorIndex }: { log: WorkLog; items: WorkItemsSlice | undefined; trackDisabled: boolean; colorIndex: number }) {
  const track = useAction();
  const ticket = logTicket(log);
  const start = logStart(log);
  return (
    <li className={styles.row}>
      <ActivityPill colorIndex={colorIndex} />
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>{historyTitle(log, items)}</span>
        <span className={styles.meta}>
          {ticket !== null ? (
            <span className={styles.ticket}>
              <TicketLink ticketId={ticket} compact />
            </span>
          ) : null}
          <span className={styles.time}>{start ? formatClockTime(start) : log.timestamp}</span>
          {log.activityType?.name ? <ActivityChip name={log.activityType.name} colorIndex={colorIndex} /> : null}
          {ticket === null ? <span>No Azure ticket</span> : null}
        </span>
        {track.error ? <span className={styles.error}>{track.error.message}</span> : null}
      </div>
      <span className={styles.duration}>{formatShortDuration(log.length)}</span>
      {ticket !== null ? (
        <Button
          size="small"
          variant="plain"
          icon={PlayIcon}
          isDisabled={trackDisabled}
          onPress={() => void track.run({ type: 'tracking.chooseTicket', ticketId: ticket, surface: 'picker' })}
          aria-label={`Track again, #${ticket}`}
        >
          Track again
        </Button>
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * The day's worklogs as a thin bar of activity-coloured spans (the mockup's mini strip). Purely
 * decorative: the rows below list the same times.
 */
function MiniStrip({ day, logs, colorOf }: { day: string; logs: readonly WorkLog[]; colorOf: ColorOf }) {
  const spans = logs.flatMap((log) => {
    const start = logStart(log);
    const end = logEnd(log);
    return start && end && end > start ? [{ log, start: start.getTime(), end: end.getTime() }] : [];
  });
  if (spans.length === 0) return null;
  const date = toCalendarDay(day);
  const { from, to } = stripWindow(
    date ? new Date(date.year, date.month - 1, date.day) : new Date(spans[0]!.start),
    spans.flatMap((span) => [span.start, span.end]),
  );
  const range = Math.max(to - from, 1);
  const pct = (time: number) => `${((Math.min(Math.max(time, from), to) - from) / range) * 100}%`;
  return (
    <span className={styles.mini} aria-hidden="true">
      {spans.map(({ log, start, end }) => (
        <span
          key={log.id}
          className={styles.miniBlock}
          style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})`, background: seriesColor(colorOf(log)) }}
        />
      ))}
    </span>
  );
}

function DayGroup({
  day,
  logs,
  items,
  trackDisabled,
  colorOf,
}: {
  day: string;
  logs: WorkLog[];
  items: WorkItemsSlice | undefined;
  trackDisabled: boolean;
  colorOf: ColorOf;
}) {
  const headingId = useId();
  // A plain section (no landmark per day): long ranges would otherwise list dozens of regions.
  return (
    <Card as="section" padding="none" className={styles.day}>
      <div className={styles.dayHeader}>
        <Heading level={2} id={headingId} className={styles.dayTitle}>
          {formatDayLong(day)}
        </Heading>
        <div className={styles.daySummary}>
          <MiniStrip day={day} logs={logs} colorOf={colorOf} />
          <span className={styles.duration}>{formatShortDuration(totalLength(logs))}</span>
        </div>
      </div>
      <ul role="list" aria-labelledby={headingId} className={styles.rows}>
        {logs.map((log) => (
          <LogRow key={log.id} log={log} items={items} trackDisabled={trackDisabled} colorIndex={colorOf(log)} />
        ))}
      </ul>
    </Card>
  );
}

function Worklogs({ history, filter, trackDisabled }: { history: HistorySlice; filter: string; trackDisabled: boolean }) {
  const items = useSlice('workItems');
  const [visible, setVisible] = useState(HISTORY_PAGE_SIZE);
  const filtered = useMemo(() => history.logs.filter((log) => matches(log, filter.trim(), items)), [history.logs, filter, items]);
  const { days, unknown, shownCount } = useMemo(() => {
    const shown = filtered.slice(0, visible);
    const groups = new Map<string, WorkLog[]>();
    const unreadable: WorkLog[] = [];
    for (const log of shown) {
      const start = logStart(log);
      if (!start) {
        unreadable.push(log);
        continue;
      }
      const key = localDayKey(start);
      const group = groups.get(key);
      if (group) group.push(log);
      else groups.set(key, [log]);
    }
    return { days: [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)), unknown: unreadable, shownCount: shown.length };
  }, [filtered, visible]);
  const tickets = new Set(filtered.map(logTicket).filter((id) => id !== null)).size;
  const colorOf = useLogColors(history.logs);

  return (
    <div className={styles.tab}>
      <dl className={styles.metrics}>
        <Card className={styles.metric}>
          <dt>Tracked time</dt>
          <dd>{formatShortDuration(totalLength(filtered))}</dd>
        </Card>
        <Card className={styles.metric}>
          <dt>Worklogs</dt>
          <dd>{filtered.length}</dd>
        </Card>
        <Card className={styles.metric}>
          <dt>Tickets</dt>
          <dd>{tickets}</dd>
        </Card>
      </dl>
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={HistoryIcon}
            headingLevel={2}
            title={history.loaded ? 'No worklogs in this view' : 'Your history is waiting'}
            description={history.loaded ? 'Change the date range or clear the filter.' : 'Connect to 7pace in Settings to load your real worklogs.'}
          />
        </Card>
      ) : null}
      {days.map(([day, logs]) => (
        <DayGroup key={day} day={day} logs={logs} items={items} trackDisabled={trackDisabled} colorOf={colorOf} />
      ))}
      {unknown.length > 0 ? (
        <Card padding="none" className={styles.day}>
          <div className={styles.dayHeader}>
            <Heading level={2} className={styles.dayTitle}>
              Unrecognized dates from 7pace
            </Heading>
          </div>
          <ul role="list" className={styles.rows}>
            {unknown.map((log) => (
              <LogRow key={log.id} log={log} items={items} trackDisabled={trackDisabled} colorIndex={colorOf(log)} />
            ))}
          </ul>
        </Card>
      ) : null}
      {filtered.length > shownCount ? (
        <div className={styles.more}>
          <span className={styles.caption}>{`Showing ${shownCount} of ${filtered.length} worklogs`}</span>
          <Button onPress={() => setVisible((count) => count + HISTORY_PAGE_SIZE)}>Show more worklogs</Button>
        </div>
      ) : null}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const Icon = entry.title.toLocaleLowerCase().includes('attention') ? AttentionIcon : CircleIcon;
  return (
    <li className={styles.auditRow}>
      <Icon className={styles.auditIcon} />
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>{entry.title}</span>
        <span className={styles.selectable}>{entry.detail}</span>
      </div>
      <time dateTime={entry.date} className={styles.caption}>
        {formatInstant(entry.date)}
      </time>
    </li>
  );
}

function AppActivity({ audit }: { audit: readonly AuditEntry[] }) {
  const [visible, setVisible] = useState(AUDIT_PAGE_SIZE);
  if (audit.length === 0) {
    return (
      <Card>
        <EmptyState icon={InboxIcon} headingLevel={2} title="A quiet beginning" description="Branch changes and tracking decisions will appear here." />
      </Card>
    );
  }
  const shown = audit.slice(0, visible);
  return (
    <Card padding="none" className={styles.auditCard}>
      <ol role="list" className={styles.audit} aria-label="App activity, newest first">
        {shown.map((entry) => (
          <AuditRow key={entry.id} entry={entry} />
        ))}
      </ol>
      {audit.length > shown.length ? (
        <div className={styles.more}>
          <span className={styles.caption}>{`Showing ${shown.length} of ${audit.length} entries`}</span>
          <Button onPress={() => setVisible((count) => count + AUDIT_PAGE_SIZE)}>Show more activity</Button>
        </div>
      ) : null}
    </Card>
  );
}

/** History (1.14 `HistoryView`): 7pace worklogs by range, CSV export and the App activity log. */
export default function HistoryPage() {
  const history = useSlice('history');
  const connection = useSlice('connection');
  const app = useSlice('app');
  const toast = useToast();
  const load = useAction();
  const range = useAction();
  const exporter = useAction();
  const [tab, setTab] = useState<HistoryTab>('worklogs');
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useEngineDraft(history?.from ?? '');
  const [to, setTo] = useEngineDraft(history?.to ?? '');
  const [choosing, setChoosing] = useState(false);

  const connected = connection?.connected ?? false;
  const loading = history?.loading ?? false;
  const canExport = !!history && history.logs.length > 0 && !choosing && !exporter.pending;

  const runLoad = () => void load.run({ type: 'history.load' });
  const changeRange = (nextFrom: string, nextTo: string, andLoad = false) => {
    setFrom(nextFrom);
    setTo(nextTo);
    void range.run({ type: 'history.setRange', from: nextFrom, to: nextTo }).then((result) => {
      if (result.ok && andLoad) runLoad();
    });
  };
  const preset = (which: Preset) => {
    const next = presetRange(which);
    changeRange(next.from, next.to, true);
  };
  const exportCsv = async () => {
    setChoosing(true);
    let path: string | null = null;
    try {
      path = await chooseSavePath({
        defaultPath: 'azure-time-history.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        title: 'Export history',
      });
    } catch (error) {
      toast.show({ title: 'Could not open the save dialog', description: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setChoosing(false);
    }
    if (!path) return;
    const result = await exporter.run({ type: 'history.exportCsv', path });
    if (result.ok) toast.show({ title: 'History exported', description: path, tone: 'success' });
  };

  useCommands([
    {
      id: 'history.export',
      label: 'Export history as CSV…',
      group: 'Actions',
      keywords: ['history', 'csv', 'export'],
      isDisabled: !canExport,
      onAction: () => void exportCsv(),
    },
    {
      id: 'history.activity',
      label: tab === 'activity' ? 'Show 7pace worklogs' : 'Show App activity',
      group: 'Actions',
      keywords: ['history', 'audit', 'activity', 'worklogs'],
      onAction: () => setTab(tab === 'activity' ? 'worklogs' : 'activity'),
    },
  ]);

  const exportButton = (
    <PageHeaderActions>
      <Button isDisabled={!canExport} isPending={choosing || exporter.pending} onPress={() => void exportCsv()}>
        Export CSV
      </Button>
    </PageHeaderActions>
  );

  if (!history) {
    return (
      <div className={styles.page} aria-busy="true">
        <span role="status" className="visually-hidden">
          Loading history
        </span>
        <Skeleton lines={2} />
        <Skeleton shape="rect" height="14rem" />
      </div>
    );
  }

  // The engine reports failed loads and exports in the slice; a rejected intent with the same
  // message is not shown twice.
  const issue = history.issue ?? null;
  const rejected = load.error ?? range.error ?? exporter.error ?? null;
  const failure = rejected && rejected.message !== issue ? rejected : null;

  const worklogs = (
    <div className={styles.tab}>
      <div className={styles.controls}>
        <DatePicker
          label="From"
          value={toCalendarDay(from)}
          maxValue={localToday()}
          onChange={(value) => {
            if (value) changeRange(value.toString(), to);
          }}
        />
        <DatePicker
          label="To"
          value={toCalendarDay(to)}
          maxValue={localToday()}
          onChange={(value) => {
            if (value) changeRange(from, value.toString());
          }}
        />
        <Button variant="primary" isDisabled={loading || !connected} onPress={runLoad}>
          Load
        </Button>
        <div className={styles.presets} role="group" aria-label="Quick ranges">
          {PRESETS.map(({ id, label }) => {
            const range = presetRange(id);
            return (
              <Button
                key={id}
                size="small"
                variant="plain"
                className={styles.preset}
                aria-pressed={range.from === from && range.to === to}
                isDisabled={loading || !connected}
                onPress={() => preset(id)}
              >
                {label}
              </Button>
            );
          })}
        </div>
        {loading ? (
          <span role="status" className={styles.loadingNote}>
            <SpinnerIcon className={styles.spinner} />
            Loading worklogs…
          </span>
        ) : null}
        <SearchField label="Filter tickets" value={filter} onChange={setFilter} placeholder="Ticket number or title" width="narrow" className={styles.filter} />
      </div>
      {failure ? <Banner tone="error">{failure.message}</Banner> : null}
      <LoadingRegion
        label="Loading worklogs…"
        isLoading={loading && !history.loaded}
        placeholder={
          <div className={styles.tab}>
            <Skeleton shape="rect" height="5rem" />
            <Skeleton lines={5} />
          </div>
        }
      >
        <Worklogs key={`${history.from}|${history.to}|${filter}`} history={history} filter={filter} trackDisabled={(app?.busy ?? false) || !connected} />
      </LoadingRegion>
    </div>
  );

  return (
    <div className={styles.page}>
      {exportButton}
      <PageRefresh onRefresh={runLoad} isRefreshing={loading} isDisabled={!connected} label="Refresh" />
      <p className={styles.intro}>Your 7pace worklogs and tracking decisions.</p>
      {issue ? (
        <Banner
          tone="error"
          title="History could not be loaded"
          actions={
            <Button size="small" isDisabled={loading || !connected} isPending={load.pending} onPress={runLoad}>
              Retry
            </Button>
          }
        >
          {issue}
        </Banner>
      ) : null}
      <Tabs<HistoryTab>
        label="History"
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key === 'activity' ? 'activity' : 'worklogs')}
        tabs={[
          { id: 'worklogs', title: '7pace worklogs', content: worklogs },
          { id: 'activity', title: 'App activity', content: <AppActivity audit={history.audit} /> },
        ]}
      />
    </div>
  );
}
