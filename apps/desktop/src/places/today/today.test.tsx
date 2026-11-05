import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import { agendaDenied, agendaNotDetermined, agendaUnsupported } from '../../ipc/fixtures/slices/agenda';
import { unconfiguredConnection } from '../../ipc/fixtures/slices/connection';
import { dayReviewFailed, dayReviewLoading, dayReviewReviewed, dayReviewToday, dayReviewUnconfigured } from '../../ipc/fixtures/slices/dayReview';
import { allPrompts, dayReviewPrompts, noPrompts } from '../../ipc/fixtures/slices/flow';
import { todayLogs } from '../../ipc/fixtures/slices/history';
import { offlineEmpty, readyDraft, sendingDraft } from '../../ipc/fixtures/slices/offline';
import { pausedTracking, sampleHistory, stoppedTracking } from '../../ipc/fixtures/slices/tracking';
import type { DayReviewSlice, SliceMap } from '../../ipc/contract';
import { NavigationContext, type Navigation } from '../../layout/NavigationContext';
import { pageVisibility, resolveRoute, routesEqual, toRoute, type PageId } from '../../layout/navigation';
import { PageTitleContext } from '../../layout/pageTitle';
import { MainSurface } from '../../surfaces/MainSurface';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import TodayPlace from './index';

const MONDAY: DayReviewSlice = sampleSlices().dayReview!;

