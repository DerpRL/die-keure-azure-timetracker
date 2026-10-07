import { Section } from '../../components/Card';
import { CumulativeProgress } from '../../charts/CumulativeProgress';
import type { AnalysisView, StatisticsSlice } from '../../ipc/contract';
import { date } from './format';
import styles from './Statistics.module.css';

const TITLE = 'Progress through the period';

/** The Progress chart of the time explorer (1.14 `ExplorerProgressChart`). */
export function ProgressView({ slice, analysis }: { slice: StatisticsSlice; analysis: AnalysisView }) {
  const visuals = slice.visuals;
  if (!visuals) {
    return (
      <Section title={TITLE} variant="plain">
        <p className={styles.secondary}>The progress chart appears once this window’s worklogs are analysed.</p>
      </Section>
    );
  }
  const showTargets = slice.targetComparable && analysis.target > 0;
  return (
    <>
      <CumulativeProgress
        title={TITLE}
        headingLevel={2}
        description={
          showTargets
            ? 'Recorded time alongside your scheduled target. Future dates show the target without projecting tracked time.'
            : 'Cumulative recorded time inside this filtered or zoomed window. Clear filters and reset zoom to compare the complete period with its target.'
        }
        domain={{ start: date(slice.window.start), end: date(slice.window.end) }}
        points={visuals.progress.map((point) => ({ date: date(point.date), value: point.seconds }))}
        target={showTargets ? visuals.targetProgress.map((point) => ({ date: date(point.date), value: point.target })) : null}
      />
      {analysis.total === 0 ? <p className={styles.secondary}>No recorded time in this selection.</p> : null}
    </>
  );
}
