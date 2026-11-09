import { startOfWeek } from '@internationalized/date';
import { useCallback, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card, Heading } from '../../../components/Card';
import { DatePicker } from '../../../components/DateFields';
import { EmptyState, LoadingRegion, Skeleton } from '../../../components/EmptyState';
import { SearchField } from '../../../components/Fields';
import { AttentionIcon, CircleIcon, DownloadIcon, HistoryIcon, InboxIcon, PlayIcon, SpinnerIcon } from '../../../components/icons';
import { SegmentedControl, Tab, TabList, TabPanel, TabsRoot } from '../../../components/Segmented';
import { seriesColor } from '../../../charts/palette';
import type { AuditEntry, HistorySlice, WorkItemsSlice, WorkLog } from '../../../ipc/contract';
import { ActivityChip, activityColorIndex, stripWindow, useActivityColors } from '../../../features/activity';
import { useEngineDraft } from '../../../features/ticketContext/drafts';
import {
  formatClockTime,
  formatDayLong,
  formatInstant,
  localDayKey,
  localToday,
  logEnd,
  logStart,
  logTicket,
  toCalendarDay,
  totalLength,
} from '../../../features/ticketContext/format';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import { useCommands, useRefreshShortcut } from '../../../shortcuts/hooks';
import { useAction, useSlice } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import { ExportIcon } from '../icons';
import { StepButtons, TimesheetHeader } from '../TimesheetHeader';
import { useCsvExport } from '../useCsvExport';
import styles from './History.module.css';
import shared from '../timesheet.module.css';
import { cx } from '../../../utils/cx';
import { dateFormat, mark, t, tn } from '../../../i18n';

/** Worklogs rendered at once; "Show more" adds this many (long ranges stay fast). */
export const HISTORY_PAGE_SIZE = 150;
/** App activity entries rendered at once (the log keeps up to 2,000). */
export const AUDIT_PAGE_SIZE = 100;

type ListSource = 'worklogs' | 'activity';
type Preset = 'today' | 'thisWeek' | 'lastWeek';
type RangeChoice = Preset | 'custom';

const PRESETS: ReadonlyArray<{ id: RangeChoice; label: string }> = [
  { id: 'today', label: mark('Today') },
  { id: 'thisWeek', label: mark('This week') },
  { id: 'lastWeek', label: mark('Last week') },
  { id: 'custom', label: mark('Custom…') },
];

/** The `from`/`to` days a quick range loads (weeks start on Monday, as in 1.14). */
export function presetRange(which: Preset): { from: string; to: string } {
  const today = localToday();
  const monday = startOfWeek(today, 'en-GB');
  if (which === 'today') return { from: today.toString(), to: today.toString() };
  if (which === 'thisWeek') return { from: monday.toString(), to: today.toString() };
  return { from: monday.subtract({ weeks: 1 }).toString(), to: monday.subtract({ days: 1 }).toString() };
}

function presetOf(from: string, to: string): Preset | null {
  for (const preset of ['today', 'thisWeek', 'lastWeek'] as const) {
    const range = presetRange(preset);
    if (range.from === from && range.to === to) return preset;
  }
  return null;
}

