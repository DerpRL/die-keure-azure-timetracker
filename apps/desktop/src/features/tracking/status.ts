import { useEffect, useRef } from 'react';
import { announce } from '../../components/Announcer';
import type { ConnectionSlice, HostOs, ProgressSlice, TrackingSlice } from '../../ipc/contract';
import { useLiveSeconds, useSlice } from '../../state/hooks';
import type { TrackingStatus } from '../../timer/status';

/** The tray state the engine resolved (Swift `TrackingIndicator`); "connecting" until it arrives. */
export function trackingStatus(connection: ConnectionSlice | undefined): TrackingStatus {
  return connection?.indicator ?? 'connecting';
}

/**
 * Identifies one timer session for `TimerDisplay`, so a new session starts cleanly instead of
 * rolling from the previous time. Stable across polls of the same session.
 */
export function sessionKey(tracking: TrackingSlice): string {
  if (tracking.running) return `running:${tracking.ticketId ?? ''}:${tracking.activityId ?? ''}:${tracking.title}`;
  if (tracking.paused) return `paused:${tracking.paused.ticketId ?? ''}:${tracking.paused.pausedAt}`;
  return 'idle';
}

/** The remote timer's seconds, ticking only while the engine says it may extrapolate. */
export function useTrackingSeconds(tracking: TrackingSlice | undefined): number {
  return useLiveSeconds(tracking?.elapsedBase ?? 0, tracking?.confirmedAt, tracking?.extrapolate ?? false);
}

/** The local (offline) timer's seconds since it started. */
export function useLocalSeconds(tracking: TrackingSlice | undefined): number {
  const local = tracking?.local ?? null;
  return useLiveSeconds(0, local?.start, local !== null);
}

/** Today's and this week's totals at "now", or null while they are unavailable. */
export function useProgressSeconds(progress: ProgressSlice | undefined): { today: number; week: number } | null {
  const available = progress?.available ?? false;
  const extrapolate = available && (progress?.extrapolate ?? false);
  const today = useLiveSeconds(progress?.todaySeconds ?? 0, progress?.computedAt, extrapolate);
  const week = useLiveSeconds(progress?.weekSeconds ?? 0, progress?.computedAt, extrapolate);
  return available ? { today, week } : null;
}

/** Totals are confirmed only with a confirmed 7pace timer and fresh worklogs. */
export function totalsConfirmed(connection: ConnectionSlice | undefined, progress: ProgressSlice | undefined): boolean {
  return connection?.health === 'confirmed' && !connection.progressIssue && !progress?.stale && !progress?.issue;
}

/** "this Mac" or "this computer", for the local-timer texts. */
export function deviceName(os: HostOs | undefined): string {
  return os === 'macos' ? 'this Mac' : 'this computer';
}

function trackingAnnouncement(tracking: TrackingSlice): { key: string; message: string } {
  if (tracking.running) {
    return { key: sessionKey(tracking), message: `Tracking ${tracking.title}` };
  }
  if (tracking.paused) return { key: sessionKey(tracking), message: `Paused · ${tracking.paused.title}` };
  if (tracking.local && tracking.showsLocalTimer) {
    return { key: `local:${tracking.local.draftId}`, message: `Local tracking · ${tracking.local.title}` };
  }
  return { key: 'idle', message: 'Tracking stopped' };
}

/**
 * Announces tracking changes politely (start, switch, pause, stop), never the clock itself.
 * The first value after load is not announced.
 */
export function useTrackingAnnouncements(): void {
  const tracking = useSlice('tracking');
  const previous = useRef<string | null>(null);
  const next = tracking ? trackingAnnouncement(tracking) : null;
  const key = next?.key ?? null;
  const message = next?.message ?? '';
  useEffect(() => {
    if (key === null) return;
    if (previous.current !== null && previous.current !== key) announce(message);
    previous.current = key;
  }, [key, message]);
}
