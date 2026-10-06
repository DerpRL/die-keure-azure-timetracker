import { createContext, useContext, useId, type ReactNode } from 'react';
import { useDateFormatter } from 'react-aria';
import { Badge } from '../../components/Badge';
import { Heading, type HeadingLevel } from '../../components/Card';
import type { IconComponent } from '../../components/icons';
import type { PromptKind } from '../../ipc/contract';
import { cx } from '../../utils/cx';
import { ActionError, type IntentRunner } from '../tracking/actions';
import type { TrackingSurface } from '../tracking/CurrentTracking';
import styles from './prompts.module.css';

export interface PromptContextValue {
  /** Where the prompt is shown: the panel prepares choices in the panel, the main window in its sheet. */
  surface: TrackingSurface;
  /** Level of each prompt's heading in the surrounding outline. */
  headingLevel: HeadingLevel;
  /** The panel shows compact prompts (fewer explanations, 1.14 `compact`). */
  compact: boolean;
}

export const PromptContext = createContext<PromptContextValue>({ surface: 'main', headingLevel: 2, compact: false });

export function usePromptContext(): PromptContextValue {
  return useContext(PromptContext);
}

export type PromptTone = 'warning' | 'accent' | 'neutral';

export interface PromptCardProps {
  kind: PromptKind | 'idleCorrection';
  icon: IconComponent;
  title: string;
  /** A line under the title, e.g. the repository name. */
  subtitle?: ReactNode;
  tone?: PromptTone;
  /** A short label next to the title ("Review"), as text, not colour. */
  badge?: string;
  children?: ReactNode;
  /** The buttons; mark the default one with `data-prompt-primary` for focus on panel open. */
  actions: ReactNode;
  runner: IntentRunner;
}

/**
 * The frame shared by every prompt: icon, heading, explanation and actions. A prompt only
 * prepares a choice; the timer changes after the user confirms.
 */
export function PromptCard({ kind, icon: Icon, title, subtitle, tone = 'accent', badge, children, actions, runner }: PromptCardProps) {
  const { headingLevel } = usePromptContext();
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className={cx(styles.card, styles[tone])} data-prompt={kind}>
      <div className={styles.header}>
        <span className={styles.iconTile} aria-hidden="true">
          <Icon />
        </span>
        <div className={styles.headerText}>
          <Heading level={headingLevel} id={headingId} className={styles.title}>
            {title}
          </Heading>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {badge ? (
          <Badge tone={tone === 'warning' ? 'warning' : 'accent'} className={styles.badge}>
            {badge}
          </Badge>
        ) : null}
      </div>
      {children ? <div className={styles.body}>{children}</div> : null}
      <div className={styles.actions}>{actions}</div>
      <ActionError error={runner.error} />
      {runner.confirmation}
    </article>
  );
}

/** "10:20" in the user's 24-hour English format. */
export function useTimeOfDay(): (iso: string) => string {
  const formatter = useDateFormatter({ hour: '2-digit', minute: '2-digit' });
  return (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : formatter.format(date);
  };
}

export const promptStyles = styles;
