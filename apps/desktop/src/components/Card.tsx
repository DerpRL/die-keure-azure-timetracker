import { useId, type ElementType, type ReactNode } from 'react';
import { cx } from '../utils/cx';
import styles from './Card.module.css';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingProps {
  level: HeadingLevel;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** A heading whose level is chosen by the page outline, not by its looks. */
export function Heading({ level, id, className, children }: HeadingProps) {
  const Tag = `h${level}` as ElementType;
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

export interface CardProps {
  children: ReactNode;
  /** `section`/`article` add semantics; use `Section` when the card has a heading. */
  as?: 'div' | 'section' | 'article' | 'aside';
  padding?: 'none' | 'small' | 'medium' | 'large';
  /** Raised cards sit on other cards or in panels. */
  tone?: 'default' | 'sunken';
  className?: string;
  'aria-labelledby'?: string;
  'aria-label'?: string;
}

/** Solid surface with a border, the building block of every page. */
export function Card({ children, as: Tag = 'div', padding = 'medium', tone = 'default', className, ...aria }: CardProps) {
  return (
    <Tag {...aria} className={cx(styles.card, styles[`padding-${padding}`], tone === 'sunken' && styles.sunken, className)}>
      {children}
    </Tag>
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  subtitle?: ReactNode;
  level?: HeadingLevel;
  id?: string;
  /** Right-aligned controls next to the heading. */
  actions?: ReactNode;
  size?: 'title' | 'section' | 'group';
  className?: string;
}

/** Heading with an optional secondary line, as `SectionTitle` and `AppSectionHeading` in 1.14. */
export function SectionHeading({
  title,
  subtitle,
  level = 2,
  id,
  actions,
  size = 'section',
  className,
}: SectionHeadingProps) {
  return (
    <div className={cx(styles.heading, className)}>
      <div className={styles.headingText}>
        <Heading level={level} id={id} className={cx(styles.title, styles[`title-${size}`])}>
          {title}
        </Heading>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export interface SectionProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Heading level in the page outline. Default 2. */
  headingLevel?: HeadingLevel;
  actions?: ReactNode;
  children: ReactNode;
  /** `card` draws the surface; `plain` keeps only the heading and spacing. */
  variant?: 'card' | 'plain';
  padding?: CardProps['padding'];
  className?: string;
}

/** A labelled region: `<section aria-labelledby>` with its heading, inside a card by default. */
export function Section({
  title,
  subtitle,
  headingLevel = 2,
  actions,
  children,
  variant = 'card',
  padding = 'medium',
  className,
}: SectionProps) {
  const headingId = useId();
  const content = (
    <>
      <SectionHeading
        id={headingId}
        level={headingLevel}
        title={title}
        subtitle={subtitle}
        actions={actions}
        size={variant === 'card' ? 'group' : 'section'}
      />
      <div className={styles.body}>{children}</div>
    </>
  );
  if (variant === 'plain') {
    return (
      <section aria-labelledby={headingId} className={cx(styles.plainSection, className)}>
        {content}
      </section>
    );
  }
  return (
    <Card as="section" aria-labelledby={headingId} padding={padding} className={cx(styles.cardSection, className)}>
      {content}
    </Card>
  );
}
