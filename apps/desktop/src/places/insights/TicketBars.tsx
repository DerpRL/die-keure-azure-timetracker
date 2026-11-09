import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { t } from '../../i18n';
import type { AnalysisView } from '../../ipc/contract';
import { duration, percent } from './explore/format';
import { cx } from '../../utils/cx';
import styles from './insights.module.css';

/** Tickets listed before "Show all". */
export const TICKET_ROWS = 8;

/**
 * "By ticket" (2.2 "S3 · Insights"): every ticket and ticket-free task of the window by recorded
 * time, as bars against the largest. Work without a ticket is grouped by activity and comment, as in
 * 7pace.
 */
export function TicketBars({ analysis }: { analysis: AnalysisView }) {
  const headingId = useId();
  const [all, setAll] = useState(false);
  const tasks = analysis.tasks;
  const largest = Math.max(1, ...tasks.map((task) => task.seconds));
  const shown = all ? tasks : tasks.slice(0, TICKET_ROWS);
  return (
    <Card as="section" aria-labelledby={headingId} padding="medium" className={styles.chartCard}>
      <h2 id={headingId} className={styles.cardTitle}>
        {t('By ticket')}
      </h2>
      {tasks.length === 0 ? (
        <p className={styles.muted}>{t('No tickets in this window.')}</p>
      ) : (
        <ul role="list" aria-label={t('Recorded time by ticket')} className={styles.ticketRows}>
          {shown.map((task) => (
            <li key={task.id} className={styles.ticketRow}>
              <span className={styles.ticketName}>
                {task.ticketId ? (
                  <TicketLink ticketId={task.ticketId} title={task.title} />
                ) : (
                  <span className={styles.muted}>{t('{title} · no ticket', { title: task.title })}</span>
                )}
              </span>
              <span
                className={styles.ticketTrack}
                role="img"
                aria-label={t('{percent} of the recorded time', { percent: percent(task.seconds, analysis.total) })}
              >
                <span
                  className={cx(styles.ticketFill, !task.ticketId && styles.ticketFillFree)}
                  style={{ width: `${(task.seconds / largest) * 100}%` }}
                />
              </span>
              <span className={styles.ticketTime}>{duration(task.seconds)}</span>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > TICKET_ROWS ? (
        <Button size="small" variant="plain" className={styles.alignStart} onPress={() => setAll((value) => !value)}>
          {all ? t('Show fewer') : t('Show all {count}', { count: tasks.length })}
        </Button>
      ) : null}
    </Card>
  );
}
