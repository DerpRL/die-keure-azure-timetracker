import type { ReactElement, ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type TooltipProps as AriaTooltipProps,
} from 'react-aria-components';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  content: ReactNode;
  /** A focusable React Aria element (Button, IconButton, Link) or a `Focusable` wrapper. */
  children: ReactElement;
  placement?: AriaTooltipProps['placement'];
  /** Hover delay in ms. Keyboard focus shows the tooltip immediately. */
  delay?: number;
  isDisabled?: boolean;
}

/** Tooltip shown on hover and keyboard focus, dismissed with Escape (WCAG 1.4.13). */
export function Tooltip({ content, children, placement = 'top', delay = 600, isDisabled }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay} closeDelay={150} isDisabled={isDisabled}>
      {children}
      <AriaTooltip placement={placement} offset={8} className={styles.tooltip}>
        <OverlayArrow className={styles.arrow}>
          <svg width={10} height={6} viewBox="0 0 10 6" aria-hidden="true">
            <path d="M0 0 L5 6 L10 0" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
