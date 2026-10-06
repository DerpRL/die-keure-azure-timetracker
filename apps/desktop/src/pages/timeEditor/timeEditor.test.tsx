import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleSlices } from '../../ipc/fixtures';
import {
  journal,
  sampleLogs,
  timeEditorConflicts,
  timeEditorCorrections,
  timeEditorEditing,
  timeEditorEmpty,
  timeEditorFailed,
  timeEditorGuidedGap,
  timeEditorIdle,
  timeEditorInvalid,
  timeEditorLoadedConflicts,
  timeEditorLoading,
  timeEditorMerge,
  timeEditorNeedsReview,
  timeEditorSaved,
  timeEditorSplit,
  timeEditorUndo,
  timeEditorUnconfigured,
} from '../../ipc/fixtures/slices/timeEditor';
import { MockEngineError } from '../../ipc/mockEngine';
import type { AppSlice, SliceMap, TimeEditorSlice } from '../../ipc/contract';
import { PageFrame, resetAriaAnnouncer } from '../../features/ticketContext/testing';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import TimeEditorPage from './index';

afterEach(resetAriaAnnouncer);

function renderEditor(timeEditor: TimeEditorSlice | undefined, extra: Partial<SliceMap> = {}) {
  const slices = sampleSlices();
  if (timeEditor) slices.timeEditor = timeEditor;
  else delete slices.timeEditor;
  return renderWithEngine(
    <PageFrame title="Time editor">
      <TimeEditorPage />
    </PageFrame>,
    { slices: { ...slices, ...extra } },
  );
}

function app(patch: Partial<AppSlice> = {}): AppSlice {
  return { ...sampleSlices().app!, ...patch };
}

