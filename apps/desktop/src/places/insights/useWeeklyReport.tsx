import { useCallback, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { instantToDay, localToday } from '../../features/ticketContext/format';
import { chooseSavePath, copyToClipboard } from '../../features/ticketContext/native';
import type { IpcError } from '../../ipc';
import type { WeeklySlice } from '../../ipc/contract';
import { useCommands } from '../../shortcuts/hooks';
import { ipcErrorKind, useAction, useSlice, useStore } from '../../state/hooks';

interface TextState {
  /** The week the text belongs to (`range.start`). */
  week: string;
  value: string;
  /** The last slice text seen. */
  source: string;
  /** Take the slice text as it arrives (right after a generate, until the next keystroke). */
  follow: boolean;
}

/**
 * The report text is controlled here while the user types: the slice echoes every edit, and taking
 * those echoes would move the cursor. The slice text replaces the field only for another week or
 * after a generate.
 */
function useWeeklyText(week: string, source: string): [string, (value: string) => void, (generated: string) => void] {
  const [state, setState] = useState<TextState>({ week, value: source, source, follow: false });
  let current = state;
  if (state.week !== week) {
    current = { week, value: source, source, follow: false };
    setState(current);
  } else if (state.source !== source) {
    current = state.follow ? { ...state, value: source, source } : { ...state, source };
    setState(current);
  }
  const type = useCallback((value: string) => setState((previous) => ({ ...previous, value, follow: false })), []);
  const adopt = useCallback(
    (generated: string) => setState((previous) => ({ ...previous, value: generated, source: generated, follow: true })),
    [],
  );
  return [current.value, type, adopt];
}

export interface WeeklyReport {
  weekly: WeeklySlice | undefined;
  /** The text as typed (the field's value). */
  draft: string;
  empty: boolean;
  /** Sends an edit to the engine (saved locally, debounced there). */
  edit: (value: string) => void;
  generate: () => Promise<void>;
  generating: boolean;
  copy: () => Promise<void>;
  exportMarkdown: () => Promise<void>;
  exporting: boolean;
  move: (amount: number) => void;
  jumpTo: (day: string) => void;
  refresh: () => void;
  /** The latest refusal of generate, move, edit or export, shown verbatim. */
  failure: IpcError | null;
  /** The "Replace this week's draft?" dialog; render once. */
  confirmation: ReactNode;
}

/**
 * The weekly report's actions (1.14 `WeeklyReportView`), shared by the Insights side panel and the
 * Weekly report view: generate (asking before replacing a draft), copy, export and edits. The engine
 * stores the draft and writes exports; the clipboard copy stays in the UI. `commands` registers the
 * palette entries; only one mounted user should.
 */
export function useWeeklyReport({ commands = false }: { commands?: boolean } = {}): WeeklyReport {
  const weekly = useSlice('weekly');
  const toast = useToast();
  const store = useStore();
  const navigator = useAction();
  const generator = useAction();
  const text = useAction();
  const exporter = useAction();
  const refresher = useAction();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft, adoptGenerated] = useWeeklyText(weekly?.range.start ?? '', weekly?.text ?? '');
  const empty = draft.trim().length === 0;
  const loading = weekly?.loading ?? false;
  const hasData = weekly?.hasData ?? false;
  const weekEnd = instantToDay(weekly?.range.end);

  const generate = async () => {
    const result = await generator.run({ type: 'weekly.generate', replace: false });
    if (result.ok) adoptGenerated(store.get('weekly')?.text ?? '');
    else if (ipcErrorKind(result.error) === 'needsConfirmation') {
      generator.clearError();
      setConfirmReplace(true);
    }
  };
  const replace = async () => {
    const result = await generator.run({ type: 'weekly.generate', replace: true });
    if (result.ok) adoptGenerated(store.get('weekly')?.text ?? '');
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
        defaultPath: weekly?.exportFileName || `weekly-status-${instantToDay(weekly?.range.start)?.toString() ?? 'draft'}.md`,
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
  const edit = (value: string) => {
    setDraft(value);
    void text.run({ type: 'weekly.setText', text: value });
  };
  const move = (amount: number) => void navigator.run({ type: 'weekly.move', amount });
  const jumpTo = (day: string) => void navigator.run({ type: 'weekly.jumpTo', date: day });
  const refresh = () => void refresher.run({ type: 'weekly.refresh' });

  const isFuture = !weekEnd || weekEnd.compare(localToday()) > 0;
  useCommands(
    commands
      ? [
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
        ]
      : [],
  );

  return {
    weekly,
    draft,
    empty,
    edit,
    generate,
    generating: generator.pending,
    copy,
    exportMarkdown,
    exporting: choosing || exporter.pending,
    move,
    jumpTo,
    refresh,
    failure: generator.error ?? navigator.error ?? exporter.error ?? text.error ?? refresher.error ?? null,
    confirmation: (
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
    ),
  };
}
