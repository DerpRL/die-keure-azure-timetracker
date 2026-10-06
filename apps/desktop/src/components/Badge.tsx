import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import { DisconnectedIcon, ErrorIcon, PausedIcon, type IconComponent } from './icons';
import styles from './Badge.module.css';

export type Tone = 'neutral' | 'accent' | 'running' | 'paused' | 'warning' | 'danger' | 'success' | 'info';

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  icon?: IconComponent;
  /**
   * Replaces the visible text for assistive technology, e.g. a count "3" read as
   * "3 pending branch changes".
   */
  accessibleLabel?: string;
  className?: string;
}

/** Compact solid label. Text and background meet AA in every theme. */
export function Badge({ tone = 'neutral', children, icon: Icon, accessibleLabel, className }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], className)}>
      {Icon ? <Icon className={styles.icon} /> : null}
      {accessibleLabel ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="visually-hidden">{accessibleLabel}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}

export interface StatusDotProps {
  tone: Tone;
  /** What the dot means. Hidden visually unless `showLabel`, but always available to screen readers. */
  label: string;
  showLabel?: boolean;
  /** Gentle pulse for live states; disabled by reduced motion. */
  pulse?: boolean;
  className?: string;
}

/** Shapes differ per tone, so the dot never relies on colour alone. */
const SHAPE_ICONS: Partial<Record<Tone, IconComponent>> = {
  paused: PausedIcon,
  warning: DisconnectedIcon,
  danger: ErrorIcon,
};

export function StatusDot({ tone, label, showLabel = false, pulse = false, className }: StatusDotProps) {
  const Icon = SHAPE_ICONS[tone];
  return (
    <span className={cx(styles.status, className)}>
      {Icon ? (
        <Icon className={cx(styles.shape, styles[`fg-${tone}`])} strokeWidth={2.5} />
      ) : (
        <span
          aria-hidden="true"
          className={cx(styles.dot, styles[`dot-${tone}`], tone === 'neutral' && styles.ring, pulse && styles.pulse)}
        />
      )}
      <span className={showLabel ? styles.statusLabel : 'visually-hidden'}>{label}</span>
    </span>
  );
}
