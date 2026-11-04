import { useDateFormatter } from 'react-aria';
import { Button } from '../../components/Button';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ClockIcon, PlayIcon } from '../../components/icons';
import type { WorkLog } from '../../ipc/contract';
import {
  ActivityChip,
  ActivityPill,
  TodayStrip,
  activityColorIndex,
  useActivityColors,
  type ActivityColors,
} from '../../features/activity';
import { useSlice, useWorkItem } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { ActionError, useIntents, useWriteGuards } from '../../features/tracking/actions';
import { openMainPage } from '../../features/tracking/platform';
import styles from './overview.module.css';

/** 1.14 showed today's five newest worklogs on Overview; History has the rest. */
export const TODAY_LOG_LIMIT = 5;

/** One worklog (1.14 `LogRow`): title, ticket, start time, activity, comment and length. */
export function LogRow({ log, colors }: { log: WorkLog; colors: ActivityColors }) {
  const ticketId = log.workItemId ?? null;
  const item = useWorkItem(ticketId);
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const time = useDateFormatter({ hour: '2-digit', minute: '2-digit' });
  const start = new Date(log.timestamp);
  const comment = log.comment?.trim() || null;
  const title = item?.title ?? comment ?? (ticketId !== null ? `Azure ticket #${ticketId}` : 'Unassigned time');
  const colorIndex = activityColorIndex(colors, log.activityType?.id);
  return (
    <li className={styles.logRow}>
      <ActivityPill colorIndex={colorIndex} />
      <div className={styles.logText}>
        <p className={styles.logTitle}>{title}</p>
        <div className={styles.logMeta}>
          {ticketId !== null ? <TicketLink ticketId={ticketId} compact /> : null}
          <span className={styles.time}>{Number.isNaN(start.getTime()) ? log.timestamp : time.format(start)}</span>
          {log.activityType?.name ? <ActivityChip name={log.activityType.name} colorIndex={colorIndex} /> : null}
          {comment && comment !== title ? <span className={styles.logComment}>{comment}</span> : null}
        </div>
        <ActionError error={actions.error} />
      </div>
      <span className={styles.duration}>{formatShortDuration(log.length)}</span>
      {ticketId !== null ? (
        <Button
          size="small"
          icon={PlayIcon}
          aria-label={`Track again: #${ticketId}`}
          isDisabled={busy || !connected}
          isPending={actions.isPending('again')}
          onPress={() => void actions.run('again', { type: 'tracking.chooseTicket', ticketId, surface: 'picker' })}
        >
          Track again
        </Button>
      ) : (
        <span aria-hidden="true" />
      )}
      {actions.confirmation}
    </li>
  );
}

/** "Today’s time": today's worklogs from `history.todayLogs`, newest first. */
export function TodayLogs() {
  const history = useSlice('history');
  const colors = useActivityColors();
  const loading = !history || (history.loading && !history.loaded);
  const logs = history?.todayLogs ?? [];
  const shown = logs.slice(0, TODAY_LOG_LIMIT);
  const more = logs.length - shown.length;
  return (
    <LoadingRegion label="Loading today’s worklogs" isLoading={loading} placeholder={<Skeleton lines={4} />}>
      {logs.length === 0 ? (
        <EmptyState
          size="compact"
          icon={ClockIcon}
          title="A clear start"
          description={
            history?.loaded
              ? 'Your completed worklogs will appear here as you track.'
              : 'Connect 7pace to see today’s worklogs.'
          }
        />
      ) : (
        <>
          <TodayStrip logs={logs} colors={colors} className={styles.strip} />
          <ul role="list" aria-label="Today’s worklogs" className={styles.logList}>
            {shown.map((log) => (
              <LogRow key={log.id} log={log} colors={colors} />
            ))}
          </ul>
          {more > 0 ? (
            <Button variant="plain" size="small" onPress={() => openMainPage('history')}>
              {`${more} more today in History`}
            </Button>
          ) : null}
        </>
      )}
    </LoadingRegion>
  );
}
