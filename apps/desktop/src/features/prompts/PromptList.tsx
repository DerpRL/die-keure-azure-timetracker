import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { announce } from '../../components/Announcer';
import { Button } from '../../components/Button';
import type { HeadingLevel } from '../../components/Card';
import type { AttentionView, PromptsSlice } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import type { TrackingSurface } from '../tracking/CurrentTracking';
import { openMainPage } from '../tracking/platform';
import { BranchPrompt } from './BranchPrompt';
import { DayReviewPrompt } from './DayReviewPrompt';
import { FigmaPrompt } from './FigmaPrompt';
import { ForgottenTimerPrompt } from './ForgottenTimerPrompt';
import { IdleCorrectionPrompt, IdlePrompt } from './IdlePrompt';
import { MeetingPrompt } from './MeetingPrompt';
import { MeetingReturnPrompt } from './MeetingReturnPrompt';
import { MicrophoneEndPrompt } from './MicrophoneEndPrompt';
import { MicrophonePrompt } from './MicrophonePrompt';
import { PromptContext, promptStyles as styles } from './PromptCard';
import { TicketCompletionPrompt } from './TicketCompletionPrompt';
import { TrackingAttentionPrompt } from './TrackingAttentionPrompt';

export interface PromptItem {
  /** Stable per prompt occurrence, so arrival is announced once. */
  key: string;
  /** Spoken when the prompt arrives, e.g. "Branch changed · webshop". */
  label: string;
  element: ReactElement;
}

const newestFirst = <T,>(items: readonly T[], at: (item: T) => string): T[] =>
  [...items].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));

/**
 * Every pending prompt, most urgent first: 7pace's tracking attention (7pace stops the timer
 * when it goes unanswered), then 1.14's order: branch, Figma, time away, saved idle review,
 * forgotten timer, completed ticket, day review, microphone end, meeting return, microphone,
 * calendar meeting. The panel shows one branch, Figma file and meeting at a time, as 1.14 did.
 */
export function buildPromptItems(
  prompts: PromptsSlice,
  attention: AttentionView | null,
  surface: TrackingSurface,
): PromptItem[] {
  const panel = surface === 'panel';
  const items: PromptItem[] = [];

  if (attention) {
    items.push({
      key: `attention:${attention.id}`,
      label: attention.heading,
      element: <TrackingAttentionPrompt attention={attention} />,
    });
  }

  const branches = newestFirst(prompts.branches, (view) => view.change.detectedAt);
  for (const view of panel ? branches.slice(0, 1) : branches) {
    const more = panel ? branches.length - 1 : 0;
    items.push({
      key: `branch:${view.change.id}`,
      label: `Branch changed · ${view.change.repositoryName}`,
      element: (
        <div className={styles.list}>
          <BranchPrompt view={view} />
          {more > 0 ? (
            <Button variant="plain" size="small" className={styles.more} onPress={() => openMainPage('overview')}>
              {`Review ${more} more branch ${more === 1 ? 'change' : 'changes'}`}
            </Button>
          ) : null}
        </div>
      ),
    });
  }

  const figma = newestFirst(prompts.figma, (view) => view.suggestion.created);
  for (const view of panel ? figma.slice(0, 1) : figma) {
    items.push({
      key: `figma:${view.suggestion.id}`,
      label: `Figma file active · ${view.suggestion.name}`,
      element: <FigmaPrompt view={view} />,
    });
  }

  if (prompts.idle) {
    items.push({ key: `idle:${prompts.idle.id}`, label: 'Review time away', element: <IdlePrompt idle={prompts.idle} /> });
  } else if (prompts.idleCorrection) {
    items.push({
      key: `idleCorrection:${prompts.idleCorrection.id}`,
      label: 'Saved idle-time review',
      element: <IdleCorrectionPrompt />,
    });
  }

  if (prompts.forgotten) {
    items.push({
      key: `forgotten:${prompts.forgotten.id}`,
      label: 'Working without a timer?',
      element: <ForgottenTimerPrompt reminder={prompts.forgotten} tickets={prompts.forgottenTickets} />,
    });
  }

  if (prompts.ticketCompletion) {
    items.push({
      key: `completion:${prompts.ticketCompletion.id}`,
      label: 'Tracked ticket completed',
      element: <TicketCompletionPrompt prompt={prompts.ticketCompletion} />,
    });
  }

  if (prompts.dayReview) {
    items.push({
      key: `dayReview:${prompts.dayReview.day}`,
      label: 'Review your day',
      element: <DayReviewPrompt view={prompts.dayReview} />,
    });
  }

  if (prompts.microphoneEnd) {
    items.push({
      key: `microphoneEnd:${prompts.microphoneEnd.id}`,
      label: 'Microphone use stopped',
      element: <MicrophoneEndPrompt prompt={prompts.microphoneEnd} canReturn={prompts.canReturnAfterMicrophone} />,
    });
  }

  if (prompts.meetingReturn?.ready) {
    items.push({
      key: `meetingReturn:${prompts.meetingReturn.ticketId}:${prompts.meetingReturn.end}`,
      label: 'Meeting ended',
      element: <MeetingReturnPrompt view={prompts.meetingReturn} />,
    });
  }

  for (const session of panel ? prompts.microphone.slice(0, 1) : prompts.microphone) {
    items.push({
      key: `microphone:${session.id}`,
      label: `Microphone in use · ${session.owner.name}`,
      element: <MicrophonePrompt session={session} />,
    });
  }

  for (const view of panel ? prompts.meetings.slice(0, 1) : prompts.meetings) {
    const more = panel ? prompts.meetings.length - 1 : 0;
    items.push({
      key: `meeting:${view.event.id}`,
      label: `Meeting started · ${view.event.title}`,
      element: (
        <div className={styles.list}>
          <MeetingPrompt view={view} />
          {more > 0 ? (
            <p className={styles.caption}>{`${more} more meeting ${more === 1 ? 'suggestion' : 'suggestions'} in Overview`}</p>
          ) : null}
        </div>
      ),
    });
  }

  return items;
}

