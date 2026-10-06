import type { ReactNode } from 'react';
import { Button } from '../components/Button';
import { RefreshIcon } from '../components/icons';
import { useRefreshShortcut } from '../shortcuts/hooks';
import type { KeyCombo } from '../shortcuts/keys';
import { usePageTitleId } from './pageTitle';
import styles from './PageHeader.module.css';

export const REFRESH_SHORTCUT: KeyCombo = { key: 'r', mod: true };

export interface PageHeaderProps {
  title: string;
  /** Connection status slot (the 1.14 `ConnectionHealthView`). */
  status?: ReactNode;
  /** Shows a Refresh button and registers ⌘R / Ctrl+R. */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  refreshDisabled?: boolean;
  /** Accessible name for the refresh action (shown as its label). */
  refreshLabel?: string;
  actions?: ReactNode;
}

/** Page title (h1) with connection status and the refresh action. */
export function PageHeader({
  title,
  status,
  onRefresh,
  isRefreshing = false,
  refreshDisabled = false,
  refreshLabel = 'Refresh',
  actions,
}: PageHeaderProps) {
  const titleId = usePageTitleId();
  useRefreshShortcut(() => onRefresh?.(), { isDisabled: !onRefresh || refreshDisabled || isRefreshing, label: refreshLabel });
  return (
    <header className={styles.header}>
      <h1 id={titleId} className={styles.title}>
        {title}
      </h1>
      <div className={styles.trailing}>
        {status ? <div className={styles.status}>{status}</div> : null}
        {actions}
        {onRefresh ? (
          <Button
            icon={RefreshIcon}
            onPress={onRefresh}
            isPending={isRefreshing}
            isDisabled={refreshDisabled}
            shortcut={REFRESH_SHORTCUT}
          >
            {refreshLabel}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
