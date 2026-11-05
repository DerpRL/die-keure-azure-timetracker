import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetMockIpc } from '../../ipc';
import type { FlowSlice } from '../../ipc/contract';
import { busyApp } from '../../ipc/fixtures/slices/app';
import {
  activityErrorFlow,
  branchDraftFlow,
  branchSuggestionFlow,
  figmaDraftFlow,
  loadingActivitiesFlow,
  missingStandupDraftFlow,
  noActivitiesFlow,
  pickerDraftFlow,
  pickerSearchFlow,
  resumeDraftFlow,
  searchErrorFlow,
  searchResultsFlow,
  standupDraftFlow,
  ticketDraft,
} from '../../ipc/fixtures/slices/flow';
import { stoppedTracking } from '../../ipc/fixtures/slices/tracking';
import { MockEngineError } from '../../ipc/mockEngine';
import { expectAccessible } from './testHelpers';
import { renderWithEngine } from '../../test/engine';
import { TicketPickerSheet } from './TicketPickerSheet';
import { pickerRows, typeTag } from './TicketPicker';

afterEach(() => {
  resetMockIpc();
});

const picker = (flow: FlowSlice) => ({ ...flow, surface: 'picker' as const });

/** The ticket list's rows, by their visible title. */
const rowTitles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('row')
    .map((row) => row.querySelector('[class*="rowTitle"]')?.textContent);

