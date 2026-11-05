import { useMemo, useState, type CSSProperties } from 'react';
import { useDateFormatter } from 'react-aria';
import { Badge, type Tone } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { CopyIcon, ExternalLinkIcon } from '../../components/icons';
import type { TicketContext, TicketLink as TicketLinkData, WorkLog } from '../../ipc/contract';
import { useNavigation } from '../../layout/NavigationContext';
import { useAction, useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { activityColor, useActivityColors } from '../activity';
import { isOpenableUrl, openExternalUrl } from './native';
import styles from './TicketContextSheet.module.css';

const FIELDS: ReadonlyArray<{ label: string; key: keyof Pick<TicketContext, 'assignedTo' | 'iteration' | 'tags' | 'project'> }> = [
  { label: 'Assigned to', key: 'assignedTo' },
  { label: 'Iteration', key: 'iteration' },
  { label: 'Tags', key: 'tags' },
];

/** Azure work item states that mean "being worked on" or "done", for the state chip's tone. */
function stateTone(state: string): Tone {
  const value = state.trim().toLowerCase();
  if (['active', 'in progress', 'committed', 'doing'].includes(value)) return 'success';
  if (['closed', 'done', 'resolved', 'removed'].includes(value)) return 'neutral';
  return 'info';
}

function TextSection({ title, text }: { title: string; text: string }) {
  const value = text.trim();
  return (
    <section className={styles.section}>
      <Heading level={3} className={styles.sectionTitle}>
        {title}
      </Heading>
      <p className={value ? styles.prose : styles.muted}>{value || 'No details provided.'}</p>
    </section>
  );
}

function RelatedLinks({ links }: { links: readonly TicketLinkData[] }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  if (links.length === 0) return null;
  return (
    <section className={styles.section}>
      <Heading level={3} className={styles.sectionTitle}>
        Links
      </Heading>
      <ul role="list" className={styles.links}>
        {links.map((link) => {
          const name = link.title || link.url;
          return (
            <li key={`${link.url}-${link.title}`}>
              {isOpenableUrl(link.url) ? (
                <button
                  type="button"
                  className={styles.link}
                  aria-label={`${name}, opens in your browser`}
                  onClick={() => {
                    setFailure(null);
                    openExternalUrl(link.url).catch((error: unknown) =>
                      setFailure(error instanceof Error ? error.message : String(error)),
                    );
                  }}
                >
                  <span className={styles.linkTitle}>{name}</span>
                  <ExternalLinkIcon className={styles.linkIcon} />
                </button>
              ) : (
                <div className={styles.unopenable}>
                  <span className={styles.unopenableText}>
                    <span className={styles.linkName}>{name}</span>
                    <span className={styles.unopenableNote}>{`${link.url} · only https links open from the app`}</span>
                  </span>
                  {navigator.clipboard ? (
                    <Button
                      size="small"
                      icon={CopyIcon}
                      aria-label={`Copy link ${name}`}
                      onPress={() => {
                        void navigator.clipboard.writeText(link.url).then(() => setCopied(link.url));
                      }}
                    >
                      {copied === link.url ? 'Copied' : 'Copy link'}
                    </Button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {failure ? (
        <Banner tone="warning" live="polite">
          {failure}
        </Banner>
      ) : null}
    </section>
  );
}

interface DayTime {
  day: string;
  label: string;
  seconds: number;
  activityId: string | null;
}

/** The ticket's worklogs the History slice has loaded (its range plus today), per local day. */
function useTicketTime(ticketId: number): { days: DayTime[]; total: number } {
  const history = useSlice('history');
  const format = useDateFormatter({ weekday: 'short', day: 'numeric', month: 'short' });
  return useMemo(() => {
    const seen = new Set<string>();
    const logs: WorkLog[] = [];
    for (const log of [...(history?.logs ?? []), ...(history?.todayLogs ?? [])]) {
      if (log.workItemId !== ticketId || seen.has(log.id)) continue;
      seen.add(log.id);
      logs.push(log);
    }
    const byDay = new Map<string, DayTime>();
    for (const log of logs) {
      const start = new Date(log.timestamp);
      const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
      const entry = byDay.get(key) ?? { day: key, label: format.format(start), seconds: 0, activityId: log.activityType?.id ?? null };
      entry.seconds += log.length;
      byDay.set(key, entry);
    }
    const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
    return { days, total: days.reduce((sum, day) => sum + day.seconds, 0) };
  }, [history?.logs, history?.todayLogs, ticketId, format]);
}

function YourTime({ ticketId }: { ticketId: number }) {
  const { days, total } = useTicketTime(ticketId);
  const colors = useActivityColors();
  if (days.length === 0) return null;
  const max = Math.max(...days.map((day) => day.seconds), 1);
  return (
    <section className={styles.yourTime} aria-labelledby={`your-time-${ticketId}`}>
      <div className={styles.yourTimeHead}>
        <Heading level={3} id={`your-time-${ticketId}`} className={styles.sectionTitle}>
          Your time on this ticket
        </Heading>
        <span className={styles.total}>{formatShortDuration(total)}</span>
      </div>
      <dl className={styles.days}>
        {days.map((day) => (
          <div key={day.day} className={styles.dayRow}>
            <dt className={styles.dayLabel}>{day.label}</dt>
            <dd className={styles.dayValue}>
              <span className={styles.bar} aria-hidden="true">
                <span
                  className={styles.barFill}
                  style={{ width: `${(day.seconds / max) * 100}%`, '--activity-color': activityColor(colors, day.activityId) } as CSSProperties}
                />
              </span>
              <span className={styles.dayDuration}>{formatShortDuration(day.seconds)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Facts({ details }: { details: TicketContext }) {
  return (
    <dl className={styles.facts}>
      {FIELDS.map(({ label, key }) => (
        <div key={key} className={styles.fact}>
          <dt>{label}</dt>
          <dd className={details[key].trim() ? undefined : styles.muted}>{details[key].trim() || 'Not set'}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Ticket details in a drawer over the main window (2.2 layout "S7 · Ticket context"), shown while
 * `ticketContext.ticketId` is set: type, state and number, assignee, iteration and tags, the
 * time you logged on it (from the loaded worklogs), description, acceptance criteria and links.
 * `TicketLink` opens it; Done sends `ticket.closeContext`.
 */
export function TicketContextSheet() {
  const context = useSlice('ticketContext');
  const navigation = useNavigation();
  const close = useAction();
  const azure = useAction();
  const reload = useAction();
  const ticketId = context?.ticketId ?? null;
  if (!context || ticketId === null) return null;

  const details = context.details?.id === ticketId ? context.details : null;
  const issue = context.issue ?? reload.error?.message ?? null;
  const closeContext = () => void close.run({ type: 'ticket.closeContext' });
  const showEntries = navigation?.canNavigate({ place: 'timesheet', view: 'list' }) ?? false;

  return (
    <Dialog
      isOpen
      onOpenChange={() => {}}
      onCancel={closeContext}
      title={details?.title || `Ticket #${ticketId}`}
      titleSize="large"
      presentation="drawer"
      showCloseButton
      cancelLabel={null}
      eyebrow={
        <>
          {details?.type ? <Badge tone="info">{details.type}</Badge> : null}
          {details?.state ? <Badge tone={stateTone(details.state)}>{details.state}</Badge> : null}
          <span className={styles.number}>{`#${ticketId}`}</span>
        </>
      }
      headerContent={details ? <Facts details={details} /> : null}
      secondaryActions={
        <Button
          icon={ExternalLinkIcon}
          isPending={azure.pending}
          onPress={() => void azure.run({ type: 'ticket.openInAzure', ticketId })}
        >
          Open in Azure DevOps
        </Button>
      }
      primaryAction={{ label: 'Done', onAction: closeContext }}
      footerExtra={
        showEntries ? (
          <Button
            onPress={() => {
              closeContext();
              navigation?.navigate({ place: 'timesheet', view: 'list' });
            }}
          >
            All entries
          </Button>
        ) : null
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
        <YourTime ticketId={ticketId} />
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
          {details ? (
            <div className={styles.details}>
              <TextSection title="Description" text={details.description} />
              <TextSection title="Acceptance criteria" text={details.acceptanceCriteria} />
              <RelatedLinks links={details.links} />
            </div>
          ) : null}
        </LoadingRegion>
      </div>
    </Dialog>
  );
}
