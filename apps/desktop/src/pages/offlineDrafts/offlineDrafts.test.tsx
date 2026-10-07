import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import {
  offlineEmpty,
  offlineNoWorkspace,
  offlineReviewing,
  offlineUploadFailed,
  offlineWithSynced,
  offlineWorking,
  pastDraft,
  readyDraft,
  reviewSending,
  reviewWithMatch,
  runningDraft,
} from '../../ipc/fixtures/slices/offline';
import { MockEngineError } from '../../ipc/mockEngine';
import type { OfflineDraft, OfflineSlice, SliceMap } from '../../ipc/contract';
import { PageFrame } from '../../features/ticketContext/testing';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import OfflineDraftsPage from './index';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderOffline(offline: OfflineSlice | undefined, extra: Partial<SliceMap> = {}) {
  const slices = sampleSlices();
  if (offline) slices.offline = offline;
  else delete slices.offline;
  return renderWithEngine(
    <PageFrame title="Offline drafts">
      <OfflineDraftsPage />
    </PageFrame>,
    { slices: { ...slices, ...extra } },
  );
}

const politeAnnouncement = () => document.querySelector('[data-announcer="polite"]')?.textContent ?? '';

describe('Offline drafts page', () => {
  it('shows the running local timer and the workspace drafts, newest first', async () => {
    renderOffline(sampleSlices().offline);
    expect(screen.getByRole('heading', { level: 2, name: 'Local tracking · saved on this Mac' })).toBeInTheDocument();
    expect(screen.getByText('Local timer · #4790 · Invoice PDF shows the wrong VAT number')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('00:40:00');
    expect(screen.getByRole('heading', { level: 2, name: 'This workspace · 3 awaiting review' })).toBeInTheDocument();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(titles).toEqual([
      '#4790 · Invoice PDF shows the wrong VAT number',
      '#4821 · Checkout: retry failed card payments',
      'Interview preparation',
      '#4655 · Design system: date picker tokens',
    ]);
    expect(screen.getByText('Running locally', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Check 7pace before retrying')).toBeInTheDocument();
    // Only one local timer can run.
    expect(screen.getByRole('button', { name: 'Start local timer…' })).toBeDisabled();
    await expectNoA11yViolations();
  });

  it('stops the local timer and announces it', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    await user.click(screen.getByRole('button', { name: 'Stop local timer' }));
    expect(engine.dispatched('offline.stopLocal')).toHaveLength(1);
    await waitFor(() => expect(politeAnnouncement()).toBe('Local timer stopped.'));
  });

  it('starts the local timer with the current ticket and default activity', async () => {
    const { engine, user } = renderOffline(offlineEmpty);
    engine.handle('offline.startLocal', (_intent, mock) => mock.patchSlice('offline', { active: runningDraft, drafts: [runningDraft] }));
    await user.click(screen.getByRole('button', { name: 'Start local timer…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Start local timer' });
    expect(within(sheet).getByRole('textbox', { name: 'Azure ticket number (optional)' })).toHaveValue('4821');
    await expectNoA11yViolations();
    await user.type(within(sheet).getByRole('textbox', { name: 'Comment (required without a ticket)' }), 'On the train');
    await user.click(within(sheet).getByRole('button', { name: 'Start local timer' }));
    expect(engine.dispatched('offline.startLocal')).toEqual([
      { type: 'offline.startLocal', ticketId: 4821, comment: 'On the train', activityId: 'dev' },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(politeAnnouncement()).toBe('Local timer started.'));
  });

  it('validates the start form like 1.14 and keeps the sheet open on an engine refusal', async () => {
    const { engine, user } = renderOffline(offlineEmpty);
    engine.handle('offline.startLocal', () => {
      throw new MockEngineError('invalidIntent', 'Stop the existing local timer first.');
    });
    await user.click(screen.getByRole('button', { name: 'Start local timer…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Start local timer' });
    const ticket = within(sheet).getByRole('textbox', { name: 'Azure ticket number (optional)' });
    const start = within(sheet).getByRole('button', { name: 'Start local timer' });

    await user.clear(ticket);
    await user.type(ticket, 'abc');
    expect(start).toBeDisabled();
    expect(within(sheet).getByText('Enter a ticket number from 1 to 2147483647, or leave it empty.')).toBeInTheDocument();

    await user.clear(ticket);
    await user.click(start);
    expect(within(sheet).getByText('Choose a ticket or add a comment for ticket-free work.')).toBeInTheDocument();
    expect(engine.dispatched('offline.startLocal')).toHaveLength(0);

    await user.type(ticket, '4790');
    await user.click(start);
    expect(await within(sheet).findByText('Stop the existing local timer first.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Start local timer' })).toBeInTheDocument();
  });

  it('edits a draft and saves it', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    await user.click(screen.getByRole('button', { name: 'Edit, #4821 · Checkout: retry failed card payments' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit offline time' });
    expect(within(sheet).getByRole('switch', { name: 'Billable time' })).toBeChecked();
    await expectNoA11yViolations();
    const comment = within(sheet).getByRole('textbox', { name: 'Comment (required without a ticket)' });
    await user.clear(comment);
    await user.type(comment, 'Retry tests');
    await user.click(within(sheet).getByRole('button', { name: 'Save draft' }));
    expect(engine.dispatched('offline.save')).toEqual([
      {
        type: 'offline.save',
        draft: {
          ...readyDraft,
          comment: 'Retry tests',
          start: '2026-10-05T16:00:00.000Z',
          end: '2026-10-05T17:15:00.000Z',
          remoteId: undefined,
        },
      },
    ].map((intent) => JSON.parse(JSON.stringify(intent)) as unknown));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the editor open when the engine refuses the save', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    engine.handle('offline.save', () => {
      throw new MockEngineError('invalidIntent', 'An uploaded or unconfirmed draft cannot be edited.');
    });
    await user.click(screen.getByRole('button', { name: 'Edit, Interview preparation' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit offline time' });
    await user.click(within(sheet).getByRole('button', { name: 'Save draft' }));
    expect(await within(sheet).findByText('An uploaded or unconfirmed draft cannot be edited.')).toBeInTheDocument();
    expect(engine.dispatched('offline.save')[0]?.draft.id).toBe(pastDraft.id);
  });

  it('adds past time as a new local draft', async () => {
    const { engine, user } = renderOffline(offlineEmpty);
    await user.click(screen.getByRole('button', { name: 'Add past time…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit offline time' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Comment (required without a ticket)' }), 'Support call');
    // An activity is required while activities are cached.
    expect(within(sheet).getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: /Activity/ }));
    await user.click(await screen.findByRole('option', { name: 'Meeting' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save draft' }));
    const draft = engine.dispatched('offline.save')[0]?.draft as OfflineDraft;
    expect(draft).toMatchObject({
      workspace: 'https://contoso.timehub.7pace.com',
      comment: 'Support call',
      activityId: 'meeting',
      status: 'Local draft',
      billable: false,
      start: '2026-10-06T07:00:00.000Z',
      end: '2026-10-06T08:00:00.000Z',
    });
    expect('ticketId' in draft).toBe(false);
  });

  it('removes a draft after confirmation', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    await user.click(screen.getByRole('button', { name: 'Remove, Interview preparation' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this local record?' });
    expect(dialog).toHaveAccessibleDescription('Entries already in 7pace will stay there.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove local record' }));
    expect(engine.dispatched('offline.remove')).toEqual([{ type: 'offline.remove', draftId: pastDraft.id }]);
  });

  it('reviews a draft against 7pace', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    await user.click(screen.getByRole('button', { name: 'Review, #4821 · Checkout: retry failed card payments' }));
    expect(engine.dispatched('offline.review')).toEqual([{ type: 'offline.review', draftId: readyDraft.id }]);
    // The running timer and drafts awaiting a manual check are not offered for review or removal.
    expect(screen.queryByRole('button', { name: /^Review, #4790/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove, #4655/ })).toBeNull();
  });

  it('cannot review without a 7pace connection', () => {
    renderOffline({ ...sampleSlices().offline!, configured: false });
    expect(screen.getByRole('button', { name: 'Review, #4821 · Checkout: retry failed card payments' })).toBeDisabled();
  });

  it('shows overlaps in the review and uploads after confirmation', async () => {
    const { engine, user } = renderOffline(offlineReviewing);
    const review = screen.getByRole('region', { name: 'Review #4821' });
    expect(within(review).getByText('Overlapping time · uploading is still allowed')).toBeInTheDocument();
    expect(within(review).getByText('Activity: Development')).toBeInTheDocument();
    expect(within(review).getByText(/^Billable · 01:15:00$/)).toBeInTheDocument();
    await expectNoA11yViolations();
    await user.click(within(review).getByRole('button', { name: 'Upload with overlap warning' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Upload this draft to 7pace?' });
    expect(engine.dispatched('offline.upload')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Upload with overlap warning' }));
    expect(engine.dispatched('offline.upload')).toHaveLength(1);
  });

  it('shows an upload refused while another write runs', async () => {
    const { engine, user } = renderOffline(offlineReviewing);
    engine.handle('offline.upload', () => {
      throw new MockEngineError('busy', 'Another 7pace change is in progress.');
    });
    await user.click(screen.getByRole('button', { name: 'Upload with overlap warning' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Upload with overlap warning' }));
    expect(await screen.findByText('Another 7pace change is in progress.')).toBeInTheDocument();
  });

  it('disables the upload while busy', () => {
    renderOffline(offlineReviewing, { app: { ...sampleSlices().app!, busy: true } });
    expect(screen.getByRole('button', { name: 'Upload with overlap warning' })).toBeDisabled();
  });

  it('links an existing entry instead of uploading', async () => {
    const { engine, user } = renderOffline({ ...offlineReviewing, review: reviewWithMatch });
    expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Link existing entry 8e7d6c5b-4a39-4281-9069-5e4d3c2b1a0f' }));
    expect(engine.dispatched('offline.link')).toEqual([{ type: 'offline.link', logId: '8e7d6c5b-4a39-4281-9069-5e4d3c2b1a0f' }]);
  });

  it('allows a retry only after a confirmed manual check', async () => {
    const { engine, user } = renderOffline({ ...offlineReviewing, review: reviewSending });
    expect(screen.getByText(/The previous upload may have reached 7pace/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I checked 7pace…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Allow another review?' });
    await user.click(within(dialog).getByRole('button', { name: 'I checked 7pace — allow another review' }));
    expect(engine.dispatched('offline.allowRetryAfterManualCheck')).toHaveLength(1);
  });

  it('shows synced drafts on request', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    await user.click(screen.getByRole('switch', { name: 'Show synced' }));
    expect(engine.dispatched('offline.setShowSynced')).toEqual([{ type: 'offline.setShowSynced', show: true }]);
    act(() => engine.setSlice('offline', offlineWithSynced));
    expect(screen.getByText('Synced to 7pace')).toBeInTheDocument();
    expect(screen.getByText('7pace entry: 0f1e2d3c-4b5a-4968-8776-112233445566')).toBeInTheDocument();
    expect(screen.getByText('Draft confirmed by 7pace.')).toBeInTheDocument();
  });

  it('reconnects', async () => {
    const { engine, user } = renderOffline(sampleSlices().offline);
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(engine.dispatched('connection.retry')).toHaveLength(1);
  });

  it('shows the loading, working, issue and empty states', async () => {
    const { engine } = renderOffline(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Loading offline drafts');
    act(() => engine.setSlice('offline', offlineWorking));
    expect(screen.getByRole('progressbar', { name: 'Checking with 7pace…' })).toBeInTheDocument();
    act(() => engine.setSlice('offline', offlineUploadFailed));
    expect(screen.getByText(/^Upload outcome is unconfirmed/)).toBeInTheDocument();
    act(() => engine.setSlice('offline', offlineEmpty));
    expect(screen.getByRole('heading', { name: 'No offline drafts' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('asks for a workspace before drafts can be created', () => {
    renderOffline(offlineNoWorkspace);
    expect(screen.getByText('Save your 7pace workspace URL in Settings first. Credentials are only needed for uploading.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start local timer…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add past time…' })).toBeDisabled();
  });

  it('pages a long list of drafts', async () => {
    const drafts = Array.from({ length: 120 }, (_, index) => ({
      ...pastDraft,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      comment: `Draft ${index + 1}`,
    }));
    const { user } = renderOffline({ ...offlineEmpty, drafts, readyCount: 120 });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(50);
    await user.click(screen.getByRole('button', { name: 'Show more drafts' }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(100);
  });
});
