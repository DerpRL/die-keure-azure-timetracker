import { useId, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card, Heading } from '../../../components/Card';
import { DatePicker } from '../../../components/DateFields';
import { LoadingRegion, Skeleton } from '../../../components/EmptyState';
import { SearchField } from '../../../components/Fields';
import { HistoryIcon, MergeIcon, PlusIcon, WarningIcon } from '../../../components/icons';
import { useEchoDraft, useEngineDraft } from '../../../features/ticketContext/drafts';
import { deviceName, formatDayLong, localToday, toCalendarDay } from '../../../features/ticketContext/format';
import { useCommands, useRefreshShortcut } from '../../../shortcuts/hooks';
import { usePlatform } from '../../../shortcuts/platform';
import { useAction, useSlice } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import { DraftEditor } from '../drafts/DraftSheets';
import { newPastDraft } from '../drafts/labels';
import { StepButtons, TimesheetHeader } from '../TimesheetHeader';
import { CorrectionsSheet } from './CorrectionsSheet';
import { DayOverview } from './DayOverview';
import { entryOverlaps, overlapSecondsById } from './dayModel';
import { EditSheet } from './EditSheet';
import { EntriesTable } from './EntriesTable';
import { OverlapNotice } from './PlanPreview';
import { RecentEditsSheet } from './RecentEditsSheet';
import styles from './TimeEditor.module.css';
import shared from '../timesheet.module.css';
import { cx } from '../../../utils/cx';
import { t, tn } from '../../../i18n';

/** The day before or after `day` (`YYYY-MM-DD`). */
function shiftDay(day: string, days: number): string | null {
  const date = toCalendarDay(day);
  return date ? date.add({ days }).toString() : null;
}

/**
 * Timesheet · Day (2.2 "S2b", the 1.14 Time editor): the day "On the clock" and its 7pace
 * entries with edit, split, merge and undo, guided gap and overlap corrections, and the recovery
 * journal. Every write goes through an explicit confirmation and `timeEditor.save`; the engine
 * re-reads 7pace before it writes.
 */
