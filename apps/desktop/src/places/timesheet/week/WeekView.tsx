import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { LoadingRegion, Skeleton } from '../../../components/EmptyState';
import { SearchField } from '../../../components/Fields';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../../../components/icons';
import { activityColorIndex, useActivityColors } from '../../../features/activity';
import { deviceName, localToday, toCalendarDay } from '../../../features/ticketContext/format';
import { useNavigation } from '../../../layout/NavigationContext';
import { useCommands } from '../../../shortcuts/hooks';
import { useAction, useNow, useSlice } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import { EditSheet } from '../day/EditSheet';
import { DraftEditor } from '../drafts/DraftSheets';
import { newPastDraft } from '../drafts/labels';
import { StepButtons, TimesheetHeader } from '../TimesheetHeader';
import { useCsvExport } from '../useCsvExport';
import { ExportIcon } from '../icons';
import { OverlapNotice } from '../day/PlanPreview';
import { NeedsLook } from './NeedsLook';
import { NewEntryDialog } from './NewEntryDialog';
import { SelectedEntry } from './SelectedEntry';
import { WeekCalendar } from './WeekCalendar';
import { blockLanes, buildWeek, dayToLookAt, formatWeekTitle, mondayOf, visibleHours, weekRange, type WeekBlock } from './weekModel';
import styles from './week.module.css';
import shared from '../timesheet.module.css';
import { cx } from '../../../utils/cx';
import { t, tn } from '../../../i18n';

/**
 * Timesheet · Week (2.2 "S2 · Timesheet"): the week's 7pace worklogs, offline drafts and the
 * running timer as a calendar. Choosing a block opens it in "Selected entry"; the day that needs a
 * second look gets its own card. The week loads through the history range (`history.setRange`).
 */