/** "30 Sept – 6 Oct 2026", "1 – 6 October 2026", "Tuesday 6 October" for one day. */
export function formatRangeTitle(from: string, to: string): string {
  const a = toCalendarDay(from);
  const b = toCalendarDay(to);
  if (!a || !b) return t('Worklogs');
  if (a.compare(b) === 0) return formatDayLong(from);
  const date = (day: typeof a) => new Date(day.year, day.month - 1, day.day);
  const short = (day: typeof a) => dateFormat({ day: 'numeric', month: 'short' }).format(date(day));
  if (a.year !== b.year) return `${short(a)} ${a.year} – ${short(b)} ${b.year}`;
  if (a.month !== b.month) return `${short(a)} – ${short(b)} ${b.year}`;
  return `${a.day} – ${b.day} ${dateFormat({ month: 'long' }).format(date(b))} ${b.year}`;
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
  const comment = log.comment?.trim();
  return (
    <tr>
      <td className={styles.mono}>{start ? formatClockTime(start) : log.timestamp}</td>
      <td>
        <div className={styles.workItem}>
          {ticket !== null ? (
            <span className={styles.ticket}>
              <TicketLink ticketId={ticket} title={items?.[String(ticket)]?.title ?? (comment || t('Azure ticket #{ticket}', { ticket }))} />
            </span>
          ) : (
            <span>
              {comment || t('Unassigned time')}
              <span className={styles.caption}>{` · ${t('no ticket')}`}</span>
            </span>
          )}
          {ticket !== null && comment ? <span className={styles.caption}>{comment}</span> : null}
          {track.error ? <span className={styles.error}>{track.error.message}</span> : null}
        </div>
      </td>
      <td>{log.activityType?.name ? <ActivityChip name={log.activityType.name} colorIndex={colorIndex} /> : <span className={styles.caption}>—</span>}</td>
      <td className={styles.end}>
        <span className={styles.duration}>{formatShortDuration(log.length)}</span>
      </td>
      <td className={cx(styles.end, shared.noWrap)}>
        {ticket !== null ? (
          <Button
            size="small"
            icon={PlayIcon}
            isDisabled={trackDisabled}
            onPress={() => void track.run({ type: 'tracking.chooseTicket', ticketId: ticket, surface: 'picker' })}
            aria-label={t('Track again, #{ticket}', { ticket })}
          >
            {t('Track again')}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * The day's worklogs as a thin bar of activity-coloured spans (the design's mini strip). Purely
 * decorative: the rows below list the same times.
 */
function MiniStrip({ day, logs, colorOf }: { day: string; logs: readonly WorkLog[]; colorOf: ColorOf }) {
  const spans = logs.flatMap((log) => {
    const start = logStart(log);
    const end = logEnd(log);
    return start && end && end > start ? [{ log, start: start.getTime(), end: end.getTime() }] : [];
  });
  if (spans.length === 0) return <span />;
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
  title,
  logs,
  items,
  trackDisabled,
  colorOf,
}: {
  day: string | null;
  title: string;
  logs: WorkLog[];
  items: WorkItemsSlice | undefined;
  trackDisabled: boolean;
  colorOf: ColorOf;
}) {
  return (
    <tbody className={styles.dayGroup}>
      <tr>
        <th colSpan={5} scope="colgroup" className={styles.dayHeader}>
          <div className={styles.dayHeaderGrid}>
            <Heading level={2} className={styles.dayTitle}>
              {title}
            </Heading>
            {day ? <MiniStrip day={day} logs={logs} colorOf={colorOf} /> : <span />}
            <span className={styles.duration}>{formatShortDuration(totalLength(logs))}</span>
          </div>
        </th>
      </tr>
      {logs.map((log) => (
        <LogRow key={log.id} log={log} items={items} trackDisabled={trackDisabled} colorIndex={colorOf(log)} />
      ))}
    </tbody>
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
  const colorOf = useLogColors(history.logs);

  if (filtered.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={HistoryIcon}
          headingLevel={2}
          title={history.loaded ? t('No worklogs in this view') : t('Your worklogs are waiting')}
          description={history.loaded ? t('Change the date range or clear the filter.') : t('Connect to 7pace in Settings to load your real worklogs.')}
        />
      </Card>
    );
  }
  return (
    <>
      <Card padding="none" className={styles.tableCard}>
        <div className={styles.scroll}>
          <table className={styles.table} aria-label={t('Worklogs')}>
            <thead>
              <tr>
                <th scope="col" className={styles.startColumn}>
                  {t('Start')}
                </th>
                <th scope="col">{t('Work item')}</th>
                <th scope="col" className={styles.activityColumn}>
                  {t('Activity')}
                </th>
                <th scope="col" className={styles.end}>
                  {t('Duration')}
                </th>
                <th scope="col" className={styles.end}>
                  <span className="visually-hidden">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            {days.map(([day, logs]) => (
              <DayGroup key={day} day={day} title={formatDayLong(day)} logs={logs} items={items} trackDisabled={trackDisabled} colorOf={colorOf} />
            ))}
            {unknown.length > 0 ? (
              <DayGroup day={null} title={t('Unrecognized dates from 7pace')} logs={unknown} items={items} trackDisabled={trackDisabled} colorOf={colorOf} />
            ) : null}
          </table>
        </div>
      </Card>
      {filtered.length > shownCount ? (
        <div className={styles.more}>
          <span className={styles.caption}>{t('Showing {shown} of {total} worklogs', { shown: shownCount, total: filtered.length })}</span>
          <Button onPress={() => setVisible((count) => count + HISTORY_PAGE_SIZE)}>{t('Show more worklogs')}</Button>
        </div>
      ) : null}
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  // 2.6 entries carry `attention`; older ones only said so in their English title.
  const Icon = entry.attention || entry.title.toLocaleLowerCase().includes('attention') ? AttentionIcon : CircleIcon;
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
        <EmptyState icon={InboxIcon} headingLevel={2} title={t('A quiet beginning')} description={t('Branch changes and tracking decisions will appear here.')} />
      </Card>
    );
  }
  const shown = audit.slice(0, visible);
  return (
    <Card padding="none" className={styles.auditCard}>
      <ol role="list" className={styles.audit} aria-label={t('App activity, newest first')}>
        {shown.map((entry) => (
          <AuditRow key={entry.id} entry={entry} />
        ))}
      </ol>
      {audit.length > shown.length ? (
        <div className={styles.more}>
          <span className={styles.caption}>{t('Showing {shown} of {total} entries', { shown: shown.length, total: audit.length })}</span>
          <Button onPress={() => setVisible((count) => count + AUDIT_PAGE_SIZE)}>{t('Show more activity')}</Button>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Timesheet · List (2.2 "S2c", the 1.14 History): 7pace worklogs by range, grouped by day with a
 * strip of each day, Track again, CSV export, and the App activity log.
 */
export function ListView() {
  const history = useSlice('history');
  const connection = useSlice('connection');
  const app = useSlice('app');
  const items = useSlice('workItems');
  const load = useAction();
  const range = useAction();
  const { exportCsv, pending: exporting, error: exportError } = useCsvExport();
  const [source, setSource] = useState<ListSource>('worklogs');
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useEngineDraft(history?.from ?? '');
  const [to, setTo] = useEngineDraft(history?.to ?? '');
  const [customOpen, setCustomOpen] = useState(false);

  const connected = connection?.connected ?? false;
  const loading = history?.loading ?? false;
  const canExport = !!history && history.logs.length > 0 && !exporting;
  const preset = presetOf(from, to);
  const choice: RangeChoice = customOpen || !preset ? 'custom' : preset;

  const runLoad = () => void load.run({ type: 'history.load' });
  const changeRange = (nextFrom: string, nextTo: string, andLoad = false) => {
    setFrom(nextFrom);
    setTo(nextTo);
    void range.run({ type: 'history.setRange', from: nextFrom, to: nextTo }).then((result) => {
      if (result.ok && andLoad) runLoad();
    });
  };
  const step = (direction: -1 | 1) => {
    const a = toCalendarDay(from);
    const b = toCalendarDay(to);
    if (!a || !b) return;
    const days = (b.compare(a) + 1) * direction;
    changeRange(a.add({ days }).toString(), b.add({ days }).toString(), true);
  };

  useRefreshShortcut(runLoad, { isDisabled: !connected || loading, label: t('Refresh worklogs') });
  useCommands([
    {
      id: 'history.export',
      icon: DownloadIcon,
      label: t('Export worklogs as CSV…'),
      group: 'Actions',
      keywords: ['history', 'csv', 'export'],
      isDisabled: !canExport,
      onAction: () => void exportCsv(),
    },
    {
      id: 'history.activity',
      icon: HistoryIcon,
      label: source === 'activity' ? t('Show 7pace worklogs') : t('Show App activity'),
      group: 'Actions',
      keywords: ['history', 'audit', 'activity', 'worklogs'],
      onAction: () => setSource(source === 'activity' ? 'worklogs' : 'activity'),
    },
  ]);

  const filtered = useMemo(
    () => (history?.logs ?? []).filter((log) => matches(log, filter.trim(), items)),
    [history?.logs, filter, items],
  );
  const tickets = new Set(filtered.map(logTicket).filter((id) => id !== null)).size;
  const subtitle = history?.loaded
    ? [
        formatShortDuration(totalLength(filtered)),
        tn(filtered.length, '{count} worklog', '{count} worklogs'),
        tn(tickets, '{count} ticket', '{count} tickets'),
      ].join(' · ')
    : loading
      ? t('Loading…')
      : t('Not loaded yet');
  const today = localToday().toString();

  const header = (
    <TimesheetHeader
      view="list"
      before={
        <StepButtons
          unit="range"
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          isPreviousDisabled={loading || !connected || !from || !to}
          isNextDisabled={loading || !connected || !to || to >= today}
        />
      }
      title={formatRangeTitle(from, to)}
      subtitle={subtitle}
      controls={
        <Button icon={ExportIcon} isDisabled={!canExport} isPending={exporting} onPress={() => void exportCsv()}>
          {t('Export CSV')}
        </Button>
      }
    />
  );

  if (!history) {
    return (
      <>
        {header}
        <div className={styles.page} aria-busy="true">
          <span role="status" className="visually-hidden">
            {t('Loading worklogs')}
          </span>
          <Skeleton lines={2} />
          <Skeleton shape="rect" height="14rem" />
        </div>
      </>
    );
  }

  // The engine reports failed loads and exports in the slice; a rejected intent with the same
  // message is not shown twice.
  const issue = history.issue ?? null;
  const rejected = load.error ?? range.error ?? null;
  const failure = rejected && rejected.message !== issue ? rejected : null;

  return (
    <>
      {header}
      {issue ? (
        <Banner
          tone="error"
          title={t('Worklogs could not be loaded')}
          actions={
            <Button size="small" isDisabled={loading || !connected} isPending={load.pending} onPress={runLoad}>
              {t('Retry')}
            </Button>
          }
        >
          {issue}
        </Banner>
      ) : null}
      {failure ? <Banner tone="error">{failure.message}</Banner> : null}
      {exportError && exportError !== issue ? <Banner tone="error">{exportError}</Banner> : null}
      <TabsRoot selectedKey={source} onSelectionChange={(key) => setSource(key === 'activity' ? 'activity' : 'worklogs')} className={styles.tabs}>
        <div className={styles.sourceRow}>
          <TabList aria-label={t('List source')} className={styles.sourceTabs}>
            <Tab id="worklogs">{t('7pace worklogs')}</Tab>
            <Tab id="activity">{t('App activity')}</Tab>
          </TabList>
          {source === 'worklogs' ? (
            <div className={styles.controls}>
              <SegmentedControl<RangeChoice>
                label={t('Range')}
                hideLabel
                options={PRESETS.map((entry) => ({ ...entry, label: t(entry.label), isDisabled: entry.id !== 'custom' && (loading || !connected) }))}
                selectedKey={choice}
                onSelectionChange={(key) => {
                  if (key === 'custom') {
                    setCustomOpen(true);
                    return;
                  }
                  setCustomOpen(false);
                  const next = presetRange(key);
                  changeRange(next.from, next.to, true);
                }}
              />
              <SearchField label={t('Filter tickets')} hideLabel value={filter} onChange={setFilter} placeholder={t('Filter tickets')} width="auto" className={shared.listFilter} />
            </div>
          ) : null}
        </div>
        <TabPanel id="worklogs" className={styles.panel}>
          {choice === 'custom' ? (
            <div className={styles.custom} role="group" aria-label={t('Custom range')}>
              <DatePicker
                label={t('From')}
                value={toCalendarDay(from)}
                maxValue={localToday()}
                onChange={(value) => {
                  if (value) changeRange(value.toString(), to);
                }}
              />
              <DatePicker
                label={t('To')}
                value={toCalendarDay(to)}
                maxValue={localToday()}
                onChange={(value) => {
                  if (value) changeRange(from, value.toString());
                }}
              />
              <Button variant="primary" isDisabled={loading || !connected} onPress={runLoad}>
                {t('Load')}
              </Button>
            </div>
          ) : null}
          {loading ? (
            <span role="status" className={styles.loadingNote}>
              <SpinnerIcon className={styles.spinner} />
              {t('Loading worklogs…')}
            </span>
          ) : null}
          <LoadingRegion
            label={t('Loading worklogs…')}
            isLoading={loading && !history.loaded}
            placeholder={
              <div className={styles.panel}>
                <Skeleton shape="rect" height="5rem" />
                <Skeleton lines={5} />
              </div>
            }
          >
            <Worklogs key={`${history.from}|${history.to}|${filter}`} history={history} filter={filter} trackDisabled={(app?.busy ?? false) || !connected} />
          </LoadingRegion>
        </TabPanel>
        <TabPanel id="activity" className={styles.panel}>
          <AppActivity audit={history.audit} />
        </TabPanel>
      </TabsRoot>
    </>
  );
}