beforeEach(() => {
  // Only the clock is fake: "today" is Tuesday 6 October 2026, 10:00 in Brussels.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

function Frame({ navigation, children }: { navigation: Navigation; children: ReactNode }) {
  return (
    <NavigationContext.Provider value={navigation}>
      <PageTitleContext.Provider value="today-title">
        <main aria-labelledby="today-title">{children}</main>
      </PageTitleContext.Provider>
    </NavigationContext.Provider>
  );
}

interface Options {
  hidden?: PageId[];
  platform?: 'macos' | 'windows';
}

/** Today with the day review on today (unless overridden) and a navigation that records requests. */
function renderToday(extra: Partial<SliceMap> = {}, { hidden = [], platform = 'macos' }: Options = {}) {
  const navigate = vi.fn();
  const isPageVisible = pageVisibility({ platform, hiddenPages: hidden });
  const navigation: Navigation = {
    route: { place: 'today' },
    navigate,
    canNavigate: (target) => routesEqual(resolveRoute(toRoute(target), isPageVisible), toRoute(target)),
    isPageVisible,
  };
  const result = renderWithEngine(
    <Frame navigation={navigation}>
      <TodayPlace />
    </Frame>,
    { with: { dayReview: dayReviewToday, history: { ...sampleHistory, todayLogs }, ...extra } },
  );
  // The engine answers a day change with that day's review.
  result.engine.handle('dayReview.setDay', (intent, mock) =>
    mock.setSlice('dayReview', intent.day === '2026-10-06' ? dayReviewToday : { ...MONDAY, selectedDay: intent.day }),
  );
  return { ...result, navigate };
}

function region(name: string | RegExp) {
  return screen.getByRole('region', { name });
}

describe('Today', () => {
  it('shows today: the timer, suggestions, the day on the clock, the day check and offline drafts', async () => {
    const { engine } = renderToday();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday 6 October' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Tuesday 6 October' })).toBeInTheDocument();
    expect(screen.getByText('Today', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    expect(screen.getByText('2h 23m')).toBeInTheDocument();
    expect(screen.getByText('of 7h 36m', { exact: false })).toBeInTheDocument();

    const now = region('Tracking now');
    expect(within(now).getByText('Checkout: retry failed card payments')).toBeInTheDocument();
    expect(within(now).getByText('01:23:20')).toBeInTheDocument();
    expect(within(now).getByText(/since 08:36/)).toBeInTheDocument();
    expect(within(now).getByRole('button', { name: /^Pause/ })).toBeInTheDocument();
    expect(within(now).getByRole('button', { name: /^Stop/ })).toBeInTheDocument();
    expect(within(now).getByRole('button', { name: 'Switch ticket…' })).toBeInTheDocument();

    const suggestions = region('Suggestions');
    expect(within(suggestions).getByText('1 waiting')).toBeInTheDocument();
    expect(within(suggestions).getByRole('button', { name: /Track #4790/ })).toBeInTheDocument();

    const day = region('Your day');
    const calendar = within(day).getByRole('list', { name: 'Calendar events' });
    expect(within(calendar).getAllByRole('listitem').map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Checkout retry design review AB#4821'), expect.stringContaining('Lunch & learn')]),
    );
    expect(within(day).getByRole('list', { name: 'All-day events' })).toHaveTextContent('Sprint 42: review week');
    const tracked = within(day).getByRole('list', { name: 'Tracked time' });
    expect(tracked).toHaveTextContent('#4790');
    expect(tracked).toHaveTextContent('Running since 08:36');
    expect(within(day).getByRole('list', { name: 'Legend' })).toHaveTextContent('Calendar event');
    // The running timer started before the saved worklogs ended, but only saved entries overlap.
    expect(tracked).not.toHaveTextContent('overlaps another entry');
    expect(within(day).getByRole('list', { name: 'Legend' })).not.toHaveTextContent('Overlap');

    const check = region('Day check');
    expect(within(check).getByText('No gaps so far today')).toBeInTheDocument();
    expect(within(check).getByText('No overlaps')).toBeInTheDocument();
    expect(within(check).getByText(/You’ll get a long-entry check at 3h 0m/)).toBeInTheDocument();

    const drafts = region('Offline drafts');
    expect(within(drafts).getByText('3 drafts aren’t in 7pace yet.')).toBeInTheDocument();

    // The engine already shows today: nothing to change.
    expect(engine.dispatched('dayReview.setDay')).toEqual([]);
    expect(engine.dispatched('agenda.setDay')).toEqual([]);
    await expectNoA11yViolations();
  });

  it('runs the timer, the day check and the drafts link through the engine', async () => {
    const { engine, user, navigate } = renderToday({ prompts: dayReviewPrompts });
    const now = region('Tracking now');
    await user.click(within(now).getByRole('button', { name: /^Pause/ }));
    expect(engine.dispatched('tracking.pause')).toHaveLength(1);
    await user.click(within(now).getByRole('button', { name: 'Switch ticket…' }));
    expect(engine.dispatched('tracking.openPicker')).toHaveLength(1);

    const check = region('Day check');
    await user.click(within(check).getByRole('button', { name: 'Mark day reviewed' }));
    expect(engine.dispatched('dayReview.markReviewed')).toEqual([{ type: 'dayReview.markReviewed', day: '2026-10-06' }]);
    await user.click(within(check).getByRole('button', { name: 'Remind me in 30 minutes' }));
    expect(engine.dispatched('dayReview.snooze')).toHaveLength(1);
    // The review prompt is offered by the day check, not repeated as a suggestion.
    expect(screen.queryByRole('button', { name: 'Open review' })).toBeNull();

    await user.click(within(region('Offline drafts')).getByRole('button', { name: 'Open in Timesheet' }));
    expect(navigate).toHaveBeenCalledWith({ place: 'timesheet', view: 'drafts' });
  });

  it('deletes an offline draft from Today after confirmation', async () => {
    const single = { ...offlineEmpty, drafts: [readyDraft], readyCount: 1 };
    const { engine, user } = renderToday({ offline: single });
    const drafts = region('Offline drafts');
    expect(within(drafts).getByText(/^#4821 · .* isn’t in 7pace yet\.$/)).toBeInTheDocument();
    await user.click(within(drafts).getByRole('button', { name: /^Delete draft, #4821 · Mon \d\d:\d\d – \d\d:\d\d$/ }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Delete this draft?' });
    expect(dialog).toHaveAccessibleDescription(/^“#4821 · Mon \d\d:\d\d – \d\d:\d\d” is not uploaded to 7pace\. This can’t be undone\.$/);
    await expectNoA11yViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    expect(engine.dispatched('offline.remove')).toEqual([{ type: 'offline.remove', draftId: readyDraft.id }]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // The previous day's Day check offers it per draft.
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    const check = await screen.findByRole('region', { name: 'Day check' });
    await waitFor(() => expect(within(check).getByRole('heading', { name: '1 offline draft' })).toBeInTheDocument());
    await user.click(within(check).getByRole('button', { name: /^Delete, #4821 · Mon/ }));
    dialog = await screen.findByRole('alertdialog', { name: 'Delete this draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep draft' }));
    expect(engine.dispatched('offline.remove')).toHaveLength(1);
    await user.click(within(check).getByRole('button', { name: /^Delete, #4821 · Mon/ }));
    dialog = await screen.findByRole('alertdialog', { name: 'Delete this draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    expect(engine.dispatched('offline.remove')).toHaveLength(2);
    // The deleted draft's button is gone: focus continues from the Day check.
    await waitFor(() => expect(within(check).getByRole('heading', { level: 2, name: 'Day check' })).toHaveFocus());
  });

  it('offers Delete on the Offline drafts card only for a single named draft', () => {
    renderToday();
    const drafts = region('Offline drafts');
    expect(within(drafts).getByText('3 drafts aren’t in 7pace yet.')).toBeInTheDocument();
    expect(within(drafts).queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('deletes a single unconfirmed upload from Today with a warning', async () => {
    const { engine, user } = renderToday({ offline: { ...offlineEmpty, drafts: [sendingDraft], readyCount: 1 } });
    await user.click(within(region('Offline drafts')).getByRole('button', { name: /^Delete draft, #4655/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this unconfirmed draft?' });
    expect(dialog).toHaveAccessibleDescription(/so 7pace may already have it\. Only the draft on this device is deleted/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }));
    expect(engine.dispatched('offline.remove')).toEqual([{ type: 'offline.remove', draftId: sendingDraft.id }]);
  });

  it('asks the engine for today when it still shows another day', async () => {
    const { engine } = renderToday({ dayReview: MONDAY, agenda: { ...sampleSlices().agenda!, day: '2026-10-05' } });
    await waitFor(() => expect(engine.dispatched('dayReview.setDay')).toEqual([{ type: 'dayReview.setDay', day: '2026-10-06' }]));
    expect(engine.dispatched('agenda.setDay')).toEqual([{ type: 'agenda.setDay', day: '2026-10-06' }]);
    expect(await screen.findByText('No gaps so far today')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday 6 October' })).toBeInTheDocument();
  });

  it('reviews the previous day in place, with its checks, and goes back to today', async () => {
    const { engine, user, navigate } = renderToday();
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(engine.dispatched('dayReview.setDay').at(-1)).toEqual({ type: 'dayReview.setDay', day: '2026-10-05' });
    expect(engine.dispatched('agenda.setDay').at(-1)).toEqual({ type: 'agenda.setDay', day: '2026-10-05' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
    expect(screen.getByText('Not reviewed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
    expect(screen.getByText('7h 15m')).toBeInTheDocument();

    const perTicket = region('Time per ticket');
    expect(within(perTicket).getByText('6 entries · 4 tickets')).toBeInTheDocument();
    expect(within(perTicket).getAllByRole('listitem')[0]).toHaveTextContent('#4821 Checkout: retry failed card payments3h 55m');

    const clock = region('Monday on the clock');
    expect(within(clock).getByRole('list', { name: 'Tracked time' })).toHaveTextContent('Possible gap 12:40 – 13:30');
    expect(within(clock).getByRole('list', { name: 'Tracked time' })).toHaveTextContent(/09:15 – 12:40 · 3h 25m, long entry/);
    expect(within(clock).getByRole('list', { name: 'Legend' })).toHaveTextContent('Possible gapOverlapLong entry');

    const check = region('Day check');
    expect(within(check).getByRole('heading', { name: 'Long entry · 3h 25m' })).toBeInTheDocument();
    expect(within(check).getByText('#4821 from 09:15 to 12:40. A forgotten timer, or one long session?')).toBeInTheDocument();
    expect(within(check).getByRole('heading', { name: '2 possible gaps · 1h 25m' })).toBeInTheDocument();
    expect(within(check).getByText('12:40 – 13:30 and 15:05 – 15:40')).toBeInTheDocument();
    expect(within(check).getByRole('heading', { name: 'Overlap · 0h 10m' })).toBeInTheDocument();
    expect(within(check).getByText('#4655 and Reviewing pull requests both cover 16:20 – 16:30.')).toBeInTheDocument();
    expect(within(check).getByRole('heading', { name: '1 offline draft' })).toBeInTheDocument();
    expect(within(check).getByText('Saves a review status on this Mac. It doesn’t submit a timesheet.')).toBeInTheDocument();
    await expectNoA11yViolations();

    await user.click(within(check).getByRole('button', { name: 'Fix overlap…' }));
    await waitFor(() => expect(engine.dispatched('timeEditor.loadCorrections')).toHaveLength(1));
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-10-05' }]);
    expect(navigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'day' });

    await user.click(within(check).getByRole('button', { name: 'Split in Timesheet…' }));
    await waitFor(() => expect(engine.dispatched('timeEditor.setFilter')).toEqual([{ type: 'timeEditor.setFilter', text: '4821' }]));

    await user.click(within(perTicket).getByRole('button', { name: 'Edit entries in Timesheet' }));
    expect(navigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'day' });

    await user.click(within(check).getByRole('button', { name: 'Mark Monday reviewed' }));
    expect(engine.dispatched('dayReview.markReviewed')).toEqual([{ type: 'dayReview.markReviewed', day: '2026-10-05' }]);

    await user.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(engine.dispatched('dayReview.setDay').at(-1)).toEqual({ type: 'dayReview.setDay', day: '2026-10-06' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tuesday 6 October' })).toBeInTheDocument();
  });

  it('shows a reviewed day as reviewed', async () => {
    const { engine, user } = renderToday();
    engine.handle('dayReview.setDay', (_intent, mock) => mock.setSlice('dayReview', dayReviewReviewed));
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByText('Reviewed', { selector: 'span' })).toBeInTheDocument();
    expect(within(region('Day check')).getByRole('status')).toHaveTextContent(/^Reviewed /);
    expect(screen.queryByRole('button', { name: 'Mark Monday reviewed' })).toBeNull();
  });

  it('offers an earlier day the engine wants reviewed', async () => {
    const { engine, user } = renderToday({ prompts: { ...noPrompts, dayReview: { day: '2026-10-05', canSnooze: false } } });
    const card = region('Monday isn’t reviewed');
    await user.click(within(card).getByRole('button', { name: 'Review Monday' }));
    expect(engine.dispatched('dayReview.setDay').at(-1)).toEqual({ type: 'dayReview.setDay', day: '2026-10-05' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
  });

  it('follows a day the engine opens itself ("Open review")', async () => {
    const { engine, user } = renderToday();
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
    act(() => engine.setSlice('dayReview', dayReviewToday));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tuesday 6 October' })).toBeInTheDocument();
  });

  it('refreshes with ⌘R: the connection on today, the review on another day', async () => {
    const { engine, user } = renderToday();
    await user.keyboard('{Meta>}r{/Meta}');
    expect(engine.dispatched('connection.refresh')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' });
    await user.keyboard('{Meta>}r{/Meta}');
    expect(engine.dispatched('dayReview.refresh')).toHaveLength(1);
  });
});

describe('Today overlaps', () => {
  it('flags saved worklogs that cover the same time on the timeline', () => {
    const [first, second] = todayLogs;
    const overlapping = [first!, { ...second!, timestamp: '2026-10-06T06:40:00Z' }];
    renderToday({ history: { ...sampleHistory, todayLogs: overlapping }, tracking: stoppedTracking });
    const day = region('Your day');
    expect(within(day).getAllByText(/overlaps another entry/)).toHaveLength(2);
    expect(within(day).getByRole('list', { name: 'Legend' })).toHaveTextContent('Overlap');
  });
});

describe('Today tracked time', () => {
  it('opens a saved entry in Timesheet · Day by click or keyboard; the running timer is no button', async () => {
    const [invoice, standup] = todayLogs;
    const { engine, user, navigate } = renderToday();
    const tracked = within(region('Your day')).getByRole('list', { name: 'Tracked time' });

    await user.click(within(tracked).getByRole('button', { name: 'Open #4790 Invoice PDF shows the wrong VAT number, 08:45 – 09:10 · 0h 25m' }));
    await waitFor(() => expect(engine.dispatched('timeEditor.select')).toEqual([{ type: 'timeEditor.select', logId: invoice!.id }]));
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-10-06' }]);
    expect(navigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'day' });

    within(tracked).getByRole('button', { name: /^Open #4777/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(engine.dispatched('timeEditor.select').at(-1)).toEqual({ type: 'timeEditor.select', logId: standup!.id }));

    // The two saved entries are buttons in time order; the running timer (not an entry yet) is not.
    expect(within(tracked).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Open #4777 .*08:30/),
      expect.stringMatching(/^Open #4790 .*08:45/),
    ]);
    expect(tracked).toHaveTextContent('Running since 08:36');
    await expectNoA11yViolations();
  });

  it('opens a locked entry’s day without selecting it, and a reviewed day’s entries', async () => {
    const [invoice, standup] = todayLogs;
    const { engine, user, navigate } = renderToday({ history: { ...sampleHistory, todayLogs: [{ ...invoice!, isCanEdit: false }, standup!] } });
    await user.click(within(region('Your day')).getByRole('button', { name: /^Open #4790/ }));
    expect(navigate).toHaveBeenLastCalledWith({ place: 'timesheet', view: 'day' });
    await waitFor(() => expect(engine.dispatched('timeEditor.setDay')).toHaveLength(1));
    expect(engine.dispatched('timeEditor.select')).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    const clock = await screen.findByRole('region', { name: 'Monday on the clock' });
    await user.click(within(clock).getByRole('button', { name: /^Open .*, 09:15 – 12:40 · 3h 25m, long entry$/ }));
    await waitFor(() => expect(engine.dispatched('timeEditor.select')).toHaveLength(1));
    expect(engine.dispatched('timeEditor.setDay').at(-1)).toEqual({ type: 'timeEditor.setDay', day: '2026-10-05' });
  });

  it('leaves the blocks inert when the Day view is hidden', () => {
    renderToday({}, { hidden: ['timeEditor'] });
    const tracked = within(region('Your day')).getByRole('list', { name: 'Tracked time' });
    expect(within(tracked).getByText(/Invoice PDF/)).toBeInTheDocument();
    expect(within(tracked).queryAllByRole('button')).toEqual([]);
  });
});

describe('Today suggestions', () => {
  it('opens the first suggestion and lists the rest with Review', async () => {
    const { user } = renderToday({ prompts: allPrompts });
    const suggestions = region('Suggestions');
    // Every prompt but the day review, which the day check offers.
    expect(within(suggestions).getByText('11 waiting')).toBeInTheDocument();
    const rows = within(suggestions).getByRole('list', { name: 'More suggestions' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(3);
    await user.click(within(suggestions).getByRole('button', { name: 'Show all 11' }));
    expect(within(rows).getAllByRole('listitem')).toHaveLength(10);
    const figma = within(rows).getByRole('button', { name: /^Review: Figma file active/ });
    await user.click(figma);
    expect(within(suggestions).getByRole('article', { name: /Figma/ })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('says so when nothing waits', () => {
    renderToday({ prompts: noPrompts });
    expect(within(region('Suggestions')).getByText(/Nothing waiting/)).toBeInTheDocument();
  });
});

describe('Today states', () => {
  it('offers to start or resume tracking', async () => {
    const { engine, user, unmount } = renderToday({ tracking: stoppedTracking });
    await user.click(within(region('Not tracking')).getByRole('button', { name: 'Start tracking…' }));
    expect(engine.dispatched('tracking.openPicker')).toHaveLength(1);
    unmount();
    const paused = renderToday({ tracking: pausedTracking });
    await paused.user.click(within(region(/^Paused/)).getByRole('button', { name: 'Resume…' }));
    expect(paused.engine.dispatched('tracking.resume')).toEqual([{ type: 'tracking.resume', surface: 'picker' }]);
  });

  it('asks to set up accounts before 7pace is connected', async () => {
    const { user, navigate } = renderToday({ connection: unconfiguredConnection, dayReview: { ...dayReviewUnconfigured, selectedDay: '2026-10-06' } });
    await user.click(screen.getByRole('button', { name: 'Set up accounts' }));
    expect(navigate).toHaveBeenCalledWith({ place: 'settings', view: 'accounts' });
    const check = region('Day check');
    expect(within(check).getByText(/Connect your account/)).toBeInTheDocument();
    await user.click(within(check).getByRole('button', { name: 'Open Settings' }));
    expect(navigate).toHaveBeenLastCalledWith({ place: 'settings', view: 'accounts' });
  });

  it('shows loading, failed and unavailable-gap reviews honestly', async () => {
    const { engine, user } = renderToday({ dayReview: { ...dayReviewLoading, selectedDay: '2026-10-06' } });
    expect(within(region('Day check')).getByRole('status')).toHaveTextContent('Checking today’s worklogs');
    act(() => engine.setSlice('dayReview', { ...dayReviewFailed, selectedDay: '2026-10-06', summary: { ...dayReviewFailed.summary!, sessions: [] } }));
    const check = region('Day check');
    expect(within(check).getByText('The 7pace request timed out.')).toBeInTheDocument();
    expect(within(check).getByText('A gap estimate isn’t available right now')).toBeInTheDocument();
    expect(within(check).getByRole('button', { name: 'Mark day reviewed' })).toBeDisabled();
    engine.handle('dayReview.setDay', (_intent, mock) => mock.setSlice('dayReview', dayReviewLoading));
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByText('Loading the day’s worklogs…')).toBeInTheDocument();
  });

  it('asks for calendar access in the Calendar column', async () => {
    const { engine, user } = renderToday({ agenda: agendaNotDetermined });
    const day = region('Your day');
    expect(within(day).queryByRole('list', { name: 'Calendar events' })).toBeNull();
    await user.click(within(day).getByRole('button', { name: 'Allow calendar access' }));
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(1);
    act(() => engine.setSlice('agenda', agendaDenied));
    expect(within(region('Your day')).getByRole('button', { name: 'Check access again' })).toBeInTheDocument();
  });

  it('opens Calendar and the calendar choice from the day', async () => {
    const { engine, user, navigate } = renderToday();
    const day = region('Your day');
    await user.click(within(day).getByRole('button', { name: 'Open Calendar' }));
    expect(engine.dispatched('agenda.openCalendar')).toHaveLength(1);
    await user.click(within(day).getByRole('button', { name: 'Choose calendars' }));
    expect(navigate).toHaveBeenCalledWith({ place: 'settings', view: 'calendars' });
  });

  it('leaves the Calendar column out on Windows and the checks out when their pages are hidden', () => {
    renderToday({ agenda: agendaUnsupported, offline: offlineEmpty }, { platform: 'windows', hidden: ['dayReview'] });
    const day = region('Your day');
    expect(within(day).queryByRole('list', { name: 'Calendar events' })).toBeNull();
    expect(within(day).getByRole('list', { name: 'Tracked time' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Day check' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Offline drafts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose calendars' })).toBeNull();
  });
});

describe('Today in the main window', () => {
  it('is the first place, named by its date', async () => {
    renderWithEngine(<MainSurface />, { with: { dayReview: dayReviewToday, prompts: noPrompts } });
    expect(await screen.findByRole('main', { name: 'Tuesday 6 October' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers the Tracking commands with their 1.14 shortcuts', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, { with: { dayReview: dayReviewToday, prompts: noPrompts } });
    await screen.findByRole('main', { name: 'Tuesday 6 October' });
    await user.keyboard('{Meta>}n{/Meta}');
    expect(engine.dispatched('tracking.openPicker')).toHaveLength(1);
    await user.keyboard('{Meta>}{Shift>}d{/Shift}{/Meta}');
    expect(engine.dispatched('dayReview.open')).toHaveLength(1);
  });
});