describe('TicketPickerSheet', () => {
  it('stays closed while no picker is open', () => {
    renderWithEngine(<TicketPickerSheet />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as one two-column dialog: tickets, ticket-free rows and an empty activity column', async () => {
    renderWithEngine(<TicketPickerSheet />, {
      with: {
        flow: {
          ...pickerSearchFlow,
          quickTickets: [
            { ticketId: 4790, title: null, favorite: false },
            { ticketId: 4821, title: 'Checkout: retry failed card payments', favorite: true },
          ],
        },
      },
    });
    // A timer runs in the sample data: the picker says what is running and that nothing changes yet.
    const dialog = await screen.findByRole('dialog', { name: 'Switch ticket' });
    expect(dialog).toHaveAccessibleDescription(/^Now tracking #4821 · \d+:\d\d:\d\d\. Nothing changes in 7pace until you confirm\.$/);
    expect(within(dialog).getByRole('searchbox', { name: 'Search tickets' })).toHaveFocus();
    expect(within(dialog).getByRole('radio', { name: 'All' })).toBeChecked();
    const list = within(dialog).getByRole('grid', { name: 'Tickets' });
    // Favourites first; a missing title and the type come from the shared title cache.
    expect(rowTitles(list)).toEqual([
      'Checkout: retry failed card payments',
      'Invoice PDF shows the wrong VAT number',
      'Work without a ticket',
      'Meeting without a ticket',
      'Daily stand-up',
    ]);
    const rows = within(list).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('Story');
    expect(rows[0]).toHaveTextContent('#4821 · tracking now · favorite');
    expect(rows[1]).toHaveTextContent('Bug');
    expect(rows[2]).toHaveTextContent('None');
    expect(within(dialog).getByText('Choose a ticket, or work without one, to pick its activity.')).toBeInTheDocument();
    // Nothing is chosen, so nothing can start.
    expect(within(dialog).getByRole('button', { name: 'Start tracking' })).toBeDisabled();
    expect(within(dialog).getByText('Command Return')).toBeInTheDocument();
    await expectAccessible();
  });

  it('asks to choose a ticket while no timer runs, and closes with the × button', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow, tracking: stoppedTracking } });
    const dialog = await screen.findByRole('dialog', { name: 'Choose a ticket' });
    expect(dialog).toHaveAccessibleDescription('Search Azure tickets by number or title. Nothing changes in 7pace until you confirm.');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(engine.dispatched('tracking.closePicker')).toHaveLength(1);
  });

  it('debounces typing into one tracking.search and lists the results to choose from', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    engine.handle('tracking.search', (intent, mock) => {
      mock.setSlice('flow', picker({ ...searchResultsFlow, search: { ...searchResultsFlow.search, query: intent.query } }));
    });
    const input = await screen.findByRole('searchbox', { name: 'Search tickets' });
    await user.type(input, 'vat');
    await waitFor(() => expect(engine.dispatched('tracking.search')).toEqual([{ type: 'tracking.search', query: 'vat' }]));
    // While searching, the filter makes way for the results.
    expect(screen.queryByRole('radio', { name: 'Favorites' })).not.toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /VAT exemption for intra-EU customers/ });
    expect(row).toHaveTextContent('Story');
    expect(screen.getByText('2 tickets found')).toBeInTheDocument();
    await user.click(row);
    expect(engine.dispatched('tracking.chooseTicket')).toEqual([{ type: 'tracking.chooseTicket', ticketId: 4512 }]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(engine.dispatched('tracking.search')).toHaveLength(1);
  });

  it('shows the engine search error verbatim', async () => {
    const { user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker({ ...searchErrorFlow }) } });
    const input = await screen.findByRole('searchbox', { name: 'Search tickets' });
    expect(input).toHaveValue('#99999');
    expect(screen.getByRole('alert')).toHaveTextContent('Azure ticket #99999 was not found or is not accessible.');
    await user.clear(input);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('filters the quick tickets and keeps the favourite star', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    const list = await screen.findByRole('grid', { name: 'Tickets' });
    await user.click(screen.getByRole('radio', { name: 'Favorites' }));
    expect(rowTitles(list).slice(0, 1)).toEqual(['Checkout: retry failed card payments']);
    await user.click(screen.getByRole('radio', { name: 'Recent' }));
    expect(rowTitles(list).slice(0, 2)).toEqual(['Invoice PDF shows the wrong VAT number', 'Sprint ceremonies']);
    // The star toggles the favourite without choosing the ticket.
    await user.click(screen.getByRole('button', { name: 'Save favorite ticket #4790' }));
    expect(engine.dispatched('quick.toggleFavorite')).toEqual([{ type: 'quick.toggleFavorite', ticketId: 4790 }]);
    expect(engine.dispatched('tracking.chooseTicket')).toHaveLength(0);
  });

  it('starts ticket-free work and suggestions without a ticket', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    await user.click(await screen.findByRole('row', { name: /Daily stand-up/ }));
    expect(engine.dispatched('tracking.chooseManual')).toEqual([{ type: 'tracking.chooseManual', kind: 'standup' }]);
    act(() => engine.setSlice('flow', picker(branchSuggestionFlow)));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription('For webshop · feature/AB#4790-vat-number. Nothing changes in 7pace until you confirm.');
    expect(screen.getByRole('row', { name: /Invoice PDF shows the wrong VAT number/ })).toHaveTextContent('#4790 · suggested by your branch');
    // A suggestion replaces the manual choices with one ticket-free row.
    expect(screen.queryByRole('row', { name: /Daily stand-up/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('row', { name: /Continue without a ticket/ }));
    expect(engine.dispatched('tracking.continueWithoutTicket')).toHaveLength(1);
  });

  it('runs choose → activity → start and sends exactly one tracking.start', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    engine.handle('tracking.chooseTicket', (_intent, mock) => mock.setSlice('flow', pickerDraftFlow));
    await user.click(await screen.findByRole('row', { name: /Invoice PDF shows the wrong VAT number/ }));
    const dialog = screen.getByRole('dialog', { name: 'Switch ticket' });
    // The chosen row is selected and the activity column belongs to its draft.
    await waitFor(() => expect(screen.getByRole('row', { name: /Invoice PDF/ })).toHaveAttribute('aria-selected', 'true'));
    expect(within(dialog).getByRole('radio', { name: 'Development' })).toBeChecked();
    expect(within(dialog).getByText(/^Your timer on #4821 stops when you press Track #4790 and is saved as \d+h \d+m\.$/)).toBeInTheDocument();
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
    await expectAccessible();
    await user.click(within(dialog).getByRole('button', { name: 'Track #4790' }));
    expect(engine.dispatched('tracking.start')).toEqual([
      { type: 'tracking.start', draftId: ticketDraft.id, activityId: 'dev', comment: '', includeTicket: true },
    ]);
  });

  it('lets go of the draft before choosing another row, keeping a suggestion and an active search', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    await user.click(await screen.findByRole('row', { name: /Sprint ceremonies/ }));
    await waitFor(() =>
      expect(engine.intents.slice(-2)).toEqual([{ type: 'tracking.chooseDifferentWork' }, { type: 'tracking.chooseTicket', ticketId: 4777 }]),
    );
    // Choosing the draft's own row again sends nothing.
    const sent = engine.intents.length;
    await user.click(screen.getByRole('row', { name: /Invoice PDF/ }));
    expect(engine.intents).toHaveLength(sent);

    // A branch draft found by the engine's search for its ticket.
    act(() => engine.setSlice('flow', picker({ ...branchDraftFlow, search: branchSuggestionFlow.search })));
    await user.click(await screen.findByRole('row', { name: /Continue without a ticket/ }));
    await waitFor(() =>
      expect(engine.intents.slice(-3)).toEqual([
        { type: 'tracking.chooseSuggestionTicket', draftId: branchDraftFlow.draft!.id },
        { type: 'tracking.search', query: '4790' },
        { type: 'tracking.continueWithoutTicket' },
      ]),
    );
  });

  it('moves from the search into the list with Down Arrow and chooses with Return', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    await screen.findByRole('searchbox', { name: 'Search tickets' });
    // Return in the search never starts anything.
    await user.keyboard('{Enter}');
    expect(engine.intents.filter((intent) => intent.type.startsWith('tracking.'))).toEqual([]);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('row', { name: /Checkout: retry failed card payments/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(engine.dispatched('tracking.chooseTicket')).toEqual([{ type: 'tracking.chooseTicket', ticketId: 4790 }]);
  });

  it('starts with ⌘Return from the search or the list, once', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    // The start stays in flight until both presses are done, however slow the run.
    let finish: (value: null) => void = () => {};
    engine.handle('tracking.start', () => new Promise<null>((resolve) => (finish = resolve)));
    await screen.findByRole('searchbox', { name: 'Search tickets' });
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await user.keyboard('{ArrowDown}{Meta>}{Enter}{/Meta}');
    expect(engine.dispatched('tracking.start')).toEqual([
      { type: 'tracking.start', draftId: ticketDraft.id, activityId: 'dev', comment: '', includeTicket: true },
    ]);
    act(() => finish(null));
  });

  it('sends one start for a double click or repeated Return', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    engine.handle('tracking.start', () => new Promise((resolve) => setTimeout(() => resolve(null), 50)));
    await user.dblClick(await screen.findByRole('button', { name: 'Track #4790' }));
    await user.keyboard('{Enter}{Enter}');
    expect(engine.dispatched('tracking.start')).toHaveLength(1);
  });

  it('never starts without a click', async () => {
    const { engine } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    await screen.findByRole('dialog', { name: 'Switch ticket' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
  });

  it('lets the user pick another activity', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    const activities = await screen.findByRole('radiogroup', { name: 'Activity' });
    expect(within(activities).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Development',
      'Design',
      'Meeting',
      'Standup',
      'Code review',
    ]);
    await user.click(within(activities).getByRole('radio', { name: 'Code review' }));
    await user.click(screen.getByRole('button', { name: 'Track #4790' }));
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ activityId: 'review' });
  });

  it('disables Start and the rows while the engine is busy', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow, app: busyApp } });
    expect(await screen.findByRole('button', { name: 'Track #4790' })).toBeDisabled();
    expect(screen.getByText('Starting tracking…')).toBeInTheDocument();
    await user.click(screen.getByRole('row', { name: /Sprint ceremonies/ }));
    expect(engine.dispatched('tracking.chooseTicket')).toHaveLength(0);
  });

  it('prefills the stand-up comment and allows only the Standup activity', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(standupDraftFlow) } });
    const comment = await screen.findByRole('textbox', { name: 'Comment (optional)' });
    expect(comment).toHaveValue('daily standup');
    expect(screen.getByRole('row', { name: /Daily stand-up/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Activity' })).getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Standup' })).toBeChecked();
    await user.clear(comment);
    await user.type(comment, 'Team sync');
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(engine.dispatched('tracking.start')).toEqual([
      { type: 'tracking.start', draftId: standupDraftFlow.draft!.id, activityId: 'standup', comment: 'Team sync', includeTicket: true },
    ]);
  });

  it('explains a missing required activity and cannot start', async () => {
    renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(missingStandupDraftFlow) } });
    expect(
      await screen.findByText('The Standup activity is missing in 7pace. Add or enable it before tracking this stand-up.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start tracking' })).toBeDisabled();
  });

  it('can switch the suggested ticket off or choose another one', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(branchDraftFlow) } });
    expect(await screen.findByText('Comment: feature/AB#4790-vat-number')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Use Azure ticket #4790' }));
    expect(screen.getByText('No Azure ticket')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose another ticket…' }));
    expect(engine.dispatched('tracking.chooseSuggestionTicket')).toEqual([
      { type: 'tracking.chooseSuggestionTicket', draftId: branchDraftFlow.draft!.id },
    ]);
    // Without the ticket the button no longer names it.
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));
    // The engine adds the branch remark itself; only manual drafts send a typed comment.
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ includeTicket: false, comment: '' });
  });

  it('offers different work for a Figma draft and says Resume for a paused session', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(figmaDraftFlow) } });
    expect(await screen.findByText('The Figma file name is saved as the 7pace comment.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose different work…' }));
    expect(engine.dispatched('tracking.chooseDifferentWork')).toHaveLength(1);
    act(() => engine.setSlice('flow', picker(resumeDraftFlow)));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(screen.getByText('Resume starts a new session. Paused time is not logged.')).toBeInTheDocument();
  });

  it('follows the engine for Start, the meeting line and choosing another ticket', async () => {
    const draft = {
      ...ticketDraft,
      allowsNoTicket: true,
      meetingTitle: 'Sprint planning',
      canChooseTicket: false,
      startableActivityIds: ['meeting'],
    };
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: { ...pickerDraftFlow, draft } } });
    expect(await screen.findByText('Sprint planning')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Use Azure ticket #4790' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose (another ticket|a ticket instead)…/ })).not.toBeInTheDocument();
    // The preferred Development activity is not startable for this draft.
    expect(screen.getByRole('button', { name: 'Track #4790' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Meeting' }));
    await user.click(screen.getByRole('button', { name: 'Track #4790' }));
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ activityId: 'meeting' });
  });

  it('shows loading, error and empty activity states', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(loadingActivitiesFlow) } });
    expect(await screen.findByText('Loading 7pace activities…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Track #4790' })).toBeDisabled();
    act(() => engine.setSlice('flow', picker(activityErrorFlow)));
    expect(await screen.findByText('Could not load activity types: The request timed out.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload activity types' }));
    expect(engine.dispatched('tracking.reloadActivities')).toHaveLength(1);
    act(() => engine.setSlice('flow', picker(noActivitiesFlow)));
    expect(
      await screen.findByText('No activity types are configured in 7pace. Its workspace default will be used.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Track #4790' }));
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ activityId: '' });
  });

  it('cancels with the button or Escape', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('tracking.closePicker')).toHaveLength(1);
    // From the (empty) search field, Escape cancels too.
    await user.click(screen.getByRole('searchbox', { name: 'Search tickets' }));
    await user.keyboard('{Escape}');
    expect(engine.dispatched('tracking.closePicker')).toHaveLength(2);
  });

  it('shows a refusal verbatim and asks before resending a confirmation request', async () => {
    let calls = 0;
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    engine.handle('tracking.start', () => {
      calls += 1;
      if (calls === 1) throw new MockEngineError('needsConfirmation', 'The 7pace timer changed. Start anyway?');
      if (calls === 2) throw new MockEngineError('remoteChanged', 'The 7pace timer changed on the server.');
    });
    await user.click(await screen.findByRole('button', { name: 'Track #4790' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Confirm this change' });
    expect(confirm).toHaveTextContent('The 7pace timer changed. Start anyway?');
    await user.click(within(confirm).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(engine.dispatched('tracking.start')).toHaveLength(2));
    expect(engine.dispatched('tracking.start')[1]).toMatchObject({ confirmed: true });
    expect(await screen.findByText('The 7pace timer changed on the server.')).toBeInTheDocument();
  });
});

describe('pickerRows', () => {
  const options = { query: '', results: [], filter: 'all' as const, runningId: null, workItems: undefined };

  it('keeps the draft’s ticket and the running ticket visible', () => {
    const flow = picker({ ...pickerSearchFlow, quickTickets: [], draft: { ...ticketDraft, item: { id: 4512, title: 'VAT exemption', type: 'User Story' } } });
    const rows = pickerRows(flow, { ...options, runningId: 4821 });
    expect(rows.map((row) => row.key)).toEqual(['ticket-4512', 'ticket-4821', 'manual-activity', 'manual-meeting', 'manual-standup']);
    expect(rows[1]).toMatchObject({ title: 'Azure ticket #4821', notes: ['tracking now'], favorite: null });
  });

  it('shows a ticket-free draft without a suggestion as its own row', () => {
    const flow = picker({ ...pickerSearchFlow, quickTickets: [], draft: { ...resumeDraftFlow.draft!, item: null, remark: 'Customer call' } });
    expect(pickerRows(flow, options)[0]).toMatchObject({ kind: 'draft', key: 'draft', title: 'Customer call' });
  });

  it('shortens Azure work item types for the tag', () => {
    expect(typeTag('User Story')).toEqual({ label: 'Story', tone: 'info' });
    expect(typeTag('Bug')).toEqual({ label: 'Bug', tone: 'danger' });
    expect(typeTag('Task')).toEqual({ label: 'Task', tone: 'neutral' });
    expect(typeTag(null)).toEqual({ label: 'Ticket', tone: 'neutral' });
  });
});
