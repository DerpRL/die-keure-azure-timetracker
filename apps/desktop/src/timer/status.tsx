import type { Tone } from '../components/Badge';
import {
  AttentionIcon,
  ConnectingIcon,
  DisconnectedIcon,
  PausedIcon,
  RunningIcon,
  StoppedIcon,
  type IconComponent,
} from '../components/icons';
import { cx } from '../utils/cx';
import styles from './status.module.css';

/** Mirrors Swift `TrackingIndicator`. */
export type TrackingStatus = 'running' | 'stopped' | 'paused' | 'disconnected' | 'connecting' | 'attention';

export interface TrackingStatusInfo {
  /** `TrackingIndicator.label`, verbatim. */
  label: string;
  icon: IconComponent;
  tone: Tone;
}

/**
 * The status vocabulary from 1.14 (README "Meeting suggestions and tracking status"): play circle
 * while tracking, amber pause circle, stop circle, orange warning triangle, refresh arrows, orange
 * question circle. Each state has its own symbol, so colour is never the only signal.
 */
export const TRACKING_STATUS: Readonly<Record<TrackingStatus, TrackingStatusInfo>> = {
  running: { label: 'Tracking', icon: RunningIcon, tone: 'running' },
  stopped: { label: 'Stopped', icon: StoppedIcon, tone: 'neutral' },
  paused: { label: 'Paused', icon: PausedIcon, tone: 'paused' },
  disconnected: { label: 'Disconnected', icon: DisconnectedIcon, tone: 'warning' },
  connecting: { label: 'Connecting', icon: ConnectingIcon, tone: 'neutral' },
  attention: { label: 'Check activity', icon: AttentionIcon, tone: 'warning' },
};

/** Statuses whose elapsed time is not confirmed by 7pace (shown still, labelled "Last known"). */
export function isUnconfirmed(status: TrackingStatus): boolean {
  return status === 'disconnected' || status === 'connecting' || status === 'attention';
}

export interface TrackingStatusLabelProps {
  status: TrackingStatus;
  /** Replaces the default label, e.g. "Local tracking" while only the offline timer runs. */
  label?: string;
  icon?: IconComponent;
  size?: 'small' | 'medium';
  className?: string;
}

/** Icon plus text status, as in the panel header and the mini timer. */
export function TrackingStatusLabel({ status, label, icon, size = 'small', className }: TrackingStatusLabelProps) {
  const info = TRACKING_STATUS[status];
  const Icon = icon ?? info.icon;
  return (
    <span className={cx(styles.status, styles[info.tone], styles[size], className)}>
      <Icon className={styles.icon} />
      <span>{label ?? info.label}</span>
    </span>
  );
}
