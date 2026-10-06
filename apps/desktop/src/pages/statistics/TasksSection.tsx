import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card, Section } from '../../components/Card';
import { Select } from '../../components/Pickers';
import { Table, type TableColumn } from '../../components/Table';
import { Donut } from '../../charts/Donut';
import type { AnalysisView, ExplorerTask, StatisticsSection, StatisticsSlice } from '../../ipc/contract';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { useAction } from '../../state/hooks';
import { duration, percent } from './format';
import styles from './Statistics.module.css';

type TaskOrder = 'time' | 'entries' | 'recent';
type Column = 'task' | 'time' | 'entries' | 'days' | 'average' | 'actions';

const ORDERS: ReadonlyArray<{ id: TaskOrder; label: string }> = [
  { id: 'time', label: 'Most time' },
  { id: 'entries', label: 'Most entries' },
  { id: 'recent', label: 'Recently worked' },
];

const COLUMNS: ReadonlyArray<TableColumn<Column>> = [
  { id: 'task', title: 'Task / share of selected time', isRowHeader: true, minWidth: '16rem' },
  { id: 'time', title: 'Time', align: 'end' },
  { id: 'entries', title: 'Entries', align: 'end' },
  { id: 'days', title: 'Days', align: 'end' },
  { id: 'average', title: 'Avg / entry', align: 'end' },
  { id: 'actions', title: 'Actions', hideTitle: true },
];

/** Tasks shown at first and added per "Show 20 more tasks" (1.14). */
export const TASK_PAGE = 20;

function ordered(tasks: readonly ExplorerTask[], order: TaskOrder): ExplorerTask[] {
  const byId = (a: ExplorerTask, b: ExplorerTask) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  switch (order) {
    case 'time':
      return [...tasks];
    case 'entries':
      return [...tasks].sort((a, b) => b.count - a.count || byId(a, b));
    case 'recent':
      return [...tasks].sort((a, b) => Date.parse(b.lastWorked) - Date.parse(a.lastWorked) || byId(a, b));
  }
}

export interface TasksSectionProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  onSection: (section: StatisticsSection) => void;
}

/** 1.14 `taskExplorer`: the task ranking and the activity breakdown. */
export function TasksSection({ slice, analysis, analysisKey, colors, onSection }: TasksSectionProps) {
  const filter = useAction();
  const [order, setOrder] = useState<TaskOrder>('time');
  const [shown, setShown] = useState<{ key: string; limit: number }>({ key: analysisKey, limit: TASK_PAGE });
  const limit = shown.key === analysisKey ? shown.limit : TASK_PAGE;
  const tasks = useMemo(() => ordered(analysis.tasks, order), [analysis.tasks, order]);
  const visible = tasks.slice(0, limit);

  const explore = (task: ExplorerTask) => {
    void filter.run({ type: 'statistics.setFilter', filter: { ...slice.filter, taskId: task.id } });
    onSection('time');
  };

  return (
    <div className={styles.stack}>
      <Section
        title="Tasks you worked on"
        subtitle="Select a task to explore its timeline and entries."
        actions={
          <Select
            label="Sort"
            width="auto"
            items={ORDERS}
            selectedKey={order}
            onSelectionChange={(key) => {
              if (key !== null) setOrder(key as TaskOrder);
            }}
          />
        }
      >
        <Table<ExplorerTask, Column>
          aria-label="Tasks you worked on"
          columns={COLUMNS}
          rows={visible}
          getRowId={(task) => task.id}
          getRowText={(task) => task.title}
          onRowAction={(key) => {
            const task = analysis.tasks.find((item) => item.id === key);
            if (task) explore(task);
          }}
          renderEmptyState={() => 'No tasks match these filters.'}
          renderCell={(task, column) => {
            switch (column) {
              case 'task': {
                const share = task.seconds / Math.max(1, analysis.total);
                return (
                  <span className={styles.taskCell}>
                    {task.ticketId ? <TicketLink ticketId={task.ticketId} title={task.title} /> : <span className={styles.strong}>{task.title}</span>}
                    <span className={styles.shareRow}>
                      <span className={styles.shareTrack} aria-hidden="true">
                        <span className={styles.shareFill} style={{ width: `${Math.min(100, share * 100)}%` }} />
                      </span>
                      <span className={styles.note}>{percent(task.seconds, analysis.total)}</span>
                    </span>
                  </span>
                );
              }
              case 'time':
                return <span className={styles.number}>{duration(task.seconds)}</span>;
              case 'entries':
                return <span className={styles.number}>{task.count}</span>;
              case 'days':
                return <span className={styles.number}>{task.days}</span>;
              case 'average':
                return <span className={styles.number}>{duration(task.count > 0 ? task.seconds / task.count : 0)}</span>;
              case 'actions':
                return (
                  <Button size="small" variant="plain" aria-label={`Explore ${task.title}`} onPress={() => explore(task)}>
                    Explore
                  </Button>
                );
            }
          }}
        />
        {tasks.length > limit ? (
          <div className={styles.buttonRow}>
            <Button size="small" onPress={() => setShown({ key: analysisKey, limit: limit + TASK_PAGE })}>
              Show 20 more tasks
            </Button>
            <span className={styles.secondary}>{`${visible.length} of ${tasks.length} tasks`}</span>
          </div>
        ) : null}
        <p className={styles.secondary}>
          Work without an Azure ticket is grouped by activity and comment. Entry averages use only the selected time window.
        </p>
      </Section>
      <Card padding="large">
        <Donut
          title="Time by activity"
          headingLevel={2}
          description="Select an activity to filter every chart and task in this period."
          slices={analysis.activities.map((activity) => ({
            id: activity.id,
            name: activity.name,
            value: activity.seconds,
            colorIndex: colors.get(activity.id) ?? 0,
          }))}
          selectedId={slice.filter.activityId}
          onSelect={(activityId) => void filter.run({ type: 'statistics.setFilter', filter: { ...slice.filter, activityId } })}
          emptyMessage="No activities in this selection."
        />
      </Card>
      {filter.error ? (
        <p role="alert" className={styles.inlineError}>
          {filter.error.message}
        </p>
      ) : null}
    </div>
  );
}
