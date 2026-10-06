import type { SliceMap } from '../../contract';

export default {
  connection: {
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
  },
} satisfies Partial<SliceMap>;
