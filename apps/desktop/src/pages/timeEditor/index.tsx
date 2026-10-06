import { useEffect, useId, useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { SearchField } from '../../components/Fields';
import { WarningIcon } from '../../components/icons';
import { PageRefresh } from '../../features/app/PageHeaderActions';
import { useEchoDraft, useEngineDraft } from '../../features/ticketContext/drafts';
import { deviceName, formatDayLong, localToday, toCalendarDay } from '../../features/ticketContext/format';
import { useCommands } from '../../shortcuts/hooks';
import { usePlatform } from '../../shortcuts/platform';
import { useAction, useSlice } from '../../state/hooks';
import { CorrectionsSheet } from './CorrectionsSheet';
import { EditSheet } from './EditSheet';
import { EntriesTable } from './EntriesTable';
import { OverlapNotice } from './PlanPreview';
import { RecentEditsSheet } from './RecentEditsSheet';
import styles from './TimeEditor.module.css';

/**
 * Time editor (1.14 `TimeEditorView`): the day's 7pace entries with edit, split, merge and undo,
 * guided gap and overlap corrections, and the recovery journal. Every write goes through an
 * explicit confirmation and `timeEditor.save`; the engine re-reads 7pace before it writes.
 */
export default function TimeEditorPage() {
  const editor = useSlice('timeEditor');
  const app = useSlice('app');
  const connection = useSlice('connection');
  const items = useSlice('workItems');
  const flow = useSlice('flow');
  const platform = usePlatform();

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

  const { run: runLoad } = load;
  // 1.14 loaded the day whenever the page appeared.
  useEffect(() => {
    void runLoad({ type: 'timeEditor.load' });
  }, [runLoad]);

  const busy = app?.busy ?? false;
  const working = editor?.working ?? false;
  const loading = editor?.loading ?? false;
  const blocked = working || busy;

  const openCorrections = () => {
    void corrections.run({ type: 'timeEditor.showCorrections', show: true }).then(() => corrections.run({ type: 'timeEditor.loadCorrections' }));
  };
  const beginMerge = () => void merge.run({ type: 'timeEditor.beginMerge' });

  useCommands([
    {
      id: 'timeEditor.corrections',
      label: 'Gaps & overlaps…',
      group: 'Actions',
      keywords: ['time editor', 'gaps', 'overlaps', 'corrections'],
      isDisabled: !editor || blocked || loading,
      onAction: openCorrections,
    },
    {
      id: 'timeEditor.recentEdits',
      label: 'Recent edits',
      group: 'Actions',
      keywords: ['time editor', 'journal', 'undo', 'history'],
      isDisabled: !editor,
      onAction: () => setRecentOpen(true),
    },
    {
      id: 'timeEditor.merge',
      label: 'Merge selected entries…',
      group: 'Actions',
      keywords: ['time editor', 'merge'],
      isDisabled: !editor || editor.selection.length < 2 || blocked,
      onAction: beginMerge,
    },
  ]);

  if (!editor) {
    return (
      <div className={styles.page} aria-busy="true">
        <span role="status" className="visually-hidden">
          Loading the time editor
        </span>
        <Skeleton lines={2} />
        <Skeleton shape="rect" height="16rem" />
      </div>
    );
  }

  const configured = !!connection && connection.health !== 'unconfigured';
  const preview = app?.preview ?? false;
  const device = deviceName(app?.os);
  const selected = editor.selected;
  const showCorrections = editor.corrections.show;
  const showRecent = recentOpen && !showCorrections;
  const actionError = merge.error ?? select.error ?? corrections.error ?? selection.error ?? setDay.error ?? null;

  return (
    <div className={styles.page}>
      <PageRefresh
        onRefresh={() => void load.run({ type: 'timeEditor.load' })}
        isRefreshing={loading}
        isDisabled={blocked || !!selected}
        label="Refresh"
      />
      <p className={styles.intro}>Edit recorded time in 7pace. Overlap warnings are informational and do not block saving.</p>

      <div className={styles.toolbar}>
        <DatePicker
          label="Worklog date"
          value={toCalendarDay(day)}
          maxValue={localToday()}
          onChange={(value) => {
            if (!value) return;
            const next = value.toString();
            setDayDraft(next);
            void setDay.run({ type: 'timeEditor.setDay', day: next });
          }}
          isDisabled={blocked}
        />
        <SearchField
          label="Filter"
          placeholder="Filter by ticket number or comment"
          value={filter}
          onChange={(text) => {
            setFilterDraft(text);
            void setFilter.run({ type: 'timeEditor.setFilter', text });
          }}
          isDisabled={blocked}
          className={styles.filter}
        />
      </div>

      {editor.requiresReview ? (
        <Banner
          tone="warning"
          title="An earlier change needs review"
          actions={
            <Button size="small" onPress={() => setRecentOpen(true)}>
              Open Recent edits
            </Button>
          }
        >
          Open Recent edits before making another change.
        </Banner>
      ) : null}
      {editor.journalIssue ? <Banner tone="warning">{editor.journalIssue}</Banner> : null}
      {editor.message ? <Banner tone="success">{editor.message}</Banner> : null}
      {editor.savedConflicts.length > 0 || editor.savedOverlapIssue ? (
        <details className={styles.savedNotice}>
          <summary>
            <WarningIcon className={styles.warningIcon} />
            {editor.savedConflicts.length === 0 ? 'Overlap check incomplete' : 'Saved with overlapping time'}
          </summary>
          <OverlapNotice conflicts={editor.savedConflicts} issue={editor.savedOverlapIssue} saved />
        </details>
      ) : null}
      {!selected && editor.issue ? <Banner tone="warning">{editor.issue}</Banner> : null}
      {actionError ? <Banner tone="error">{actionError.message}</Banner> : null}

      <section aria-labelledby={headingId} className={styles.entries}>
        <div className={styles.sectionHeader}>
          <Heading level={2} id={headingId} className={styles.sectionTitle}>
            {day ? `Entries · ${formatDayLong(day)}` : 'Entries'}
          </Heading>
          <div className={styles.actions}>
            <Button isDisabled={editor.selection.length < 2 || blocked} isPending={merge.pending} onPress={beginMerge}>
              Merge selected…
            </Button>
            <Button isDisabled={blocked || loading} onPress={openCorrections}>
              Gaps & overlaps…
            </Button>
            <Button onPress={() => setRecentOpen(true)}>Recent edits</Button>
          </div>
        </div>
        <p className={styles.caption}>
          {`Select adjacent entries using the checkboxes or ${platform === 'windows' ? 'Ctrl-click' : '⌘-click'}.`}
        </p>
        <LoadingRegion
          label="Loading tracked time…"
          isLoading={loading}
          placeholder={<Skeleton shape="rect" height="12rem" />}
        >
          <EntriesTable
            logs={editor.logs}
            items={items}
            selection={editor.selection}
            runningLogId={editor.runningLogId}
            disabled={blocked}
            labelledBy={headingId}
            emptyMessage={
              configured || preview ? 'No entries match this date or filter.' : 'Connect to 7pace in Settings to edit your recorded time.'
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
    </div>
  );
}
