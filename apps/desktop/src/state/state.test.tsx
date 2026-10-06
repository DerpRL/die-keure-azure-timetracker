import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockIpc } from '../ipc';
import { installMockEngine, MockEngineError } from '../ipc/mockEngine';
import { sampleSlices } from '../ipc/fixtures';
import { EngineProvider, useEngineStatus } from './EngineProvider';
import { liveSeconds, useAction, useLiveSeconds, useSlice } from './hooks';
import { SliceStore } from './store';

afterEach(() => {
  resetMockIpc();
  vi.useRealTimers();
});

function TrackingTitle() {
  const tracking = useSlice('tracking');
  const status = useEngineStatus();
  return <p>{tracking ? tracking.title : `waiting (${status})`}</p>;
}

describe('slice store', () => {
  it('notifies only the subscribers of changed slices, once per batch', () => {
    const target = new SliceStore();
    const tracking = vi.fn();
    const flow = vi.fn();
    target.subscribe('tracking', tracking);
    target.subscribe('flow', flow);
    const slices = sampleSlices();
    target.apply([
      { name: 'tracking', value: slices.tracking! },
      { name: 'tracking', value: { ...slices.tracking!, title: 'Second' } },
    ]);
    expect(tracking).toHaveBeenCalledTimes(1);
    expect(flow).not.toHaveBeenCalled();
    expect(target.get('tracking')?.title).toBe('Second');
  });
});

describe('EngineProvider', () => {
  it('subscribes, resyncs and renders slices as they arrive', async () => {
    const engine = installMockEngine({ slices: sampleSlices() });
    render(
      <EngineProvider store={new SliceStore()}>
        <TrackingTitle />
      </EngineProvider>,
    );
    expect(await screen.findByText('Checkout: retry failed card payments')).toBeInTheDocument();
    expect(engine.ipc.calls.map((call) => call.command)).toEqual(['engine_resync']);

    act(() => engine.patchSlice('tracking', { title: 'Invoice PDF shows the wrong VAT number' }));
    expect(screen.getByText('Invoice PDF shows the wrong VAT number')).toBeInTheDocument();
  });

  it('reports a failed connection', async () => {
    resetMockIpc();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <EngineProvider store={new SliceStore()}>
        <TrackingTitle />
      </EngineProvider>,
    );
    expect(await screen.findByText('waiting (failed)')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });
});

function StopButton() {
  const stop = useAction();
  return (
    <div>
      <button type="button" disabled={stop.pending} onClick={() => void stop.run({ type: 'tracking.stop' })}>
        Stop
      </button>
      {stop.error ? <p role="alert">{`${stop.errorKind}: ${stop.error.message}`}</p> : null}
    </div>
  );
}

describe('useAction', () => {
  it('dispatches intents and exposes engine errors with their kind', async () => {
    const engine = installMockEngine({ slices: sampleSlices() }).handle('tracking.stop', () => {
      throw new MockEngineError('busy', 'Another tracking change is still in progress.');
    });
    render(
      <EngineProvider store={new SliceStore()} connect={false}>
        <StopButton />
      </EngineProvider>,
    );
    act(() => screen.getByRole('button', { name: 'Stop' }).click());
    expect(await screen.findByRole('alert')).toHaveTextContent('busy: Another tracking change is still in progress.');
    expect(engine.dispatched('tracking.stop')).toEqual([{ type: 'tracking.stop' }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
  });
});

function Clock({ extrapolate }: { extrapolate: boolean }) {
  const seconds = useLiveSeconds(100, '2026-10-06T08:00:00Z', extrapolate);
  return <p>{Math.floor(seconds)}</p>;
}

describe('live clocks', () => {
  it('extrapolates from the confirmation time only while asked to', () => {
    const at = Date.parse('2026-10-06T08:00:30Z');
    expect(liveSeconds(100, '2026-10-06T08:00:00Z', true, at)).toBe(130);
    expect(liveSeconds(100, '2026-10-06T08:00:00Z', false, at)).toBe(100);
    expect(liveSeconds(100, null, true, at)).toBe(100);
    // A clock skew never runs the timer backwards.
    expect(liveSeconds(100, '2026-10-06T08:01:00Z', true, at)).toBe(100);
  });

  it('ticks once per second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:10Z'));
    render(<Clock extrapolate />);
    expect(screen.getByText('110')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1010);
    });
    expect(screen.getByText('111')).toBeInTheDocument();
  });
});
