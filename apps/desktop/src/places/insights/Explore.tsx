import { useState } from 'react';
import { SegmentedControl } from '../../components/Segmented';
import type { AnalysisView, Interval, StatisticsSection, StatisticsSlice } from '../../ipc/contract';
import { SearchFilter } from './explore/Filters';
import { TasksSection } from './explore/TasksSection';
import { TimeSection, type TimeChart } from './explore/TimeSection';
import { useCommands } from '../../shortcuts/hooks';
import { useAction } from '../../state/hooks';
import styles from './insights.module.css';
import { StatisticsIcon } from '../../components/icons';

type ExploreSection = Exclude<StatisticsSection, 'patterns'>;

export const EXPLORE_SECTIONS: ReadonlyArray<{ id: ExploreSection; label: string }> = [
  { id: 'time', label: 'Time explorer' },
  { id: 'tasks', label: 'Tasks' },
];

export interface ExploreProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  chart: TimeChart;
  onChartChange: (chart: TimeChart) => void;
  onOpenTimeline: (range: Interval) => void;
}

/**
 * Below the overview charts: the full time explorer (zoomable chart, heatmaps, timeline, progress
 * and the entries, with "Open in Time editor") and the task table, as the 1.14 statistics sections.
 * The engine remembers which of the two is open (`statistics.section`).
 */
export function Explore({ slice, analysis, analysisKey, colors, chart, onChartChange, onOpenTimeline }: ExploreProps) {
  const section = useAction();
  // The choice shows at once and gives way to the next slice; a refusal returns to the engine's.
  const [pending, setPending] = useState<{ from: StatisticsSection; to: ExploreSection } | null>(null);
  const engineSection: ExploreSection = slice.section === 'tasks' ? 'tasks' : 'time';
  const shown = pending && pending.from === slice.section ? pending.to : engineSection;

  const choose = (next: ExploreSection) => {
    if (next === shown) return;
    setPending({ from: slice.section, to: next });
    void section.run({ type: 'statistics.setSection', section: next }).then((result) => {
      if (!result.ok) setPending(null);
    });
  };
  useCommands(
    EXPLORE_SECTIONS.map((item) => ({
      id: `statistics.section.${item.id}`,
      icon: StatisticsIcon,
      label: `Show ${item.label}`,
      group: 'Actions' as const,
      keywords: ['statistics', 'section', 'insights'],
      isDisabled: shown === item.id,
      onAction: () => choose(item.id),
    })),
  );

  return (
    <div className={styles.explore}>
      <div className={styles.exploreHead}>
        <SegmentedControl label="Explore" hideLabel options={EXPLORE_SECTIONS} selectedKey={shown} onSelectionChange={choose} />
        <SearchFilter slice={slice} className={styles.exploreSearch} />
      </div>
      <div aria-busy={slice.analyzing || undefined} className={slice.analyzing ? styles.analyzing : undefined}>
        {shown === 'time' ? (
          <TimeSection
            slice={slice}
            analysis={analysis}
            analysisKey={analysisKey}
            colors={colors}
            chart={chart}
            onChartChange={onChartChange}
            onOpenTimeline={onOpenTimeline}
          />
        ) : (
          <TasksSection slice={slice} analysis={analysis} analysisKey={analysisKey} colors={colors} onSection={(next) => choose(next === 'tasks' ? 'tasks' : 'time')} />
        )}
      </div>
      {section.error ? (
        <p role="alert" className={styles.inlineError}>
          {section.error.message}
        </p>
      ) : null}
    </div>
  );
}
