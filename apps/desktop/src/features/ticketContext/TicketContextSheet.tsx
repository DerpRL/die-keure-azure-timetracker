import { useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ExternalLinkIcon } from '../../components/icons';
import type { TicketContext, TicketLink as TicketLinkData } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import { isOpenableUrl, openExternalUrl } from './native';
import styles from './TicketContextSheet.module.css';

const FIELDS: ReadonlyArray<{ label: string; key: keyof Pick<TicketContext, 'state' | 'type' | 'assignedTo' | 'project' | 'iteration' | 'tags'> }> = [
  { label: 'Status', key: 'state' },
  { label: 'Type', key: 'type' },
  { label: 'Assigned to', key: 'assignedTo' },
  { label: 'Project', key: 'project' },
  { label: 'Iteration', key: 'iteration' },
  { label: 'Tags', key: 'tags' },
];

function TextSection({ title, text }: { title: string; text: string }) {
  const value = text.trim();
  return (
    <div className={styles.section}>
      <Heading level={3} className={styles.sectionTitle}>
        {title}
      </Heading>
      <p className={value ? styles.prose : styles.muted}>{value || 'No details provided.'}</p>
    </div>
  );
}

function RelatedLinks({ links }: { links: readonly TicketLinkData[] }) {
  const [failure, setFailure] = useState<string | null>(null);
  if (links.length === 0) return null;
  return (
    <div className={styles.section}>
      <Heading level={3} className={styles.sectionTitle}>
        Related links
      </Heading>
      <ul role="list" className={styles.links}>
        {links.map((link) => (
          <li key={`${link.url}-${link.title}`}>
            {isOpenableUrl(link.url) ? (
              <Button
                variant="plain"
                size="small"
                trailingIcon={ExternalLinkIcon}
                onPress={() => {
                  setFailure(null);
                  openExternalUrl(link.url).catch((error: unknown) =>
                    setFailure(error instanceof Error ? error.message : String(error)),
                  );
                }}
                aria-label={`${link.title || link.url}, opens in your browser`}
              >
                {link.title || link.url}
              </Button>
            ) : (
              <span className={styles.unopenable}>
                {link.title || link.url}
                <span className={styles.muted}> · {link.url} (only https links open from the app)</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {failure ? (
        <Banner tone="warning" live="polite">
          {failure}
        </Banner>
      ) : null}
    </div>
  );
}

function Details({ details }: { details: TicketContext }) {
  return (
    <div className={styles.details}>
      <Heading level={3} className={styles.ticketTitle}>
        {details.title || `#${details.id}`}
      </Heading>
      <dl className={styles.fields}>
        {FIELDS.map(({ label, key }) => (
          <div key={key} className={styles.field}>
            <dt>{label}</dt>
            <dd className={details[key].trim() ? undefined : styles.muted}>{details[key].trim() || 'Not set'}</dd>
          </div>
        ))}
      </dl>
      <TextSection title="Description" text={details.description} />
      <TextSection title="Acceptance criteria" text={details.acceptanceCriteria} />
      <RelatedLinks links={details.links} />
    </div>
  );
}

/**
 * Ticket details over the main window (1.14 `TicketContextView`), shown while
 * `ticketContext.ticketId` is set. `TicketLink` opens it; Done sends `ticket.closeContext`.
 */
export function TicketContextSheet() {
  const context = useSlice('ticketContext');
  const close = useAction();
  const azure = useAction();
  const reload = useAction();
  const ticketId = context?.ticketId ?? null;
  if (!context || ticketId === null) return null;

  const details = context.details?.id === ticketId ? context.details : null;
  const issue = context.issue ?? reload.error?.message ?? null;

  return (
    <Dialog
      isOpen
      onOpenChange={() => {}}
      onCancel={() => void close.run({ type: 'ticket.closeContext' })}
      title="Ticket context"
      description={`#${ticketId}`}
      presentation="sheet"
      size="large"
      cancelLabel="Done"
      secondaryActions={
        <Button
          icon={ExternalLinkIcon}
          isPending={azure.pending}
          onPress={() => void azure.run({ type: 'ticket.openInAzure', ticketId })}
        >
          Open in Azure DevOps
        </Button>
      }
    >
      <div className={styles.body}>
        {azure.error ? (
          <Banner tone="error" live="polite">
            {azure.error.message}
          </Banner>
        ) : null}
        {issue ? (
          <Banner
            tone="warning"
            title="Ticket details are unavailable"
            actions={
              <Button
                size="small"
                isPending={reload.pending}
                onPress={() => void reload.run({ type: 'ticket.showContext', ticketId })}
              >
                Retry
              </Button>
            }
          >
            {issue}
          </Banner>
        ) : null}
        <LoadingRegion
          label="Loading ticket details…"
          isLoading={context.loading && !details}
          placeholder={
            <div className={styles.details}>
              <Skeleton width="60%" height="1.5rem" />
              <Skeleton lines={4} />
            </div>
          }
        >
          {details ? <Details details={details} /> : null}
        </LoadingRegion>
      </div>
    </Dialog>
  );
}
