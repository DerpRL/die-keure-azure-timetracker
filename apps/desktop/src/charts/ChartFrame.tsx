import { useId, useState, type ReactNode } from 'react';
import { ToggleButton } from 'react-aria-components';
import { Heading, type HeadingLevel } from '../components/Card';
import { TableIcon } from '../components/icons';
import { cx } from '../utils/cx';
import styles from './charts.module.css';

export interface ChartFrameProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  /** Extra controls next to "Show as table" (zoom, pan, reset). */
  actions?: ReactNode;
  /** Status line above the chart, e.g. the inspected interval. */
  status?: ReactNode;
  legend?: ReactNode;
  /** The data-table twin, shown instead of the chart when "Show as table" is on. */
  table: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  showTable?: boolean;
  defaultShowTable?: boolean;
  onShowTableChange?: (showTable: boolean) => void;
  className?: string;
}

/** Shared chart chrome: heading, description, the table toggle, legend and footer. */
export function ChartFrame({
  title,
  headingLevel = 3,
  description,
  actions,
  status,
  legend,
  table,
  children,
  footer,
  showTable: controlled,
  defaultShowTable = false,
  onShowTableChange,
  className,
}: ChartFrameProps) {
  const titleId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultShowTable);
  const showTable = controlled ?? uncontrolled;
  const setShowTable = (next: boolean) => {
    if (controlled === undefined) setUncontrolled(next);
    onShowTableChange?.(next);
  };
  return (
    <section aria-labelledby={titleId} className={cx(styles.frame, className)}>
      <div className={styles.frameHead}>
        <div className={styles.frameTitles}>
          <Heading level={headingLevel} id={titleId} className={styles.frameTitle}>
            {title}
          </Heading>
          {description ? <p className={styles.frameDescription}>{description}</p> : null}
        </div>
        <div className={styles.frameActions}>
          {actions}
          <ToggleButton isSelected={showTable} onChange={setShowTable} className={styles.tableToggle}>
            <TableIcon />
            <span>Show as table</span>
          </ToggleButton>
        </div>
      </div>
      {status ? (
        <div className={styles.frameStatus} aria-hidden="true">
          {status}
        </div>
      ) : null}
      {showTable ? <div className={styles.tableWrap}>{table}</div> : children}
      {legend && !showTable ? legend : null}
      {footer}
    </section>
  );
}
