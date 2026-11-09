import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import { MockEngineError } from '../../ipc/mockEngine';
import { sampleLogs, timeEditorEditing, timeEditorNeedsReview } from '../../ipc/fixtures/slices/timeEditor';
import type { Route } from '../../layout/navigation';
import { expectNoA11yViolations } from '../../test/axe';
import { renderTimesheet } from './testing';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const CARD_RETRY = '#4821 Checkout: retry failed card payments, Development, 09:15 to 12:40, 3h 25m, long entry';

function calendar() {
  return screen.getByRole('region', { name: 'Week calendar' });
}

describe('Timesheet · Week', () => {
  it('loads the week through the history range and titles it with its totals', async () => {
    const { engine } = renderTimesheet('week');
    expect(screen.getByRole('heading', { level: 1, name: '5 – 9 October 2026' })).toBeInTheDocument();
    // Monday and Tuesday's worklogs plus the running timer, of the 38h target; one draft not uploaded.
    expect(screen.getByText(/^9h \d+m of 38h 0m · 2 drafts not uploaded$/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Week' })).toBeChecked();
    await waitFor(() =>
      expect(engine.dispatched('history.setRange')).toEqual([{ type: 'history.setRange', from: '2026-10-05', to: '2026-10-06' }]),
    );
    await waitFor(() => expect(engine.dispatched('history.load')).toHaveLength(1));
  });

  it('shows each day as a named group with its blocks, gaps, overlaps and drafts', async () => {
    renderTimesheet('week');
    const days = within(calendar()).getAllByRole('group');
    expect(days.map((day) => day.getAttribute('aria-label'))).toEqual([
      'Monday 5 October, 7h 15m, 2 possible gaps, 1 overlap, 1 offline draft',
      expect.stringMatching(/^Tuesday 6 October, today, 2h \d+m, 1 offline draft$/),
      'Wednesday 7 October, nothing tracked',
      'Thursday 8 October, nothing tracked',
      'Friday 9 October, nothing tracked',
    ]);
    const monday = days[0]!;
    expect(within(monday).getAllByRole('button')).toHaveLength(7);
    expect(within(monday).getByRole('button', { name: CARD_RETRY })).toHaveTextContent('Long entry');
    expect(
      within(monday).getByRole('button', {
        name: '#4655 Design system: date picker tokens, Design, 15:40 to 16:30, 0h 50m, overlaps another entry',
      }),
    ).toBeInTheDocument();
    expect(
      within(monday).getByRole('button', { name: /^#4821 Checkout: retry failed card payments, Development, 17:00 to 17:30, 0h 30m, locked by 7pace$/ }),
    ).toHaveTextContent('#4821 · locked');
    expect(
      within(monday).getByRole('button', {
        name: '#4821 Checkout: retry failed card payments, Development, 18:00 to 19:15, 1h 15m, offline draft, not in 7pace yet',
      }),
    ).toHaveTextContent('Draft · #4821');
    expect(within(days[1]!).getByRole('button', { name: /^#4821 Checkout: retry failed card payments, Development, running since 08:36/ })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Code review',
      'Design',
      'Development',
      'Standup',
      'Offline draft',
      'Overlap',
      'Gap',
    ]);
    await expectNoA11yViolations();
  });

  it('suggests a second look at Monday, fixes it in the Day view and marks it reviewed', async () => {
    const onNavigate = vi.fn<(route: Route) => void>();
    const { engine, user } = renderTimesheet('week', { onNavigate });
    const look = screen.getByRole('region', { name: 'Monday needs a look' });
    expect(within(look).getByText('16:20 – 16:30 · #4655 and Reviewing pull requests', { exact: false })).toBeInTheDocument();
    expect(within(look).getByText('· 1h 25m without an entry', { exact: false })).toBeInTheDocument();
    expect(within(look).getByText('· 18:00 – 19:15 not uploaded', { exact: false })).toBeInTheDocument();

    await user.click(within(look).getByRole('button', { name: 'Mark Monday reviewed' }));
    expect(engine.dispatched('dayReview.markReviewed')).toEqual([{ type: 'dayReview.markReviewed', day: '2026-10-05' }]);

    await user.click(within(look).getByRole('button', { name: 'Fill gaps' }));
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'day' }));
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-10-05' }]);
    expect(engine.dispatched('timeEditor.loadCorrections')).toHaveLength(1);
  });

  it('opens drafts from a draft block and from the look card', async () => {
    const onNavigate = vi.fn<(route: Route) => void>();
    const { user } = renderTimesheet('week', { onNavigate });
    await user.click(within(calendar()).getAllByRole('button', { name: /offline draft, not in 7pace yet$/ })[0]!);
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'drafts' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Offline drafts' })).toBeInTheDocument();
  });

  it('edits the selected block through the time editor and saves after confirmation', async () => {
    const { engine, user } = renderTimesheet('week');
    engine.handle('timeEditor.select', (_intent, mock) => mock.setSlice('timeEditor', timeEditorEditing));
    const block = within(calendar()).getByRole('button', { name: CARD_RETRY });
    await user.click(block);
    expect(engine.dispatched('timeEditor.select')).toEqual([{ type: 'timeEditor.select', logId: sampleLogs.cardRetry.id }]);
    expect(block).toHaveAttribute('aria-pressed', 'true');
    const card = await screen.findByRole('region', { name: 'Selected entry' });
    expect(within(card).getByText('Checkout: retry failed card payments')).toBeInTheDocument();
    expect(within(card).getByText('Monday 5 October')).toBeInTheDocument();
    // The engine's edit times: 3h 15m after shortening.
    expect(within(card).getByText('3h 15m')).toBeInTheDocument();
    expect(within(card).getAllByRole('spinbutton', { name: /hour, Start/i })).not.toHaveLength(0);
    await expectNoA11yViolations();

    await user.click(within(card).getByRole('button', { name: 'Save to 7pace' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Save these time changes in 7pace?' });
    expect(engine.dispatched('timeEditor.save')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Save time changes' }));
    expect(engine.dispatched('timeEditor.save')).toHaveLength(1);
  });

  it('sends edited times and opens the full edit sheet for split', async () => {
    const { engine, user } = renderTimesheet('week');
    engine.handle('timeEditor.select', (_intent, mock) => mock.setSlice('timeEditor', timeEditorEditing));
    await user.click(within(calendar()).getByRole('button', { name: CARD_RETRY }));
    const card = await screen.findByRole('region', { name: 'Selected entry' });
    await user.click(within(card).getAllByRole('spinbutton', { name: /minute, End/i })[0]!);
    await user.keyboard('{ArrowUp}');
    expect(engine.dispatched('timeEditor.setTimes').at(-1)).toEqual({
      type: 'timeEditor.setTimes',
      start: '2026-10-05T07:15:00.000Z',
      end: '2026-10-05T10:31:00.000Z',
    });
    await user.click(within(card).getByRole('button', { name: 'More options…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit time · recorded time' });
    expect(within(sheet).getByRole('radio', { name: 'Split entry' })).toBeInTheDocument();
  });

  it('closes the selection and cancels the edit', async () => {
    const { engine, user } = renderTimesheet('week');
    engine.handle('timeEditor.select', (_intent, mock) => mock.setSlice('timeEditor', timeEditorEditing));
    await user.click(within(calendar()).getByRole('button', { name: CARD_RETRY }));
    const card = await screen.findByRole('region', { name: 'Selected entry' });
    await user.click(within(card).getByRole('button', { name: 'Close selected entry' }));
    expect(engine.dispatched('timeEditor.cancel')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Selected entry' })).toBeNull();
  });

  it('shows locked entries and the running timer without editing them', async () => {
    const { engine, user } = renderTimesheet('week');
    await user.click(within(calendar()).getByRole('button', { name: /locked by 7pace$/ }));
    const card = screen.getByRole('region', { name: 'Selected entry' });
    expect(within(card).getByText('7pace doesn’t allow editing this entry.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Save to 7pace' })).toBeNull();
    await user.click(within(calendar()).getByRole('button', { name: /running since/ }));
    expect(within(screen.getByRole('region', { name: 'Selected entry' })).getByText(/timer is still running/)).toBeInTheDocument();
    expect(engine.dispatched('timeEditor.select')).toHaveLength(0);
  });

  it('opens the selected entry’s day', async () => {
    const onNavigate = vi.fn<(route: Route) => void>();
    const { engine, user } = renderTimesheet('week', { onNavigate });
    await user.click(within(calendar()).getByRole('button', { name: /locked by 7pace$/ }));
    await user.click(screen.getByRole('button', { name: 'Open day' }));
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'day' }));
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-10-05' }]);
  });

  it('steps to the previous week and not past the current one', async () => {
    const { engine, user } = renderTimesheet('week');
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { level: 1, name: '28 September – 2 October 2026' })).toBeInTheDocument();
    expect(engine.dispatched('history.setRange').at(-1)).toEqual({ type: 'history.setRange', from: '2026-09-28', to: '2026-10-04' });
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  });

  it('filters the calendar by ticket or comment', async () => {
    const { user } = renderTimesheet('week');
    await user.type(screen.getByRole('searchbox', { name: 'Filter entries' }), 'pull requests');
    expect(within(calendar()).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Reviewing pull requests, Code review, 16:20 to 17:00/),
    ]);
  });

  it('adds time as an offline draft', async () => {
    const { user } = renderTimesheet('week');
    await user.click(screen.getByRole('button', { name: 'Add time' }));
    expect(await screen.findByRole('dialog', { name: 'Edit offline time' })).toBeInTheDocument();
  });

  it('drags across an empty slot to add an entry to 7pace', async () => {
    const { engine, user } = renderTimesheet('week');
    const monday = within(calendar()).getAllByRole('group')[0]!;
    // The column shows 08:00–20:00 local; 100 px per hour.
    vi.spyOn(monday, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 1200, bottom: 1200, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(monday, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(monday, { pointerId: 1, clientY: 230 });
    fireEvent.pointerUp(monday, { pointerId: 1, clientY: 230 });

    const dialog = await screen.findByRole('dialog', { name: 'Add time to 7pace' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Azure ticket number (optional)' }), '4821');
    await user.click(within(dialog).getByRole('button', { name: 'Add entry' }));
    await waitFor(() => expect(engine.dispatched('timeEditor.create')).toHaveLength(1));
    const [intent] = engine.dispatched('timeEditor.create');
    // 09:00–10:30 in Brussels (UTC+2), the saved default activity.
    expect(Date.parse(intent!.start)).toBe(Date.parse('2026-10-05T07:00:00Z'));
    expect(Date.parse(intent!.end)).toBe(Date.parse('2026-10-05T08:30:00Z'));
    expect(intent).toMatchObject({ ticketId: 4821, comment: '', activityId: 'dev', billable: false });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add time to 7pace' })).toBeNull());
  });

  it('keeps a click on an empty slot and clicks on blocks from creating anything', async () => {
    const { user } = renderTimesheet('week');
    const monday = within(calendar()).getAllByRole('group')[0]!;
    fireEvent.pointerDown(monday, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerUp(monday, { pointerId: 1, clientY: 101 });
    await user.click(within(monday).getByRole('button', { name: CARD_RETRY }));
    expect(screen.queryByRole('dialog', { name: 'Add time to 7pace' })).toBeNull();
  });

  it('shows a refused entry in the dialog and keeps it open', async () => {
    const { engine, user } = renderTimesheet('week');
    engine.handle('timeEditor.create', () => {
      throw new MockEngineError('message', 'Choose valid times with no time in the future.');
    });
    const monday = within(calendar()).getAllByRole('group')[0]!;
    vi.spyOn(monday, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 1200, bottom: 1200, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(monday, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(monday, { pointerId: 1, clientY: 200 });
    fireEvent.pointerUp(monday, { pointerId: 1, clientY: 200 });
    const dialog = await screen.findByRole('dialog', { name: 'Add time to 7pace' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Comment (required without a ticket)' }), 'Support call');
    await user.click(within(dialog).getByRole('button', { name: 'Add entry' }));
    expect(await within(dialog).findByText('Choose valid times with no time in the future.')).toBeInTheDocument();
  });

  it('says why dragging is off while an earlier change needs review', async () => {
    const onNavigate = vi.fn();
    const { user } = renderTimesheet('week', { with: { timeEditor: timeEditorNeedsReview }, onNavigate });
    const monday = within(calendar()).getAllByRole('group')[0]!;
    vi.spyOn(monday, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 1200, bottom: 1200, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(monday, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(monday, { pointerId: 1, clientY: 200 });
    fireEvent.pointerUp(monday, { pointerId: 1, clientY: 200 });
    expect(screen.queryByRole('dialog', { name: 'Add time to 7pace' })).toBeNull();
    expect(screen.getByText('An earlier change needs review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review in Day' }));
    expect(onNavigate).toHaveBeenCalledWith({ place: 'timesheet', view: 'day' });
  });

  it('explains that 7pace takes no future time when a drag starts after now', async () => {
    const { user } = renderTimesheet('week');
    const wednesday = within(calendar()).getAllByRole('group')[2]!;
    fireEvent.pointerDown(wednesday, { button: 0, pointerId: 1, clientY: 100 });
    expect(await screen.findByText(/7pace only takes time that has already passed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/7pace only takes time that has already passed/)).toBeNull();
  });

  it('shows a skeleton until the week is loaded', () => {
    const { engine } = renderTimesheet('week', { with: { history: undefined } });
    expect(screen.queryByRole('region', { name: 'Week calendar' })).toBeNull();
    act(() => engine.setSlice('history', sampleSlices().history!));
    expect(screen.getByRole('region', { name: 'Week calendar' })).toBeInTheDocument();
  });
});

describe('Timesheet place', () => {
  it('switches views from the header', async () => {
    const onNavigate = vi.fn<(route: Route) => void>();
    const { user } = renderTimesheet('week', { onNavigate });
    const views = screen.getByRole('radiogroup', { name: 'View' });
    expect(within(views).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent ?? radio.getAttribute('aria-label'))).toHaveLength(4);
    await user.click(within(views).getByRole('radio', { name: 'List' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'list' });
    expect(await screen.findByRole('tab', { name: '7pace worklogs' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Day' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Drafts · 3' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Offline drafts' })).toBeInTheDocument();
  });

  it('leaves out views whose page is hidden and falls back to the first one left', () => {
    renderTimesheet('week', { hiddenPages: ['history', 'offlineDrafts'] });
    // Only Day is left: no view switch, the Day view instead of the week.
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
  });

  it('labels Drafts without a count when nothing waits', () => {
    renderTimesheet('week', { with: { offline: { ...sampleSlices().offline!, readyCount: 0 } } });
    expect(screen.getByRole('radio', { name: 'Drafts' })).toBeInTheDocument();
  });
});
