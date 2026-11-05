import type { CalendarDate } from '@internationalized/date';
import { useId, type ReactNode } from 'react';
import { Button, IconButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from '../../components/icons';
import { deviceName, formatClockTime, instantToDay, localToday, parseInstant } from '../../features/ticketContext/format';
import { PlaceHeader } from '../../layout/Place';
import { REFRESH_SHORTCUT } from '../../layout/PageHeader';
import { rangeTitle } from './explore/format';
import { WeekSoFar } from './report/WeekSoFar';
import { useRefreshShortcut } from '../../shortcuts/hooks';
import { useSlice } from '../../state/hooks';
import { Extras } from './Extras';
import { MarkdownPreview } from './markdown';
import styles from './insights.module.css';
import { useWeeklyReport } from './useWeeklyReport';
import { ReportProblems } from './WeeklyAside';

/**
 * Weekly report (2.2 "S3c · Insights — Weekly report"): the week, Regenerate from time / Copy /
 * Export Markdown…, the Markdown draft next to its preview, and the week so far below. Drafts are
 * saved on this device as you type; nothing is sent automatically.
 */
export function ReportView({ tabs }: { tabs?: ReactNode }) {
  const report = useWeeklyReport({ commands: true });
  const app = useSlice('app');
  const editId = useId();
  const previewId = useId();
  const { weekly, draft, empty } = report;
  const loading = weekly?.loading ?? false;
  useRefreshShortcut(report.refresh, { isDisabled: !weekly?.configured || loading, label: 'Refresh time' });

  if (!weekly) {
    return (
      <>
        <PlaceHeader title="Weekly report" />
        {tabs}
        <div aria-busy="true" className={styles.stack}>
          <span role="status" className="visually-hidden">
            Loading the weekly report
          </span>
          <Skeleton lines={2} />
          <Skeleton shape="rect" height="20rem" />
        </div>
      </>
    );
  }

  const today = localToday();
  const weekStart = instantToDay(weekly.range.start);
  const weekEnd = instantToDay(weekly.range.end);
  const isFuture = !weekEnd || weekEnd.compare(today) > 0;
  const isCurrent = !!weekStart && !!weekEnd && weekStart.compare(today) <= 0 && weekEnd.compare(today) > 0;
  const synced = parseInstant(weekly.syncedAt);
  const status = [
    weekly.hasDraft || !empty ? `Draft saved on ${deviceName(app?.os)}` : 'No draft yet',
    loading ? 'loading time…' : synced ? `time loaded ${formatClockTime(synced)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PlaceHeader
        title={rangeTitle('week', weekly.range)}
        subtitle={<span role="status">{status}</span>}
        before={
          <div className={styles.stepper}>
            <IconButton label="Previous week" icon={ChevronLeftIcon} variant="secondary" onPress={() => report.move(-1)} />
            <IconButton label="Next week" icon={ChevronRightIcon} variant="secondary" isDisabled={isFuture} onPress={() => report.move(1)} />
          </div>
        }
        after={
          isCurrent ? null : (
            <Button size="small" variant="plain" onPress={() => report.jumpTo(today.toString())}>
              This week
            </Button>
          )
        }
        actions={
          <>
            <DatePicker<CalendarDate>
              label="Week of"
              hideLabel
              className={styles.jumpTo}
              value={weekStart}
              maxValue={today}
              onChange={(value) => {
                if (value) report.jumpTo(value.toString());
              }}
            />
            <IconButton
              label="Refresh time"
              icon={RefreshIcon}
              variant="secondary"
              shortcut={REFRESH_SHORTCUT}
              isPending={loading}
              isDisabled={!weekly.configured}
              onPress={report.refresh}
            />
            <Button isDisabled={!weekly.hasData || loading} isPending={report.generating} onPress={() => void report.generate()}>
              {empty ? 'Generate from time' : 'Regenerate from time'}
            </Button>
            <Button isDisabled={empty} onPress={() => void report.copy()}>
              Copy
            </Button>
            <Button variant="primary" isDisabled={empty || report.exporting} isPending={report.exporting} onPress={() => void report.exportMarkdown()}>
              Export Markdown…
            </Button>
          </>
        }
      />
      {tabs}
      <ReportProblems weekly={weekly} report={report} />
      <div className={styles.reportGrid}>
        <Card as="section" aria-labelledby={editId} padding="none" className={styles.reportCard}>
          <div className={styles.reportHead}>
            <h2 id={editId} className={styles.cardTitle}>
              Edit
            </h2>
            <span className={styles.muted}>Markdown</span>
          </div>
          <TextField
            label="Editable weekly status report"
            hideLabel
            multiline
            rows={24}
            value={draft}
            onChange={report.edit}
            placeholder="Generate a draft, or write your update here."
            className={styles.reportEditor}
          />
        </Card>
        <Card as="section" aria-labelledby={previewId} padding="none" className={styles.reportCard}>
          <div className={styles.reportHead}>
            <h2 id={previewId} className={styles.cardTitle}>
              Preview
            </h2>
            <span className={styles.muted}>As it looks when pasted</span>
          </div>
          <div className={styles.reportPreview}>
            {empty ? <p className={styles.muted}>Generate a draft from the week’s time, or write your update.</p> : <MarkdownPreview source={draft} />}
            <p className={styles.reportFootnote}>
              {weekly.message ?? 'Edits are saved locally as you type. Nothing is sent automatically.'}
            </p>
          </div>
        </Card>
      </div>
      {weekly.summary ? (
        <Extras id="weekSoFar" title="Week so far" summary="The total, tickets and days the draft is based on">
          <WeekSoFar summary={weekly.summary} />
        </Extras>
      ) : null}
      {report.confirmation}
    </>
  );
}