describe('Time editor page', () => {
  it('lists the day’s entries (the engine loads them when the page appears)', async () => {
    const { engine } = renderEditor(sampleSlices().timeEditor);
    expect(engine.dispatched('timeEditor.load')).toHaveLength(0);
    const table = screen.getByRole('grid', { name: 'Entries · Monday 5 October' });
    // Header row plus six entries.
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(table).getAllByRole('button', { name: '#4821 Checkout: retry failed card payments, show details' })).toHaveLength(2);
    expect(within(table).getByText('No Azure ticket')).toBeInTheDocument();
    expect(within(table).getByText('Locked by 7pace')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: /^Edit time for/ })).toHaveLength(5);
    await expectNoA11yViolations();
  });

  it('shows a skeleton until the slice arrives, then the loading state', async () => {
    const { engine } = renderEditor(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the time editor');
    act(() => engine.setSlice('timeEditor', timeEditorLoading));
    expect(await screen.findByText('Loading tracked time…')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('explains an empty day, and asks to connect when 7pace is not configured', () => {
    const { engine } = renderEditor(timeEditorEmpty);
    expect(screen.getByText('No entries match this date or filter.')).toBeInTheDocument();
    act(() => engine.setSlice('timeEditor', timeEditorUnconfigured));
    expect(screen.getByText('Connect to 7pace in Settings to edit your recorded time.')).toBeInTheDocument();
  });

  it('shows the load issue verbatim', async () => {
    renderEditor(timeEditorFailed);
    expect(screen.getByText('7pace could not be reached. Check your network connection and try again.')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('opens an entry, filters and selects entries for merging', async () => {
    const { engine, user } = renderEditor(sampleSlices().timeEditor);
    engine.handle('timeEditor.setSelection', (intent, mock) => mock.patchSlice('timeEditor', { selection: intent.ids }));

    await user.click(screen.getByRole('button', { name: 'Edit time for #4790 · Invoice PDF shows the wrong VAT number' }));
    expect(engine.dispatched('timeEditor.select')).toEqual([{ type: 'timeEditor.select', logId: sampleLogs.invoice.id }]);

    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), '48');
    expect(engine.dispatched('timeEditor.setFilter').map((intent) => intent.text)).toEqual(['4', '48']);
    expect(screen.getByRole('searchbox', { name: 'Filter' })).toHaveValue('48');

    const merge = screen.getByRole('button', { name: 'Merge selected…' });
    expect(merge).toBeDisabled();
    const checkboxes = within(screen.getByRole('grid')).getAllByRole('checkbox');
    await user.click(checkboxes[5]!);
    await user.click(checkboxes[6]!);
    expect(engine.dispatched('timeEditor.setSelection').at(-1)?.ids).toEqual([sampleLogs.cardRetry.id, sampleLogs.standup.id]);
    await waitFor(() => expect(merge).toBeEnabled());
    await user.click(merge);
    expect(engine.dispatched('timeEditor.beginMerge')).toHaveLength(1);
  });

  it('changes the day through the date field', async () => {
    const { engine, user } = renderEditor(sampleSlices().timeEditor);
    const day = screen.getAllByRole('spinbutton', { name: /day, Worklog date/i })[0]!;
    await user.click(day);
    await user.keyboard('{ArrowDown}');
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-10-04' }]);
  });

  it('opens Gaps & overlaps and Recent edits', async () => {
    const { engine, user } = renderEditor(sampleSlices().timeEditor);
    await user.click(screen.getByRole('button', { name: 'Gaps & overlaps…' }));
    expect(engine.dispatched('timeEditor.loadCorrections')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Recent edits' }));
    const sheet = await screen.findByRole('dialog', { name: 'Recent edits' });
    expect(within(sheet).getByRole('heading', { level: 3, name: 'Edit time' })).toBeInTheDocument();
    expect(within(sheet).getByText('Ready to undo')).toBeInTheDocument();
    await expectNoA11yViolations();
    await user.click(within(sheet).getByRole('button', { name: 'Undo…' }));
    expect(engine.dispatched('timeEditor.beginUndo')).toEqual([{ type: 'timeEditor.beginUndo', changeId: journal[0]!.id }]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recent edits' })).toBeNull());
  });

  it('shows the saved message and the overlaps it kept', async () => {
    const { user } = renderEditor(timeEditorSaved);
    expect(screen.getByText('Edit time confirmed by 7pace. You can undo this from Recent edits.')).toBeInTheDocument();
    const summary = screen.getByText('Saved with overlapping time', { selector: 'summary' });
    await user.click(summary);
    const notice = summary.closest('details')!;
    expect(within(notice).getByText('Your changes were saved. Overlapping entries were kept.')).toBeInTheDocument();
    expect(within(notice).getByText('Reviewing pull requests')).toBeInTheDocument();
  });
});

describe('Edit sheet', () => {
  it('shows the plan and the review, and saves only after the confirmation', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    engine.handle('timeEditor.save', (_intent, mock) =>
      mock.patchSlice('timeEditor', { selected: null, plan: null, review: null, message: 'Edit time confirmed by 7pace. You can undo this from Recent edits.' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    expect(sheet).toHaveAccessibleDescription('#4821 · Checkout: retry failed card payments');
    expect(within(sheet).getByText('Total: 3h 15m')).toBeInTheDocument();
    expect(within(sheet).getByText('No overlapping entries found')).toBeInTheDocument();
    await expectNoA11yViolations();

    await user.click(within(sheet).getByRole('button', { name: 'Check overlaps' }));
    expect(engine.dispatched('timeEditor.checkOverlaps')).toHaveLength(1);

    await user.click(within(sheet).getByRole('button', { name: 'Save time changes' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Save these time changes in 7pace?' });
    expect(engine.dispatched('timeEditor.save')).toHaveLength(0);
    await expectNoA11yViolations();
    await user.click(within(confirm).getByRole('button', { name: 'Save time changes' }));
    expect(engine.dispatched('timeEditor.save')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Edit time confirmed by 7pace. You can undo this from Recent edits.')).toBeInTheDocument();
  });

  it('keeps editing when the confirmation is cancelled', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    await user.click(within(sheet).getByRole('button', { name: 'Save time changes' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(engine.dispatched('timeEditor.save')).toHaveLength(0);
  });

  it('shows a failed save verbatim', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    engine.handle('timeEditor.save', () => {
      throw new MockEngineError('remoteChanged', 'An entry changed in 7pace. Reload it before saving.');
    });
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    await user.click(within(sheet).getByRole('button', { name: 'Save time changes' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save time changes' }));
    expect(await within(sheet).findByText('An entry changed in 7pace. Reload it before saving.')).toBeInTheDocument();
  });

  it('sends edited times', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    const hour = within(sheet).getAllByRole('spinbutton', { name: /hour, Start/i })[0]!;
    await user.click(hour);
    await user.keyboard('{ArrowUp}');
    expect(engine.dispatched('timeEditor.setTimes')).toEqual([
      { type: 'timeEditor.setTimes', start: '2026-10-05T08:15:00.000Z', end: '2026-10-05T10:30:00.000Z' },
    ]);
  });

  it('switches to split and sends the second entry', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    await user.click(within(sheet).getByRole('radio', { name: 'Split entry' }));
    expect(engine.dispatched('timeEditor.setMode')).toEqual([{ type: 'timeEditor.setMode', mode: 'split' }]);
  });

  it('edits the second entry of a split', async () => {
    const { engine, user } = renderEditor(timeEditorSplit);
    const sheet = await screen.findByRole('dialog', { name: 'Split · recorded time' });
    expect(within(sheet).getByRole('heading', { name: 'Second entry' })).toBeInTheDocument();
    expect(within(sheet).getByText('#4790 · 1h 40m')).toBeInTheDocument();
    const comment = within(sheet).getByRole('textbox', { name: 'Comment' });
    await user.clear(comment);
    await user.type(comment, 'VAT');
    expect(engine.dispatched('timeEditor.setSplit').at(-1)).toEqual({
      type: 'timeEditor.setSplit',
      at: '2026-10-05T09:00:00Z',
      ticket: '4790',
      comment: 'VAT',
      activityId: 'dev',
    });
    await expectNoA11yViolations();
  });

  it('shows overlapping entries as advice', () => {
    renderEditor(timeEditorConflicts);
    const sheet = screen.getByRole('dialog', { name: 'Edit time · recorded time' });
    expect(within(sheet).getByText('Overlapping time')).toBeInTheDocument();
    expect(within(sheet).getByText(/25m overlap$/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save time changes' })).toBeEnabled();
  });

  it('shows overlaps with the loaded day before the full check', () => {
    renderEditor(timeEditorLoadedConflicts);
    const sheet = screen.getByRole('dialog', { name: 'Edit time · recorded time' });
    expect(within(sheet).getByText('Overlapping time')).toBeInTheDocument();
    expect(within(sheet).getByText('Reviewing pull requests')).toBeInTheDocument();
  });

  it('shows a save refused because another 7pace write runs', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    engine.handle('timeEditor.save', () => {
      throw new MockEngineError('busy', 'Another change is being saved in 7pace. Try again when it finishes.');
    });
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    await user.click(within(sheet).getByRole('button', { name: 'Save time changes' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save time changes' }));
    expect(await within(sheet).findByText('Another change is being saved in 7pace. Try again when it finishes.')).toBeInTheDocument();
    expect(engine.dispatched('timeEditor.save')).toHaveLength(1);
  });

  it('blocks saving with a validation issue, a pending review or while busy', () => {
    const { engine } = renderEditor(timeEditorInvalid);
    const sheet = screen.getByRole('dialog', { name: 'Edit time · recorded time' });
    expect(within(sheet).getByText('The end must be after the start.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save time changes' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'Check overlaps' })).toBeDisabled();

    act(() => engine.setSlice('timeEditor', { ...timeEditorEditing, requiresReview: true }));
    expect(within(sheet).getByRole('button', { name: 'Save time changes' })).toBeDisabled();

    act(() => {
      engine.setSlice('timeEditor', timeEditorEditing);
      engine.setSlice('app', app({ busy: true }));
    });
    expect(within(sheet).getByRole('button', { name: 'Save time changes' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'Cancel edit' })).toBeDisabled();
    expect(within(sheet).getByRole('progressbar', { name: 'Checking 7pace…' })).toBeInTheDocument();
  });

  it('cancels the edit', async () => {
    const { engine, user } = renderEditor(timeEditorEditing);
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel edit' }));
    expect(engine.dispatched('timeEditor.cancel')).toHaveLength(1);
  });

  it('offers to reload an entry that changed', async () => {
    const { engine, user } = renderEditor({ ...timeEditorEditing, needsReload: true, issue: 'This entry changed in 7pace.' });
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    expect(within(sheet).getByText('This entry changed in 7pace.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Reload entry' }));
    expect(engine.dispatched('timeEditor.select')).toEqual([{ type: 'timeEditor.select', logId: sampleLogs.cardRetry.id }]);
  });

  it('shows a prepared idle correction first and lets the idle time become its own entry', async () => {
    const { engine, user } = renderEditor(timeEditorIdle);
    const sheet = await screen.findByRole('dialog', { name: 'Guided correction · recorded time' });
    const headings = within(sheet).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 2)).toEqual(['Idle interval', 'Before → after']);
    expect(within(sheet).getByRole('button', { name: 'Apply correction' })).toBeEnabled();
    await expectNoA11yViolations();
    await user.click(within(sheet).getByRole('radio', { name: 'Separate into its own entry' }));
    expect(engine.dispatched('timeEditor.setSeparateIdle')).toEqual([{ type: 'timeEditor.setSeparateIdle', separate: true }]);
    const comment = within(sheet).getByRole('textbox', { name: 'Comment for the separate entry' });
    expect(comment).toHaveValue('Idle time');
    await user.type(comment, '!');
    expect(engine.dispatched('timeEditor.setSecondEntry')).toEqual([
      { type: 'timeEditor.setSecondEntry', ticket: '', comment: 'Idle time!', activityId: 'dev' },
    ]);
    expect(engine.dispatched('timeEditor.setSplit')).toHaveLength(0);
  });

  it('previews a guided gap correction', () => {
    renderEditor(timeEditorGuidedGap);
    const sheet = screen.getByRole('dialog', { name: 'Guided correction · recorded time' });
    expect(within(sheet).getByRole('heading', { name: 'Before · 3h 25m' })).toBeInTheDocument();
    expect(within(sheet).getByRole('heading', { name: 'After · 4h 15m' })).toBeInTheDocument();
  });

  it('explains merge and undo', () => {
    const { engine } = renderEditor(timeEditorMerge);
    expect(screen.getByRole('dialog', { name: 'Merge · recorded time' })).toHaveTextContent(
      'The first entry is extended and the other selected entries are removed.',
    );
    act(() => engine.setSlice('timeEditor', timeEditorUndo));
    const sheet = screen.getByRole('dialog', { name: 'Undo · recorded time' });
    expect(sheet).toHaveTextContent('Removed entries are recreated with new IDs');
    expect(within(sheet).getByRole('button', { name: 'Undo change' })).toBeEnabled();
  });
});

describe('Recent edits', () => {
  it('shows a change that needs review prominently and acknowledges it', async () => {
    const { engine, user } = renderEditor(timeEditorNeedsReview);
    const banner = screen.getByText('An earlier change needs review').closest('[role="status"]')!;
    await user.click(within(banner as HTMLElement).getByRole('button', { name: 'Open Recent edits' }));
    const sheet = await screen.findByRole('dialog', { name: 'Recent edits' });
    expect(within(sheet).getByText('Needs review')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Undo…' })).toBeDisabled();
    await expectNoA11yViolations();
    await user.click(within(sheet).getByRole('button', { name: 'I checked the entries in 7pace' }));
    expect(engine.dispatched('timeEditor.acknowledge')).toEqual([
      { type: 'timeEditor.acknowledge', changeId: '7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a' },
    ]);
  });

  it('explains an empty journal', async () => {
    const { user } = renderEditor(timeEditorEmpty);
    await user.click(screen.getByRole('button', { name: 'Recent edits' }));
    expect(await screen.findByText('Your confirmed edits, splits and merges will appear here.')).toBeInTheDocument();
  });
});

describe('Gaps & overlaps', () => {
  it('lists issues and prepares the chosen correction', async () => {
    const { engine, user } = renderEditor(timeEditorCorrections);
    const sheet = await screen.findByRole('dialog', { name: 'Gaps & overlaps' });
    expect(sheet).toHaveAccessibleDescription('Monday, 5 October 2026');
    expect(within(sheet).getByRole('heading', { name: 'Possible gap · 0h 50m' })).toBeInTheDocument();
    expect(within(sheet).getByRole('heading', { name: 'Overlapping time · 0h 10m' })).toBeInTheDocument();
    await expectNoA11yViolations();

    await user.click(within(sheet).getAllByRole('button', { name: 'Extend earlier task…' })[0]!);
    expect(engine.dispatched('timeEditor.prepareCorrection')).toEqual([
      {
        type: 'timeEditor.prepareCorrection',
        issueId: `gap|1791196800.0|${sampleLogs.cardRetry.id}|${sampleLogs.invoice.id}`,
        option: 'extendEarlier',
      },
    ]);
    // The engine offers only the options with a valid plan.
    expect(within(sheet).getAllByRole('button', { name: 'Start later task earlier…' }).map((button) => button.hasAttribute('disabled'))).toEqual([
      false,
      true,
    ]);
    await user.click(within(sheet).getByRole('button', { name: 'Remove overlap from later…' }));
    expect(engine.dispatched('timeEditor.prepareCorrection').at(-1)).toEqual({
      type: 'timeEditor.prepareCorrection',
      issueId: `overlap|1791210000.0|${sampleLogs.design.id}|${sampleLogs.review.id}`,
      option: 'removeFromLater',
    });
    await user.click(within(sheet).getByRole('button', { name: 'Preview boundary…' }));
    expect(engine.dispatched('timeEditor.prepareCorrection').at(-1)).toEqual({
      type: 'timeEditor.prepareCorrection',
      issueId: `overlap|1791210000.0|${sampleLogs.design.id}|${sampleLogs.review.id}`,
      option: 'boundary',
      boundary: '2026-10-05T14:25:00.000Z',
    });

    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(engine.dispatched('timeEditor.showCorrections')).toEqual([{ type: 'timeEditor.showCorrections', show: false }]);
  });

  it('shows a correction that no longer exists verbatim', async () => {
    const { engine, user } = renderEditor(timeEditorCorrections);
    engine.handle('timeEditor.prepareCorrection', () => {
      throw new MockEngineError('notFound', 'This gap or overlap changed. Refresh the review.');
    });
    const sheet = await screen.findByRole('dialog', { name: 'Gaps & overlaps' });
    await user.click(within(sheet).getAllByRole('button', { name: 'Extend earlier task…' })[0]!);
    expect(await within(sheet).findByText('This gap or overlap changed. Refresh the review.')).toBeInTheDocument();
  });

  it('shows the loading, issue and nothing-found states', () => {
    const { engine } = renderEditor({ ...timeEditorCorrections, corrections: { show: true, issues: [], loading: true, issue: null, choices: [] } });
    expect(screen.getByRole('progressbar', { name: 'Checking recorded time…' })).toBeInTheDocument();
    act(() =>
      engine.setSlice('timeEditor', {
        ...timeEditorCorrections,
        corrections: { show: true, issues: [], loading: false, issue: 'There is no elapsed workday to review for this date.', choices: [] },
      }),
    );
    expect(screen.getByText('There is no elapsed workday to review for this date.')).toBeInTheDocument();
    act(() => engine.setSlice('timeEditor', { ...timeEditorCorrections, corrections: { show: true, issues: [], loading: false, issue: null, choices: [] } }));
    expect(screen.getByText('No gaps or overlaps found in the elapsed workday.')).toBeInTheDocument();
  });
});
