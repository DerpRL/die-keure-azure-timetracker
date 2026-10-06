import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import styles from './charts.module.css';

export interface DataTableColumn {
  id: string;
  header: string;
  align?: 'start' | 'end';
}

export interface DataTableRow {
  id: string;
  cells: Readonly<Record<string, ReactNode>>;
}

export interface DataTableProps {
  caption: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** The first column names each row (a row header). */
  rowHeader?: boolean;
  emptyMessage?: string;
}

/** Static data table: the accessible twin of every chart. */
export function DataTable({ caption, columns, rows, rowHeader = true, emptyMessage = 'No data' }: DataTableProps) {
  return (
    <table className={styles.dataTable}>
      <caption className={styles.dataCaption}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id} scope="col" className={cx(column.align === 'end' && styles.alignEnd)}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className={styles.dataEmpty}>
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column, index) =>
                rowHeader && index === 0 ? (
                  <th key={column.id} scope="row" className={cx(column.align === 'end' && styles.alignEnd)}>
                    {row.cells[column.id]}
                  </th>
                ) : (
                  <td key={column.id} className={cx(column.align === 'end' && styles.alignEnd)}>
                    {row.cells[column.id]}
                  </td>
                ),
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
