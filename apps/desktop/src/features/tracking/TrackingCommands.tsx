import { DayReviewIcon, PauseIcon, PlayIcon, StopIcon } from '../../components/icons';
import { useSlice } from '../../state/hooks';
import { useCommands } from '../../shortcuts/hooks';
import { useIntents, useWriteGuards } from './actions';
import { flowSurface, openFlow, type TrackingSurface } from './CurrentTracking';
import { t } from '../../i18n';

/**
 * The 1.14 Tracking menu as palette commands and shortcuts: Track a ticket… (⌘N / Ctrl+N), Stop,
 * Pause, Resume tracking… and Review today (⌘⇧D / Ctrl+Shift+D). Disabled exactly when 1.14
 * disabled the menu items.
 */
export function TrackingCommands({ surface }: { surface: TrackingSurface }) {
  const tracking = useSlice('tracking');
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const running = tracking?.running ?? false;
  const paused = !running && !!tracking?.paused;
  useCommands([
    {
      id: 'tracking.chooseTicket',
      label: t('Track a ticket…'),
      group: 'Tracking',
      icon: PlayIcon,
      keywords: ['choose', 'track', 'switch', 'start', 'ticket'],
      shortcut: { key: 'n', mod: true },
      isDisabled: busy,
      onAction: () => void actions.run('choose', openFlow(surface)),
    },
    {
      id: 'tracking.stop',
      label: t('Stop tracking'),
      group: 'Tracking',
      icon: StopIcon,
      isDisabled: !connected || !running || busy,
      onAction: () => void actions.run('stop', { type: 'tracking.stop' }),
    },
    {
      id: 'tracking.pause',
      label: t('Pause tracking'),
      group: 'Tracking',
      icon: PauseIcon,
      isDisabled: !connected || !running || busy,
      onAction: () => void actions.run('pause', { type: 'tracking.pause' }),
    },
    {
      id: 'tracking.resume',
      label: t('Resume tracking…'),
      group: 'Tracking',
      icon: PlayIcon,
      isDisabled: !connected || !paused || busy,
      onAction: () =>
        void actions.run('resume', { type: 'tracking.resume', surface: flowSurface(surface) }),
    },
    {
      id: 'tracking.reviewToday',
      label: t('Review today'),
      group: 'Tracking',
      icon: DayReviewIcon,
      keywords: ['day review'],
      shortcut: { key: 'd', mod: true, shift: true },
      onAction: () => void actions.run('review', { type: 'dayReview.open' }),
    },
  ]);
  return <>{actions.confirmation}</>;
}
