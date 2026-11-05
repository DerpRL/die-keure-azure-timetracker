/**
 * The ticket picker's flow for the browser preview: choosing a row prepares a draft, letting go
 * of it and searching behave like the engine (`crates/att-engine/src/session/tracking.rs`), so
 * the picker can be tried end to end without Tauri. Starting only closes the picker.
 */
import type { DraftView, FlowSlice, ManualTrackingKind, WorkItem } from '../contract';
import type { MockEngine } from '../mockEngine';
import { standupDraftFlow, ticketDraft } from './slices/flow';

let drafts = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++drafts).padStart(12, '0')}`;

const MANUAL_DRAFTS: Record<ManualTrackingKind, Partial<DraftView>> = {
  standup: standupDraftFlow.draft!,
  meeting: { title: 'Meeting', defaultComment: '', remark: 'Meeting', preferredActivityId: 'meeting', standup: false, allowedActivityIds: [] },
  activity: { title: 'Other activity', defaultComment: '', remark: null, preferredActivityId: 'dev', standup: false, allowedActivityIds: [] },
};

function knownItems(mock: MockEngine): WorkItem[] {
  return Object.values(mock.slices.workItems ?? {});
}

/** Like `choose_activity`: refused while a draft exists. */
function setDraft(mock: MockEngine, draft: DraftView): void {
  const flow = mock.slices.flow;
  if (!flow || flow.draft) return;
  mock.patchSlice('flow', { draft });
}

function release(flow: FlowSlice): Partial<FlowSlice> {
  return { draft: null, search: { ...flow.search, results: [], error: null } };
}

export function handlePickerPreview(engine: MockEngine): MockEngine {
  return engine
    .handle('tracking.search', ({ query }, mock) => {
      const text = query.trim().replace(/^#/, '').toLowerCase();
      const results = text ? knownItems(mock).filter((item) => String(item.id).includes(text) || item.title.toLowerCase().includes(text)) : [];
      mock.patchSlice('flow', { search: { query, results, searching: false, error: null } });
    })
    .handle('tracking.chooseTicket', ({ ticketId }, mock) => {
      const item = mock.slices.workItems?.[String(ticketId)] ?? { id: ticketId, title: `Azure ticket #${ticketId}` };
      setDraft(mock, { ...ticketDraft, id: nextId(), title: item.title, item, allowsNoTicket: mock.slices.flow?.selectedSuggestion != null });
    })
    .handle('tracking.chooseManual', ({ kind }, mock) => {
      setDraft(mock, { ...standupDraftFlow.draft!, ...MANUAL_DRAFTS[kind], id: nextId(), manual: kind, startableActivityIds: kind === 'standup' ? ['standup'] : ticketDraft.startableActivityIds });
    })
    .handle('tracking.continueWithoutTicket', (_intent, mock) => {
      const suggestion = mock.slices.flow?.selectedSuggestion;
      setDraft(mock, { ...ticketDraft, id: nextId(), source: 'branch', item: null, title: suggestion?.title ?? 'No ticket', remark: suggestion?.title ?? null });
    })
    .handle('tracking.chooseDifferentWork', (_intent, mock) => {
      if (mock.slices.flow) mock.patchSlice('flow', release(mock.slices.flow));
    })
    .handle('tracking.chooseSuggestionTicket', (_intent, mock) => {
      if (mock.slices.flow) mock.patchSlice('flow', release(mock.slices.flow));
    })
    .handle('tracking.start', (_intent, mock) => mock.patchSlice('flow', { surface: 'none', draft: null }));
}