/** The prompts for one surface, ordered by urgency; `undefined` until the slices arrive. */
export function usePromptItems(surface: TrackingSurface): PromptItem[] | undefined {
  const prompts = useSlice('prompts');
  const tracking = useSlice('tracking');
  const attention = tracking?.attention ?? null;
  return useMemo(() => (prompts ? buildPromptItems(prompts, attention, surface) : undefined), [prompts, attention, surface]);
}

/**
 * Announces a newly arrived prompt once, politely, without moving focus. Prompts present when
 * the surface loads are not announced.
 */
export function usePromptAnnouncements(items: PromptItem[] | undefined): void {
  const seen = useRef<Set<string> | null>(null);
  const keys = items?.map((item) => item.key).join('\n');
  useEffect(() => {
    if (!items) return;
    const known = seen.current;
    const fresh = known ? items.filter((item) => !known.has(item.key)) : [];
    seen.current = new Set(items.map((item) => item.key));
    if (fresh.length === 1) announce(`New suggestion: ${fresh[0]!.label}`);
    else if (fresh.length > 1) announce(`${fresh.length} new suggestions. First: ${fresh[0]!.label}`);
    // `keys` captures every change of the list; the items themselves are new on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
}

export interface PromptListProps {
  items: PromptItem[];
  surface: TrackingSurface;
  headingLevel: HeadingLevel;
  /** Accessible name of the list, e.g. "Suggestions". */
  label: string;
}

/** The prompts as a list, with the surface's heading level and intents. */
export function PromptList({ items, surface, headingLevel, label }: PromptListProps) {
  const context = useMemo(() => ({ surface, headingLevel, compact: surface === 'panel' }), [surface, headingLevel]);
  if (items.length === 0) return null;
  return (
    <PromptContext.Provider value={context}>
      <ul role="list" aria-label={label} className={styles.list}>
        {items.map((item) => (
          <li key={item.key}>{item.element}</li>
        ))}
      </ul>
    </PromptContext.Provider>
  );
}
