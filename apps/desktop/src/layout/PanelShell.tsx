import { useId, type ReactNode } from 'react';
import { Disclosure, DisclosurePanel, Button as AriaButton, Heading as AriaHeading } from 'react-aria-components';
import { Button } from '../components/Button';
import { ChevronRightIcon, ClockIcon, type IconComponent } from '../components/icons';
import { cx } from '../utils/cx';
import styles from './PanelShell.module.css';

export interface PanelShellProps {
  title?: string;
  /** Tracking status in text and symbol (`TrackingStatusLabel`), next to the title. */
  status?: ReactNode;
  children: ReactNode;
  /** After the content, e.g. the section grid; scrolls with it. */
  footer?: ReactNode;
}

/**
 * The 420 px tray panel. It scrolls vertically only: content wraps instead of widening, which
 * keeps every control reachable at 150 % scale.
 */
export function PanelShell({ title = 'Azure timetracker', status, children, footer }: PanelShellProps) {
  const titleId = useId();
  return (
    <div className={styles.panel} data-surface="panel">
      <header className={styles.header}>
        <ClockIcon className={styles.brandIcon} />
        <h1 id={titleId} className={styles.title}>
          {title}
        </h1>
        {status ? <div className={styles.status}>{status}</div> : null}
      </header>
      {/* One scroll area for the content and the section grid, so a large scale never leaves
          the grid pinned over most of a short panel. Vertical scrolling only. */}
      <div className={styles.scroll}>
        <main className={styles.body} aria-labelledby={titleId}>
          {children}
        </main>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface PanelSectionProps {
  title: string;
  children: ReactNode;
  /** Secondary sections collapse to keep the next action in view (rewrite plan §8). */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  /** Short summary shown next to a collapsed section's title. */
  summary?: ReactNode;
}

export function PanelSection({ title, children, collapsible = false, defaultExpanded = true, summary }: PanelSectionProps) {
  const headingId = useId();
  if (!collapsible) {
    return (
      <section aria-labelledby={headingId} className={styles.section}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {title}
        </h2>
        <div className={styles.sectionBody}>{children}</div>
      </section>
    );
  }
  return (
    <Disclosure defaultExpanded={defaultExpanded} className={styles.section}>
      <AriaHeading level={2} className={styles.sectionTitle}>
        <AriaButton slot="trigger" className={styles.disclosureButton}>
          <ChevronRightIcon className={styles.disclosureChevron} />
          <span className={styles.disclosureTitle}>{title}</span>
          {summary ? <span className={styles.summary}>{summary}</span> : null}
        </AriaButton>
      </AriaHeading>
      <DisclosurePanel className={styles.sectionBody}>{children}</DisclosurePanel>
    </Disclosure>
  );
}

export interface PanelSectionLink {
  id: string;
  label: string;
  icon: IconComponent;
  onPress: () => void;
  /** Shown as a tooltip-free hint for consequences, e.g. "Quitting leaves the 7pace timer running". */
  description?: string;
}

/** "Open a section": a two-column grid of labelled buttons that collapses to one column. */
export function PanelSectionGrid({ title = 'Open a section', links }: { title?: string; links: readonly PanelSectionLink[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
      <ul role="list" className={styles.grid}>
        {links.map((link) => (
          <li key={link.id} className={styles.gridItem}>
            <Button icon={link.icon} onPress={link.onPress} fullWidth className={styles.gridButton}>
              {link.label}
            </Button>
            {link.description ? <span className={styles.gridHint}>{link.description}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PanelDivider({ className }: { className?: string }) {
  return <hr className={cx(styles.divider, className)} />;
}
