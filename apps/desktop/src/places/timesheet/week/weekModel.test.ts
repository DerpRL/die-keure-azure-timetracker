import { CalendarDate } from '@internationalized/date';
import { describe, expect, it } from 'vitest';
import { sampleSlices } from '../../../ipc/fixtures';
import type { WorkLog } from '../../../ipc/contract';
import { historyLogs, mondayLogs } from '../../../ipc/fixtures/slices/history';
import { readyDraft, runningDraft, syncedDraft } from '../../../ipc/fixtures/slices/offline';
import { stoppedTracking } from '../../../ipc/fixtures/slices/tracking';
import { blockLanes, buildWeek, dayGaps, dayToLookAt, formatWeekTitle, mondayOf, visibleHours, weekRange, type WeekInput } from './weekModel';

const monday = new CalendarDate(2026, 10, 5);
const tuesday = new CalendarDate(2026, 10, 6);
const NOW = Date.parse('2026-10-06T08:00:00Z');

function input(patch: Partial<WeekInput> = {}): WeekInput {
  const slices = sampleSlices();
  return {
    weekStart: monday,
    today: tuesday,
    now: NOW,
    logs: historyLogs,
    drafts: [runningDraft, readyDraft, syncedDraft],
    tracking: slices.tracking,
    runningLogId: null,
    items: slices.workItems,
    longEntryMinutes: 180,
    gapMinutes: 20,
    filter: '',
    ...patch,
  };
}

