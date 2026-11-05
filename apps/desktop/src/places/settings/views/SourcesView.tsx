import { useId, type ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Switch } from '../../../components/Toggles';
import { useFigmaPreferences } from '../../../features/settings/FigmaSettings';
import { CalendarAccess, CalendarSwitches } from '../../../features/settings/MeetingsSections';
import { InlineIssue } from '../../../features/settings/SettingsSection';
import { useSettingsForm } from '../../../features/settings/SettingsForm';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import { useNavigation } from '../../../layout/NavigationContext';
import type { SettingsView } from '../../../layout/navigation';
import { useSlice } from '../../../state/hooks';
import { cx } from '../../../utils/cx';
import { RepositoriesPanel, WatchSwitch } from '../git';
import { CalendarSourceIcon, FigmaSourceIcon, GitIcon } from '../icons';
import styles from '../settings.module.css';

type Tone = 'git' | 'figma' | 'calendar';

interface SourceCardProps {
  icon: ReactNode;
  tone: Tone;
  title: string;
  description: string;
  actions?: ReactNode;
  /** The body runs edge to edge (lists with their own padding). */
  flush?: boolean;
  children: ReactNode;
}

/** A source: a tinted icon tile, its name and what it suggests, its switch, then its details. */
function SourceCard({ icon, tone, title, description, actions, flush = false, children }: SourceCardProps) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} padding="none" className={styles.sourceCard}>
      <div className={styles.sourceHeader}>
        <div className={styles.sourceTitle}>
          <span className={cx(styles.iconTile, styles[`tile-${tone}`])}>{icon}</span>
          <div className={styles.sourceText}>
            <h3 id={titleId} className={styles.sourceName}>
              {title}
            </h3>
            <p className={styles.sourceDescription}>{description}</p>
          </div>
        </div>
        {actions ? <div className={styles.sourceActions}>{actions}</div> : null}
      </div>
      <div className={flush ? styles.sourceBodyFlush : styles.sourceBody}>{children}</div>
    </Card>
  );
}

function FigmaCard({ onOpen }: { onOpen: () => void }) {
  const figma = useSlice('figma');
  const { preferences, apply, error } = useFigmaPreferences();
  const active = figma?.currentFile ?? null;
  const activeFile = active ? figma?.files.find((file) => file.name === active) : undefined;
  const linked = figma?.files.filter((file) => file.ticketId !== null).length ?? 0;
  return (
    <SourceCard
      icon={<FigmaSourceIcon />}
      tone="figma"
      title="Figma Desktop"
      description="Suggests Design tracking"
      actions={
        <Switch aria-label="Observe Figma files" isSelected={preferences.enabled} onChange={(enabled) => apply({ ...preferences, enabled })}>
          {null}
        </Switch>
      }
    >
      {preferences.enabled && active ? (
        <p className={styles.activeRow}>
          <span className={styles.activeName}>{`Active: ${active}`}</span>
          {activeFile?.ticketId != null ? <TicketLink ticketId={activeFile.ticketId} compact /> : null}
        </p>
      ) : (
        <p className={styles.activeRow}>
          <span className={styles.muted}>{preferences.enabled ? (figma?.label ?? 'Waiting for Figma') : 'Observation is off'}</span>
        </p>
      )}
      <p className={styles.sourceMeta}>
        {`${linked} linked ${linked === 1 ? 'file' : 'files'} · reads only file names and window titles · `}
        <Button variant="plain" size="small" className={styles.linkButton} onPress={onOpen}>
          Figma files and history
        </Button>
      </p>
      {error ? <InlineIssue>{error.message}</InlineIssue> : null}
    </SourceCard>
  );
}

function CalendarsCard({ onOpen }: { onOpen: () => void }) {
  const { draft } = useSettingsForm();
  const agenda = useSlice('agenda');
  return (
    <SourceCard icon={<CalendarSourceIcon />} tone="calendar" title="Calendars" description="Shown on Today, suggests Meeting tracking">
      {draft.calendarEnabled ? (
        <CalendarAccess>
          <CalendarSwitches calendars={agenda?.calendars ?? []} />
        </CalendarAccess>
      ) : (
        <p className={styles.sourceMeta}>
          {'The calendar is off. '}
          <Button variant="plain" size="small" className={styles.linkButton} onPress={onOpen}>
            Turn it on in Calendars
          </Button>
        </p>
      )}
    </SourceCard>
  );
}

/** Settings → Sources → Overview (design "S4 · Settings & sources"): Git, Figma and Calendars. */
export function SourcesView() {
  const navigation = useNavigation();
  const app = useSlice('app');
  const agenda = useSlice('agenda');
  const open = (view: SettingsView) => () => navigation?.navigate({ place: 'settings', view });
  const visible = (page: 'figma' | 'agenda') => navigation?.isPageVisible(page) ?? true;
  const calendars = (app?.features.calendar ?? true) && agenda?.supported !== false && visible('agenda');
  const figma = visible('figma');
  return (
    <>
      <SourceCard
        icon={<GitIcon />}
        tone="git"
        title="Git repositories"
        description="Suggests the ticket of the branch you switch to"
        actions={<WatchSwitch />}
        flush
      >
        <RepositoriesPanel variant="overview" onOpenGit={open('git')} />
      </SourceCard>
      {figma || calendars ? (
        <div className={styles.cols2}>
          {figma ? <FigmaCard onOpen={open('figma')} /> : null}
          {calendars ? <CalendarsCard onOpen={open('calendars')} /> : null}
        </div>
      ) : null}
    </>
  );
}
