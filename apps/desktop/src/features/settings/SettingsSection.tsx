import { createContext, useContext, useId, type ReactNode } from 'react';
import { Heading, type HeadingLevel } from '../../components/Card';
import { ErrorIcon, WarningIcon } from '../../components/icons';
import { Switch, type SwitchProps } from '../../components/Toggles';
import { cx } from '../../utils/cx';
import { sectionAnchorId, sectionTitle, type SettingsSectionId } from './sections';
import styles from './settings.module.css';

export interface SettingsSectionProps {
  id: SettingsSectionId;
  /** One line under the title. */
  subtitle?: ReactNode;
  /** Controls at the right of the header (a switch, a button, a count). */
  actions?: ReactNode;
  /** Overrides the section's title from `SETTINGS_SECTIONS`. */
  title?: ReactNode;
  /** `danger`: the Reset card's red border. */
  tone?: 'default' | 'danger';
  /** Hides the header (the section's title is then only its accessible name). */
  headless?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The level of a settings card's heading: h3 in Settings (the menu's title is the h1, the view's
 * title the h2); the onboarding, which has only its step title above the cards, provides 2.
 */
export const SectionHeadingLevel = createContext<HeadingLevel>(3);

/**
 * One deep-linkable settings card (`#settings/<id>`), the design's "settings group": a header
 * with the title, a line of explanation and optional controls, then rows divided by hairlines.
 */
export function SettingsSection({ id, subtitle, actions, title, tone = 'default', headless = false, className, children }: SettingsSectionProps) {
  const headingLevel = useContext(SectionHeadingLevel);
  const titleId = useId();
  const name = title ?? sectionTitle(id);
  return (
    <section
      id={sectionAnchorId(id)}
      tabIndex={-1}
      aria-labelledby={headless ? undefined : titleId}
      aria-label={headless && typeof name === 'string' ? name : undefined}
      className={cx(styles.sectionCard, tone === 'danger' && styles.dangerCard, className)}
    >
      {headless ? null : (
        <div className={styles.sectionHeader}>
          <div className={styles.sectionHeaderText}>
            <Heading level={headingLevel} id={titleId} className={styles.sectionTitle}>
              {name}
            </Heading>
            {subtitle ? <p className={styles.sectionSubtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

/** Content inside a card that is not a row (a grid, a form): padded like a row. */
export function SectionBody({ children, className, tone }: { children: ReactNode; className?: string; tone?: 'sunken' }) {
  return <div className={cx(styles.sectionBody, tone === 'sunken' && styles.sunken, className)}>{children}</div>;
}

/** A small uppercase label between rows ("In the app window"). */
export function SettingsGroup({ title, description, children, className }: { title: string; description?: ReactNode; children?: ReactNode; className?: string }) {
  const headingLevel = useContext(SectionHeadingLevel);
  const level = Math.min(headingLevel + 1, 6) as HeadingLevel;
  return (
    <>
      <div className={cx(styles.groupLabel, className)}>
        <Heading level={level} className={styles.groupTitle}>
          {title}
        </Heading>
        {description ? <p className={styles.hint}>{description}</p> : null}
      </div>
      {children}
    </>
  );
}

export interface ToggleRowProps extends Omit<SwitchProps, 'children' | 'description'> {
  /** The setting, in bold. */
  title: ReactNode;
  /** What it does: the switch's description. */
  help?: ReactNode;
  /** Extra lines under the help (privacy facts, a permission). */
  extra?: ReactNode;
  /** Indented under the row above (the row it depends on). */
  sub?: boolean;
  className?: string;
}

/**
 * A setting with its switch on the right (the design's settings rows): the bold title and the
 * help text are the switch's label and description, so the whole row stays one control.
 */
export function ToggleRow({ title, help, extra, sub = false, className, ...props }: ToggleRowProps) {
  return (
    <div className={cx(styles.row, styles.toggleRowFrame, sub && styles.subRow, className)}>
      <Switch
        {...props}
        description={
          help || extra ? (
            <>
              {help}
              {extra ? <span className={styles.rowExtra}>{extra}</span> : null}
            </>
          ) : undefined
        }
        className={styles.toggleRow}
      >
        <span className={styles.rowTitle}>{title}</span>
      </Switch>
    </div>
  );
}

export interface SettingRowProps {
  title: ReactNode;
  help?: ReactNode;
  /** The control(s) on the right; a function receives the ids to label and describe them with. */
  children?: ReactNode | ((ids: { titleId: string; helpId: string | undefined }) => ReactNode);
  /** Content under the row, full width (an issue, a result). */
  below?: ReactNode;
  /** Indented under the row above (the row it depends on). */
  sub?: boolean;
  /** The text and the control stack (wide controls). */
  stacked?: boolean;
  /** Greys out the row (an option that has no effect right now). */
  dimmed?: boolean;
  className?: string;
  id?: string;
}

/** A row with the setting's title and help on the left and its control on the right. */
export function SettingRow({ title, help, children, below, sub = false, stacked = false, dimmed = false, className, id }: SettingRowProps) {
  const titleId = useId();
  const helpId = useId();
  const control = typeof children === 'function' ? children({ titleId, helpId: help ? helpId : undefined }) : children;
  return (
    <div id={id} className={cx(styles.row, sub && styles.subRow, stacked && styles.stackedRow, dimmed && styles.dimmedRow, className)}>
      <div className={styles.rowText}>
        <p id={titleId} className={styles.rowTitle}>
          {title}
        </p>
        {help ? (
          <p id={helpId} className={styles.rowHelp}>
            {help}
          </p>
        ) : null}
      </div>
      {control ? <div className={styles.rowControl}>{control}</div> : null}
      {below ? <div className={styles.rowBelow}>{below}</div> : null}
    </div>
  );
}

/** A full-width row (an empty state, a list item with its own layout). */
export function FullRow({ children, className, tone }: { children: ReactNode; className?: string; tone?: 'sunken' }) {
  return <div className={cx(styles.row, styles.fullRow, tone === 'sunken' && styles.sunken, className)}>{children}</div>;
}

/** The grey strip at the bottom of a card: a status line and an action. */
export function SectionFooter({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.sectionFooter}>
      <div className={styles.footerText}>{children}</div>
      {actions ? <div className={styles.footerActions}>{actions}</div> : null}
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

/** An inline problem as its own row in a card. */
export function IssueRow({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'warning' }) {
  return (
    <div className={cx(styles.row, styles.fullRow, styles.issueRow)}>
      <InlineIssue tone={tone}>{children}</InlineIssue>
    </div>
  );
}

/** A hint as its own row in a card. */
export function HintRow({ children }: { children: ReactNode }) {
  return (
    <div className={cx(styles.row, styles.fullRow, styles.hintRow)}>
      <Hint>{children}</Hint>
    </div>
  );
}
