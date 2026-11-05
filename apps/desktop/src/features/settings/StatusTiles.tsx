import type { ReactNode } from 'react';
import type { IconComponent } from '../../components/icons';
import { cx } from '../../utils/cx';
import styles from './settings.module.css';

export type TileTone = 'success' | 'neutral' | 'accent' | 'warning' | 'danger';

export interface StatusTile {
  id: string;
  icon: IconComponent;
  tone: TileTone;
  title: string;
  detail?: ReactNode;
}

/**
 * The status tiles at the top of a Settings view (design "stiles"): what is connected or
 * allowed, at a glance. A list, so screen readers hear how many there are.
 */
export function StatusTiles({ tiles, label }: { tiles: readonly StatusTile[]; label: string }) {
  return (
    <ul role="list" aria-label={label} className={styles.tiles}>
      {tiles.map(({ id, icon: Icon, tone, title, detail }) => (
        <li key={id} className={styles.tile}>
          <span className={cx(styles.tileIcon, styles[`tile-${tone}`])} aria-hidden="true">
            <Icon />
          </span>
          <span className={styles.tileText}>
            <span className={styles.tileTitle}>{title}</span>
            {detail ? <span className={styles.tileDetail}>{detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
