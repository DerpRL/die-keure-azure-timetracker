import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Section } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import type { FigmaSlice } from '../../ipc/contract';
import { showMain } from '../../ipc/shell';
import { useAction } from '../../state/hooks';
import { formatSeen, localDay } from './model';
import styles from './figma.module.css';

/** The engine sends the newest 200 observations. */
export const HISTORY_LIMIT = 200;

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
      title="Context history"
      subtitle={`Local observations, not recorded hours. Kept for ${figma.preferences.historyDays} ${figma.preferences.historyDays === 1 ? 'day' : 'days'}, up to 5,000 observations.`}
      actions={
        <>
          <Button size="small" onPress={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={expanded ? listId : undefined}>
            {expanded ? 'Hide history' : 'Show history'}
          </Button>
          <Button size="small" isDisabled={history.length === 0} onPress={() => onConfirmingChange(true)}>
            Clear history…
          </Button>
        </>
      }
    >
      {expanded ? (
        history.length === 0 ? (
          <p id={listId} className={styles.text}>
            No observations yet.
          </p>
        ) : (
          <>
            <ol id={listId} role="list" aria-label="Figma observations, newest first" className={styles.history}>
              {history.map((event) => {
                const when = formatSeen(event.timestamp) ?? event.timestamp;
                return (
                  <li key={event.id} className={styles.event}>
                    <time dateTime={event.timestamp} className={styles.eventTime}>
                      {when}
                    </time>
                    <div>
                      <div>{event.name}</div>
                      {event.ticketId ? <div className={styles.text}>#{event.ticketId} at the time</div> : null}
                    </div>
                    <Button
                      size="small"
                      variant="plain"
                      onPress={() => void reviewDay(event.timestamp)}
                      aria-label={`Review day of ${when}`}
                    >
                      Review day
                    </Button>
                  </li>
                );
              })}
            </ol>
            {history.length >= HISTORY_LIMIT ? (
              <p className={styles.text}>Showing the latest {HISTORY_LIMIT} observations.</p>
            ) : null}
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
        title="Clear local Figma history?"
        description="Tracked hours, files and ticket links will stay."
        primaryAction={{ label: 'Clear history', variant: 'destructive', onAction: () => void confirmClear(), isPending: clear.pending }}
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
