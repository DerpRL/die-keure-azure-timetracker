import { useEffect, useId, useRef, useState } from 'react';
import { announce } from '../../components/Announcer';
import { Banner } from '../../components/Banner';
import { Section } from '../../components/Card';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import type { FigmaSlice } from '../../ipc/contract';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { ContextHistory } from './ContextHistory';
import { FileRegister } from './FileRegister';
import { formatSeen } from './model';
import { ObservationSection } from './ObservationSection';
import { SuggestionCard } from './SuggestionCard';
import styles from './figma.module.css';

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

/** "Last worked in Figma": the most recently worked linked ticket and its files. */
function LastWorked({ figma }: { figma: FigmaSlice }) {
  const ticketId = figma.lastWorkedTicket;
  if (ticketId === null) return null;
  const files = figma.files
    .filter((file) => file.ticketId === ticketId)
    .sort((left, right) => (right.lastSeen ?? '').localeCompare(left.lastSeen ?? ''));
  const title = files.find((file) => file.ticketTitle)?.ticketTitle;
  return (
    <Section title="Last worked in Figma" subtitle="Based on the most recently seen linked file.">
      <p className={styles.ticket}>
        <TicketLink ticketId={ticketId} title={title ?? undefined} />
      </p>
      {files.length > 0 ? (
        <ul role="list" aria-label="Files linked to this ticket" className={styles.lastWorked}>
          {files.map((file) => (
            <li key={file.key}>
              <span>{file.name}</span>
              {file.lastSeen ? (
                <time dateTime={file.lastSeen} className={styles.text}>
                  {formatSeen(file.lastSeen)}
                </time>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

/** Figma page (1.14 `FigmaView`): observation, suggestions, file register and context history. */
export default function FigmaPage() {
  const figma = useSlice('figma');
  const app = useSlice('app');
  const repositories = useSlice('repositories');
  const toggle = useAction();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const suggestionsId = useId();
  useSuggestionAnnouncements(figma);

  const enabled = figma?.preferences.enabled ?? false;
  useCommands([
    {
      id: 'figma.toggleObservation',
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
  const watching = repositories?.watching ?? true;

  return (
    <div className={styles.page}>
      <p className={styles.intro}>Your files, ticket links and recent design context.</p>
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
      <ObservationSection figma={figma} watching={watching} titleOnly={titleOnly} />
      {figma.suggestions.length > 0 ? (
        <section aria-labelledby={suggestionsId} className={styles.page}>
          <h2 id={suggestionsId} className={styles.sectionTitle}>
            Suggested from Figma
          </h2>
          {figma.suggestions.map((prompt) => (
            <SuggestionCard key={prompt.suggestion.id} prompt={prompt} />
          ))}
        </section>
      ) : null}
      <LastWorked figma={figma} />
      <FileRegister figma={figma} titleOnly={titleOnly} />
      <ContextHistory figma={figma} confirming={confirmingClear} onConfirmingChange={setConfirmingClear} />
    </div>
  );
}
