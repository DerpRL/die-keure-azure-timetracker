import { useId, type ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Switch } from '../../../components/Toggles';
import { useFigmaPreferences } from '../../../features/settings/FigmaSettings';
import { calendarShown } from '../../../features/settings/MeetingsSections';
import { calendarAccessText, microphoneAppLabel } from '../../../features/settings/labels';
import { MicrophoneIcon } from '../../../features/settings/icons';
import { StatusTiles, type StatusTile } from '../../../features/settings/StatusTiles';
import { Badge } from '../../../components/Badge';
import { ChevronRightIcon } from '../../../components/icons';
import { InlineIssue } from '../../../features/settings/SettingsSection';
import { useSettingsForm } from '../../../features/settings/SettingsForm';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import { useNavigation } from '../../../layout/NavigationContext';
import type { SettingsView } from '../../../layout/navigation';
import { useSlice } from '../../../state/hooks';
import { RepositoriesPanel, WatchSwitch } from '../git';
import { CalendarSourceIcon, FigmaSourceIcon, GitIcon } from '../icons';
import styles from '../settings.module.css';

interface SourceCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  /** The body runs edge to edge (lists with their own padding). */
  flush?: boolean;
  children: ReactNode;
}

/** A source: a tinted icon tile, its name and what it suggests, its switch, then its details. */
function SourceCard({ icon, title, description, actions, flush = false, children }: SourceCardProps) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} padding="none" className={styles.sourceCard}>
      <div className={styles.sourceHeader}>
        <div className={styles.sourceTitle}>
          <span className={styles.iconTile}>{icon}</span>
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

/** A card's "Manage" link to the source's own view. */
function ManageButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Button size="small" trailingIcon={ChevronRightIcon} onPress={onPress} aria-label={`Manage ${label}`}>
      Manage
    </Button>
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
      title="Figma"
      description="Suggests Design tracking for linked files."
      actions={
        <>
          <ManageButton onPress={onOpen} label="Figma" />
          <Switch aria-label="Observe Figma files" isSelected={preferences.enabled} onChange={(enabled) => apply({ ...preferences, enabled })}>
            {null}
          </Switch>
        </>
      }
    >
      <div className={styles.sourceRow}>
        <span className={styles.sourceMeta}>{`${linked} linked ${linked === 1 ? 'file' : 'files'} · reads only file names and window titles`}</span>
        {preferences.enabled && active ? (
          <span className={styles.activeRow}>
            <span className={styles.activeName}>{`Active: ${active}`}</span>
            {activeFile?.ticketId != null ? <TicketLink ticketId={activeFile.ticketId} compact /> : null}
          </span>
        ) : (
          <Badge tone="neutral">{preferences.enabled ? (figma?.label ?? 'Waiting for Figma') : 'Observation is off'}</Badge>
        )}
      </div>
      {error ? (
        <div className={styles.sourceRow}>
          <InlineIssue>{error.message}</InlineIssue>
        </div>
      ) : null}
    </SourceCard>
  );
}

function CalendarsCard({ onOpen }: { onOpen: () => void }) {
  const { draft, update } = useSettingsForm();
  const agenda = useSlice('agenda');
  const calendars = agenda?.calendars ?? [];
  const shown = calendars.filter((calendar) => calendarShown(draft.selectedCalendarIds, calendar.id));
  return (
    <SourceCard
      icon={<CalendarSourceIcon />}
      title="Calendars"
      description="Shows events on Today and suggests Meeting tracking."
      actions={
        <>
          <ManageButton onPress={onOpen} label="Calendars" />
          <Switch
            aria-label="Show my calendar on Today"
            isSelected={draft.calendarEnabled}
            onChange={(calendarEnabled) => update((current) => ({ ...current, calendarEnabled }))}
          >
            {null}
          </Switch>
        </>
      }
    >
      <div className={styles.sourceRow}>
        {!draft.calendarEnabled ? (
          <span className={styles.sourceMeta}>The calendar is off.</span>
        ) : agenda?.access !== 'authorized' ? (
          <span className={styles.sourceMeta}>{agenda ? calendarAccessText(agenda.access) : 'Loading calendars…'}</span>
        ) : (
          <>
            <ul role="list" aria-label="Calendars shown" className={styles.swatches}>
              {shown.map((calendar) => (
                <li key={calendar.id}>
                  <span aria-hidden="true" className={styles.swatch} style={calendar.color ? { background: calendar.color } : undefined} />
                  {calendar.title}
                </li>
              ))}
            </ul>
            <span className={styles.sourceMeta}>{`${shown.length} of ${calendars.length}`}</span>
          </>
        )}
      </div>
    </SourceCard>
  );
}

