import { act, screen, waitFor, within } from '@testing-library/react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import {
  weeklyDraftText,
  weeklyEmpty,
  weeklyFailed,
  weeklyGenerated,
  weeklyLoading,
  weeklyPrevious,
  weeklyStorageIssue,
  weeklyUnconfigured,
} from '../../ipc/fixtures/slices/weekly';
import { MockEngineError } from '../../ipc/mockEngine';
import type { SliceMap, WeeklySlice } from '../../ipc/contract';
import { formatDayShort, instantToDay } from '../../features/ticketContext/format';
import { PageFrame } from '../../features/ticketContext/testing';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import WeeklyReportPage from './index';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.mocked(save).mockReset();
  vi.mocked(writeText).mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderWeekly(weekly: WeeklySlice | undefined, extra: Partial<SliceMap> = {}) {
  const slices = sampleSlices();
  if (weekly) slices.weekly = weekly;
  else delete slices.weekly;
  return renderWithEngine(
    <PageFrame title="Weekly report">
      <WeeklyReportPage />
    </PageFrame>,
    { slices: { ...slices, ...extra } },
  );
}

const editor = () => screen.getByRole('textbox', { name: 'Editable weekly status report' });

describe('Weekly report page', () => {
  it('shows the week and its editable draft (the engine loads the week when the page appears)', async () => {
    const { engine } = renderWeekly(sampleSlices().weekly);
    expect(engine.dispatched('weekly.refresh')).toHaveLength(0);
    const start = instantToDay(sampleSlices().weekly!.range.start)!;
    const last = instantToDay(sampleSlices().weekly!.range.end)!.subtract({ days: 1 });
    expect(screen.getByText(`${formatDayShort(start.toString())} – ${formatDayShort(last.toString())}`)).toBeInTheDocument();
    expect(editor()).toHaveValue(weeklyDraftText);
    expect(screen.getByRole('button', { name: 'Regenerate draft…' })).toBeEnabled();
    expect(screen.getByText(/^Time loaded /)).toBeInTheDocument();
    expect(editor()).toHaveAccessibleDescription('Edits are saved locally as you type. Copy or export when ready; nothing is sent automatically.');
    await expectNoA11yViolations();
  });

  it('sends every edit and keeps what was typed while the engine echoes it', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    engine.handle('weekly.setText', (intent, mock) => mock.patchSlice('weekly', { text: intent.text }));
    await user.type(editor(), 'Done');
    expect(engine.dispatched('weekly.setText').map((intent) => intent.text)).toEqual(['D', 'Do', 'Don', 'Done']);
    await waitFor(() => expect(engine.slices.weekly?.text).toBe('Done'));
    expect(editor()).toHaveValue('Done');
  });

  it('keeps the typed text when the slice text changes, and takes it for another week', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    await user.type(editor(), 'Mine');
    act(() => engine.patchSlice('weekly', { text: 'Mi' }));
    expect(editor()).toHaveValue('Mine');
    act(() => engine.setSlice('weekly', { ...weeklyPrevious, text: 'Last week’s notes' }));
    expect(editor()).toHaveValue('Last week’s notes');
  });

  it('generates a first draft and shows it', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    engine.handle('weekly.generate', (_intent, mock) => mock.setSlice('weekly', weeklyGenerated));
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(engine.dispatched('weekly.generate')).toEqual([{ type: 'weekly.generate', replace: false }]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(editor()).toHaveValue(weeklyDraftText));
    expect(editor()).toHaveAccessibleDescription('Draft generated. Review outcomes and blockers before sharing.');
  });

  it('shows a generated draft that arrives after the intent returned', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    await waitFor(() => expect(engine.dispatched('weekly.generate')).toHaveLength(1));
    act(() => engine.setSlice('weekly', weeklyGenerated));
    expect(editor()).toHaveValue(weeklyDraftText);
  });

  it('asks before replacing an edited draft, then resends with replace', async () => {
    const { engine, user } = renderWeekly(sampleSlices().weekly);
    engine.handle('weekly.generate', (intent) => {
      if (!intent.replace) throw new MockEngineError('needsConfirmation', 'Replace your edited report?');
      return null;
    });
    await user.click(screen.getByRole('button', { name: 'Regenerate draft…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Replace this week’s draft?' });
    expect(dialog).toHaveAccessibleDescription('This replaces your local draft with a fresh summary of the loaded time.');
    expect(screen.queryByText('Replace your edited report?')).toBeNull();
    await expectNoA11yViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Replace draft' }));
    expect(engine.dispatched('weekly.generate')).toEqual([
      { type: 'weekly.generate', replace: false },
      { type: 'weekly.generate', replace: true },
    ]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('keeps the draft when the replacement is declined', async () => {
    const { engine, user } = renderWeekly(sampleSlices().weekly);
    engine.handle('weekly.generate', () => {
      throw new MockEngineError('needsConfirmation', 'Replace your edited report?');
    });
    await user.click(screen.getByRole('button', { name: 'Regenerate draft…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep draft' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(engine.dispatched('weekly.generate')).toEqual([{ type: 'weekly.generate', replace: false }]);
  });

  it('shows other generate failures verbatim', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    engine.handle('weekly.generate', () => {
      throw new MockEngineError('invalidIntent', 'Load this week’s time first.');
    });
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByText('Load this week’s time first.')).toBeInTheDocument();
  });

  it('copies the draft with the clipboard plugin', async () => {
    const { user } = renderWeekly(sampleSlices().weekly);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(weeklyDraftText);
    expect(await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Draft copied.')).toBeInTheDocument();
  });

  it('exports Markdown to the path chosen in the save dialog', async () => {
    vi.mocked(save).mockResolvedValue('/Users/sam/Documents/weekly.md');
    const { engine, user } = renderWeekly(sampleSlices().weekly);
    await user.click(screen.getByRole('button', { name: 'Export Markdown…' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'weekly-status-2026-10-05.md' }));
    await waitFor(() =>
      expect(engine.dispatched('weekly.exportMarkdown')).toEqual([{ type: 'weekly.exportMarkdown', path: '/Users/sam/Documents/weekly.md' }]),
    );
    expect(await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Draft exported.')).toBeInTheDocument();
  });

  it('cannot copy or export an empty draft', () => {
    renderWeekly(weeklyEmpty);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export Markdown…' })).toBeDisabled();
  });

  it('moves between weeks', async () => {
    const { engine, user } = renderWeekly(weeklyPrevious);
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(engine.dispatched('weekly.move').map((intent) => intent.amount)).toEqual([-1, 1]);
    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(engine.dispatched('weekly.jumpTo')).toEqual([{ type: 'weekly.jumpTo', date: '2026-10-06' }]);
  });

  it('cannot move past the current week', () => {
    renderWeekly(sampleSlices().weekly);
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'This week' })).toBeDisabled();
  });

  it('shows the loading, issue and storage states', async () => {
    const { engine } = renderWeekly(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the weekly report');
    act(() => engine.setSlice('weekly', weeklyLoading));
    expect(screen.getByText('Loading time…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
    act(() => engine.setSlice('weekly', weeklyFailed));
    expect(screen.getByText('Could not load this week from 7pace: the request timed out.')).toBeInTheDocument();
    act(() => engine.setSlice('weekly', weeklyStorageIssue));
    expect(screen.getByText('Draft is in memory but could not be saved: the disk is full.')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('asks to connect when 7pace is not set up', () => {
    renderWeekly(weeklyUnconfigured);
    expect(screen.getByText('Connect to 7pace in Settings to generate a draft.')).toBeInTheDocument();
  });
});
