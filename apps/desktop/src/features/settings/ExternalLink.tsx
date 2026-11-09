import type { MouseEvent, ReactNode } from 'react';
import { ExternalLinkIcon } from '../../components/icons';
import { cx } from '../../utils/cx';
import { openExternalLink } from './platform';
import { t } from '../../i18n';
import styles from './settings.module.css';

/**
 * A link to another site, opened in the default browser and never inside the app's window: a
 * click (with or without ⌘, Ctrl or Shift), Return and a middle click all go to the opener
 * plugin. `target="_blank"` is the fallback: the opener plugin's own click handler and the
 * shell's navigation guard (`navigation.rs`) send it to the browser as well.
 */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openExternalLink(href).catch((error: unknown) => console.warn('The link could not be opened.', error));
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={open}
      onAuxClick={(event) => {
        if (event.button === 1) open(event);
      }}
      className={cx(styles.inlineLink, className)}
    >
      {children}
      <ExternalLinkIcon />
      <span className="visually-hidden"> {t('(opens in your browser)')}</span>
    </a>
  );
}
