import { useState } from 'react';
import type { IconComponent } from '../components/icons';
import { ClockIcon, ConnectingIcon, PauseIcon, PlayIcon, StopIcon } from '../components/icons';
import { cx } from '../utils/cx';
import type { TrackingStatus } from './status';
import styles from './TimerDisplay.module.css';

const BADGES: Record<TrackingStatus, IconComponent | 'exclamation' | 'question'> = {
  running: PlayIcon,
  paused: PauseIcon,
  stopped: StopIcon,
  connecting: ConnectingIcon,
  disconnected: 'exclamation',
  attention: 'question',
};

export interface ProgressRingProps {
  status: TrackingStatus;
  /** 0…1, already capped; null draws the empty ring (no target or no total). */
  fraction: number | null;
  /** Totals are last known rather than confirmed: the arc is drawn in the neutral colour. */
  stale: boolean;
  /** Accessible description of the clock, e.g. "Tracking. Today · 45% of daily target". */
  label: string;
  reducedMotion: boolean;
}

/** Clock face with a progress ring toward the daily target, capped at one full circle. */
export function ProgressRing({ status, fraction, stale, label, reducedMotion }: ProgressRingProps) {
  // The clock pulses once when the state changes to running (not on first render).
  const [previous, setPrevious] = useState({ status, pulses: 0 });
  if (previous.status !== status) {
    setPrevious({ status, pulses: status === 'running' ? previous.pulses + 1 : previous.pulses });
  }
  const pulse = !reducedMotion && status === 'running' && previous.pulses > 0;
  const badge = BADGES[status];
  const Badge = typeof badge === 'string' ? null : badge;
  const percent = fraction === null ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10;

  return (
    <span role="img" aria-label={`Tracking clock. ${label}`} className={cx(styles.ring, styles[`status-${status}`])}>
      <svg viewBox="0 0 64 64" className={styles.ringSvg} aria-hidden="true">
        <circle cx={32} cy={32} r={29} className={styles.ringTrack} />
        {fraction !== null && percent > 0 ? (
          <circle
            cx={32}
            cy={32}
            r={29}
            pathLength={100}
            strokeDasharray={`${percent} ${100 - percent}`}
            transform="rotate(-90 32 32)"
            className={cx(styles.ringArc, stale && styles.ringStale)}
            data-fraction={fraction}
          />
        ) : null}
        <circle cx={32} cy={32} r={22} className={styles.ringFace} />
      </svg>
      <span key={pulse ? previous.pulses : 'still'} className={cx(styles.clockIcon, pulse && styles.pulse)}>
        <ClockIcon />
      </span>
      <span className={styles.badge}>
        {Badge ? <Badge strokeWidth={3} /> : <span className={styles.badgeGlyph}>{badge === 'question' ? '?' : '!'}</span>}
      </span>
    </span>
  );
}
