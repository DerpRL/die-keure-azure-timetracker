import type { ReactNode } from 'react';
import { Section } from '../../components/Card';
import { ErrorIcon, WarningIcon } from '../../components/icons';
import { cx } from '../../utils/cx';
import { sectionAnchorId, sectionTitle, type SettingsSectionId } from './sections';
import styles from './settings.module.css';

export interface SettingsSectionProps {
  id: SettingsSectionId;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * One deep-linkable settings card (`#settings/<id>`). Its heading is an h2: the page title in the
 * header is the h1, and the category tab labels the panel around it.
 */
export function SettingsSection({ id, subtitle, actions, children }: SettingsSectionProps) {
  return (
    <div id={sectionAnchorId(id)} className={styles.sectionAnchor} tabIndex={-1}>
      <Section title={sectionTitle(id)} subtitle={subtitle} actions={actions} headingLevel={2}>
        {children}
      </Section>
    </div>
  );
}

/** A group inside a section, with an h3. */
export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(styles.group, className)}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {description ? <p className={styles.hint}>{description}</p> : null}
      {children}
    </div>
  );
}

/** Secondary explanation text (1.14 `.font(.callout).foregroundStyle(palette.secondary)`). */
export function Hint({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} className={cx(styles.hint, className)}>
      {children}
    </p>
  );
}

/** An inline problem next to the controls it is about (not a live region: Save announces). */
export function InlineIssue({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'warning' }) {
  const Icon = tone === 'error' ? ErrorIcon : WarningIcon;
  return (
    <p className={cx(styles.issue, tone === 'warning' && styles.warning)}>
      <Icon className={styles.issueIcon} />
      <span>{children}</span>
    </p>
  );
}

export function Divider() {
  return <hr className={styles.divider} />;
}
