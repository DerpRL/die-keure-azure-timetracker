import { Button } from '../../components/Button';
import { MinusIcon, PausedIcon, WarningIcon } from '../../components/icons';
import { Switch } from '../../components/Toggles';
import { Tooltip } from '../../components/Tooltip';
import type { RepositoryView } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { BranchIcon, FolderIcon } from './icons';
import styles from './repositories.module.css';

/** The branch line: error, paused, detached HEAD, the branch, or still reading (1.14 `RepositoriesView`). */
function RepositoryStatus({ repository }: { repository: RepositoryView }) {
  if (repository.error) {
    return (
      <p className={`${styles.status} ${styles.issue}`}>
        <WarningIcon />
        <span>
          <span className="visually-hidden">Problem: </span>
          {repository.error}
        </span>
      </p>
    );
  }
  if (!repository.enabled) {
    return (
      <p className={`${styles.status} ${styles.muted}`}>
        <PausedIcon />
        <span>Paused</span>
      </p>
    );
  }
  if (repository.detached || repository.branch) {
    return (
      <p className={`${styles.status} ${styles.branch}`}>
        <BranchIcon />
        <span>
          <span className="visually-hidden">Current branch: </span>
          {repository.detached ? 'Detached HEAD' : repository.branch}
        </span>
      </p>
    );
  }
  return (
    <p className={`${styles.status} ${styles.muted}`}>
      <BranchIcon />
      <span>Reading branch…</span>
    </p>
  );
}

export interface RepositoryRowProps {
  repository: RepositoryView;
  /** Opens the removal confirmation. */
  onRemove: (repository: RepositoryView) => void;
}

/** One watched repository: name, path, branch or problem, the watch switch and Remove. */
export function RepositoryRow({ repository, onRemove }: RepositoryRowProps) {
  const toggle = useAction();
  return (
    <li className={styles.row}>
      <FolderIcon className={styles.rowIcon} strokeWidth={1.5} />
      <div className={styles.rowMain}>
        <h3 className={styles.rowName}>{repository.name}</h3>
        <p className={styles.path}>{repository.path}</p>
        <RepositoryStatus repository={repository} />
        {toggle.error ? (
          <p role="alert" className={styles.error}>
            {toggle.error.message}
          </p>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        <Switch
          isSelected={repository.enabled}
          isDisabled={toggle.pending}
          onChange={(enabled) => void toggle.run({ type: 'repositories.setEnabled', id: repository.id, enabled })}
          // The visible "Watch" starts the name (WCAG 2.5.3); the repository makes it unique.
          aria-label={`Watch ${repository.name}`}
        >
          Watch
        </Switch>
        <Tooltip content="Remove from watch list; repository files are preserved">
          <Button
            size="small"
            variant="plain"
            icon={MinusIcon}
            onPress={() => onRemove(repository)}
            aria-label={`Remove ${repository.name} from watch list`}
          >
            Remove
          </Button>
        </Tooltip>
      </div>
    </li>
  );
}
