import type { ReactNode } from 'react';
import styles from './MiniTimerShell.module.css';

export interface MiniTimerShellProps {
  /** Usually a small `TimerDisplay`. */
  children: ReactNode;
  /** Ticket or status line under the timer. */
  caption?: ReactNode;
  /** Compact icon buttons: pause, stop, open the panel. */
  actions?: ReactNode;
  /** Accessible name of the window's main region. */
  label?: string;
}

/**
 * Floating always-on-top timer (Windows, where the tray cannot show text). The background is a
 * Tauri drag region so the frameless window can be moved; controls inside stay clickable.
 */
export function MiniTimerShell({ children, caption, actions, label = 'Mini timer' }: MiniTimerShellProps) {
  return (
    <div className={styles.mini} data-surface="mini" data-tauri-drag-region="">
      <main aria-label={label} className={styles.body} data-tauri-drag-region="">
        <div className={styles.timer}>{children}</div>
        {caption ? <div className={styles.caption}>{caption}</div> : null}
      </main>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
