import { useId, useState } from 'react';
import { Button } from '../../../components/Button';
import { Section } from '../../../components/Card';
import { Dialog } from '../../../components/Dialog';
import type { FigmaSlice } from '../../../ipc/contract';
import { showMain } from '../../../ipc/shell';
import { useAction } from '../../../state/hooks';
import { formatSeen, localDay } from './model';
import { numberFormat, t, tn } from '../../../i18n';
import styles from './figma.module.css';

export interface ContextHistoryProps {
  figma: FigmaSlice;
  /** Controlled so the palette's "Clear Figma history…" opens the same confirmation. */
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
}

/** "Context history" (1.14 `FigmaView`): local observations, newest first, with Review day and Clear. */
export function ContextHistory({ figma, confirming, onConfirmingChange }: ContextHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const clear = useAction();
  const review = useAction();
  const listId = useId();
  const { history } = figma;

  const reviewDay = async (timestamp: string) => {
    const day = localDay(timestamp);
    if (!day) return;
    const result = await review.run({ type: 'dayReview.setDay', day });
    if (result.ok) await showMain('dayReview').catch(() => undefined);
  };

  const confirmClear = async () => {
    const result = await clear.run({ type: 'figma.clearHistory' });
    if (result.ok) onConfirmingChange(false);
  };

  return (
    <Section
      headingLevel={3}
      className={styles.historyCard}
      title={t('Context history')}
      subtitle={tn(
        figma.preferences.historyDays,
        'Local observations, not recorded hours. Kept for {count} day, up to {limit} observations.',
        'Local observations, not recorded hours. Kept for {count} days, up to {limit} observations.',
        { limit: numberFormat().format(5000) },
      )}
      actions={
        <>
          <Button onPress={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={expanded ? listId : undefined}>
            {expanded ? t('Hide history') : t('Show history')}
          </Button>
          <Button variant="plain" className={styles.danger} isDisabled={history.length === 0} onPress={() => onConfirmingChange(true)}>
            {t('Clear history…')}
          </Button>
        </>
      }
    >
      {expanded ? (
        history.length === 0 ? (
          <p id={listId} className={styles.text}>
            {t('No observations yet.')}
          </p>
        ) : (
          <>
            <ol id={listId} role="list" aria-label={t('Figma observations, newest first')} className={styles.history}>
              {history.map((event) => {
                const when = formatSeen(event.timestamp) ?? event.timestamp;
                return (
                  <li key={event.id} className={styles.event}>
                    <time dateTime={event.timestamp} className={styles.eventTime}>
                      {when}
                    </time>
                    <div>
                      <div>{event.name}</div>
                      {event.ticketId ? <div className={styles.text}>{t('#{id} at the time', { id: event.ticketId })}</div> : null}
                    </div>
                    <Button
                      size="small"
                      variant="plain"
                      onPress={() => void reviewDay(event.timestamp)}
                      aria-label={t('Review day of {date}', { date: when })}
                    >
                      {t('Review day')}
                    </Button>
                  </li>
                );
              })}
            </ol>
            {figma.historyCount > history.length ? <p className={styles.text}>{t('Showing the latest {count} observations.', { count: history.length })}</p> : null}
          </>
        )
      ) : null}
      {review.error ? (
        <p role="alert" className={styles.error}>
          {review.error.message}
        </p>
      ) : null}
      <Dialog
        isOpen={confirming}
        onOpenChange={(open) => {
          if (!open) {
            onConfirmingChange(false);
            clear.clearError();
          }
        }}
        role="alertdialog"
        size="small"
        title={t('Clear local Figma history?')}
        description={t('Tracked hours, files and ticket links will stay.')}
        primaryAction={{ label: t('Clear history'), variant: 'destructive', onAction: () => void confirmClear(), isPending: clear.pending }}
      >
        {clear.error ? (
          <p role="alert" className={styles.error}>
            {clear.error.message}
          </p>
        ) : null}
      </Dialog>
    </Section>
  );
}