function CallsCard({ onOpen }: { onOpen: () => void }) {
  const { draft, update, settings, app } = useSettingsForm();
  const microphone = draft.microphone;
  const unavailable = app?.features.microphone === false || !settings.microphone.supported;
  return (
    <SourceCard
      icon={<MicrophoneIcon />}
      title="Calls"
      description="Suggests Meeting tracking during calls without a calendar event."
      actions={
        <>
          <ManageButton onPress={onOpen} label="Calls" />
          <Switch
            aria-label="Suggest tracking when a call app uses the microphone"
            isSelected={microphone.enabled}
            isDisabled={unavailable}
            onChange={(enabled) => update((current) => ({ ...current, microphone: { ...current.microphone, enabled } }))}
          >
            {null}
          </Switch>
        </>
      }
    >
      <div className={styles.sourceRow}>
        <span className={styles.sourceMeta}>
          {unavailable
            ? 'Not available on this system.'
            : `${microphone.apps.map(microphoneAppLabel).join(', ') || 'No apps chosen'} · audio is never recorded`}
        </span>
      </div>
    </SourceCard>
  );
}

/** Settings → Sources → Overview (design "S4"): Git, Figma, Calendars and Calls, with their status. */
export function SourcesView() {
  const navigation = useNavigation();
  const app = useSlice('app');
  const agenda = useSlice('agenda');
  const repositories = useSlice('repositories');
  const figma = useSlice('figma');
  const figmaPreferences = useFigmaPreferences().preferences;
  const { draft } = useSettingsForm();
  const open = (view: SettingsView) => () => navigation?.navigate({ place: 'settings', view });
  const visible = (page: 'figma' | 'agenda') => navigation?.isPageVisible(page) ?? true;
  const calendars = (app?.features.calendar ?? true) && agenda?.supported !== false && visible('agenda');
  const figmaShown = visible('figma');
  const repositoryCount = repositories?.repositories.length ?? 0;
  const calendarList = agenda?.calendars ?? [];
  const shownCalendars = calendarList.filter((calendar) => calendarShown(draft.selectedCalendarIds, calendar.id)).length;
  const tiles: StatusTile[] = [
    {
      id: 'git',
      icon: GitIcon,
      tone: repositories?.watching ? 'success' : 'neutral',
      title: `Git · ${repositories?.watching ? 'watching' : 'paused'}`,
      detail: `${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}`,
    },
    ...(figmaShown
      ? [
          {
            id: 'figma',
            icon: FigmaSourceIcon,
            tone: figmaPreferences.enabled ? 'success' : 'neutral',
            title: `Figma · ${figmaPreferences.enabled ? (figma?.currentFile ? 'observing' : 'waiting') : 'off'}`,
            detail: figmaPreferences.enabled ? (figma?.label ?? '') : 'Observation is off',
          } satisfies StatusTile,
        ]
      : []),
    ...(calendars
      ? [
          {
            id: 'calendars',
            icon: CalendarSourceIcon,
            tone: draft.calendarEnabled && agenda?.access === 'authorized' ? 'success' : 'neutral',
            title: `Calendars · ${draft.calendarEnabled ? 'on' : 'off'}`,
            detail: calendarList.length > 0 ? `${shownCalendars} of ${calendarList.length} calendars` : 'No calendars yet',
          } satisfies StatusTile,
        ]
      : []),
    {
      id: 'calls',
      icon: MicrophoneIcon,
      tone: draft.microphone.enabled ? 'success' : 'neutral',
      title: `Calls · ${draft.microphone.enabled ? 'on' : 'off'}`,
      detail: `${draft.microphone.apps.length} call ${draft.microphone.apps.length === 1 ? 'app' : 'apps'}`,
    },
  ];
  return (
    <>
      <StatusTiles label="Sources status" tiles={tiles} />
      <SourceCard
        icon={<GitIcon />}
        title="Git repositories"
        description="Suggests the ticket of the branch you switch to."
        actions={
          <>
            <ManageButton onPress={open('git')} label="Git repositories" />
            <WatchSwitch label="Watch Git repositories" compact />
          </>
        }
        flush
      >
        <RepositoriesPanel variant="overview" onOpenGit={open('git')} />
      </SourceCard>
      {figmaShown ? <FigmaCard onOpen={open('figma')} /> : null}
      {calendars ? <CalendarsCard onOpen={open('calendars')} /> : null}
      <CallsCard onOpen={open('meetings')} />
    </>
  );
}
