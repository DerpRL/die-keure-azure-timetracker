import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetMockIpc } from '../../ipc';
import type { PromptsSlice, SliceMap } from '../../ipc/contract';
import { busyApp } from '../../ipc/fixtures/slices/app';
import { disconnectedConnection, sampleConnection } from '../../ipc/fixtures/slices/connection';
import {
  allPrompts,
  branchPrompts,
  completionPrompts,
  dayReviewPrompts,
  figmaPrompts,
  forgottenPrompts,
  idleCorrectionPrompts,
  idlePrompts,
  integrationBranch,
  integrationBranchPrompts,
  meetingPrompts,
  meetingReturnPrompts,
  microphoneEndPrompts,
  microphonePrompts,
  noPrompts,
  sampleBranch,
  sampleFigma,
  sampleMeeting,
  ticketlessBranch,
  ticketlessMeeting,
} from '../../ipc/fixtures/slices/flow';
import {
  attentionRunningTracking,
  attentionStoppedTracking,
  runningTracking,
  stoppedTracking,
} from '../../ipc/fixtures/slices/tracking';
import { renderWithEngine } from '../../test/engine';
import type { TrackingSurface } from '../tracking/CurrentTracking';
import { expectAccessible } from '../tracking/testHelpers';
import { PromptList, usePromptAnnouncements, usePromptItems } from './PromptList';

afterEach(() => {
  resetMockIpc();
});

function Prompts({ surface = 'main' }: { surface?: TrackingSurface }) {
  const items = usePromptItems(surface);
  usePromptAnnouncements(items);
  return items ? <PromptList items={items} surface={surface} headingLevel={2} label="Suggestions" /> : null;
}

function renderPrompts(prompts: PromptsSlice, extra: Partial<SliceMap> = {}, surface: TrackingSurface = 'main') {
  return renderWithEngine(<Prompts surface={surface} />, { with: { prompts, ...extra } });
}

const press = async (user: ReturnType<typeof renderWithEngine>['user'], name: string | RegExp) => {
  await user.click(screen.getByRole('button', { name }));
};

describe('PromptList', () => {
  it('renders nothing without prompts and while the slice loads', () => {
    const first = renderPrompts(noPrompts);
    expect(screen.queryByRole('list', { name: 'Suggestions' })).not.toBeInTheDocument();
    first.unmount();
    renderWithEngine(<Prompts />, { slices: {} });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('orders prompts by urgency: tracking attention first, then 1.14 order', async () => {
    renderPrompts(allPrompts, { tracking: attentionRunningTracking });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Are you still working on this?',
      'Branch changed',
      'Branch changed',
      'Figma file active',
      'Review time away',
      'Working without a timer?',
      'Tracked ticket completed',
      'Review your day',
      'Microphone use stopped',
      'Meeting ended',
      'Microphone in use · possible meeting',
      'Meeting started',
      'Meeting started',
    ]);
    // Newest branch first.
    const branches = screen.getAllByRole('article', { name: 'Branch changed' });
    expect(branches[0]).toHaveTextContent('chore/upgrade-node');
    await expectAccessible();
  });

  it('shows one of each in the panel with a pointer to the rest', async () => {
    const { engine, user } = renderPrompts(allPrompts, {}, 'panel');
    expect(screen.getAllByRole('article', { name: 'Branch changed' })).toHaveLength(1);
    expect(screen.getAllByRole('article', { name: 'Meeting started' })).toHaveLength(1);
    expect(screen.getByText('1 more meeting suggestion in Overview')).toBeInTheDocument();
    // The panel leaves out the 1.14 "does not prove" explanation.
    expect(screen.queryByText(/does not prove the design was edited/)).not.toBeInTheDocument();
    await press(user, 'Review 1 more branch change');
    expect(engine.ipc.calls.some((call) => call.command === 'shell_show_main' && call.args?.page === 'overview')).toBe(true);
  });

  it('announces a new prompt once, politely, but not the ones present at load', async () => {
    const { engine } = renderPrompts(branchPrompts);
    const polite = () => document.querySelector('[data-announcer="polite"]')?.textContent ?? '';
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(polite()).toBe('');
    act(() => engine.patchSlice('prompts', { meetings: [sampleMeeting] }));
    await waitFor(() => expect(polite()).toBe('New suggestion: Meeting started · Sprint review · Webshop'));
  });
});

