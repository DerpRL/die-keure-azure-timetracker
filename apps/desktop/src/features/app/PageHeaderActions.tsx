import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/Button';
import { RefreshIcon } from '../../components/icons';
import { REFRESH_SHORTCUT } from '../../layout/PageHeader';
import { useRefreshShortcut } from '../../shortcuts/hooks';

/** The element in the main window's page header where the current page puts its actions. */
export const PageHeaderSlotContext = createContext<HTMLElement | null>(null);

/**
 * Renders `children` in the page header (next to the connection status), e.g. Export or a
 * period picker. Pages render it anywhere in their tree; outside the main window it renders
 * nothing.
 */
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageHeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
}

export interface PageRefreshProps {
  onRefresh: () => void;
  isRefreshing?: boolean;
  isDisabled?: boolean;
  /** Button text and palette label, e.g. "Refresh statistics". */
  label?: string;
}

/** The page's Refresh button in the header, with ⌘R / Ctrl+R. */
export function PageRefresh({ onRefresh, isRefreshing = false, isDisabled = false, label = 'Refresh' }: PageRefreshProps) {
  useRefreshShortcut(onRefresh, { isDisabled: isDisabled || isRefreshing, label });
  return (
    <PageHeaderActions>
      <Button
        icon={RefreshIcon}
        onPress={onRefresh}
        isPending={isRefreshing}
        isDisabled={isDisabled}
        shortcut={REFRESH_SHORTCUT}
      >
        {label}
      </Button>
    </PageHeaderActions>
  );
}
