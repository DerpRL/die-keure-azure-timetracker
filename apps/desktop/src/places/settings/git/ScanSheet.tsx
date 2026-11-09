import { useEffect, useMemo, useRef, useState } from 'react';
import { announce } from '../../../components/Announcer';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { SearchField } from '../../../components/Fields';
import { ProgressBar } from '../../../components/Progress';
import { Checkbox } from '../../../components/Toggles';
import type { DiscoveredView, ScanView } from '../../../ipc/contract';
import { BranchIcon } from './icons';
import { t, tn } from '../../../i18n';
import styles from './repositories.module.css';

/** Results rendered at once; "Show more" adds the next page (a parent folder can hold hundreds). */
export const SCAN_PAGE_SIZE = 100;

/** The last path component: what 1.14 showed as the repository name. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export interface ScanSheetProps {
  isOpen: boolean;
  /** The folder the user chose (shown until the engine reports its own root). */
  folder: string | null;
  scan: ScanView;
  /** The scan intent is still running, or the engine reports `scanning`. */
  isScanning: boolean;
  /** The scan intent failed (shown verbatim). */
  scanError: string | null;
  /** Closes the sheet (Escape, Cancel, after adding). */
  onClose: () => void;
  /** Escape or Cancel while the sheet is open: the parent cancels a running scan. */
  onCancel: () => void;
  /** Adds the chosen paths; resolves true when the sheet may close. */
  onAdd: (paths: string[]) => Promise<boolean>;
  isAdding: boolean;
  addError: string | null;
}

function ResultRow({ result, isSelected, onChange }: { result: DiscoveredView; isSelected: boolean; onChange: (selected: boolean) => void }) {
  const name = folderName(result.path);
  return (
    <li className={styles.result}>
      <Checkbox
        isSelected={result.alreadyAdded || isSelected}
        isDisabled={result.alreadyAdded}
        onChange={onChange}
        description={
          <>
            {result.path}
            <br />
            <span className={styles.status}>
              <BranchIcon />
              <span>
                <span className="visually-hidden">{t('Branch:')} </span>
                {result.branch}
              </span>
            </span>
          </>
        }
      >
        <span className={styles.resultName}>
          {name}
          {result.alreadyAdded ? <Badge tone="neutral">{t('Already added')}</Badge> : null}
        </span>
      </Checkbox>
    </li>
  );
}

/**
 * "Choose repositories" (1.14 `RepositoryImportView`): the engine scans the chosen folder, the
 * user picks which of the discovered repositories to watch.
 */
export function ScanSheet({
  isOpen,
  folder,
  scan,
  isScanning,
  scanError,
  onClose,
  onCancel,
  onAdd,
  isAdding,
  addError,
}: ScanSheetProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(SCAN_PAGE_SIZE);

  // The parent remounts the sheet for every scan, so a new scan starts from an empty selection.
  const wasScanning = useRef(isScanning);
  useEffect(() => {
    if (!isScanning && wasScanning.current && isOpen) {
      const found = scan.results.length;
      announce(scan.error ?? tn(found, 'Scan finished: {count} repository found.', 'Scan finished: {count} repositories found.'));
    }
    wasScanning.current = isScanning;
  }, [isScanning, isOpen, scan.results.length, scan.error]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? scan.results.filter((result) => result.path.toLocaleLowerCase().includes(needle)) : scan.results;
  }, [scan.results, query]);
  const selectable = visible.filter((result) => !result.alreadyAdded).map((result) => result.path);
  const known = new Set(scan.results.filter((result) => !result.alreadyAdded).map((result) => result.path));
  const additions = [...selected].filter((path) => known.has(path)).sort();
  const shown = visible.slice(0, limit);
  const error = scanError ?? scan.error;
  const showResults = !isScanning && !error;

  const toggle = (path: string, isSelected: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('Choose repositories')}
      description={t('Select the Git repositories you want to watch.')}
      size="large"
      onCancel={onCancel}
      primaryAction={{
        label: t('Add selected ({count})', { count: additions.length }),
        onAction: () => void onAdd(additions),
        isDisabled: !showResults || additions.length === 0,
        isPending: isAdding,
      }}
    >
      <div className={styles.sheet}>
        <p className={styles.path}>{scan.root ?? folder}</p>
        <p className={styles.text}>
          {t('Includes subfolders and Git worktrees. Git metadata, application packages and linked folders are skipped.')}
        </p>
        {isScanning ? (
          <ProgressBar label={t('Scanning folders…')} isIndeterminate />
        ) : error ? (
          <Banner tone="error" live="off">
            {error}
          </Banner>
        ) : scan.results.length === 0 ? (
          <Banner tone="info" title={t('No repositories found')} live="off">
            {t('Choose a folder containing Git checkouts or worktrees.')}
          </Banner>
        ) : (
          <>
            <div className={styles.toolbar}>
              <SearchField label={t('Search by name or path')} hideLabel placeholder={t('Search by name or path')} value={query} onChange={setQuery} />
              <Button
                size="small"
                isDisabled={selectable.length === 0}
                onPress={() => setSelected((current) => new Set([...current, ...selectable]))}
              >
                {t('Select all shown')}
              </Button>
              <Button size="small" isDisabled={selected.size === 0} onPress={() => setSelected(new Set())}>
                {t('Clear selection')}
              </Button>
            </div>
            {visible.length === 0 ? (
              <p className={styles.text}>{t('No repository matches “{query}”.', { query: query.trim() })}</p>
            ) : (
              <ul role="list" aria-label={t('Repositories found')} className={styles.results}>
                {shown.map((result) => (
                  <ResultRow
                    key={result.path}
                    result={result}
                    isSelected={selected.has(result.path)}
                    onChange={(isSelected) => toggle(result.path, isSelected)}
                  />
                ))}
              </ul>
            )}
            {visible.length > shown.length ? (
              <Button size="small" className={styles.more} onPress={() => setLimit((current) => current + SCAN_PAGE_SIZE)}>
                {t('Show {count} more of {total}', { count: Math.min(SCAN_PAGE_SIZE, visible.length - shown.length), total: visible.length - shown.length })}
              </Button>
            ) : null}
          </>
        )}
        {showResults && scan.unreadable.length > 0 ? (
          <details className={styles.unreadable}>
            <summary>
              {tn(scan.unreadable.length, '{count} folder could not be read', '{count} folders could not be read')}
            </summary>
            <ul>
              {scan.unreadable.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {showResults ? (
          <p className={styles.summary}>
            {t('{found} found · {count} selected to add', { found: scan.results.length, count: additions.length })}
          </p>
        ) : null}
        {addError ? (
          <p role="alert" className={styles.error}>
            {addError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
