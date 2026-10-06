import { useEffect, useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { Dialog } from '../../components/Dialog';
import { Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { ChevronLeftIcon, ChevronRightIcon, SpinnerIcon } from '../../components/icons';
import { useToast } from '../../components/Toast';
import { PageRefresh } from '../../features/app/PageHeaderActions';
import { useEchoDraft } from '../../features/ticketContext/drafts';
import { deviceName, formatClockTime, formatDayShort, instantToDay, localToday, parseInstant } from '../../features/ticketContext/format';
import { chooseSavePath, copyToClipboard } from '../../features/ticketContext/native';
import { useCommands } from '../../shortcuts/hooks';
import { ipcErrorKind, useAction, useSlice } from '../../state/hooks';
import styles from './WeeklyReport.module.css';

/**
 * Weekly report (1.14 `WeeklyReportView`): an editable Markdown status update generated from the
 * week's worklogs. The engine stores the draft (debounced) and writes exports; the clipboard copy
 * stays in the UI.
 */
export default function WeeklyReportPage() {
  const weekly = useSlice('weekly');
  const app = useSlice('app');
  const connection = useSlice('connection');
  const toast = useToast();
  const refresh = useAction();
  const navigate = useAction();
  const generator = useAction();
  const text = useAction();
  const exporter = useAction();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [draft, setDraft] = useEchoDraft(weekly?.text ?? '');
  const [choosing, setChoosing] = useState(false);

  const { run: runRefresh } = refresh;
  // 1.14 loaded the week's time whenever the page appeared.
  useEffect(() => {
    void runRefresh({ type: 'weekly.refresh' });
  }, [runRefresh]);

  const today = localToday();
  const weekStart = instantToDay(weekly?.range.start);
  const weekEnd = instantToDay(weekly?.range.end);
  const lastDay = weekEnd?.subtract({ days: 1 }) ?? null;
  const isFuture = !weekEnd || weekEnd.compare(today) > 0;
  const isCurrent = !!weekStart && !!weekEnd && weekStart.compare(today) <= 0 && weekEnd.compare(today) > 0;
  const loading = weekly?.loading ?? false;
  const hasData = weekly?.hasData ?? false;
  const empty = draft.trim().length === 0;

  const generate = async () => {
    const result = await generator.run({ type: 'weekly.generate', replace: false });
    if (!result.ok && ipcErrorKind(result.error) === 'needsConfirmation') {
      generator.clearError();
      setConfirmReplace(true);
    }
  };
  const replace = async () => {
    await generator.run({ type: 'weekly.generate', replace: true });
    setConfirmReplace(false);
  };
  const copy = async () => {
    try {
      await copyToClipboard(draft);
      toast.show({ title: 'Draft copied.', tone: 'success' });
    } catch (error) {
      toast.show({ title: 'Could not copy the draft', description: error instanceof Error ? error.message : String(error), tone: 'error' });
    }
  };
  const exportMarkdown = async () => {
    setChoosing(true);
    let path: string | null = null;
    try {
      path = await chooseSavePath({
        defaultPath: `weekly-status-${weekStart?.toString() ?? 'draft'}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        title: 'Export weekly report',
      });
    } catch (error) {
      toast.show({ title: 'Could not open the save dialog', description: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setChoosing(false);
    }
    if (!path) return;
    const result = await exporter.run({ type: 'weekly.exportMarkdown', path });
    if (result.ok) toast.show({ title: 'Draft exported.', description: path, tone: 'success' });
  };
  const move = (amount: number) => void navigate.run({ type: 'weekly.move', amount });

  useCommands([
    {
      id: 'weekly.generate',
      label: empty ? 'Generate weekly report draft' : 'Regenerate weekly report draft…',
      group: 'Actions',
      keywords: ['weekly report', 'generate'],
      isDisabled: !hasData || loading,
      onAction: () => void generate(),
    },
    { id: 'weekly.copy', label: 'Copy weekly report', group: 'Actions', keywords: ['weekly report', 'clipboard'], isDisabled: empty, onAction: () => void copy() },
    {
      id: 'weekly.export',
      label: 'Export weekly report as Markdown…',
      group: 'Actions',
      keywords: ['weekly report', 'markdown', 'export'],
      isDisabled: empty || choosing,
      onAction: () => void exportMarkdown(),
    },
    { id: 'weekly.previous', label: 'Previous week', group: 'Actions', keywords: ['weekly report'], isDisabled: !weekly, onAction: () => move(-1) },
    { id: 'weekly.next', label: 'Next week', group: 'Actions', keywords: ['weekly report'], isDisabled: !weekly || isFuture, onAction: () => move(1) },
  ]);

  if (!weekly) {
    return (
      <div className={styles.page} aria-busy="true">
        <span role="status" className="visually-hidden">
          Loading the weekly report
        </span>
        <Skeleton lines={2} />
        <Skeleton shape="rect" height="20rem" />
      </div>
    );
  }

  const configured = !!connection && connection.health !== 'unconfigured';
  const synced = parseInstant(weekly.syncedAt);
  const failure = generator.error ?? navigate.error ?? exporter.error ?? text.error ?? null;

  return (
    <div className={styles.page}>
      <PageRefresh onRefresh={() => void refresh.run({ type: 'weekly.refresh' })} isRefreshing={loading} isDisabled={!configured} label="Refresh time" />
      <p className={styles.intro}>{`Turn your recorded work into an editable status update. Drafts stay on ${deviceName(app?.os)}.`}</p>

      <Card className={styles.weekBar}>
        <IconButton label="Previous week" icon={ChevronLeftIcon} onPress={() => move(-1)} />
        <DatePicker
          label="Week of"
          value={weekStart}
          maxValue={today}
          onChange={(value) => {
            if (value) void navigate.run({ type: 'weekly.jumpTo', date: value.toString() });
          }}
        />
        <IconButton label="Next week" icon={ChevronRightIcon} onPress={() => move(1)} isDisabled={isFuture} />
        <Button isDisabled={isCurrent} onPress={() => void navigate.run({ type: 'weekly.jumpTo', date: today.toString() })}>
          This week
        </Button>
        {weekStart && lastDay ? <p className={styles.range}>{`${formatDayShort(weekStart.toString())} – ${formatDayShort(lastDay.toString())}`}</p> : null}
      </Card>

      <div className={styles.toolbar}>
        <Button variant="primary" isDisabled={!hasData || loading} isPending={generator.pending} onPress={() => void generate()}>
          {empty ? 'Generate draft' : 'Regenerate draft…'}
        </Button>
        {loading ? (
          <span role="status" className={styles.status}>
            <SpinnerIcon className={styles.spinner} />
            Loading time…
          </span>
        ) : synced ? (
          <span className={styles.status}>{`Time loaded ${formatClockTime(synced)}`}</span>
        ) : null}
        <span className={styles.spacer} />
        <Button isDisabled={empty} onPress={() => void copy()}>
          Copy
        </Button>
        <Button isDisabled={empty || choosing} isPending={choosing || exporter.pending} onPress={() => void exportMarkdown()}>
          Export Markdown…
        </Button>
      </div>

      {weekly.issue ? <Banner tone="warning">{weekly.issue}</Banner> : null}
      {weekly.storageIssue ? (
        <Banner tone="warning" title="Draft not saved">
          {weekly.storageIssue}
        </Banner>
      ) : null}
      {failure ? <Banner tone="error">{failure.message}</Banner> : null}
      {!configured && !app?.preview ? <p className={styles.caption}>Connect to 7pace in Settings to generate a draft.</p> : null}
      {!hasData && !loading && !weekly.issue && configured ? (
        <p className={styles.caption}>Refresh the week’s time to generate a draft.</p>
      ) : null}

      <TextField
        label="Editable weekly status report"
        multiline
        rows={18}
        value={draft}
        onChange={(value) => {
          setDraft(value);
          void text.run({ type: 'weekly.setText', text: value });
        }}
        placeholder="Generate a draft, or write your update here."
        description={weekly.message ?? 'Edits are saved locally as you type. Copy or export when ready; nothing is sent automatically.'}
        className={styles.editor}
      />

      <Dialog
        isOpen={confirmReplace}
        onOpenChange={setConfirmReplace}
        role="alertdialog"
        size="small"
        title="Replace this week’s draft?"
        description="This replaces your local draft with a fresh summary of the loaded time."
        cancelLabel="Keep draft"
        primaryAction={{ label: 'Replace draft', variant: 'destructive', onAction: () => void replace(), isPending: generator.pending }}
      />
    </div>
  );
}