describe('branch prompt', () => {
  it('keeps, tracks or chooses another ticket in the main window', async () => {
    const { engine, user } = renderPrompts(branchPrompts);
    const card = screen.getByRole('article', { name: 'Branch changed' });
    expect(card).toHaveTextContent('webshop');
    expect(card).toHaveTextContent('Fromfeature/AB#4821-card-retry');
    expect(card).toHaveTextContent('Suggested: #4790 · Invoice PDF shows the wrong VAT number');
    await press(user, 'Keep tracking');
    await press(user, 'Track #4790…');
    await press(user, 'Choose another ticket…');
    const id = sampleBranch.change.id;
    expect(engine.dispatched('branch.keep')).toEqual([{ type: 'branch.keep', id }]);
    expect(engine.dispatched('branch.track')).toEqual([{ type: 'branch.track', id }]);
    expect(engine.dispatched('branch.chooseAnother')).toEqual([{ type: 'branch.chooseAnother', id }]);
    expect(engine.dispatched('tracking.beginPanel')).toHaveLength(0);
  });

  it('prepares the choice in the panel first when shown there', async () => {
    const { engine, user } = renderPrompts(branchPrompts, {}, 'panel');
    const id = sampleBranch.change.id;
    await press(user, 'Track #4790…');
    expect(engine.intents.map((intent) => intent.type)).toEqual(['tracking.beginPanel', 'branch.track']);
    expect(engine.dispatched('tracking.beginPanel')).toEqual([{ type: 'tracking.beginPanel', branchId: id }]);
    await press(user, 'Choose another ticket…');
    expect(engine.dispatched('tracking.beginPanel')).toHaveLength(2);
    expect(engine.dispatched('branch.chooseAnother')).toHaveLength(0);
  });

  it('offers an activity without a ticket and says Dismiss without a timer', async () => {
    const { engine, user } = renderPrompts({ ...noPrompts, branches: [ticketlessBranch] }, { tracking: stoppedTracking });
    expect(screen.getByText('No ticket number found. Track an activity without a ticket, or keep your timer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose another ticket…' })).not.toBeInTheDocument();
    await press(user, 'Dismiss');
    await press(user, 'Choose activity…');
    expect(engine.dispatched('branch.keep')).toEqual([{ type: 'branch.keep', id: ticketlessBranch.change.id }]);
    expect(engine.dispatched('branch.track')).toEqual([{ type: 'branch.track', id: ticketlessBranch.change.id }]);
  });

  it('offers Pause, Stop or Keep for an integration branch', async () => {
    const { engine, user } = renderPrompts(integrationBranchPrompts);
    expect(screen.getByText('This is an integration branch. Pause, stop or keep your timer.')).toBeInTheDocument();
    const id = integrationBranch.change.id;
    await press(user, 'Pause');
    await press(user, 'Stop');
    await press(user, 'Keep current');
    expect(engine.dispatched('branch.pause')).toEqual([{ type: 'branch.pause', id }]);
    expect(engine.dispatched('branch.stop')).toEqual([{ type: 'branch.stop', id }]);
    expect(engine.dispatched('branch.keep')).toEqual([{ type: 'branch.keep', id }]);
  });

  it('has nothing to pause on an integration branch without a timer', () => {
    renderPrompts(integrationBranchPrompts, { tracking: stoppedTracking });
    expect(screen.getByText('No active timer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });
});

describe('meeting and microphone prompts', () => {
  it('begins a meeting with or without its ticket, or dismisses it', async () => {
    const { engine, user } = renderPrompts(meetingPrompts);
    const card = screen.getByRole('article', { name: 'Meeting started' });
    expect(card).toHaveTextContent('Sprint review · Webshop');
    expect(card).toHaveTextContent(/\d\d:\d\d – \d\d:\d\d · Work/);
    expect(card).toHaveTextContent('Linked ticket #4777');
    await press(user, 'Choose activity…');
    await press(user, 'Other ticket…');
    await press(user, 'Keep current');
    const id = sampleMeeting.event.id;
    expect(engine.dispatched('meeting.begin')).toEqual([
      { type: 'meeting.begin', id, useSuggestedTicket: true },
      { type: 'meeting.begin', id, useSuggestedTicket: false },
    ]);
    expect(engine.dispatched('meeting.dismiss')).toEqual([{ type: 'meeting.dismiss', id }]);
  });

  it('explains a meeting without a ticket', () => {
    renderPrompts({ ...noPrompts, meetings: [ticketlessMeeting] });
    expect(screen.getByText('No ticket needed. The meeting title becomes the comment.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Other ticket…' })).not.toBeInTheDocument();
  });

  it('tracks a microphone meeting or stand-up', async () => {
    const { engine, user } = renderPrompts(microphonePrompts);
    expect(screen.getByText('Microsoft Teams')).toBeInTheDocument();
    const sessionId = microphonePrompts.microphone[0]!.id;
    await press(user, 'Meeting…');
    await press(user, 'Daily standup…');
    await press(user, 'Keep current');
    expect(engine.dispatched('microphone.choose')).toEqual([
      { type: 'microphone.choose', sessionId, standup: false },
      { type: 'microphone.choose', sessionId, standup: true },
    ]);
    expect(engine.dispatched('microphone.dismiss')).toEqual([{ type: 'microphone.dismiss', sessionId }]);
  });

  it('keeps, pauses or stops after the microphone stopped, or resumes the previous ticket', async () => {
    const { engine, user } = renderPrompts(microphoneEndPrompts);
    expect(
      screen.getByText('Microsoft Teams has not used the microphone for at least a minute. Has your meeting finished?'),
    ).toBeInTheDocument();
    expect(screen.getByText('Your timer is still running: Checkout: retry failed card payments')).toBeInTheDocument();
    await press(user, 'Keep tracking');
    await press(user, 'Pause');
    await press(user, 'Stop');
    await press(user, 'Resume previous ticket…');
    expect(engine.intents.map((intent) => intent.type)).toEqual([
      'microphone.endKeep',
      'microphone.endPause',
      'microphone.endStop',
      'meeting.returnResume',
    ]);
  });

  it('hides "Resume previous ticket…" when there is nothing to return to', () => {
    renderPrompts({ ...microphoneEndPrompts, canReturnAfterMicrophone: false });
    expect(screen.queryByRole('button', { name: 'Resume previous ticket…' })).not.toBeInTheDocument();
  });

  it('resumes the ticket from before a meeting or keeps the current one', async () => {
    const { engine, user } = renderPrompts(meetingReturnPrompts);
    expect(screen.getByText('Return to #4790?')).toBeInTheDocument();
    await press(user, 'Resume previous…');
    await press(user, 'Keep current');
    expect(engine.intents.map((intent) => intent.type)).toEqual(['meeting.returnResume', 'meeting.returnDismiss']);
  });

  it('waits for a meeting return to be due', () => {
    renderPrompts({ ...meetingReturnPrompts, meetingReturn: { ...meetingReturnPrompts.meetingReturn!, ready: false } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('Figma, awareness and completion prompts', () => {
  it('starts Design with the linked or another ticket, or keeps tracking', async () => {
    const { engine, user } = renderPrompts(figmaPrompts);
    expect(screen.getByText('#4821 · Checkout: retry failed card payments')).toBeInTheDocument();
    const suggestionId = sampleFigma.suggestion.id;
    await press(user, 'Start Design…');
    await press(user, 'Other ticket');
    await press(user, 'Keep tracking');
    expect(engine.dispatched('figma.track')).toEqual([
      { type: 'figma.track', suggestionId, useLinkedTicket: true },
      { type: 'figma.track', suggestionId, useLinkedTicket: false },
    ]);
    expect(engine.dispatched('figma.keep')).toEqual([{ type: 'figma.keep', suggestionId }]);
  });

  it('keeps time away or pauses to review it', async () => {
    const { engine, user } = renderPrompts(idlePrompts);
    expect(screen.getByText('Screen locked · 0h 32m')).toBeInTheDocument();
    await press(user, 'Keep time');
    await press(user, 'Pause & review…');
    expect(engine.dispatched('awareness.keepIdle')).toHaveLength(1);
    expect(engine.dispatched('awareness.reviewIdle')).toEqual([{ type: 'awareness.reviewIdle', promptId: idlePrompts.idle!.id }]);
  });

  it('needs a confirmed timer to pause and review', () => {
    renderPrompts(idlePrompts, { connection: disconnectedConnection });
    expect(screen.getByRole('button', { name: 'Pause & review…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep time' })).toBeEnabled();
  });

  it('opens or discards a saved idle review', async () => {
    const { engine, user } = renderPrompts(idleCorrectionPrompts);
    await press(user, 'Open correction preview…');
    await press(user, 'Keep recorded time');
    expect(engine.intents.map((intent) => intent.type)).toEqual(['awareness.openCorrection', 'awareness.discardCorrection']);
  });

  it('chooses a watched ticket or any ticket for forgotten time, or defers', async () => {
    const { engine, user } = renderPrompts(forgottenPrompts, { tracking: stoppedTracking });
    expect(
      screen.getByText('You’ve been active in selected work apps, including Visual Studio Code, with no timer running.'),
    ).toBeInTheDocument();
    await press(user, /^webshop · #4790/);
    await press(user, 'Choose a ticket…');
    await press(user, 'Snooze 15 min');
    await press(user, 'Ignore today');
    expect(engine.dispatched('awareness.chooseForgottenTicket')).toEqual([
      { type: 'awareness.chooseForgottenTicket', ticketId: 4790 },
      { type: 'awareness.chooseForgottenTicket', ticketId: null },
    ]);
    expect(engine.dispatched('awareness.deferForgotten')).toEqual([
      { type: 'awareness.deferForgotten', untilTomorrow: false },
      { type: 'awareness.deferForgotten', untilTomorrow: true },
    ]);
  });

  it('keeps, stops or switches from a completed ticket', async () => {
    const { engine, user } = renderPrompts(completionPrompts);
    expect(screen.getByText('Azure status: Closed. Your timer is still running.')).toBeInTheDocument();
    await press(user, 'Keep tracking');
    await press(user, 'Stop');
    await press(user, 'Switch ticket…');
    expect(engine.intents.map((intent) => intent.type)).toEqual(['completion.keep', 'completion.stop', 'completion.switch']);
  });

  it('switches from a completed ticket in the panel', async () => {
    const { engine, user } = renderPrompts(completionPrompts, {}, 'panel');
    await press(user, 'Switch ticket…');
    expect(engine.intents).toEqual([{ type: 'tracking.beginPanel', branchId: null }]);
  });
});

describe('tracking attention and day review', () => {
  it('keeps a stopped timer stopped or continues', async () => {
    const { engine, user } = renderPrompts(noPrompts, { tracking: attentionStoppedTracking });
    expect(screen.getByRole('heading', { name: '7pace stopped your timer' })).toBeInTheDocument();
    expect(screen.getByText('#4821 · Checkout: retry failed card payments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue…' })).toHaveAttribute('data-prompt-primary');
    await press(user, 'Keep stopped');
    await press(user, 'Continue…');
    expect(engine.intents.map((intent) => intent.type)).toEqual(['attention.keepStopped', 'attention.continue']);
  });

  it('stops or continues a running timer that 7pace asks about', async () => {
    const { engine, user } = renderPrompts(noPrompts, { tracking: attentionRunningTracking });
    await press(user, 'Stop tracking');
    await press(user, 'Continue tracking');
    expect(engine.intents.map((intent) => intent.type)).toEqual(['tracking.stop', 'attention.continue']);
  });

  it('opens, snoozes or marks the day reviewed', async () => {
    const { engine, user } = renderPrompts(dayReviewPrompts);
    expect(screen.getByText('Marking the day reviewed will leave this timer running.')).toBeInTheDocument();
    await press(user, 'Snooze 30 min');
    await press(user, 'Mark day reviewed');
    await press(user, 'Open review');
    expect(engine.intents).toEqual([
      { type: 'dayReview.snooze' },
      { type: 'dayReview.markReviewed', day: '2026-10-06' },
      { type: 'dayReview.open' },
    ]);
  });

  it('cannot snooze past the end of the day', () => {
    renderPrompts({ ...noPrompts, dayReview: { day: '2026-10-06', canSnooze: false } }, { tracking: stoppedTracking });
    expect(screen.getByRole('button', { name: 'Snooze 30 min' })).toBeDisabled();
    expect(screen.queryByText('Marking the day reviewed will leave this timer running.')).not.toBeInTheDocument();
  });
});

describe('writes while busy or offline', () => {
  it('disables every write while the engine is busy', () => {
    renderPrompts(allPrompts, { app: busyApp, tracking: attentionRunningTracking });
    for (const name of [
      'Continue tracking',
      'Stop tracking',
      'Track #4790…',
      'Start Design…',
      'Pause & review…',
      'Choose a ticket…',
      'Switch ticket…',
      'Pause',
      'Stop',
      'Resume previous…',
      'Meeting…',
    ]) {
      for (const button of screen.getAllByRole('button', { name })) expect(button, name).toBeDisabled();
    }
    // Choices that only dismiss stay available where 1.14 kept them.
    const meeting = screen.getAllByRole('article', { name: 'Meeting started' })[0]!;
    expect(within(meeting).getByRole('button', { name: 'Keep current' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Ignore today' })).toBeEnabled();
  });

  it('disables 7pace actions while disconnected and shows a refusal verbatim', async () => {
    const first = renderPrompts(branchPrompts, { connection: disconnectedConnection });
    expect(screen.getByRole('button', { name: 'Track #4790…' })).toBeDisabled();
    first.unmount();
    resetMockIpc();
    const { engine, user } = renderPrompts(branchPrompts, { connection: sampleConnection, tracking: runningTracking });
    engine.handle('branch.track', () => {
      throw Object.assign(new Error('This branch change is no longer current.'), { kind: 'remoteChanged' });
    });
    await press(user, 'Track #4790…');
    const card = screen.getByRole('article', { name: 'Branch changed' });
    expect(await within(card).findByRole('alert')).toHaveTextContent('This branch change is no longer current.');
  });
});