export function DayView() {
  const editor = useSlice('timeEditor');
  const app = useSlice('app');
  const connection = useSlice('connection');
  const items = useSlice('workItems');
  const flow = useSlice('flow');
  const offline = useSlice('offline');
  const review = useSlice('dayReview');
  const platform = usePlatform();
  const [adding, setAdding] = useState(false);

  const load = useAction();
  const setDay = useAction();
  const setFilter = useAction();
  const selection = useAction();
  const select = useAction();
  const merge = useAction();
  const corrections = useAction();
  const [recentOpen, setRecentOpen] = useState(false);
  const [day, setDayDraft] = useEngineDraft(editor?.day ?? '');
  const [filter, setFilterDraft] = useEchoDraft(editor?.filter ?? '');
  const headingId = useId();
  const clockId = useId();
  const overlaps = useMemo(() => entryOverlaps(editor?.logs ?? []), [editor?.logs]);
  const overlapById = useMemo(() => overlapSecondsById(overlaps), [overlaps]);

  const busy = app?.busy ?? false;
  const working = editor?.working ?? false;
  const loading = editor?.loading ?? false;
  const blocked = working || busy;

  // Opens the sheet (the engine sets `corrections.show`) and checks the day.
  const openCorrections = () => void corrections.run({ type: 'timeEditor.loadCorrections' });
  const beginMerge = () => void merge.run({ type: 'timeEditor.beginMerge' });

  useRefreshShortcut(() => void load.run({ type: 'timeEditor.load' }), {
    isDisabled: !editor || blocked || loading || !!editor.selected || !editor.configured,
    label: t('Refresh the day'),
  });

  useCommands([
    {
      id: 'timeEditor.corrections',
      icon: WarningIcon,
      label: t('Gaps & overlaps…'),
      group: 'Actions',
      keywords: ['time editor', 'gaps', 'overlaps', 'corrections'],
      isDisabled: !editor || blocked || loading,
      onAction: openCorrections,
    },
    {
      id: 'timeEditor.recentEdits',
      icon: HistoryIcon,
      label: t('Recent edits'),
      group: 'Actions',
      keywords: ['time editor', 'journal', 'undo', 'history'],
      isDisabled: !editor,
      onAction: () => setRecentOpen(true),
    },
    {
      id: 'timeEditor.merge',
      icon: MergeIcon,
      label: t('Merge selected entries…'),
      group: 'Actions',
      keywords: ['time editor', 'merge'],
      isDisabled: !editor || editor.selection.length < 2 || blocked,
      onAction: beginMerge,
    },
  ]);

  if (!editor) {
    return (
      <>
        <TimesheetHeader view="day" title={t('Day')} />
        <div className={styles.page} aria-busy="true">
          <span role="status" className="visually-hidden">
            {t('Loading the day')}
          </span>
          <Skeleton lines={2} />
          <Skeleton shape="rect" height="16rem" />
        </div>
      </>
    );
  }

  const configured = editor.configured;
  const preview = app?.preview ?? false;
  const device = deviceName(app?.os);
  const selected = editor.selected;
  const showCorrections = editor.corrections.show;
  const showRecent = recentOpen && !showCorrections;
  const actionError = merge.error ?? select.error ?? corrections.error ?? selection.error ?? setDay.error ?? load.error ?? null;
  const today = localToday().toString();
  const goTo = (next: string | null) => {
    if (!next) return;
    setDayDraft(next);
    void setDay.run({ type: 'timeEditor.setDay', day: next });
  };
  const total = editor.logs.reduce((sum, log) => sum + (Number.isFinite(log.length) ? Math.max(log.length, 0) : 0), 0);
  const target = review && review.selectedDay === editor.day && review.targetSeconds > 0 ? review.targetSeconds : 0;
  const count = editor.logs.length;
  const subtitle = loading
    ? t('Loading…')
    : [
        target ? t('{done} of {target}', { done: formatShortDuration(total), target: formatShortDuration(target) }) : formatShortDuration(total),
        tn(count, '{count} entry', '{count} entries'),
        overlaps.length > 0 ? tn(overlaps.length, '{count} overlap', '{count} overlaps') : null,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <>
      <TimesheetHeader
        view="day"
        before={
          <StepButtons
            unit="day"
            onPrevious={() => goTo(shiftDay(day, -1))}
            onNext={() => goTo(shiftDay(day, 1))}
            isPreviousDisabled={blocked || !day}
            isNextDisabled={blocked || !day || day >= today}
          />
        }
        title={day ? formatDayLong(day) : t('Day')}
        subtitle={subtitle}
        controls={
          <>
            <Button onPress={() => setRecentOpen(true)}>{t('Recent edits')}</Button>
            <Button variant="primary" icon={PlusIcon} isDisabled={!offline?.canCreate} onPress={() => setAdding(true)}>
              {t('Add time')}
            </Button>
          </>
        }
      />

      {editor.requiresReview ? (
        <Banner
          tone="warning"
          title={t('An earlier change needs review')}
          actions={
            <Button size="small" onPress={() => setRecentOpen(true)}>
              {t('Open Recent edits')}
            </Button>
          }
        >
          {t('Open Recent edits before making another change.')}
        </Banner>
      ) : null}
      {editor.journalIssue ? <Banner tone="warning">{editor.journalIssue}</Banner> : null}
      {editor.message ? <Banner tone="success">{editor.message}</Banner> : null}
      {editor.savedConflicts.length > 0 || editor.savedOverlapIssue ? (
        <details className={styles.savedNotice}>
          <summary>
            <WarningIcon className={styles.warningIcon} />
            {editor.savedConflicts.length === 0 ? t('Overlap check incomplete') : t('Saved with overlapping time')}
          </summary>
          <OverlapNotice conflicts={editor.savedConflicts} issue={editor.savedOverlapIssue} saved />
        </details>
      ) : null}
      {!selected && editor.issue ? <Banner tone="warning">{editor.issue}</Banner> : null}
      {actionError ? <Banner tone="error">{actionError.message}</Banner> : null}

      <Card as="section" aria-labelledby={clockId} className={styles.clockCard}>
        <div className={styles.sectionHeader}>
          <Heading level={2} id={clockId} className={styles.sectionTitle}>
            {t('On the clock')}
          </Heading>
          <p className={styles.caption}>{t('Gaps appear once Gaps & overlaps has checked the day.')}</p>
        </div>
        {!loading && editor.day && editor.logs.length > 0 ? (
          <DayOverview
            day={editor.day}
            today={today}
            logs={editor.logs}
            runningLogId={editor.runningLogId}
            overlaps={overlaps}
            issues={editor.corrections.issues}
          />
        ) : (
          <p className={styles.caption}>{loading ? t('Loading the day…') : t('Nothing recorded on this day.')}</p>
        )}
      </Card>

      <section aria-labelledby={headingId} className={styles.entries}>
        <div className={styles.toolbar}>
          <div className={styles.headingText}>
            <Heading level={2} id={headingId} className={styles.sectionTitle}>
              {day ? t('Entries · {day}', { day: formatDayLong(day) }) : t('Entries')}
            </Heading>
            <p className={styles.caption}>
              {platform === 'windows' ? t('Select adjacent entries using the checkboxes or Ctrl-click.') : t('Select adjacent entries using the checkboxes or ⌘-click.')}
            </p>
          </div>
          <div className={cx(styles.actions, shared.noWrap)}>
            <DatePicker
              label={t('Go to date')}
              hideLabel
              value={toCalendarDay(day)}
              maxValue={localToday()}
              onChange={(value) => {
                if (value) goTo(value.toString());
              }}
              isDisabled={blocked}
            />
            <SearchField
              label={t('Filter')}
              hideLabel
              placeholder={t('Filter by ticket or comment')}
              value={filter}
              onChange={(text) => {
                setFilterDraft(text);
                void setFilter.run({ type: 'timeEditor.setFilter', text });
              }}
              isDisabled={blocked}
              width="auto"
              className={shared.dayFilter}
            />
            <Button isDisabled={editor.selection.length < 2 || blocked} isPending={merge.pending} onPress={beginMerge}>
              {t('Merge selected…')}
            </Button>
            <Button isDisabled={blocked || loading} onPress={openCorrections}>
              {t('Gaps & overlaps…')}
            </Button>
          </div>
        </div>
        <LoadingRegion label={t('Loading tracked time…')} isLoading={loading} placeholder={<Skeleton shape="rect" height="12rem" />}>
          <EntriesTable
            className={shared.noWrap}
            logs={editor.logs}
            items={items}
            selection={editor.selection}
            runningLogId={editor.runningLogId}
            overlaps={overlapById}
            overlapCount={overlaps.length}
            longSeconds={(review?.longEntryMinutes ?? 180) * 60}
            disabled={blocked}
            labelledBy={headingId}
            emptyMessage={
              configured || preview ? t('No entries match this date or filter.') : t('Connect to 7pace in Settings to edit your recorded time.')
            }
            onSelectionChange={(ids) => void selection.run({ type: 'timeEditor.setSelection', ids })}
            onEdit={(log) => void select.run({ type: 'timeEditor.select', logId: log.id })}
          />
        </LoadingRegion>
      </section>

      {showCorrections ? (
        <CorrectionsSheet
          day={editor.day}
          issues={editor.corrections.issues}
          choices={editor.corrections.choices}
          loading={editor.corrections.loading}
          issue={editor.corrections.issue}
          working={working}
          busy={busy}
          items={items}
        />
      ) : null}
      <RecentEditsSheet
        isOpen={showRecent}
        onClose={() => setRecentOpen(false)}
        changes={editor.changes}
        requiresReview={editor.requiresReview}
        journalIssue={editor.journalIssue}
        disabled={blocked}
        device={device}
        workspaceUrl={connection?.workspace || null}
      />
      {selected && !showCorrections && !showRecent ? (
        <EditSheet editor={{ ...editor, selected }} items={items} activities={flow?.activityTypes ?? []} busy={busy} preview={preview} />
      ) : null}
      {adding && offline ? (
        <DraftEditor
          draft={newPastDraft(offline.workspace)}
          activities={offline.activities}
          working={offline.working}
          device={device}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}
