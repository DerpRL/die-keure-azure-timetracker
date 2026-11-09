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
import { t, tn } from '../../../i18n';
import { figmaLabel } from '../figma/model';
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
    <Button size="small" trailingIcon={ChevronRightIcon} onPress={onPress} aria-label={t('Manage {source}', { source: label })}>
      {t('Manage')}
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
      description={t('Suggests Design tracking for linked files.')}
      actions={
        <>
          <ManageButton onPress={onOpen} label="Figma" />
          <Switch aria-label={t('Observe Figma files')} isSelected={preferences.enabled} onChange={(enabled) => apply({ ...preferences, enabled })}>
            {null}
          </Switch>
        </>
      }
    >
      <div className={styles.sourceRow}>
        <span className={styles.sourceMeta}>{tn(linked, '{count} linked file · reads only file names and window titles', '{count} linked files · reads only file names and window titles')}</span>
        {preferences.enabled && active ? (
          <span className={styles.activeRow}>
            <span className={styles.activeName}>{t('Active: {file}', { file: active })}</span>
            {activeFile?.ticketId != null ? <TicketLink ticketId={activeFile.ticketId} compact /> : null}
          </span>
        ) : (
          <Badge tone="neutral">{preferences.enabled ? (figma ? figmaLabel(figma) : t('Waiting for Figma')) : t('Observation is off')}</Badge>
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
      title={t('Calendars')}
      description={t('Shows events on Today and suggests Meeting tracking.')}
      actions={
        <>
          <ManageButton onPress={onOpen} label={t('Calendars')} />
          <Switch
            aria-label={t('Show my calendar on Today')}
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
          <span className={styles.sourceMeta}>{t('The calendar is off.')}</span>
        ) : agenda?.access !== 'authorized' ? (
          <span className={styles.sourceMeta}>{agenda ? calendarAccessText(agenda.access) : t('Loading calendars…')}</span>
        ) : (
          <>
            <ul role="list" aria-label={t('Calendars shown')} className={styles.swatches}>
              {shown.map((calendar) => (
                <li key={calendar.id}>
                  <span aria-hidden="true" className={styles.swatch} style={calendar.color ? { background: calendar.color } : undefined} />
                  {calendar.title}
                </li>
              ))}
            </ul>
            <span className={styles.sourceMeta}>{t('{count} of {total}', { count: shown.length, total: calendars.length })}</span>
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
      title={t('Calls')}
      description={t('Suggests Meeting tracking during calls without a calendar event.')}
      actions={
        <>
          <ManageButton onPress={onOpen} label={t('Calls')} />
          <Switch
            aria-label={t('Suggest tracking when a call app uses the microphone')}
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
            ? t('Not available on this system.')
            : t('{apps} · audio is never recorded', { apps: microphone.apps.map(microphoneAppLabel).join(', ') || t('No apps chosen') })}
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
      title: repositories?.watching ? t('Git · watching') : t('Git · paused'),
      detail: tn(repositoryCount, '{count} repository', '{count} repositories'),
    },
    ...(figmaShown
      ? [
          {
            id: 'figma',
            icon: FigmaSourceIcon,
            tone: figmaPreferences.enabled ? 'success' : 'neutral',
            title: figmaPreferences.enabled ? (figma?.currentFile ? t('Figma · observing') : t('Figma · waiting')) : t('Figma · off'),
            detail: figmaPreferences.enabled ? (figma ? figmaLabel(figma) : '') : t('Observation is off'),
          } satisfies StatusTile,
        ]
      : []),
    ...(calendars
      ? [
          {
            id: 'calendars',
            icon: CalendarSourceIcon,
            tone: draft.calendarEnabled && agenda?.access === 'authorized' ? 'success' : 'neutral',
            title: draft.calendarEnabled ? t('Calendars · on') : t('Calendars · off'),
            detail:
              calendarList.length > 0
                ? t('{count} of {total} calendars', { count: shownCalendars, total: calendarList.length })
                : t('No calendars yet'),
          } satisfies StatusTile,
        ]
      : []),
    {
      id: 'calls',
      icon: MicrophoneIcon,
      tone: draft.microphone.enabled ? 'success' : 'neutral',
      title: draft.microphone.enabled ? t('Calls · on') : t('Calls · off'),
      detail: tn(draft.microphone.apps.length, '{count} call app', '{count} call apps'),
    },
  ];
  return (
    <>
      <StatusTiles label={t('Sources status')} tiles={tiles} />
      <SourceCard
        icon={<GitIcon />}
        title={t('Git repositories')}
        description={t('Suggests the ticket of the branch you switch to.')}
        actions={
          <>
            <ManageButton onPress={open('git')} label={t('Git repositories')} />
            <WatchSwitch label={t('Watch Git repositories')} compact />
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
