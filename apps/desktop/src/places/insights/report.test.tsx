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
import { expectNoA11yViolations } from '../../test/axe';
import { renderInsights } from './testing';

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
  return renderInsights({ view: 'report', openExtras: ['weekSoFar'] }, { ...extra, weekly: weekly ?? null });
}

const footnote = () => screen.getByText((_, element) => element?.tagName === 'P' && element.className.includes('reportFootnote'));

const editor = () => screen.getByRole('textbox', { name: 'Editable weekly status report' });

describe('Insights · Weekly report', () => {
  it('shows the week and its editable draft (the engine loads the week when the page appears)', async () => {
    const { engine } = renderWeekly(sampleSlices().weekly);
    expect(engine.dispatched('weekly.refresh')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: '5 Oct – 11 Oct 2026' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Insights views' })).toBeInTheDocument();
    expect(editor()).toHaveValue(weeklyDraftText);
    expect(screen.getByRole('button', { name: 'Regenerate from time' })).toBeEnabled();
    expect(screen.getByText(/^Draft saved on this Mac · time loaded /)).toBeInTheDocument();
    expect(footnote()).toHaveTextContent('Edits are saved locally as you type. Nothing is sent automatically.');
    await expectNoA11yViolations();
  });

  it('shows the week so far next to the draft', async () => {
    renderWeekly(sampleSlices().weekly);
    const panel = screen.getByRole('complementary', { name: 'Week so far' });
    expect(within(panel).getByText('8h 25m')).toBeInTheDocument();
    expect(within(panel).getByText('of 38h 0m')).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: /^8h 25m of 38h 0m, Development 6h 25m, Design 0h 50m/ })).toBeInTheDocument();
    const tickets = within(within(panel).getByRole('list', { name: 'Time per ticket' })).getAllByRole('listitem');
    expect(tickets.map((row) => row.textContent)).toEqual([
      '#4821 Checkout: retry failed card payments4h 25m',
      '#4790 Invoice PDF shows the wrong VAT number2h 0m',
      '#4655 Design system: date picker tokens0h 50m',
      'Reviewing pull requests · no ticket0h 40m',
      '#4777 Sprint ceremonies0h 30m',
    ]);
    const days = within(within(panel).getByRole('list', { name: 'Time per day' })).getAllByRole('listitem');
    expect(days.map((day) => day.getAttribute('aria-label'))).toEqual([
      'Monday 7h 15m',
      'Tuesday 1h 10m',
      'Wednesday no time',
      'Thursday no time',
      'Friday no time',
      'Saturday no time',
      'Sunday no time',
    ]);
    await expectNoA11yViolations();
  });

  it('has no week so far until the week is loaded', () => {
    renderWeekly(weeklyLoading);
    expect(screen.queryByRole('complementary', { name: 'Week so far' })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Generate from time' }));
    expect(engine.dispatched('weekly.generate')).toEqual([{ type: 'weekly.generate', replace: false }]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(editor()).toHaveValue(weeklyDraftText));
    expect(footnote()).toHaveTextContent('Draft generated. Review outcomes and blockers before sharing.');
  });

  it('shows a generated draft that arrives after the intent returned', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    await user.click(screen.getByRole('button', { name: 'Generate from time' }));
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
    await user.click(screen.getByRole('button', { name: 'Regenerate from time' }));
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
    await user.click(screen.getByRole('button', { name: 'Regenerate from time' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep draft' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(engine.dispatched('weekly.generate')).toEqual([{ type: 'weekly.generate', replace: false }]);
  });

  it('shows other generate failures verbatim', async () => {
    const { engine, user } = renderWeekly(weeklyEmpty);
    engine.handle('weekly.generate', () => {
      throw new MockEngineError('invalidIntent', 'Load this week’s time first.');
    });
    await user.click(screen.getByRole('button', { name: 'Generate from time' }));
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

  it('previews the draft as formatted text, with placeholders marked', () => {
    renderWeekly({ ...sampleSlices().weekly!, text: '# Weekly status\n\n## Worked on\n- #4821 · Checkout — 4h\n  - Card retry flow\n\n## Outcomes\n- [ADD WHAT SHIPPED OR CHANGED]\n' });
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(within(preview).getByRole('heading', { level: 3, name: 'Weekly status' })).toBeInTheDocument();
    expect(within(preview).getByRole('heading', { level: 4, name: 'Worked on' })).toBeInTheDocument();
    const items = within(preview).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('#4821 · Checkout — 4hCard retry flow');
    expect(within(preview).getByText('[ADD WHAT SHIPPED OR CHANGED]').tagName).toBe('MARK');
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
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
  });

  it('shows the loading, issue and storage states', async () => {
    const { engine } = renderWeekly(undefined);
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Loading the weekly report')).toBe(true);
    act(() => engine.setSlice('weekly', weeklyLoading));
    expect(screen.getByText(/loading time…$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Generate|Regenerate) from time$/ })).toBeDisabled();
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
