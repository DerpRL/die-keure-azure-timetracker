import { PanelView } from '../features/panel/PanelView';
import styles from './surfaces.module.css';

/** The tray panel window. */
export function PanelSurface() {
  return (
    <div className={styles.fill}>
      <PanelView />
    </div>
  );
}
