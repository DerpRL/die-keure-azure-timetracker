import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Dialog } from '../../../components/Dialog';
import { EmptyState, LoadingRegion, Skeleton } from '../../../components/EmptyState';
import { PauseIcon, PlayIcon, PlusIcon } from '../../../components/icons';
import { Switch } from '../../../components/Toggles';
import type { RepositoryView } from '../../../ipc/contract';
import { useCommands } from '../../../shortcuts/hooks';
import { useAction, useSlice } from '../../../state/hooks';
import { chooseRepositoryFolder } from './folderDialog';
import { FolderPlusIcon } from './icons';
import { RepositoryRow } from './RepositoryRow';
import { ScanSheet } from './ScanSheet';
import styles from './repositories.module.css';

const ADD_LABEL = 'Add repositories…';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Branch watching on or off (`repositories.toggleWatching`); pausing also pauses Figma
 * observations. Renders nothing until the repositories slice arrives.
 */
export function WatchSwitch({ label = 'Watch branches', compact = false }: { label?: string; compact?: boolean }) {
  const repositories = useSlice('repositories');
  const toggle = useAction();
  if (!repositories) return null;
  const watching = repositories.watching;
  return (
    <>
      <Switch
        isSelected={watching}
        isDisabled={toggle.pending}
        onChange={(next) => {
          if (next !== watching) void toggle.run({ type: 'repositories.toggleWatching' });
        }}
        aria-label={compact ? label : undefined}
        description={compact ? undefined : 'Pausing also pauses Figma observations.'}
      >
        {compact ? null : label}
      </Switch>
      {toggle.error ? (
        <p role="alert" className={styles.error}>
          {toggle.error.message}
        </p>
      ) : null}
    </>
  );
}

export interface RepositoriesPanelProps {
  /**
   * `full` (Settings → Git repositories): the list card with paths. `overview` (Settings →
   * Sources): names and branches inside the Git card, with a link to the full view.
   */
  variant?: 'full' | 'overview';
  /** Opens Settings → Git repositories (the overview's footer link). */
  onOpenGit?: () => void;
}

/**
 * The watched repositories (1.14 `RepositoriesView` and `RepositoryImportView`): the list with a
 * switch and Remove per repository, and Add repositories…, which scans a chosen folder.
 */