describe('week model', () => {
  it('finds the Monday and the loaded range of a week, never past today', () => {
    expect(mondayOf(tuesday).toString()).toBe('2026-10-05');
    expect(weekRange(monday, tuesday)).toEqual({ from: '2026-10-05', to: '2026-10-06' });
    expect(weekRange(new CalendarDate(2026, 9, 28), tuesday)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });

  it('shows Monday to Friday, totals worklogs and keeps drafts apart', () => {
    const days = buildWeek(input());
    expect(days.map((day) => day.key)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
    const [mon, tue, wed] = days;
    expect(mon!.seconds).toBe(7 * 3600 + 15 * 60);
    expect(mon!.draftSeconds).toBe(75 * 60);
    expect(mon!.blocks.filter((block) => block.kind === 'draft').map((block) => block.title)).toEqual(['Checkout: retry failed card payments']);
    expect(tue!.isToday).toBe(true);
    expect(wed!.isFuture).toBe(true);
    expect(wed!.blocks).toEqual([]);
    // Synced drafts are already in 7pace.
    expect(days.flatMap((day) => day.blocks).some((block) => block.id === syncedDraft.id)).toBe(false);
  });

  it('flags long entries, overlaps, locked entries and gaps', () => {
    const [mon] = buildWeek(input());
    const byComment = (comment: string) => mon!.blocks.find((block) => block.comment === comment)!;
    expect(byComment('Card retry flow').long).toBe(true);
    expect(byComment('Date picker focus tokens').overlap).toBe(true);
    expect(byComment('Reviewing pull requests').overlap).toBe(true);
    expect(byComment('VAT number on invoice PDF').overlap).toBe(false);
    expect(byComment('Release notes for card retry').locked).toBe(true);
    expect(mon!.overlaps).toHaveLength(1);
    expect(mon!.gaps.map((gap) => [new Date(gap.start).toISOString(), new Date(gap.end).toISOString()])).toEqual([
      ['2026-10-05T10:40:00.000Z', '2026-10-05T11:30:00.000Z'],
      ['2026-10-05T13:05:00.000Z', '2026-10-05T13:40:00.000Z'],
    ]);
    expect(mon!.longEntries.map((block) => block.comment)).toEqual(['Card retry flow']);
  });

  it('adds the running 7pace timer until now, or marks its worklog as running', () => {
    const tue = buildWeek(input())[1]!;
    const running = tue.blocks.find((block) => block.kind === 'running')!;
    expect(running).toMatchObject({ id: 'running', ticketId: 4821, end: NOW, start: Date.parse('2026-10-06T06:36:40Z') });
    expect(buildWeek(input({ tracking: stoppedTracking }))[1]!.blocks.some((block) => block.kind === 'running')).toBe(false);
    const asLog = buildWeek(input({ runningLogId: mondayLogs[0]!.id }))[0]!;
    expect(asLog.blocks.find((block) => block.id === mondayLogs[0]!.id)?.kind).toBe('running');
  });

  it('shows weekend days only when they have blocks', () => {
    const saturday = { ...mondayLogs[1]!, id: 'sat', timestamp: '2026-10-10T08:00:00Z' };
    expect(buildWeek(input({ logs: [saturday] })).map((day) => day.key)).toContain('2026-10-10');
    expect(buildWeek(input({ logs: [saturday] })).map((day) => day.key)).not.toContain('2026-10-11');
  });

  it('filters blocks by ticket number, title or comment', () => {
    const days = buildWeek(input({ filter: '#4790' }));
    expect(days.flatMap((day) => day.blocks).map((block) => block.ticketId)).toEqual([4790, 4790, 4790]);
    expect(buildWeek(input({ filter: 'pull requests' }))[0]!.blocks.map((block) => block.comment)).toEqual(['Reviewing pull requests']);
  });

  it('finds gaps from the first start to the last end, at least the threshold long', () => {
    const at = (minutes: number) => minutes * 60_000;
    expect(dayGaps([{ start: at(0), end: at(60) }, { start: at(70), end: at(90) }, { start: at(120), end: at(150) }], 20, at(1000))).toEqual([
      { start: at(90), end: at(120) },
    ]);
    // Spans inside a longer one leave no gap.
    expect(dayGaps([{ start: at(0), end: at(200) }, { start: at(30), end: at(60) }, { start: at(210), end: at(220) }], 20, at(1000))).toEqual([]);
  });

  it('puts overlapping blocks side by side', () => {
    const min = 60_000;
    const lanes = blockLanes([
      { id: 'a', start: 0, end: 10 * min },
      { id: 'b', start: 5 * min, end: 15 * min },
      { id: 'c', start: 20 * min, end: 30 * min + 20_000 },
      // Shares ten seconds with c, within 00:30: back to back, so full width.
      { id: 'd', start: 30 * min + 10_000, end: 40 * min },
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get('c')).toEqual({ lane: 0, lanes: 1 });
    expect(lanes.get('d')).toEqual({ lane: 0, lanes: 1 });
  });

  it('does not flag entries that share seconds of one displayed minute', () => {
    // 09:30:40–10:38:20 and 10:38:10–13:03: both read 10:38, as in the reported week.
    const entry = (id: string, timestamp: string, length: number): WorkLog => ({ ...mondayLogs[0]!, id, timestamp, length, isCanEdit: true });
    const day = (logs: WorkLog[]) => buildWeek(input({ logs, drafts: [], tracking: stoppedTracking }))[0]!;
    const touching = day([entry('dev', '2026-10-05T09:30:40Z', 4_060), entry('feature', '2026-10-05T10:38:10Z', 8_690)]);
    expect(touching.overlaps).toEqual([]);
    expect(touching.blocks.map((block) => block.overlap)).toEqual([false, false]);
    const sameSecond = day([entry('dev', '2026-10-05T09:30:00Z', 4_080), entry('feature', '2026-10-05T10:38:00Z', 8_700)]);
    expect(sameSecond.overlaps).toEqual([]);
    const minute = day([entry('dev', '2026-10-05T09:30:40Z', 4_110), entry('feature', '2026-10-05T10:38:10Z', 8_690)]);
    expect(minute.overlaps).toEqual([
      { start: Date.parse('2026-10-05T10:38:10Z'), end: Date.parse('2026-10-05T10:39:10Z'), earlierId: 'dev', laterId: 'feature' },
    ]);
    expect(minute.blocks.map((block) => block.overlap)).toEqual([true, true]);
  });

  it('widens 08:00–18:00 to the hours with blocks', () => {
    expect(visibleHours(buildWeek(input()))).toEqual({ from: 8, to: 20 });
    expect(visibleHours(buildWeek(input({ logs: [], drafts: [], tracking: stoppedTracking })))).toEqual({ from: 8, to: 18 });
  });

  it('looks at the chosen day, else the latest past day with something to check', () => {
    const days = buildWeek(input());
    expect(dayToLookAt(days, null)?.key).toBe('2026-10-05');
    expect(dayToLookAt(days, '2026-10-07')).toBeNull();
    expect(dayToLookAt(buildWeek(input({ logs: [], drafts: [] })), null)).toBeNull();
  });

  it('titles a week across months and years', () => {
    expect(formatWeekTitle(monday, new CalendarDate(2026, 10, 9))).toBe('5 – 9 October 2026');
    expect(formatWeekTitle(new CalendarDate(2026, 9, 28), new CalendarDate(2026, 10, 2))).toBe('28 September – 2 October 2026');
    expect(formatWeekTitle(new CalendarDate(2025, 12, 29), new CalendarDate(2026, 1, 2))).toBe('29 December 2025 – 2 January 2026');
  });
});
