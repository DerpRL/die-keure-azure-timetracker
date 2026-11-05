import { Button } from '../../../components/Button';
import { PausedIcon, WarningIcon } from '../../../components/icons';
import { Switch } from '../../../components/Toggles';
import { Tooltip } from '../../../components/Tooltip';
import type { RepositoryView } from '../../../ipc/contract';
import { useAction } from '../../../state/hooks';
import { BranchIcon } from './icons';
import styles from './repositories.module.css';

/** The branch line: error, paused, detached HEAD, the branch, or still reading (1.14 `RepositoriesView`). */
function RepositoryStatus({ repository }: { repository: RepositoryView }) {
  if (repository.error) {
    return (
      <p className={`${styles.rowStatus} ${styles.issue}`}>
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
      <p className={styles.rowStatus}>
        <PausedIcon />
        <span>Paused</span>
      </p>
    );
  }
  if (repository.detached || repository.branch) {
    return (
      <p className={styles.rowStatus}>
        <BranchIcon />
        <span className="visually-hidden">Current branch: </span>
        {repository.detached ? <span>Detached HEAD</span> : <code className={styles.code}>{repository.branch}</code>}
      </p>
    );
  }
  return (
    <p className={styles.rowStatus}>
      <BranchIcon />
      <span>Reading branch…</span>
    </p>
  );
}

export interface RepositoryRowProps {
  repository: RepositoryView;
  /** Opens the removal confirmation. */
  onRemove: (repository: RepositoryView) => void;
  /** The Sources overview: name and branch only, without the path. */
  compact?: boolean;
}

/** One watched repository: name, path, branch or problem, the watch switch and Remove. */
export function RepositoryRow({ repository, onRemove, compact = false }: RepositoryRowProps) {
  const toggle = useAction();
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <h4 className={styles.rowName}>{repository.name}</h4>
        {compact ? null : <p className={styles.path}>{repository.path}</p>}
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
          aria-label={`Watch ${repository.name}`}
        >
          {null}
        </Switch>
        <Tooltip content="Remove from watch list; repository files are preserved">
          <Button
            size="small"
            variant="plain"
            className={styles.danger}
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
