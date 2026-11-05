import { createContext, useContext, type ReactNode } from 'react';
import { Card, Section, type HeadingLevel } from '../../components/Card';
import { ErrorIcon, WarningIcon } from '../../components/icons';
import { Switch, type SwitchProps } from '../../components/Toggles';
import { cx } from '../../utils/cx';
import { sectionAnchorId, sectionTitle, type SettingsSectionId } from './sections';
import styles from './settings.module.css';

export interface SettingsSectionProps {
  id: SettingsSectionId;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Overrides the section's title from `SETTINGS_SECTIONS`. */
  title?: ReactNode;
  children: ReactNode;
}

/**
 * The level of a settings card's heading: h3 in Settings (the menu's title is the h1, the view's
 * title the h2); the onboarding, which has only its step title above the cards, provides 2.
 */
export const SectionHeadingLevel = createContext<HeadingLevel>(3);

/** One deep-linkable settings card (`#settings/<id>`), headed at {@link SectionHeadingLevel}. */
export function SettingsSection({ id, subtitle, actions, title, children }: SettingsSectionProps) {
  const headingLevel = useContext(SectionHeadingLevel);
  return (
    <div id={sectionAnchorId(id)} className={styles.sectionAnchor} tabIndex={-1}>
      <Section
        title={title ?? sectionTitle(id)}
        subtitle={subtitle}
        actions={actions}
        headingLevel={headingLevel}
        padding="large"
        className={styles.sectionCard}
      >
        {children}
      </Section>
    </div>
  );
}

/**
 * A deep-linkable card for content that brings its own h3 (the updater's `UpdateSettings`), so
 * the outline has no empty or duplicated heading.
 */
export function SettingsCard({ id, children }: { id: SettingsSectionId; children: ReactNode }) {
  return (
    <div id={sectionAnchorId(id)} className={styles.sectionAnchor} tabIndex={-1}>
      <Card padding="large" className={styles.card}>
        {children}
      </Card>
    </div>
  );
}

/** A group inside a card, with an h4. */
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
      <h4 className={styles.groupTitle}>{title}</h4>
      {description ? <p className={styles.hint}>{description}</p> : null}
      {children}
    </div>
  );
}

export interface ToggleRowProps extends Omit<SwitchProps, 'children' | 'description'> {
  /** The setting, in bold. */
  title: ReactNode;
  /** What it does: the switch's description. */
  help?: ReactNode;
  className?: string;
}

/**
 * A setting with its switch on the right (the design's settings rows): the bold title and the
 * help text are the switch's label and description, so the whole row stays one control.
 */
export function ToggleRow({ title, help, className, ...props }: ToggleRowProps) {
  return (
    <Switch {...props} description={help} className={cx(styles.toggleRow, className)}>
      {title}
    </Switch>
  );
}

/** A row with a text block on the left and a control (button, shortcut) on the right. */
export function SettingRow({ title, help, children }: { title: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingText}>
        <p className={styles.settingTitle}>{title}</p>
        {help ? <p className={styles.hint}>{help}</p> : null}
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  );
}

/** Secondary explanation text. */
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
