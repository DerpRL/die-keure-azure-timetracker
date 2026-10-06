import type { ReactNode } from 'react';
import {
  Cell,
  Column,
  Row,
  Table as AriaTable,
  TableBody,
  TableHeader,
  type Key,
  type Selection,
  type SortDescriptor,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import { Checkbox } from './Toggles';
import { ArrowDownIcon, ArrowUpIcon } from './icons';
import styles from './Table.module.css';

export type { Selection, SortDescriptor };

export interface TableColumn<Id extends string = string> {
  id: Id;
  title: string;
  /** Exactly one column should be the row header (it names the row for screen readers). */
  isRowHeader?: boolean;
  allowsSorting?: boolean;
  align?: 'start' | 'end';
  /** CSS width, e.g. `"12rem"` or `"30%"`. Columns otherwise size to their content. */
  width?: string;
  /** CSS minimum width; rem keeps it proportional to the UI scale. */
  minWidth?: string;
  /** Hide the title visually (e.g. an actions column) while keeping it for screen readers. */
  hideTitle?: boolean;
}

export interface TableProps<Row, Id extends string = string> {
  /** Accessible name of the table. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  columns: ReadonlyArray<TableColumn<Id>>;
  rows: ReadonlyArray<Row>;
  getRowId: (row: Row) => Key;
  renderCell: (row: Row, columnId: Id) => ReactNode;
  /** Plain text for each row, used for type-ahead and announcements. */
  getRowText?: (row: Row) => string;
  /**
   * `multiple` adds a checkbox column; rows also support ⌘-click (Ctrl-click on Windows) and
   * Shift-click, like a native table.
   */
  selectionMode?: 'none' | 'single' | 'multiple';
  selectedKeys?: Selection;
  defaultSelectedKeys?: Selection;
  onSelectionChange?: (keys: Selection) => void;
  disabledKeys?: Iterable<Key>;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  /** Return or double click on a row. */
  onRowAction?: (key: Key) => void;
  renderEmptyState?: () => ReactNode;
  density?: 'compact' | 'regular';
  className?: string;
}

/**
 * Data table on React Aria's grid: arrow keys move between rows and cells, Space toggles the
 * focused row, ⌘A selects all, Return runs the row action, headers sort with Return or a click.
 */
export function Table<Row, Id extends string = string>({
  columns,
  rows,
  getRowId,
  renderCell,
  getRowText,
  selectionMode = 'none',
  selectedKeys,
  defaultSelectedKeys,
  onSelectionChange,
  disabledKeys,
  sortDescriptor,
  onSortChange,
  onRowAction,
  renderEmptyState,
  density = 'regular',
  className,
  ...aria
}: TableProps<Row, Id>) {
  const withCheckboxes = selectionMode === 'multiple';
  return (
    // A plain scroll container (no fixed column layout): columns size to content and the table
    // scrolls sideways instead of squeezing text when the window is narrow or the scale is large.
    <div className={cx(styles.container, className)}>
      <AriaTable
        {...aria}
        selectionMode={selectionMode}
        selectionBehavior={selectionMode === 'none' ? undefined : 'replace'}
        selectedKeys={selectedKeys}
        defaultSelectedKeys={defaultSelectedKeys}
        onSelectionChange={onSelectionChange}
        disabledKeys={disabledKeys}
        sortDescriptor={sortDescriptor}
        onSortChange={onSortChange}
        onRowAction={onRowAction}
        className={cx(styles.table, styles[density])}
      >
        <TableHeader className={styles.header}>
          {withCheckboxes ? (
            <Column className={cx(styles.column, styles.selectionColumn)}>
              <Checkbox slot="selection" />
            </Column>
          ) : null}
          {columns.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              isRowHeader={column.isRowHeader}
              allowsSorting={column.allowsSorting}
              style={{ width: column.width, minWidth: column.minWidth }}
              className={cx(styles.column, column.align === 'end' && styles.alignEnd)}
            >
              {({ allowsSorting, sortDirection }) => (
                <span className={styles.columnContent}>
                  <span className={column.hideTitle ? 'visually-hidden' : undefined}>{column.title}</span>
                  {allowsSorting ? (
                    <span className={cx(styles.sortIcon, !sortDirection && styles.sortIconIdle)} aria-hidden="true">
                      {sortDirection === 'descending' ? <ArrowDownIcon /> : <ArrowUpIcon />}
                    </span>
                  ) : null}
                </span>
              )}
            </Column>
          ))}
        </TableHeader>
        <TableBody
          items={rows}
          renderEmptyState={renderEmptyState ? () => <div className={styles.empty}>{renderEmptyState()}</div> : undefined}
        >
          {(row) => (
            <Row id={getRowId(row)} textValue={getRowText?.(row)} className={styles.row}>
              {withCheckboxes ? (
                <Cell className={cx(styles.cell, styles.selectionCell)}>
                  <Checkbox slot="selection" />
                </Cell>
              ) : null}
              {columns.map((column) => (
                <Cell key={column.id} className={cx(styles.cell, column.align === 'end' && styles.alignEnd)}>
                  {renderCell(row, column.id)}
                </Cell>
              ))}
            </Row>
          )}
        </TableBody>
      </AriaTable>
    </div>
  );
}
