import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import { IconButton } from './Button';
import { CloseIcon, ErrorIcon, InfoIcon, SuccessIcon, WarningIcon, type IconComponent } from './icons';
import styles from './Banner.module.css';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons for the banner's actions, e.g. "Retry" or "Download update". */
  actions?: ReactNode;
  /** Shows a dismiss button when provided. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /**
   * Live-region behaviour. Defaults to `assertive` for errors and `polite` otherwise; use `off`
   * for banners that are part of the initial page, so they are not announced on load.
   */
  live?: 'polite' | 'assertive' | 'off';
  className?: string;
}

const ICONS: Record<BannerTone, IconComponent> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
};

/** Inline message with a distinct icon shape per tone, so colour is never the only signal. */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  live,
  className,
}: BannerProps) {
  const Icon = ICONS[tone];
  const politeness = live ?? (tone === 'error' ? 'assertive' : 'polite');
  const role = politeness === 'off' ? undefined : politeness === 'assertive' ? 'alert' : 'status';
  return (
    <div role={role} className={cx(styles.banner, styles[tone], className)}>
      <Icon className={styles.icon} />
      <div className={styles.content}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children ? <div className={styles.message}>{children}</div> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton label={dismissLabel} icon={CloseIcon} size="small" onPress={onDismiss} className={styles.dismiss} />
      ) : null}
    </div>
  );
}
