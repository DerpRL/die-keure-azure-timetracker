import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import { usePageTitleId } from './pageTitle';
import styles from './Place.module.css';

export interface PlaceBodyProps {
  children: ReactNode;
  className?: string;
}

/** A place's content column: 24 / 32 / 40 px padding, 20 px between rows (2.2 layout). */
export function PlaceBody({ children, className }: PlaceBodyProps) {
  return <div className={cx(styles.body, className)}>{children}</div>;
}

export interface PlaceHeaderProps {
  /** The view's h1: a day, a range, "Offline drafts". */
  title: ReactNode;
  /** A muted line under the title ("9h 38m of 38h · 1 draft not uploaded"). */
  subtitle?: ReactNode;
  /** Today's date is larger than the other views' titles. */
  size?: 'large' | 'medium';
  /** Before the title: previous / next buttons. */
  before?: ReactNode;
  /** Right after the title: a next button, a status chip, "Back to today". */
  after?: ReactNode;
  /** The right-hand side: view switch, filters, buttons, progress. */
  actions?: ReactNode;
}

/**
 * The first row of every view: navigation and title on the left, the view's controls on the
 * right; the two wrap onto separate rows when there is no room. The title is the main
 * landmark's name.
 */
export function PlaceHeader({ title, subtitle, size = 'medium', before, after, actions }: PlaceHeaderProps) {
  const titleId = usePageTitleId();
  return (
    <div className={styles.header}>
      <div className={styles.lead}>
        {before}
        <div className={styles.titleBlock}>
          <h1 id={titleId} className={cx(styles.title, size === 'large' && styles.large)}>
            {title}
          </h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {after}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export interface ViewTab<V extends string> {
  id: V;
  title: string;
}

export interface ViewTabsProps<V extends string> {
  /** Names the navigation landmark, e.g. "Insights views". */
  label: string;
  tabs: ReadonlyArray<ViewTab<V>>;
  current: V;
  onSelect: (view: V) => void;
  className?: string;
}

/** Underlined tabs between a place's views (Insights: Where time went / Patterns / Weekly report). */
export function ViewTabs<V extends string>({ label, tabs, current, onSelect, className }: ViewTabsProps<V>) {
  return (
    <nav aria-label={label} className={cx(styles.viewTabs, className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={styles.viewTab}
          aria-current={tab.id === current ? 'page' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </nav>
  );
}
