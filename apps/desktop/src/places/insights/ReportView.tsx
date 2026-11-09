import type { CalendarDate } from '@internationalized/date';
import { useId, type ReactNode } from 'react';
import { Button, IconButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DatePicker } from '../../components/DateFields';
import { Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from '../../components/icons';
import { deviceName, formatClockTime, instantToDay, localToday, parseInstant } from '../../features/ticketContext/format';
import { t } from '../../i18n';
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
  useRefreshShortcut(report.refresh, { isDisabled: !weekly?.configured || loading, label: t('Refresh time') });

  if (!weekly) {
    return (
      <>
        <PlaceHeader title={t('Weekly report')} />
        {tabs}
        <div aria-busy="true" className={styles.stack}>
          <span role="status" className="visually-hidden">
            {t('Loading the weekly report')}
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
    weekly.hasDraft || !empty ? t('Draft saved on {device}', { device: deviceName(app?.os) }) : t('No draft yet'),
    loading ? t('loading time…') : synced ? t('time loaded {time}', { time: formatClockTime(synced) }) : null,
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
            <IconButton label={t('Previous week')} icon={ChevronLeftIcon} variant="secondary" onPress={() => report.move(-1)} />
            <IconButton label={t('Next week')} icon={ChevronRightIcon} variant="secondary" isDisabled={isFuture} onPress={() => report.move(1)} />
          </div>
        }
        after={
          isCurrent ? null : (
            <Button size="small" variant="plain" onPress={() => report.jumpTo(today.toString())}>
              {t('This week')}
            </Button>
          )
        }
        actions={
          <>
            <DatePicker<CalendarDate>
              label={t('Week of')}
              hideLabel
              className={styles.jumpTo}
              value={weekStart}
              maxValue={today}
              onChange={(value) => {
                if (value) report.jumpTo(value.toString());
              }}
            />
            <IconButton
              label={t('Refresh time')}
              icon={RefreshIcon}
              variant="secondary"
              shortcut={REFRESH_SHORTCUT}
              isPending={loading}
              isDisabled={!weekly.configured}
              onPress={report.refresh}
            />
            <Button isDisabled={!weekly.hasData || loading} isPending={report.generating} onPress={() => void report.generate()}>
              {empty ? t('Generate from time') : t('Regenerate from time')}
            </Button>
            <Button isDisabled={empty} onPress={() => void report.copy()}>
              {t('Copy')}
            </Button>
            <Button variant="primary" isDisabled={empty || report.exporting} isPending={report.exporting} onPress={() => void report.exportMarkdown()}>
              {t('Export Markdown…')}
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
              {t('Edit')}
            </h2>
            <span className={styles.muted}>Markdown</span>
          </div>
          <TextField
            label={t('Editable weekly status report')}
            hideLabel
            multiline
            rows={24}
            value={draft}
            onChange={report.edit}
            placeholder={t('Generate a draft, or write your update here.')}
            className={styles.reportEditor}
          />
        </Card>
        <Card as="section" aria-labelledby={previewId} padding="none" className={styles.reportCard}>
          <div className={styles.reportHead}>
            <h2 id={previewId} className={styles.cardTitle}>
              {t('Preview')}
            </h2>
            <span className={styles.muted}>{t('As it looks when pasted')}</span>
          </div>
          <div className={styles.reportPreview}>
            {empty ? <p className={styles.muted}>{t('Generate a draft from the week’s time, or write your update.')}</p> : <MarkdownPreview source={draft} />}
            <p className={styles.reportFootnote}>
              {weekly.message ?? t('Edits are saved locally as you type. Nothing is sent automatically.')}
            </p>
          </div>
        </Card>
      </div>
      {weekly.summary ? (
        <Extras id="weekSoFar" title={t('Week so far')} summary={t('The total, tickets and days the draft is based on')}>
          <WeekSoFar summary={weekly.summary} />
        </Extras>
      ) : null}
      {report.confirmation}
    </>
  );
}