export function RepositoriesPanel({ variant = 'full', onOpenGit }: RepositoriesPanelProps) {
  const repositories = useSlice('repositories');
  const scan = useAction();
  const add = useAction();
  const remove = useAction();
  const other = useAction();
  const listTitleId = useId();
  const [session, setSession] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RepositoryView | null>(null);
  const [focusList, setFocusList] = useState(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const full = variant === 'full';

  const { run: runScan, clearError: clearScanError } = scan;
  const { clearError: clearAddError } = add;
  const chooseFolder = useCallback(async () => {
    setDialogError(null);
    let path: string | null;
    try {
      path = await chooseRepositoryFolder();
    } catch (error) {
      setDialogError(messageOf(error));
      return;
    }
    if (!path) return;
    clearScanError();
    clearAddError();
    setFolder(path);
    setSession((current) => current + 1);
    setSheetOpen(true);
    void runScan({ type: 'repositories.scan', path });
  }, [runScan, clearScanError, clearAddError]);

  const watching = repositories?.watching ?? false;
  useCommands([
    {
      id: 'repositories.add',
      icon: PlusIcon,
      label: ADD_LABEL,
      group: 'Actions',
      keywords: ['scan', 'folder', 'git'],
      isDisabled: !repositories,
      onAction: () => void chooseFolder(),
    },
    {
      id: 'repositories.toggleWatching',
      icon: watching ? PauseIcon : PlayIcon,
      label: watching ? 'Pause branch watching' : 'Resume branch watching',
      group: 'Actions',
      keywords: ['git', 'observations'],
      isDisabled: !repositories,
      onAction: () => void other.run({ type: 'repositories.toggleWatching' }),
    },
  ]);

  // After a removal the row (and the dialog's trigger) is gone: continue from the list heading.
  useEffect(() => {
    if (!focusList || removing) return;
    const frame = requestAnimationFrame(() => {
      listHeading.current?.focus();
      setFocusList(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusList, removing]);

  if (!repositories) {
    return (
      <LoadingRegion label="Loading repositories" isLoading placeholder={<Skeleton lines={full ? 6 : 3} />}>
        {null}
      </LoadingRegion>
    );
  }

  const scanning = scan.pending || repositories.scan.scanning;
  const closeSheet = () => setSheetOpen(false);
  const cancelSheet = () => {
    if (scanning) void other.run({ type: 'repositories.cancelScan' });
  };
  const addSelected = async (paths: string[]) => {
    const result = await add.run({ type: 'repositories.add', paths });
    if (result.ok) setSheetOpen(false);
    return result.ok;
  };
  const confirmRemove = async () => {
    if (!removing) return;
    const result = await remove.run({ type: 'repositories.remove', id: removing.id });
    if (result.ok) {
      setRemoving(null);
      setFocusList(true);
    }
  };

  const count = repositories.repositories.length;
  const addButton = (
    <Button variant={full ? 'primary' : 'secondary'} size="small" icon={full ? FolderPlusIcon : PlusIcon} onPress={() => void chooseFolder()}>
      {full ? ADD_LABEL : 'Add repository'}
    </Button>
  );
  const banners =
    dialogError || other.error ? (
      <div className={styles.banners}>
        {dialogError ? (
          <Banner tone="error" title="The folder chooser could not open" onDismiss={() => setDialogError(null)}>
            {dialogError}
          </Banner>
        ) : null}
        {other.error ? (
          <Banner tone="error" onDismiss={other.clearError} dismissLabel="Dismiss error">
            {other.error.message}
          </Banner>
        ) : null}
      </div>
    ) : null;
  const list =
    count === 0 ? (
      <div className={styles.empty}>
        <EmptyState
          icon={FolderPlusIcon}
          title="Choose your repositories"
          description="Choose a parent folder, scan its subfolders and select the repositories you want to watch."
          headingLevel={4}
        />
      </div>
    ) : (
      <ul role="list" aria-labelledby={full ? listTitleId : undefined} aria-label={full ? undefined : 'Watched repositories'} className={styles.list}>
        {repositories.repositories.map((repository) => (
          <RepositoryRow key={repository.id} repository={repository} onRemove={setRemoving} compact={!full} />
        ))}
      </ul>
    );

  const overlays = (
    <>
      <ScanSheet
        key={session}
        isOpen={sheetOpen}
        folder={folder}
        scan={repositories.scan}
        isScanning={scanning}
        scanError={scan.error?.message ?? null}
        onClose={closeSheet}
        onCancel={cancelSheet}
        onAdd={addSelected}
        isAdding={add.pending}
        addError={add.error?.message ?? null}
      />
      <Dialog
        isOpen={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.clearError();
          }
        }}
        role="alertdialog"
        size="small"
        title={removing ? `Remove ${removing.name} from the watch list?` : 'Remove repository?'}
        description="Azure timetracker stops watching it and clears its pending branch suggestions. The repository and its files stay on disk."
        primaryAction={{ label: 'Remove', variant: 'destructive', onAction: () => void confirmRemove(), isPending: remove.pending }}
      >
        {remove.error ? (
          <p role="alert" className={styles.error}>
            {remove.error.message}
          </p>
        ) : null}
      </Dialog>
    </>
  );

  if (!full) {
    return (
      <div className={styles.compact}>
        {banners}
        <div className={styles.listHeader}>
          <span className={styles.text}>{count === 0 ? 'No repositories yet' : `${count} watched ${count === 1 ? 'repository' : 'repositories'}`}</span>
          {addButton}
        </div>
        {list}
        <p className={styles.footer}>
          Ticket pattern and branch rules are under{' '}
          <Button variant="plain" size="small" className={styles.linkButton} onPress={onOpenGit}>
            Git repositories
          </Button>
          .
        </p>
        {overlays}
      </div>
    );
  }

  return (
    <>
      {banners}
      <Card as="section" aria-labelledby={listTitleId} padding="none" className={styles.listCard}>
        <div className={styles.listHeader}>
          <h3 id={listTitleId} ref={listHeading} tabIndex={-1} className={styles.listHeading}>
            {`Watched repositories · ${count}`}
          </h3>
          {addButton}
        </div>
        {list}
      </Card>
      {overlays}
    </>
  );
}
