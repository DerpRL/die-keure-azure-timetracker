import type { ConnectionSlice, SliceMap } from '../../contract';

/** Connected and confirmed a few seconds before the sample "now" (08:00:00Z). */
export const sampleConnection: ConnectionSlice = {
  health: 'confirmed',
  indicator: 'running',
  status: '7pace connected',
  detail: null,
  workspace: 'https://contoso.timehub.7pace.com',
  host: 'contoso.timehub.7pace.com',
  lastSync: '2026-10-06T07:59:40Z',
  worklogSync: '2026-10-06T07:55:00Z',
  connectionIssue: null,
  azureIssue: null,
  progressIssue: null,
  hasAzurePat: true,
  hasSevenPaceToken: true,
  connected: true,
  connecting: false,
};

/** First launch: no 7pace account yet. */
export const unconfiguredConnection: ConnectionSlice = {
  ...sampleConnection,
  health: 'unconfigured',
  indicator: 'disconnected',
  status: 'Set up 7pace',
  workspace: '',
  host: null,
  lastSync: null,
  worklogSync: null,
  hasAzurePat: false,
  hasSevenPaceToken: false,
  connected: false,
};

export const connectingConnection: ConnectionSlice = {
  ...sampleConnection,
  health: 'connecting',
  indicator: 'connecting',
  status: 'Connecting to 7pace…',
  connected: false,
  connecting: true,
};

/** The last read failed: the timer is "last known". */
export const disconnectedConnection: ConnectionSlice = {
  ...sampleConnection,
  health: 'disconnected',
  indicator: 'disconnected',
  status: '7pace offline',
  detail: 'The last 7pace check failed at 09:58.',
  connectionIssue: 'Could not reach contoso.timehub.7pace.com. Check your network connection.',
  connected: false,
};

export const authenticationConnection: ConnectionSlice = {
  ...disconnectedConnection,
  health: 'authentication',
  status: 'Sign in to 7pace',
  connectionIssue: 'The 7pace token was rejected. Sign in again in Settings.',
};

/** 7pace works, but ticket titles and totals did not refresh. */
export const degradedConnection: ConnectionSlice = {
  ...sampleConnection,
  azureIssue: 'The Azure DevOps personal access token has expired.',
  progressIssue: 'Worklogs could not be downloaded (HTTP 503).',
};

export default {
  connection: sampleConnection,
} satisfies Partial<SliceMap>;
