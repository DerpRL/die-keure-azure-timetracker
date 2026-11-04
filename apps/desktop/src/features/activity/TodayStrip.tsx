import { useEffect, useMemo, useState } from 'react';
import { useDateFormatter } from 'react-aria';
import type { TrackingSlice, WorkLog } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { activityColorIndex, type ActivityColors } from './colors';
import { DayStrip, stripWindow, type DayStripBlock } from './DayStrip';

/** The current minute, so the running block and the now line move along. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function runningStart(tracking: TrackingSlice | undefined): number | null {
  if (!tracking?.running || !tracking.confirmedAt) return null;
  const confirmed = Date.parse(tracking.confirmedAt);
  return Number.isFinite(confirmed) ? confirmed - tracking.elapsedBase * 1000 : null;
}

/** Today's worklogs and the running timer on a time strip (2.0 "Calendar Blocks"). */
export function TodayStrip({
  logs,
  colors,
  size = 'medium',
  className,
}: {
  logs: readonly WorkLog[];
  colors: ActivityColors;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}) {
  const tracking = useSlice('tracking');
  const now = useMinute();
  const time = useDateFormatter({ hour: '2-digit', minute: '2-digit' });
  const started = runningStart(tracking);
  const blocks = useMemo(() => {
    const result: DayStripBlock[] = [];
    for (const log of logs) {
      const start = Date.parse(log.timestamp);
      if (!Number.isFinite(start)) continue;
      result.push({
        id: log.id,
        start,
        end: start + log.length * 1000,
        colorIndex: activityColorIndex(colors, log.activityType?.id),
        label: log.workItemId != null ? `#${log.workItemId}` : undefined,
      });
    }
    if (tracking && started !== null) {
      result.push({
        id: 'running',
        start: started,
        end: Math.max(now, started + 60_000),
        colorIndex: activityColorIndex(colors, tracking.activityId),
        label: `${tracking.ticketId !== null ? `#${tracking.ticketId} · ` : ''}running`,
        running: true,
      });
    }
    return result;
  }, [logs, colors, tracking, started, now]);
  if (blocks.length === 0) return null;
  const times = blocks.flatMap((block) => [block.start, block.end]);
  // Today only, from the first block to now (at least four hours), like the mockup.
  const window = stripWindow(new Date(now), [...times, now], { startHour: 24, endHour: 0, minHours: 4 });
  const parts = blocks
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((block) => {
      const since = block.start < window.from ? 'since before today' : `from ${time.format(new Date(block.start))}`;
      return `${block.label ?? 'Unassigned'} ${since}${block.running ? '' : ` to ${time.format(new Date(block.end))}`}`;
    });
  return (
    <DayStrip
      className={className}
      size={size}
      from={window.from}
      to={window.to}
      blocks={blocks}
      now={now}
      label={`Today’s time: ${parts.join(', ')}`}
    />
  );
}
