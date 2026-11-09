import { Skeleton } from '../../components/EmptyState';
import { Meter } from '../../components/Progress';
import { useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { totalsConfirmed, useProgressSeconds } from '../tracking/status';
import styles from './progress.module.css';
import { t } from '../../i18n';

interface RowProps {
  label: string;
  seconds: number;
  target: number;
  compact: boolean;
  stale: boolean;
}

function ProgressRow({ label, seconds, target, compact, stale }: RowProps) {
  const value = `${formatShortDuration(seconds)} / ${formatShortDuration(target)}`;
  if (!(target > 0)) {
    return (
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{t('{duration} · no target', { duration: formatShortDuration(seconds) })}</span>
      </div>
    );
  }
  const detail = compact
    ? undefined
    : seconds >= target
      ? t('Target reached · {duration} over', { duration: formatShortDuration(seconds - target) })
      : t('{duration} remaining', { duration: formatShortDuration(target - seconds) });
  return (
    <Meter
      label={label}
      value={seconds}
      maxValue={target}
      valueLabel={value}
      valueDisplay={
        <>
          <b className={styles.amount}>{formatShortDuration(seconds)}</b>
          {` / ${formatShortDuration(target)}`}
        </>
      }
      tone={stale ? 'paused' : 'running'}
      detail={detail}
    />
  );
}

/**
 * Today and this week against the targets (1.14 `TargetProgressView`). Until the week's
 * worklogs arrived it says so instead of showing a misleading 0. While the timer runs and the
 * totals are confirmed, the engine lets the UI add the running time.
 */
export function TargetProgress({ compact = false }: { compact?: boolean }) {
  const progress = useSlice('progress');
  const connection = useSlice('connection');
  const totals = useProgressSeconds(progress);

  if (!progress) {
    return (
      <div aria-busy="true" className={styles.progress}>
        <span role="status" className="visually-hidden">
          {t('Loading your time totals')}
        </span>
        <Skeleton lines={3} />
      </div>
    );
  }

  if (!totals) {
    return (
      <div className={styles.progress}>
        <p role="status" className={styles.caption}>
          {progress.loading ? t('Loading your time totals…') : t('Time totals are unavailable until worklogs sync.')}
        </p>
        {progress.issue ? <p className={styles.warning}>{t('Time totals: {issue}', { issue: progress.issue })}</p> : null}
      </div>
    );
  }

  const confirmed = totalsConfirmed(connection, progress);
  return (
    <div className={styles.progress}>
      <ProgressRow label={t('Today')} seconds={totals.today} target={progress.todayTarget} compact={compact} stale={!confirmed} />
      {progress.todayReason ? <p className={styles.caption}>{progress.todayReason}</p> : null}
      <ProgressRow label={t('This week')} seconds={totals.week} target={progress.weekTarget} compact={compact} stale={!confirmed} />
      {!compact ? (
        <p className={styles.caption}>
          {t('Monday–Sunday · daily targets from Settings · includes the identified current timer once')}
        </p>
      ) : null}
      {!confirmed ? <p className={styles.warning}>{t('Last known totals · refresh to confirm')}</p> : null}
      {progress.issue ? <p className={styles.warning}>{t('Time totals: {issue}', { issue: progress.issue })}</p> : null}
    </div>
  );
}

/** The collapsed panel section's summary, e.g. "Today 2h 23m / 7h 36m". */
export function useProgressSummary(): string | null {
  const progress = useSlice('progress');
  const totals = useProgressSeconds(progress);
  if (!progress) return null;
  if (!totals) return progress.loading ? t('Loading…') : t('Unavailable');
  return progress.todayTarget > 0
    ? t('Today {today} / {target}', { today: formatShortDuration(totals.today), target: formatShortDuration(progress.todayTarget) })
    : t('Today {today}', { today: formatShortDuration(totals.today) });
}
