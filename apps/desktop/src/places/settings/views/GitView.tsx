import { sectionAnchorId } from '../../../features/settings/sections';
import { BranchRulesSection } from '../../../features/settings/TrackingSection';
import { RepositoriesPanel } from '../git';
import styles from '../settings.module.css';

/** Settings → Git repositories (design "S4d"): watched repositories and branch rules. */
export function GitView() {
  return (
    <>
      <div id={sectionAnchorId('repositories')} tabIndex={-1} className={styles.anchor}>
        <RepositoriesPanel />
      </div>
      <BranchRulesSection />
    </>
  );
}
