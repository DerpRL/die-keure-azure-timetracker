import { MiniTimerView } from '../features/mini/MiniTimerView';
import styles from './surfaces.module.css';

/** The floating mini timer window (Windows replaces the menu-bar text with it; optional on macOS). */
export function MiniSurface() {
  return (
    <div className={styles.fill}>
      <MiniTimerView />
    </div>
  );
}
