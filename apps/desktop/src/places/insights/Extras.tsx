import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronRightIcon } from '../../components/icons';
import { cx } from '../../utils/cx';
import styles from './insights.module.css';

/** The retained 1.14 blocks behind a disclosure, one key per block. */
export type ExtrasId = 'explore' | 'patterns' | 'weekSoFar';

export interface ExtrasState {
  isOpen: (id: ExtrasId) => boolean;
  setOpen: (id: ExtrasId, open: boolean) => void;
}

const ExtrasContext = createContext<ExtrasState | null>(null);

/**
 * Remembers which extras are open while Insights stays open (moving between its views keeps them).
 * An outer provider (tests) wins over this one.
 */
export function ExtrasProvider({ initial = [], children }: { initial?: readonly ExtrasId[]; children: ReactNode }) {
  const outer = useContext(ExtrasContext);
  const [open, setOpenIds] = useState<ReadonlySet<ExtrasId>>(() => new Set(initial));
  const value = useMemo<ExtrasState>(
    () => ({
      isOpen: (id) => open.has(id),
      setOpen: (id, next) =>
        setOpenIds((previous) => {
          const copy = new Set(previous);
          if (next) copy.add(id);
          else copy.delete(id);
          return copy;
        }),
    }),
    [open],
  );
  if (outer) return <>{children}</>;
  return <ExtrasContext.Provider value={value}>{children}</ExtrasContext.Provider>;
}

/** Opens a block from elsewhere ("open this day's timeline" opens the explorer). */
export function useOpenExtras(): (id: ExtrasId) => void {
  const shared = useContext(ExtrasContext);
  return (id) => shared?.setOpen(id, true);
}

export interface ExtrasProps {
  id: ExtrasId;
  title: string;
  /** What opening shows, next to the title ("Time explorer, heatmaps, …"). */
  summary: string;
  children: ReactNode;
}

/**
 * A block beyond the design's view, closed by default: a heading whose button shows or hides it.
 * The content mounts only while open.
 */
export function Extras({ id, title, summary, children }: ExtrasProps) {
  const shared = useContext(ExtrasContext);
  const [local, setLocal] = useState(false);
  const open = shared ? shared.isOpen(id) : local;
  const toggle = () => (shared ? shared.setOpen(id, !open) : setLocal(!open));
  const headingId = useId();
  const panelId = useId();
  const titleId = useId();
  const summaryId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.extras}>
      <h2 id={headingId} className={styles.extrasHeading}>
        <button
          type="button"
          className={styles.extrasButton}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-labelledby={titleId}
          aria-describedby={summaryId}
          onClick={toggle}
        >
          <ChevronRightIcon className={cx(styles.extrasChevron, open && styles.extrasChevronOpen)} />
          <span id={titleId} className={styles.extrasTitle}>
            {title}
          </span>
          <span id={summaryId} className={styles.extrasSummary}>
            {summary}
          </span>
        </button>
      </h2>
      {open ? (
        <div id={panelId} className={styles.extrasPanel}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
