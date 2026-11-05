import { useMemo } from 'react';
import {
  ActivityLegend,
  activityColorIndex,
  DayStrip,
  stripWindow,
  useActivityColors,
  type DayStripBlock,
  type LegendEntry,
} from '../../../features/activity';
import { dayToDate, formatClockTime, logEnd, logStart, logTicket } from '../../../features/ticketContext/format';
import type { TimeCorrectionIssue, WorkLog } from '../../../ipc/contract';
import { useNow } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import { correctionGaps, type EntryOverlap } from './dayModel';
import styles from './TimeEditor.module.css';

export interface DayOverviewProps {
  /** `YYYY-MM-DD`. */
  day: string;
  today: string;
  logs: readonly WorkLog[];
  runningLogId: string | null;
  overlaps: readonly EntryOverlap[];
  issues: readonly TimeCorrectionIssue[];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function range(start: number, end: number): string {
  return `${formatClockTime(new Date(start))}–${formatClockTime(new Date(end))}`;
}

/**
 * The listed entries as a Calendar Blocks day strip with their activities, overlaps and (once
 * Gaps & overlaps has checked the day) the gaps between them.
 */
export function DayOverview({ day, today, logs, runningLogId, overlaps, issues }: DayOverviewProps) {
  const colors = useActivityColors();
  const isToday = day === today;
  // Ticks only while the strip shows today, for the "now" marker.
  const now = useNow(isToday);

  const { blocks, legend } = useMemo(() => {
    const blocks: DayStripBlock[] = [];
    const legend = new Map<string, LegendEntry>();
    for (const log of logs) {
      const start = logStart(log)?.getTime();
      const end = logEnd(log)?.getTime();
      if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      const activityId = log.activityType?.id ?? '';
      const colorIndex = activityColorIndex(colors, activityId);
      const ticket = logTicket(log);
      blocks.push({
        id: log.id,
        start,
        end: Math.max(end, start),
        colorIndex,
        label: `${ticket !== null ? `#${ticket}` : (log.activityType?.name ?? 'Entry')} · ${range(start, Math.max(end, start))}`,
        running: log.id === runningLogId,
      });
      const name = log.activityType?.name ?? 'Default activity';
      if (!legend.has(activityId)) legend.set(activityId, { id: activityId || 'none', name, colorIndex });
    }
    return {
      blocks,
      legend: [...legend.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [logs, colors, runningLogId]);

  const gaps = useMemo(() => correctionGaps(issues), [issues]);

  if (blocks.length === 0) return null;

  const { from, to } = stripWindow(dayToDate(day), [...blocks.flatMap((block) => [block.start, block.end]), ...(isToday ? [now] : [])]);
  const gapSeconds = gaps.reduce((total, gap) => total + (gap.end - gap.start) / 1000, 0);

  const description = [
    `Day timeline with ${blocks.length === 1 ? '1 entry' : `${blocks.length} entries`}`,
    overlaps.length > 0 ? plural(overlaps.length, 'overlap') : null,
    gaps.length > 0 ? plural(gaps.length, 'gap') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={styles.dayOverview}>
      <DayStrip from={from} to={to} blocks={blocks} gaps={gaps} overlaps={overlaps} now={isToday ? now : null} label={description} size="large" />
      <div className={styles.legendRow}>
        <ActivityLegend items={legend} />
        {overlaps.length > 0 ? (
          <ul role="list" aria-label="Overlaps" className={styles.flags}>
            {overlaps.slice(0, 3).map((overlap) => (
              <li key={`${overlap.earlierId}-${overlap.laterId}`} className={styles.flag}>
                <span className={styles.overlapSwatch} aria-hidden="true" />
                {`Overlap ${range(overlap.start, overlap.end)}`}
              </li>
            ))}
            {overlaps.length > 3 ? <li className={styles.flag}>{`+${overlaps.length - 3} more`}</li> : null}
          </ul>
        ) : null}
        {gaps.length > 0 ? (
          <p className={styles.flag}>
            <span className={styles.gapSwatch} aria-hidden="true" />
            {`${plural(gaps.length, 'gap')} · ${formatShortDuration(gapSeconds)}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
