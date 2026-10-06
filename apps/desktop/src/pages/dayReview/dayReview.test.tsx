import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import {
  dayReviewEmptyDay,
  dayReviewFailed,
  dayReviewLoading,
  dayReviewReviewed,
  dayReviewToday,
  dayReviewUnconfigured,
} from '../../ipc/fixtures/slices/dayReview';
import type { DayReviewSlice, SliceMap } from '../../ipc/contract';
import { FakePageCommands, PageFrame, resetAriaAnnouncer } from '../../features/ticketContext/testing';
import { MainSurface } from '../../surfaces/MainSurface';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import DayReviewPage from './index';

beforeEach(() => {
  // Only the clock is fake: "today" is Tuesday 6 October 2026, and user-event keeps real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
});

afterEach(() => {
  vi.useRealTimers();
  resetAriaAnnouncer();
});

function renderReview(dayReview: DayReviewSlice | undefined, extra: Partial<SliceMap> = {}, onOpen = vi.fn()) {
  const slices = sampleSlices();
  if (dayReview) slices.dayReview = dayReview;
  else delete slices.dayReview;
  const result = renderWithEngine(
    <PageFrame title="Day review">
      <FakePageCommands onOpen={onOpen} />
      <DayReviewPage />
    </PageFrame>,
    { slices: { ...slices, ...extra } },
  );
  return { ...result, onOpen };
}

describe('Day review page', () => {
  it('summarises the day against the target, with gaps and long entries', async () => {
    renderReview(sampleSlices().dayReview);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Day at a glance',
      'Needs a look',
      'Time entries',
      'Finish the review',
    ]);
    expect(screen.getByText('Monday 5 October')).toBeInTheDocument();
    expect(screen.getByText('7h 15m')).toBeInTheDocument();
    expect(screen.getByText('6 entries')).toBeInTheDocument();
    expect(screen.getByText('7h 36m')).toBeInTheDocument();
    expect(screen.getByText('180 minutes or more')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Tracked time against the daily target' })).toHaveAttribute(
      'aria-valuetext',
      '7h 15m of 7h 36m',
    );
    expect(screen.getByText('1h 25m without a reported entry. Lunch, breaks and time off can explain these gaps.')).toBeInTheDocument();
    const perTicket = screen.getByRole('table', { name: 'Time per ticket' });
    expect(within(perTicket).getByRole('rowheader', { name: '#4821 · Checkout: retry failed card payments' })).toBeInTheDocument();
    expect(screen.getAllByText('Long entry')).toHaveLength(2);
    await expectNoA11yViolations();
  });

  it('marks the day reviewed', async () => {
    const { engine, user } = renderReview(sampleSlices().dayReview);
    engine.handle('dayReview.markReviewed', (_intent, mock) =>
      mock.patchSlice('dayReview', { record: { ...dayReviewReviewed.record } }),
    );
    await user.click(screen.getByRole('button', { name: 'Mark day reviewed' }));
    expect(engine.dispatched('dayReview.markReviewed')).toEqual([{ type: 'dayReview.markReviewed', day: '2026-10-05' }]);
    expect(await screen.findByText(/^Reviewed 5 Oct 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark day reviewed' })).toBeNull();
  });

  it('moves between days and back to today', async () => {
    const { engine, user } = renderReview(sampleSlices().dayReview);
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(engine.dispatched('dayReview.setDay').map((intent) => intent.day)).toEqual(['2026-10-04', '2026-10-06']);
    // Today is the latest day there is to review.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled());
  });

  it('offers to pause or stop a running timer, then refreshes the review', async () => {
    const { engine, user } = renderReview(dayReviewToday, {
      prompts: { ...sampleSlices().prompts!, dayReview: { day: '2026-10-06', canSnooze: true } },
    });
    expect(screen.getByRole('heading', { name: 'Your timer is still running' })).toBeInTheDocument();
    expect(screen.getByText('Checkout: retry failed card payments', { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause tracking' }));
    expect(engine.dispatched('tracking.pause')).toHaveLength(1);
    await waitFor(() => expect(engine.dispatched('dayReview.refresh')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Stop tracking' }));
    expect(engine.dispatched('tracking.stop')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Remind me in 30 minutes' }));
    expect(engine.dispatched('dayReview.snooze')).toHaveLength(1);
    await expectNoA11yViolations();
  });

  it('disables the timer buttons while a write is in progress', () => {
    renderReview(dayReviewToday, { app: { ...sampleSlices().app!, busy: true } });
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop tracking' })).toBeDisabled();
  });

  it('opens the day in History and its gaps in the Time editor', async () => {
    const { engine, user, onOpen } = renderReview(sampleSlices().dayReview);
    await user.click(screen.getByRole('button', { name: 'Open this day in History' }));
    await waitFor(() => expect(engine.dispatched('history.load')).toHaveLength(1));
    expect(engine.dispatched('history.setRange')).toEqual([{ type: 'history.setRange', from: '2026-10-05', to: '2026-10-05' }]);
    expect(onOpen).toHaveBeenCalledWith('history');

    await user.click(screen.getByRole('button', { name: 'Review gaps & overlaps in Time editor…' }));
    await waitFor(() => expect(engine.dispatched('timeEditor.loadCorrections')).toHaveLength(1));
    expect(engine.dispatched('timeEditor.setDay')).toEqual([{ type: 'timeEditor.setDay', day: '2026-10-05' }]);
    expect(onOpen).toHaveBeenCalledWith('timeEditor');
  });

  it('shows a skeleton, then the loading state', async () => {
    const { engine } = renderReview(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the day review');
    act(() => engine.setSlice('dayReview', dayReviewLoading));
    expect(await screen.findByText('Loading the day’s worklogs…')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('keeps the last sync visible when a refresh fails', async () => {
    renderReview(dayReviewFailed);
    expect(screen.getByText('Could not refresh worklogs')).toBeInTheDocument();
    expect(screen.getByText('The 7pace request timed out.')).toBeInTheDocument();
    expect(screen.getByText('The entries below are from the last successful sync.')).toBeInTheDocument();
    expect(screen.getByText(/A reliable gap estimate is unavailable for this day/)).toBeInTheDocument();
    expect(screen.getByText('1 entry has an invalid date or duration and needs checking in 7pace.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark day reviewed' })).toBeDisabled();
    await expectNoA11yViolations();
  });

  it('asks to connect when 7pace is not set up', async () => {
    const { user, onOpen } = renderReview(dayReviewUnconfigured);
    expect(screen.getByRole('heading', { name: 'Connect to review your day' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpen).toHaveBeenCalledWith('settings');
    await expectNoA11yViolations();
  });

  it('explains a day without entries', () => {
    renderReview({ ...dayReviewEmptyDay, gapMinutes: 20 });
    expect(screen.getByText('No entries recorded for this day.')).toBeInTheDocument();
    expect(screen.getByText('No gaps of 20 minutes or longer in your configured workday so far.')).toBeInTheDocument();
  });

  it('refreshes from the page header', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, {
      with: { app: { ...sampleSlices().app!, visiblePage: 'dayReview' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Refresh review' }));
    expect(engine.dispatched('dayReview.refresh')).toHaveLength(1);
  });
});
