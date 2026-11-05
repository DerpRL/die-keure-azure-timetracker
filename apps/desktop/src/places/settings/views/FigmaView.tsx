import { sectionAnchorId } from '../../../features/settings/sections';
import { FigmaPanel } from '../figma';
import styles from '../settings.module.css';

/** Settings → Figma: observation, suggestions, the file register and context history. */
export function FigmaView() {
  return (
    <div id={sectionAnchorId('figma')} tabIndex={-1} className={styles.anchor}>
      <FigmaPanel />
    </div>
  );
}
