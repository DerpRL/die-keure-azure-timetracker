import { useEffect, useState } from 'react';
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
import { PrivacyIcon, SetupIcon } from '../../features/tracking/icons';
import { openMainPage } from '../../features/tracking/platform';
import { useTrackingAnnouncements } from '../../features/tracking/status';
import { useSlice } from '../../state/hooks';
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

/** "Today Tuesday 6 October", updated once a minute so it turns over at midnight. */
function TodayLine() {
  const [now, setNow] = useState(() => Date.now());
  const date = useDateFormatter({ weekday: 'long', day: 'numeric', month: 'long' });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className={styles.today}>
      <span className={styles.todayLabel}>Today</span> {date.format(new Date(now))}
    </p>
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
  usePromptAnnouncements(items);
  useTrackingAnnouncements();

  return (
    <div className={styles.page}>
      <OverviewHeader />
      <TodayLine />

      {connection && !connection.hasSevenPaceToken ? <SetupCard /> : null}

      {items && items.length > 0 ? (
        <Section title="Suggestions" subtitle="Review a change before switching your timer." variant="plain">
          <PromptList items={items} surface="main" headingLevel={3} label="Suggestions" />
        </Section>
      ) : null}

      <Section title="Current tracking" subtitle="Start, pause or finish your active work.">
        {tracking?.showsRemoteTimer !== false ? <CurrentTracking surface="main" /> : null}
        {tracking && !tracking.showsRemoteTimer && !tracking.local ? (
          <p className={styles.caption}>No timer running</p>
        ) : null}
      </Section>

      {tracking?.local ? (
        <Section title={localTitle}>
          <LocalTimer surface="main" />
        </Section>
      ) : null}

      <div className={styles.grid}>
        <Section
          title="Today’s time"
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

      <Section title="Connection details">
        <ConnectionDetails headingLevel={null} />
      </Section>

      <p className={styles.privacy}>
        <PrivacyIcon className={styles.privacyIcon} />
        {app?.os === 'windows'
          ? 'Tokens stay in Windows Credential Manager. Your Git repositories stay untouched.'
          : 'Tokens stay in Keychain. Your Git repositories stay untouched.'}
      </p>
    </div>
  );
}
