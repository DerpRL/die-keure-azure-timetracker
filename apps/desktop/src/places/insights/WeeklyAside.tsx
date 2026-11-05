import { useId, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { SegmentedControl } from '../../components/Segmented';
import { ActivitySwatch, activityColorIndex, useActivityColors } from '../../features/activity';
import { deviceName } from '../../features/ticketContext/format';
import type { WeeklySlice } from '../../ipc/contract';
import { duration, rangeTitle } from './explore/format';
import { useSlice } from '../../state/hooks';
import styles from './insights.module.css';
import type { WeeklyReport } from './useWeeklyReport';

type Mode = 'preview' | 'edit';

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'preview', label: 'Preview' },
  { id: 'edit', label: 'Edit' },
];

/** The draft still has placeholders to fill in, or is empty. */
export function needsOutcomes(draft: string): boolean {
  return draft.trim() === '' || /\[ADD[^\]]*\]/i.test(draft);
}

/**
 * The weekly report next to the charts (2.2 "S3 · Insights" aside): what this week's draft is based
 * on, the draft itself in Edit, and Regenerate / Copy / Export Markdown. The engine loads the week
 * alongside the statistics (`also: weeklyReport`).
 */
export function WeeklyAside({ report, statisticsRange }: { report: WeeklyReport; statisticsRange: string | null }) {
  const headingId = useId();
  const app = useSlice('app');
  const [mode, setMode] = useState<Mode>('preview');
  const { weekly, draft, empty } = report;
  const week = weekly ? rangeTitle('week', weekly.range) : null;
  const otherWeek = !!weekly && statisticsRange !== null && weekly.range.start !== statisticsRange;

  return (
    <Card as="aside" aria-labelledby={headingId} padding="none" className={styles.aside}>
      <div className={styles.asideHead}>
        <div className={styles.asideTitleBlock}>
          <h2 id={headingId} className={styles.cardTitle}>
            Weekly report
          </h2>
          {otherWeek && week ? <p className={styles.asideRange}>{`Week of ${week}`}</p> : null}
        </div>
        <SegmentedControl label="Report view" hideLabel size="small" options={MODES} selectedKey={mode} onSelectionChange={setMode} />
      </div>
      <div className={styles.asideBody}>
        {!weekly ? (
          <div aria-busy="true">
            <span role="status" className="visually-hidden">
              Loading the weekly report
            </span>
            <Skeleton lines={4} />
          </div>
        ) : (
          <>
            <Badge tone="neutral" className={styles.alignStart}>
              {weekly.hasDraft || !empty ? `Draft · saved on ${deviceName(app?.os)}` : 'No draft yet'}
            </Badge>
            <ReportProblems weekly={weekly} report={report} />
            {mode === 'preview' ? (
              <WeekBasis weekly={weekly} />
            ) : (
              <TextField
                label="Editable weekly status report"
                multiline
                rows={14}
                value={draft}
                onChange={report.edit}
                placeholder="Generate a draft, or write your update here."
                description={weekly.message ?? 'Edits are saved locally as you type.'}
                className={styles.asideEditor}
              />
            )}
            {mode === 'preview' && needsOutcomes(draft) && weekly.hasData ? (
              <p className={styles.hint}>Add outcomes before sharing. The draft only lists recorded time.</p>
            ) : null}
          </>
        )}
      </div>
      <div className={styles.asideFoot}>
        <Button
          size="small"
          isDisabled={!weekly?.hasData || weekly.loading}
          isPending={report.generating}
          onPress={() => void report.generate()}
        >
          {empty ? 'Generate' : 'Regenerate'}
        </Button>
        <div className={styles.buttonRow}>
          <Button size="small" isDisabled={empty} onPress={() => void report.copy()}>
            Copy
          </Button>
          <Button
            size="small"
            variant="primary"
            isDisabled={empty || report.exporting}
            isPending={report.exporting}
            onPress={() => void report.exportMarkdown()}
          >
            Export Markdown
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Loading, unconfigured and refusal states of the weekly report. */
export function ReportProblems({ weekly, report }: { weekly: WeeklySlice; report: WeeklyReport }) {
  const app = useSlice('app');
  return (
    <>
      {weekly.issue ? <Banner tone="warning">{weekly.issue}</Banner> : null}
      {weekly.storageIssue ? (
        <Banner tone="warning" title="Draft not saved">
          {weekly.storageIssue}
        </Banner>
      ) : null}
      {report.failure ? <Banner tone="error">{report.failure.message}</Banner> : null}
      {!weekly.configured && !app?.preview ? <p className={styles.muted}>Connect to 7pace in Settings to generate a draft.</p> : null}
      {!weekly.hasData && !weekly.loading && !weekly.issue && weekly.configured ? (
        <p className={styles.muted}>Refresh the week’s time to generate a draft.</p>
      ) : null}
    </>
  );
}

/** What the draft is based on: the week's time against its target and the tickets worked on. */
function WeekBasis({ weekly }: { weekly: WeeklySlice }) {
  const summary = weekly.summary;
  const colors = useActivityColors(summary?.activities.flatMap((activity) => (activity.activityId ? [activity.activityId] : [])) ?? []);
  if (!summary) {
    return weekly.loading ? (
      <p role="status" className={styles.muted}>
        Loading the week’s time…
      </p>
    ) : null;
  }
  return (
    <div className={styles.basis}>
      <div className={styles.basisGroup}>
        <h3 className={styles.basisTitle}>Time</h3>
        <p className={styles.muted}>
          {summary.targetSeconds > 0
            ? `${duration(summary.totalSeconds)} tracked · target ${duration(summary.targetSeconds)}`
            : `${duration(summary.totalSeconds)} tracked`}
        </p>
      </div>
      <div className={styles.basisGroup}>
        <h3 className={styles.basisTitle}>Worked on</h3>
        {summary.tickets.length > 0 ? (
          <ul role="list" aria-label="Time per ticket" className={styles.basisTickets}>
            {summary.tickets.map((ticket) => (
              <li key={`${ticket.ticketId ?? 'none'}-${ticket.title ?? ''}`} className={styles.basisTicket}>
                <ActivitySwatch colorIndex={activityColorIndex(colors, ticket.activityId)} />
                <span>
                  {ticket.ticketId !== null
                    ? `#${ticket.ticketId} ${ticket.title ?? 'Azure ticket'}`
                    : `${ticket.title ?? 'Work without an Azure ticket'} · no ticket`}
                </span>
                <span className={styles.basisTime}>{duration(ticket.seconds)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No recorded time in this week yet.</p>
        )}
      </div>
    </div>
  );
}
