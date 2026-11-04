import { useEffect, useId, useRef, useState } from 'react';
import { useDateFormatter } from 'react-aria';
import { Button } from '../../components/Button';
import { Card, Section } from '../../components/Card';
import { PlusIcon } from '../../components/icons';
import { PageHeaderActions, PageRefresh } from '../../features/app/PageHeaderActions';
import { ConnectionDetails } from '../../features/connection/ConnectionDetails';
import { TargetProgress } from '../../features/progress/TargetProgress';
import { PromptList, usePromptAnnouncements, usePromptItems } from '../../features/prompts/PromptList';
import { useIntents, useWriteGuards } from '../../features/tracking/actions';
import { CurrentTracking, LocalTimer, useLocalTimerTitle } from '../../features/tracking/CurrentTracking';
import { useFocusRecovery } from '../../features/tracking/focus';
import { PrivacyIcon, SetupIcon } from '../../features/tracking/icons';
import { openMainPage } from '../../features/tracking/platform';
import { useTrackingAnnouncements } from '../../features/tracking/status';
import { useSlice } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { TodayLogs } from './TodayLogs';
import styles from './overview.module.css';

/** "A little setup. A lot less forgotten time." until 7pace is connected. */
function SetupCard() {
  return (
    <Card className={styles.setup}>
      <SetupIcon className={styles.setupIcon} />
      <div className={styles.setupText}>
        <h2 className={styles.setupTitle}>A little setup. A lot less forgotten time.</h2>
        <p className={styles.caption}>
          Connect 7pace, add your Azure PAT, and your branches will bring the right ticket to you.
        </p>
      </div>
      <Button variant="primary" onPress={() => openMainPage('settings')}>
        Set up accounts
      </Button>
    </Card>
  );
}

/** Where focus goes when a resolved prompt takes the focused button with it. */
const FOCUS_FALLBACKS = ['[data-prompt-primary]:not([disabled])', '[data-current-primary]:not([disabled])'] as const;

/** ISO 8601 week number (weeks start on Monday, week 1 holds the first Thursday). */
export function isoWeek(date: Date): number {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * "TODAY / Tuesday 6 October" with today's target and the week number on the right, updated once
 * a minute so it turns over at midnight.
 */
function TodayLine() {
  const progress = useSlice('progress');
  const [now, setNow] = useState(() => Date.now());
  const date = useDateFormatter({ weekday: 'long', day: 'numeric', month: 'long' });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const today = new Date(now);
  const target = progress?.todayTarget ?? 0;
  return (
    <div className={styles.today}>
      <p className={styles.todayText}>
        <span className={styles.todayLabel}>Today</span> <span className={styles.todayDate}>{date.format(today)}</span>
      </p>
      <p className={styles.caption}>
        {target > 0 ? `Daily target ${formatShortDuration(target)} · ` : ''}
        {`week ${isoWeek(today)}`}
      </p>
    </div>
  );
}

/** Header actions: Track a ticket (the picker sheet) and Refresh (⌘R / Ctrl+R). */
function OverviewHeader() {
  const connection = useSlice('connection');
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  return (
    <>
      <PageRefresh
        onRefresh={() => void actions.run('refresh', { type: 'connection.refresh' })}
        isRefreshing={actions.isPending('refresh')}
        isDisabled={busy || !connection?.hasSevenPaceToken}
      />
      <PageHeaderActions>
        <Button
          variant="primary"
          icon={PlusIcon}
          isDisabled={!connected || busy}
          isPending={actions.isPending('track')}
          onPress={() => void actions.run('track', { type: 'tracking.openPicker' })}
        >
          Track a ticket
        </Button>
        {actions.confirmation}
      </PageHeaderActions>
    </>
  );
}

/**
 * Overview (1.14 `OverviewView`): today's suggestions by urgency, the current timer and the
 * local timer, today's worklogs, progress toward the targets and the connection details.
 */
export default function OverviewPage() {
  const connection = useSlice('connection');
  const tracking = useSlice('tracking');
  const app = useSlice('app');
  const items = usePromptItems('main');
  const localTitle = useLocalTimerTitle();
  const rootRef = useRef<HTMLDivElement>(null);
  const localHeadingId = useId();
  usePromptAnnouncements(items);
  useTrackingAnnouncements();
  useFocusRecovery(rootRef, FOCUS_FALLBACKS);

  return (
    <div ref={rootRef} className={styles.page}>
      <OverviewHeader />
      <TodayLine />

      {connection && !connection.hasSevenPaceToken ? <SetupCard /> : null}

      {items && items.length > 0 ? (
        // The suggestion cards lead the page without a heading of their own (2.0 redesign).
        <section aria-label="Suggestions" className={styles.suggestions}>
          <PromptList items={items} surface="main" headingLevel={2} label="Suggestions" />
        </section>
      ) : null}

      <Card className={styles.current}>
        <section aria-label="Current tracking" className={styles.currentBody}>
          {tracking?.showsRemoteTimer !== false ? <CurrentTracking surface="main" /> : null}
          {tracking?.local ? (
            <section aria-labelledby={localHeadingId} className={styles.local}>
              <h3 id={localHeadingId} className={styles.localTitle}>
                {localTitle}
              </h3>
              <LocalTimer surface="main" />
            </section>
          ) : null}
        </section>
      </Card>

      <div className={styles.grid}>
        <Section
          title="Today’s time"
          subtitle="Your worklogs and the running timer"
          actions={
            <Button size="small" onPress={() => openMainPage('history')}>
              View history
            </Button>
          }
        >
          <TodayLogs />
        </Section>
        <Section title="Progress" subtitle="Your daily and weekly targets.">
          <TargetProgress />
        </Section>
      </div>

      <Card as="section" aria-label="Connection details">
        <ConnectionDetails headingLevel={2} />
      </Card>

      <p className={styles.privacy}>
        <PrivacyIcon className={styles.privacyIcon} />
        {app?.os === 'windows'
          ? 'Tokens stay in Windows Credential Manager. Your Git repositories stay untouched.'
          : 'Tokens stay in Keychain. Your Git repositories stay untouched.'}
      </p>
    </div>
  );
}