export function WeekView() {
  const history = useSlice('history');
  const editor = useSlice('timeEditor');
  const offline = useSlice('offline');
  const tracking = useSlice('tracking');
  const progress = useSlice('progress');
  const review = useSlice('dayReview');
  const items = useSlice('workItems');
  const flow = useSlice('flow');
  const app = useSlice('app');
  const navigation = useNavigation();
  const colors = useActivityColors();
  const now = useNow();
  const today = localToday();

  const setRange = useAction();
  const load = useAction();
  const select = useAction();
  const cancel = useAction();
  const prepare = useAction();
  const { exportCsv, pending: exporting, error: exportError } = useCsvExport();

  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lookDay, setLookDay] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState<{ start: number; end: number } | null>(null);
  const [futureDrag, setFutureDrag] = useState(false);

  // Load the week through the history range when it changes.
  const range = weekRange(weekStart, today);
  const { run: runRange } = setRange;
  const { run: runLoad } = load;
  const historyFrom = history?.from;
  const historyTo = history?.to;
  const requested = useRef<string | null>(null);
  useEffect(() => {
    const key = `${range.from}|${range.to}`;
    if ((historyFrom === range.from && historyTo === range.to) || requested.current === key) return;
    requested.current = key;
    void runRange({ type: 'history.setRange', from: range.from, to: range.to }).then((result) => {
      if (result.ok) void runLoad({ type: 'history.load' });
    });
  }, [range.from, range.to, historyFrom, historyTo, runRange, runLoad]);

  const activityNames = useMemo(
    () => new Map((offline?.activities ?? []).map((activity) => [activity.id, activity.name ?? t('Activity')])),
    [offline?.activities],
  );
  // The calendar follows the clock to the minute (the running block, the now line).
  const minute = Math.floor(now / 60_000) * 60_000;
  const todayKey = today.toString();
  const days = useMemo(
    () =>
      buildWeek({
        weekStart,
        today: toCalendarDay(todayKey)!,
        now: minute,
        logs: history?.logs ?? [],
        drafts: offline?.drafts ?? [],
        tracking,
        runningLogId: editor?.runningLogId ?? null,
        items,
        longEntryMinutes: review?.longEntryMinutes ?? 180,
        gapMinutes: review?.gapMinutes ?? 20,
        filter,
        activityNames,
      }),
    [history?.logs, offline?.drafts, tracking, editor?.runningLogId, items, review?.longEntryMinutes, review?.gapMinutes, filter, activityNames, weekStart, todayKey, minute],
  );

  const hours = useMemo(() => visibleHours(days), [days]);
  const lanes = useMemo(() => {
    const result = new Map<string, { lane: number; lanes: number }>();
    for (const day of days) for (const [id, lane] of blockLanes(day.blocks)) result.set(id, lane);
    return result;
  }, [days]);
  const legend = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; colorIndex: number }>();
    for (const day of days)
      for (const block of day.blocks) {
        const id = block.activityId ?? '';
        if (!seen.has(id) && block.activityName) seen.set(id, { id: id || 'none', name: block.activityName, colorIndex: activityColorIndex(colors, block.activityId) });
      }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [days, colors]);

  const selected: WeekBlock | null = useMemo(
    () => days.flatMap((day) => day.blocks).find((block) => block.id === selectedId && block.kind !== 'draft') ?? null,
    [days, selectedId],
  );
  const look = dayToLookAt(days, lookDay);

  // Forget the selection once the time editor let go of the entry (saved, cancelled elsewhere).
  const loadedRef = useRef(false);
  const editorSelectedId = editor?.selected?.id ?? null;
  useEffect(() => {
    if (!selectedId) return;
    if (editorSelectedId === selectedId) loadedRef.current = true;
    else if (loadedRef.current && !editor?.working) {
      loadedRef.current = false;
      setSelectedId(null);
      setSheetOpen(false);
    }
  }, [editorSelectedId, selectedId, editor?.working]);

  const choose = (block: WeekBlock) => {
    if (block.kind === 'draft') {
      navigation?.navigate({ place: 'timesheet', view: 'drafts' });
      return;
    }
    loadedRef.current = false;
    setSelectedId(block.id);
    setLookDay(block.day);
    if (block.kind === 'log' && !block.locked) void select.run({ type: 'timeEditor.select', logId: block.id });
  };
  const close = () => {
    if (editor?.selected) void cancel.run({ type: 'timeEditor.cancel' });
    loadedRef.current = false;
    setSelectedId(null);
    setSheetOpen(false);
  };
  const openDay = async (day: string, corrections = false) => {
    const result = await prepare.run({ type: 'timeEditor.setDay', day });
    if (result.ok && corrections) await prepare.run({ type: 'timeEditor.loadCorrections' });
    navigation?.navigate({ place: 'timesheet', view: 'day' });
  };

  const isCurrentWeek = mondayOf(today).compare(weekStart) === 0;
  const total = days.reduce((sum, day) => sum + day.seconds, 0);
  const draftCount = days.reduce((sum, day) => sum + day.drafts.length, 0);
  const target = isCurrentWeek && progress?.available && progress.weekTarget > 0 ? progress.weekTarget : 0;
  const subtitle = [
    target ? t('{done} of {target}', { done: formatShortDuration(total), target: formatShortDuration(target) }) : formatShortDuration(total),
    draftCount > 0 ? tn(draftCount, '{count} draft not uploaded', '{count} drafts not uploaded') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const first = days[0]?.date ?? weekStart;
  const last = days.at(-1)?.date ?? weekStart.add({ days: 4 });
  const canAdd = !!offline?.canCreate;
  // Dragging writes to 7pace directly: it needs a connection and an editor that is free.
  const canCreate = !!editor?.configured && !editor.requiresReview;
  const canExport = !!history && history.logs.length > 0 && !exporting;
  const busy = app?.busy ?? false;
  const failure = setRange.error ?? load.error ?? select.error ?? prepare.error ?? null;

  useCommands([
    {
      id: 'timesheet.previousWeek',
      icon: ChevronLeftIcon,
      label: t('Previous week'),
      group: 'Actions',
      keywords: ['timesheet', 'week'],
      onAction: () => setWeekStart((week) => week.subtract({ weeks: 1 })),
    },
    {
      id: 'timesheet.nextWeek',
      icon: ChevronRightIcon,
      label: t('Next week'),
      group: 'Actions',
      keywords: ['timesheet', 'week'],
      isDisabled: isCurrentWeek,
      onAction: () => setWeekStart((week) => week.add({ weeks: 1 })),
    },
  ]);

  return (
    <>
      <TimesheetHeader
        view="week"
        before={
          <StepButtons
            unit="week"
            onPrevious={() => setWeekStart((week) => week.subtract({ weeks: 1 }))}
            onNext={() => setWeekStart((week) => week.add({ weeks: 1 }))}
            isNextDisabled={isCurrentWeek}
          />
        }
        title={formatWeekTitle(first, last)}
        subtitle={subtitle}
        controls={
          <>
            <SearchField
              label={t('Filter entries')}
              hideLabel
              placeholder={t('Filter by ticket or comment')}
              value={filter}
              onChange={setFilter}
              width="auto"
              className={shared.weekFilter}
            />
            <Button icon={ExportIcon} isDisabled={!canExport} isPending={exporting} onPress={() => void exportCsv()}>
              {t('Export CSV')}
            </Button>
            <Button variant="primary" icon={PlusIcon} isDisabled={!canAdd} onPress={() => setAdding(true)}>
              {t('Add time')}
            </Button>
          </>
        }
      />
      {history?.issue ? (
        <Banner
          tone="error"
          title={t('Worklogs could not be loaded')}
          actions={
            <Button size="small" isPending={load.pending} onPress={() => void load.run({ type: 'history.load' })}>
              {t('Retry')}
            </Button>
          }
        >
          {history.issue}
        </Banner>
      ) : null}
      {failure ? <Banner tone="error">{failure.message}</Banner> : null}
      {exportError ? <Banner tone="error">{exportError}</Banner> : null}
      {editor?.requiresReview ? (
        <Banner
          tone="warning"
          title={t('An earlier change needs review')}
          actions={
            <Button size="small" onPress={() => navigation?.navigate({ place: 'timesheet', view: 'day' })}>
              {t('Review in Day')}
            </Button>
          }
        >
          {t('A change to your time may not have been saved completely. Check it in Recent edits (Day view) before you drag to add time.')}
        </Banner>
      ) : null}
      {futureDrag && canCreate ? (
        <Banner tone="info" onDismiss={() => setFutureDrag(false)}>
          {t('7pace only takes time that has already passed. Drag over earlier time, or use Add time for a draft.')}
        </Banner>
      ) : null}
      {editor?.message && !selectedId ? <Banner tone="success">{editor.message}</Banner> : null}
      {editor?.message && !selectedId && (editor.savedConflicts.length > 0 || editor.savedOverlapIssue) ? (
        <Banner tone="warning" title={editor.savedConflicts.length === 0 ? t('Overlap check incomplete') : t('Saved with overlapping time')}>
          <OverlapNotice conflicts={editor.savedConflicts} issue={editor.savedOverlapIssue} saved />
        </Banner>
      ) : null}
      <LoadingRegion
        label={t('Loading the week…')}
        isLoading={!history || (history.loading && !history.loaded)}
        placeholder={<Skeleton shape="rect" height="24rem" />}
      >
        <div className={styles.layout}>
          <WeekCalendar
            days={days}
            hours={hours}
            lanes={lanes}
            colors={colors}
            selectedId={selected?.id ?? null}
            now={now}
            onSelect={choose}
            legend={legend}
            onCreate={
              canCreate
                ? (span) => {
                    setFutureDrag(false);
                    setCreating(span);
                  }
                : undefined
            }
            onFutureDrag={() => setFutureDrag(true)}
          />
          {selected || look ? (
            <aside aria-label={t('Entry details')} className={cx(styles.side, shared.noWrap)}>
              {selected ? (
                <SelectedEntry
                  block={selected}
                  onClose={close}
                  onMoreOptions={() => setSheetOpen(true)}
                  onOpenDay={() => void openDay(selected.day)}
                />
              ) : null}
              {look ? (
                <NeedsLook
                  day={look}
                  onFix={() => void openDay(look.key, true)}
                  onOpenDrafts={() => navigation?.navigate({ place: 'timesheet', view: 'drafts' })}
                  onSelect={choose}
                />
              ) : null}
            </aside>
          ) : null}
        </div>
      </LoadingRegion>
      {sheetOpen && editor?.selected && editor.selected.id === selectedId ? (
        <EditSheet
          editor={{ ...editor, selected: editor.selected }}
          items={items}
          activities={flow?.activityTypes ?? []}
          busy={busy}
          preview={app?.preview ?? false}
        />
      ) : null}
      {creating ? (
        <NewEntryDialog
          start={creating.start}
          end={creating.end}
          activities={flow?.activityTypes.length ? flow.activityTypes : (offline?.activities ?? [])}
          defaultActivityId={flow?.defaultActivityId || null}
          busy={busy || !!editor?.working}
          onClose={() => setCreating(null)}
        />
      ) : null}
      {adding && offline ? (
        <DraftEditor
          draft={newPastDraft(offline.workspace)}
          activities={offline.activities}
          working={offline.working}
          device={deviceName(app?.os)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}
