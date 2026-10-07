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
import { MockEngineError } from '../../ipc/mockEngine';
import { expectAccessible } from './testHelpers';
import { renderWithEngine } from '../../test/engine';
import { TicketPickerSheet } from './TicketPickerSheet';

afterEach(() => {
  resetMockIpc();
});

const picker = (flow: FlowSlice) => ({ ...flow, surface: 'picker' as const });

describe('TicketPickerSheet', () => {
  it('stays closed while no picker is open', () => {
    renderWithEngine(<TicketPickerSheet />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the ticket step with manual choices, search and favourites first', async () => {
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
    const dialog = await screen.findByRole('dialog', { name: 'Choose a ticket' });
    expect(within(dialog).getByText('Search Azure tickets by number or title.')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Track without a ticket' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Ticket number or title' })).toHaveFocus();
    const list = within(dialog).getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    // Favourites first; a missing title comes from the shared title cache.
    expect(rows[0]).toHaveTextContent('#4821');
    expect(rows[1]).toHaveTextContent('#4790Invoice PDF shows the wrong VAT number');
    expect(within(dialog).getByText('Next, choose an activity type and confirm when to start.')).toBeInTheDocument();
    await expectAccessible();
  });

  it('debounces typing into one tracking.search and chooses a result', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    engine.handle('tracking.search', (intent, mock) => {
      mock.setSlice('flow', picker({ ...searchResultsFlow, search: { ...searchResultsFlow.search, query: intent.query } }));
    });
    const input = await screen.findByRole('combobox', { name: 'Ticket number or title' });
    await user.type(input, 'vat');
    await waitFor(() => expect(engine.dispatched('tracking.search')).toEqual([{ type: 'tracking.search', query: 'vat' }]));
    const option = await screen.findByRole('option', { name: /VAT exemption for intra-EU customers/ });
    await user.click(option);
    expect(engine.dispatched('tracking.chooseTicket')).toEqual([{ type: 'tracking.chooseTicket', ticketId: 4512 }]);
    // Choosing writes the option text into the field; that is not another search.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(engine.dispatched('tracking.search')).toHaveLength(1);
  });

  it('shows the engine search error verbatim', async () => {
    const { user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker({ ...searchErrorFlow }) } });
    const input = await screen.findByRole('combobox', { name: 'Ticket number or title' });
    expect(input).toHaveValue('#99999');
    expect(screen.getByRole('alert')).toHaveTextContent('Azure ticket #99999 was not found or is not accessible.');
    await user.clear(input);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts ticket-free work and suggestions without a ticket', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    await user.click(await screen.findByRole('button', { name: 'Stand-up' }));
    expect(engine.dispatched('tracking.chooseManual')).toEqual([{ type: 'tracking.chooseManual', kind: 'standup' }]);
    act(() => engine.setSlice('flow', picker(branchSuggestionFlow)));
    expect(await screen.findByText('For webshop · feature/AB#4790-vat-number')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue without a ticket…' }));
    expect(engine.dispatched('tracking.continueWithoutTicket')).toHaveLength(1);
  });

  it('runs search → activity → start and sends exactly one tracking.start', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    engine.handle('tracking.chooseTicket', (_intent, mock) => mock.setSlice('flow', pickerDraftFlow));
    await user.click(await screen.findByRole('button', { name: '#4790 Invoice PDF shows the wrong VAT number' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose an activity' });
    // Focus stays in the sheet when the ticket step makes way for the chooser.
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    // Preselected from the draft; nothing has started yet.
    expect(within(dialog).getByRole('button', { name: /Development/ })).toBeInTheDocument();
    expect(within(dialog).getByText('#4790 · Bug')).toBeInTheDocument();
    expect(within(dialog).getByText('Your current timer continues until you press Start tracking.')).toBeInTheDocument();
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
    await expectAccessible();
    await user.click(within(dialog).getByRole('button', { name: 'Start tracking' }));
    expect(engine.dispatched('tracking.start')).toEqual([
      { type: 'tracking.start', draftId: ticketDraft.id, activityId: 'dev', comment: '', includeTicket: true },
    ]);
  });

  it('sends one start for a double click or repeated Return', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    engine.handle('tracking.start', () => new Promise((resolve) => setTimeout(() => resolve(null), 50)));
    await user.dblClick(await screen.findByRole('button', { name: 'Start tracking' }));
    await user.keyboard('{Enter}{Enter}');
    expect(engine.dispatched('tracking.start')).toHaveLength(1);
  });

  it('never starts without a click', async () => {
    const { engine } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    await screen.findByRole('dialog', { name: 'Choose an activity' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
  });

  it('lets the user pick another activity', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow } });
    await user.click(await screen.findByRole('button', { name: /Development/ }));
    await user.click(await screen.findByRole('option', { name: 'Code review' }));
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ activityId: 'review' });
  });

  it('disables Start while the engine is busy', async () => {
    renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerDraftFlow, app: busyApp } });
    expect(await screen.findByRole('button', { name: 'Start tracking' })).toBeDisabled();
    expect(screen.getByText('Starting tracking…')).toBeInTheDocument();
  });

  it('prefills the stand-up comment and allows only the Standup activity', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(standupDraftFlow) } });
    const comment = await screen.findByRole('textbox', { name: 'Comment (optional)' });
    expect(comment).toHaveValue('daily standup');
    expect(screen.getByText('No Azure ticket')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Standup/ }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Standup']);
    await user.keyboard('{Escape}');
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
    expect(screen.getByRole('button', { name: 'Start tracking' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Development/ }));
    await user.click(screen.getByRole('option', { name: 'Meeting' }));
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ activityId: 'meeting' });
  });

  it('shows loading, error and empty activity states', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: picker(loadingActivitiesFlow) } });
    expect(await screen.findByText('Loading 7pace activities…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start tracking' })).toBeDisabled();
    act(() => engine.setSlice('flow', picker(activityErrorFlow)));
    expect(await screen.findByText('Could not load activity types: The request timed out.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload activity types' }));
    expect(engine.dispatched('tracking.reloadActivities')).toHaveLength(1);
    act(() => engine.setSlice('flow', picker(noActivitiesFlow)));
    expect(
      await screen.findByText('No activity types are configured in 7pace. Its workspace default will be used.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(engine.dispatched('tracking.start')[0]).toMatchObject({ activityId: '' });
  });

  it('cancels with the button or Escape', async () => {
    const { engine, user } = renderWithEngine(<TicketPickerSheet />, { with: { flow: pickerSearchFlow } });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('tracking.closePicker')).toHaveLength(1);
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
    await user.click(await screen.findByRole('button', { name: 'Start tracking' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Confirm this change' });
    expect(confirm).toHaveTextContent('The 7pace timer changed. Start anyway?');
    await user.click(within(confirm).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(engine.dispatched('tracking.start')).toHaveLength(2));
    expect(engine.dispatched('tracking.start')[1]).toMatchObject({ confirmed: true });
    expect(await screen.findByText('The 7pace timer changed on the server.')).toBeInTheDocument();
  });
});
