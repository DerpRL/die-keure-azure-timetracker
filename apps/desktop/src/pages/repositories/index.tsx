import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { StatusDot } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card, Section } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { SettingsIcon } from '../../components/icons';
import { Switch } from '../../components/Toggles';
import { PageHeaderActions } from '../../features/app/PageHeaderActions';
import type { RepositoryView } from '../../ipc/contract';
import { showMain } from '../../ipc/shell';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { chooseRepositoryFolder } from './folderDialog';
import { FolderPlusIcon } from './icons';
import { RepositoryRow } from './RepositoryRow';
import { ScanSheet } from './ScanSheet';
import styles from './repositories.module.css';

const ADD_LABEL = 'Add repositories…';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The watch switch and what branch watching does with the ticket pattern. */
function WatchingSection({ watching }: { watching: boolean }) {
  const toggle = useAction();
  const settings = useSlice('settings');
  const pattern = settings?.configuration.branchPattern;
  const [openError, setOpenError] = useState<string | null>(null);
  const openSettings = () => {
    setOpenError(null);
    showMain('settings').catch((error: unknown) => setOpenError(messageOf(error)));
  };
  return (
    <Section
      title="Branch watching"
      subtitle="Suggests the ticket of the branch you switch to. Nothing changes in 7pace until you confirm."
    >
      <div className={styles.watching}>
        <StatusDot
          tone={watching ? 'running' : 'paused'}
          label={watching ? 'Watching branches' : 'Observations paused'}
          showLabel
        />
        <Switch
          isSelected={watching}
          isDisabled={toggle.pending}
          onChange={(next) => {
            if (next !== watching) void toggle.run({ type: 'repositories.toggleWatching' });
          }}
          description="Pausing also pauses Figma observations."
        >
          Watch branches
        </Switch>
      </div>
      {toggle.error ? (
        <p role="alert" className={styles.error}>
          {toggle.error.message}
        </p>
      ) : null}
      <p className={styles.text}>
        A branch such as feature/33624-improve-loading suggests ticket 33624. develop and long-feature/* branches suggest
        Pause, Stop or Keep current instead, and a detached HEAD does not change tracking.
      </p>
      <div className={styles.pattern}>
        <span className={styles.text}>Ticket pattern:</span>
        {pattern ? <code className={styles.code}>{pattern}</code> : <span className={styles.text}>Loading…</span>}
        <Button size="small" variant="plain" icon={SettingsIcon} onPress={openSettings}>
          Change in Settings
        </Button>
      </div>
      {openError ? (
        <p role="alert" className={styles.error}>
          {openError}
        </p>
      ) : null}
    </Section>
  );
}

/** Repositories page (1.14 `RepositoriesView` and `RepositoryImportView`). */
export default function RepositoriesPage() {
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
      label: ADD_LABEL,
      group: 'Actions',
      keywords: ['scan', 'folder', 'git'],
      isDisabled: !repositories,
      onAction: () => void chooseFolder(),
    },
    {
      id: 'repositories.toggleWatching',
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
      <LoadingRegion label="Loading repositories" isLoading placeholder={<Skeleton lines={6} />}>
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

  const addButton = (
    <Button variant="primary" icon={FolderPlusIcon} onPress={() => void chooseFolder()}>
      {ADD_LABEL}
    </Button>
  );

  return (
    <div className={styles.page}>
      <PageHeaderActions>{addButton}</PageHeaderActions>
      <p className={styles.intro}>Choose which local Git repositories to watch.</p>
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
      <WatchingSection watching={repositories.watching} />
      <section aria-labelledby={listTitleId} className={styles.page}>
        <h2 id={listTitleId} ref={listHeading} tabIndex={-1} className={styles.listHeading}>
          Watched repositories
          {repositories.repositories.length > 0 ? ` (${repositories.repositories.length})` : ''}
        </h2>
        {repositories.repositories.length === 0 ? (
          <Card>
            <EmptyState
              icon={FolderPlusIcon}
              title="Choose your repositories"
              description="Choose a parent folder, scan its subfolders and select the repositories you want to watch."
              action={addButton}
            />
          </Card>
        ) : (
          <ul role="list" className={styles.list}>
            {repositories.repositories.map((repository) => (
              <RepositoryRow key={repository.id} repository={repository} onRemove={setRemoving} />
            ))}
          </ul>
        )}
      </section>
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
    </div>
  );
}
