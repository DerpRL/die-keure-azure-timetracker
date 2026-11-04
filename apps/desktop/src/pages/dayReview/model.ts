import { useMemo } from 'react';
import { activityColorIndex, useActivityColors } from '../../features/activity';
import { secondsBetween } from '../../features/ticketContext/format';
import type { ReviewSession, WorkItemsSlice } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';

export function sessionSeconds(session: ReviewSession): number {
  return secondsBetween(session.start, session.end);
}

export function sessionTitle(session: ReviewSession, items: WorkItemsSlice | undefined): string {
  return session.ticketId !== null ? (items?.[String(session.ticketId)]?.title ?? session.title) : session.title;
}

/**
 * Palette index per activity name. Review sessions carry the activity's name, so it is matched to
 * the workspace's activity types to get the same colour as everywhere else; an unknown name keeps
 * a stable colour of its own, and work without an activity is grey.
 */
export function useActivityIndex(): (activity: string) => number {
  const flow = useSlice('flow');
  const offline = useSlice('offline');
  const colors = useActivityColors();
  return useMemo(() => {
    const ids = new Map<string, string>();
    for (const activity of [...(flow?.activityTypes ?? []), ...(offline?.activities ?? [])]) {
      if (activity.name && !ids.has(activity.name)) ids.set(activity.name, activity.id);
    }
    return (activity: string) => activityColorIndex(colors, activity ? (ids.get(activity) ?? activity) : null);
  }, [flow?.activityTypes, offline?.activities, colors]);
}

export interface TicketRow {
  id: string;
  ticketId: number | null;
  title: string;
  /** The activity with the most time on this ticket, for its swatch. */
  activity: string;
  count: number;
  seconds: number;
}

/** Time per ticket (free entries per title), most time first. */
export function ticketRows(sessions: readonly ReviewSession[], items: WorkItemsSlice | undefined): TicketRow[] {
  const groups = new Map<string, TicketRow & { perActivity: Map<string, number> }>();
  for (const session of sessions) {
    const id = session.ticketId !== null ? `ticket:${session.ticketId}` : `free:${session.title}`;
    const group = groups.get(id) ?? {
      id,
      ticketId: session.ticketId,
      title: sessionTitle(session, items),
      activity: session.activity,
      count: 0,
      seconds: 0,
      perActivity: new Map<string, number>(),
    };
    const seconds = sessionSeconds(session);
    group.count += 1;
    group.seconds += seconds;
    group.perActivity.set(session.activity, (group.perActivity.get(session.activity) ?? 0) + seconds);
    groups.set(id, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .map(({ perActivity, ...row }) => ({
      ...row,
      activity: [...perActivity.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row.activity,
    }));
}

/** The activities of the day in order of first appearance, for the strip's legend. */
export function dayActivities(sessions: readonly ReviewSession[]): string[] {
  return [...new Set(sessions.map((session) => session.activity).filter(Boolean))];
}
