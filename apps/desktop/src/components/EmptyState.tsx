import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import { Heading, type HeadingLevel } from './Card';
import { InboxIcon, type IconComponent } from './icons';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: IconComponent;
  /** Usually one Button that resolves the empty state ("Set up accounts"). */
  action?: ReactNode;
  headingLevel?: HeadingLevel;
  size?: 'compact' | 'regular';
  className?: string;
}

/** Explains why there is nothing to show and what to do next (1.14 `EmptyState`). */
export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  action,
  headingLevel = 3,
  size = 'regular',
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, styles[size], className)}>
      <Icon className={styles.icon} strokeWidth={1.5} />
      <Heading level={headingLevel} className={styles.title}>
        {title}
      </Heading>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

export interface SkeletonProps {
  shape?: 'text' | 'rect' | 'circle';
  /** CSS length; defaults to the full width for text and rectangles. */
  width?: string;
  height?: string;
  /** Repeats text lines; the last one is shorter. */
  lines?: number;
  className?: string;
}

/** Placeholder block shown while content loads. Decorative: wrap it in `LoadingRegion`. */
export function Skeleton({ shape = 'text', width, height, lines = 1, className }: SkeletonProps) {
  if (shape === 'text' && lines > 1) {
    return (
      <span className={cx(styles.lines, className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={cx(styles.skeleton, styles.text)}
            style={{ width: index === lines - 1 ? '60%' : (width ?? '100%') }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, styles[shape], className)}
      style={{ width, height }}
    />
  );
}

export interface LoadingRegionProps {
  /** Announced and exposed while loading, e.g. "Loading worklogs". */
  label: string;
  isLoading: boolean;
  /** Placeholder shown while loading (usually Skeletons). */
  placeholder: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Swaps a skeleton for content and tells assistive technology that the region is busy. */
export function LoadingRegion({ label, isLoading, placeholder, children, className }: LoadingRegionProps) {
  return (
    <div aria-busy={isLoading || undefined} className={className}>
      {isLoading ? (
        <>
          <span role="status" className="visually-hidden">
            {label}
          </span>
          {placeholder}
        </>
      ) : (
        children
      )}
    </div>
  );
}
