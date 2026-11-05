import { useEffect, useId, useRef, useState } from 'react';
import { announce } from '../../../components/Announcer';
import { Banner } from '../../../components/Banner';
import { Section } from '../../../components/Card';
import { LoadingRegion, Skeleton } from '../../../components/EmptyState';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import type { FigmaSlice } from '../../../ipc/contract';
import { useCommands } from '../../../shortcuts/hooks';
import { useAction, useSlice } from '../../../state/hooks';
import { cx } from '../../../utils/cx';
import { ContextHistory } from './ContextHistory';
import { FileRegister } from './FileRegister';
import { formatSeen } from './model';
import { FigmaTiles, ObservationSection } from './ObservationSection';
import { SuggestionCard } from './SuggestionCard';
import styles from './figma.module.css';
import { FigmaIcon, TrashIcon } from '../../../components/icons';

/** Announces suggestions that arrive while the page is open (not the ones already shown). */
function useSuggestionAnnouncements(figma: FigmaSlice | undefined) {
  const known = useRef<Set<string> | null>(null);
  const ids = figma?.suggestions.map((prompt) => prompt.suggestion.id).join('\n') ?? null;
  useEffect(() => {
    if (!figma || ids === null) return;
    const previous = known.current;
    known.current = new Set(figma.suggestions.map((prompt) => prompt.suggestion.id));
    if (!previous) return;
    const fresh = figma.suggestions.filter((prompt) => !previous.has(prompt.suggestion.id));
    if (fresh[0]) announce(`Figma file active: ${fresh[0].suggestion.name}. Start Design is available.`);
    // `ids` captures the suggestion list; the slice object changes for unrelated reasons too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
}

/** "Last worked in Figma": the most recently worked linked ticket and its files (from the engine). */
function LastWorked({ figma, className }: { figma: FigmaSlice; className?: string }) {
  const ticketId = figma.lastWorkedTicket;
  if (ticketId === null) return null;
  const files = figma.lastWorked;
  const title = files.find((file) => file.ticketTitle)?.ticketTitle;
  return (
    <Section headingLevel={3} title="Last worked in Figma" subtitle="Based on the most recently seen linked file." className={className}>
      <div className={styles.lastWorkedBox}>
        <span className={styles.pill} aria-hidden="true" />
        <div className={styles.lastWorkedMain}>
          {files.length > 0 ? (
            <ul role="list" aria-label="Files linked to this ticket" className={styles.lastWorked}>
              {files.map((file) => (
                <li key={file.key}>
                  <span className={styles.lastWorkedName}>{file.name}</span>
                  {file.lastSeen ? (
                    <time dateTime={file.lastSeen} className={styles.seen}>
                      {formatSeen(file.lastSeen)}
                    </time>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className={styles.ticket}>
            <TicketLink ticketId={ticketId} title={title ?? undefined} />
          </p>
        </div>
      </div>
    </Section>
  );
}

/** Settings → Figma (1.14 `FigmaView`): observation, suggestions, file register and context history. */
export function FigmaPanel() {
  const figma = useSlice('figma');
  const app = useSlice('app');
  const toggle = useAction();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const suggestionsId = useId();
  useSuggestionAnnouncements(figma);

  const enabled = figma?.preferences.enabled ?? false;
  useCommands([
    {
      id: 'figma.toggleObservation',
      icon: FigmaIcon,
      label: enabled ? 'Stop observing Figma files' : 'Observe Figma files',
      group: 'Actions',
      keywords: ['figma', 'design'],
      isDisabled: !figma || toggle.pending,
      onAction: () => {
        if (figma) void toggle.run({ type: 'figma.setPreferences', preferences: { ...figma.preferences, enabled: !enabled } });
      },
    },
    {
      id: 'figma.clearHistory',
      icon: TrashIcon,
      label: 'Clear Figma history…',
      group: 'Actions',
      keywords: ['figma', 'context'],
      isDisabled: !figma || figma.history.length === 0,
      onAction: () => setConfirmingClear(true),
    },
  ]);

  if (!figma) {
    return (
      <LoadingRegion label="Loading Figma context" isLoading placeholder={<Skeleton lines={6} />}>
        {null}
      </LoadingRegion>
    );
  }

  const titleOnly = figma.titleOnly || (app?.features.figmaTitleOnly ?? false);
  const hasSuggestions = figma.suggestions.length > 0;
  const hasLastWorked = figma.lastWorkedTicket !== null;

  return (
    <div className={styles.page}>
      {figma.storageIssue ? (
        <Banner tone="warning" title="Figma context could not be saved" live="off">
          {figma.storageIssue}
        </Banner>
      ) : null}
      {toggle.error ? (
        <Banner tone="error" onDismiss={toggle.clearError} dismissLabel="Dismiss error">
          {toggle.error.message}
        </Banner>
      ) : null}
      <FigmaTiles figma={figma} titleOnly={titleOnly} />
      <ObservationSection figma={figma} titleOnly={titleOnly} />
      {hasSuggestions || hasLastWorked ? (
        <div className={cx(styles.pair, hasSuggestions && hasLastWorked && styles.pairSplit)}>
          {hasSuggestions ? (
            <section aria-labelledby={suggestionsId} className={styles.suggestions}>
              <h3 id={suggestionsId} className={styles.sectionTitle}>
                Suggested from Figma
              </h3>
              <div className={styles.suggestionCards}>
                {figma.suggestions.map((prompt) => (
                  <SuggestionCard key={prompt.suggestion.id} prompt={prompt} />
                ))}
              </div>
            </section>
          ) : null}
          <LastWorked figma={figma} className={styles.lastWorkedCard} />
        </div>
      ) : null}
      <FileRegister figma={figma} titleOnly={titleOnly} />
      <ContextHistory figma={figma} confirming={confirmingClear} onConfirmingChange={setConfirmingClear} />
    </div>
  );
}
