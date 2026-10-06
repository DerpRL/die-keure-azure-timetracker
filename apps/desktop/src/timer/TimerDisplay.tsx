import { useId } from 'react';
import { useReducedMotion } from '../theme/ThemeProvider';
import { cx } from '../utils/cx';
import { formatClock, formatPercent, formatSpokenDuration } from '../utils/duration';
import { ProgressRing } from './ProgressRing';
import { RollingDigits } from './RollingDigits';
import { isUnconfirmed, TRACKING_STATUS, type TrackingStatus } from './status';
import styles from './TimerDisplay.module.css';

export interface TimerDisplayProps {
  /** Elapsed seconds of the confirmed (or local) timer. Non-finite or negative shows 0. */
  seconds: number;
  status: TrackingStatus;
  /** Identity of the session; a new session starts cleanly instead of rolling from the old time. */
  sessionId: string;
  /** Today's recorded seconds for the ring; null or undefined when the total is unavailable. */
  todaySeconds?: number | null;
  /** Today's target in seconds; 0 means no target today. */
  dailyTargetSeconds?: number;
  /** False when totals are stale: the ring is labelled "Last known". */
  totalsConfirmed?: boolean;
  /** Replaces the progress description under the digits. */
  detail?: string;
  size?: 'small' | 'medium' | 'large';
  /** The mini timer can omit the ring. */
  showRing?: boolean;
  /** Name of the timer value for screen readers. */
  label?: string;
  className?: string;
}

/** 0…1 toward the target, capped at one full circle; null without a usable total or target. */
export function targetFraction(todaySeconds: number | null | undefined, target: number): number | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  if (todaySeconds === null || todaySeconds === undefined || !Number.isFinite(todaySeconds)) return null;
  return Math.min(1, Math.max(0, todaySeconds / target));
}

/** Text under the digits; strings from Swift `TimerDisplay.progressDescription`. */
export function progressDescription(
  todaySeconds: number | null | undefined,
  target: number,
  totalsConfirmed: boolean,
  detail?: string,
): string {
  if (detail) return detail;
  if (!(target > 0)) return 'No daily target today';
  const fraction = targetFraction(todaySeconds, target);
  if (fraction === null) return 'Daily total unavailable';
  return `${totalsConfirmed ? 'Today · ' : 'Last known · '}${formatPercent(fraction)} of daily target`;
}

/**
 * The tracking clock from 1.14: fixed-width rolling digits (they never shift the layout), a ring
 * toward the daily target and running / paused / unconfirmed styling. Screen readers get one
 * labelled timer value; it is not a live region, so nothing is announced every second.
 */
export function TimerDisplay({
  seconds,
  status,
  sessionId,
  todaySeconds,
  dailyTargetSeconds = 0,
  totalsConfirmed = true,
  detail,
  size = 'medium',
  showRing = true,
  label = 'Elapsed time',
  className,
}: TimerDisplayProps) {
  const reducedMotion = useReducedMotion();
  const labelId = useId();
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const clock = formatClock(safeSeconds);
  const unconfirmed = isUnconfirmed(status);
  const info = TRACKING_STATUS[status];
  const description = progressDescription(todaySeconds, dailyTargetSeconds, totalsConfirmed, detail);
  const fraction = targetFraction(todaySeconds, dailyTargetSeconds);
  // Only confirmed running time rolls; paused or unconfirmed time stays still.
  const animate = status === 'running' && !reducedMotion;

  return (
    <div
      className={cx(
        styles.timer,
        styles[size],
        styles[`status-${status}`],
        unconfirmed && styles.unconfirmed,
        reducedMotion && styles.reduced,
        className,
      )}
      data-status={status}
    >
      {showRing ? (
        <ProgressRing
          status={status}
          fraction={fraction}
          stale={!totalsConfirmed}
          label={`${info.label}. ${description}`}
          reducedMotion={reducedMotion}
        />
      ) : null}
      <div className={styles.readout}>
        <div role="timer" aria-live="off" aria-atomic="true" aria-labelledby={labelId} className={styles.value}>
          <span id={labelId} className="visually-hidden">
            {label}
          </span>
          <span className="visually-hidden">
            {formatSpokenDuration(safeSeconds)}
            {unconfirmed ? ', last known' : ''}
          </span>
          {/* The template fixes width and baseline; the rolling digits sit on top of it. */}
          <span className={styles.template} aria-hidden="true">
            {clock.replace(/[0-9]/g, '0')}
          </span>
          <span className={styles.overlay}>
            <RollingDigits key={sessionId} text={clock} animate={animate} />
          </span>
        </div>
        {showRing ? (
          <p className={styles.description} aria-hidden="true">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
