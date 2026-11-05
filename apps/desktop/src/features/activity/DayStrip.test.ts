import { describe, expect, it } from 'vitest';
import { stripLanes, type DayStripBlock } from './DayStrip';

const MIN = 60_000;
const block = (id: string, start: number, end: number): DayStripBlock => ({ id, start: start * MIN, end: end * MIN, colorIndex: 0 });

describe('stripLanes', () => {
  it('keeps blocks that overlap nothing at full height', () => {
    const lanes = stripLanes([block('a', 0, 30), block('b', 30, 60), block('c', 90, 120)]);
    expect([...lanes.values()]).toEqual([0, 0, 0]);
  });

  it('keeps back-to-back blocks that share seconds of one displayed minute at full height', () => {
    const lanes = stripLanes([
      { id: 'a', start: 0, end: 38 * MIN + 20_000, colorIndex: 0 },
      { id: 'b', start: 38 * MIN + 10_000, end: 60 * MIN, colorIndex: 0 },
    ]);
    expect([...lanes.values()]).toEqual([0, 0]);
  });

  it('never puts two overlapping blocks in the same lane', () => {
    // Stand-up 08:30–08:45, a timer since 08:36, then a worklog 08:45–09:10 during that timer.
    const blocks = [block('standup', 30, 45), block('running', 36, 120), block('log', 45, 70)];
    const lanes = stripLanes(blocks);
    expect(lanes.get('standup')).toBe(1);
    expect(lanes.get('running')).toBe(2);
    expect(lanes.get('log')).toBe(1);
    for (const a of blocks) {
      for (const b of blocks) {
        if (a !== b && a.start < b.end && b.start < a.end) expect(lanes.get(a.id)).not.toBe(lanes.get(b.id));
      }
    }
  });
});
