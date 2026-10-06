import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockIpc, invoke, IpcError, isTauri, listen, resetMockIpc, setMockIpc } from './index';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('ipc wrapper outside Tauri', () => {
  it('routes invoke to the pluggable mock', async () => {
    const mock = resetMockIpc().handle('app.ping', (args) => ({ pong: args?.value }));
    expect(isTauri()).toBe(false);
    await expect(invoke<{ pong: unknown }>('app.ping', { value: 42 })).resolves.toEqual({ pong: 42 });
    expect(mock.calls).toEqual([{ command: 'app.ping', args: { value: 42 } }]);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('rejects unknown commands and handler errors with IpcError', async () => {
    resetMockIpc().handle('broken', () => {
      throw new Error('Engine unavailable');
    });
    const missing = invoke('nope');
    await expect(missing).rejects.toBeInstanceOf(IpcError);
    await expect(missing).rejects.toMatchObject({ command: 'nope', message: 'No mock handler for "nope"' });
    await expect(invoke('broken')).rejects.toMatchObject({ command: 'broken', message: 'Engine unavailable' });
  });

  it('delivers events to listeners until they unlisten', async () => {
    const mock = resetMockIpc();
    const received: unknown[] = [];
    const unlisten = await listen<number>('state.tick', (payload) => received.push(payload));
    mock.emit('state.tick', 1);
    mock.emit('state.tick', 2);
    unlisten();
    mock.emit('state.tick', 3);
    expect(received).toEqual([1, 2]);
    expect(mock.listenerCount('state.tick')).toBe(0);
  });

  it('accepts a replacement backend', async () => {
    const custom = createMockIpc({ handlers: { 'app.version': () => '2.0.0' } });
    setMockIpc(custom);
    await expect(invoke('app.version')).resolves.toBe('2.0.0');
  });
});

describe('ipc wrapper inside Tauri', () => {
  it('uses @tauri-apps/api when __TAURI_INTERNALS__ is present', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    tauri.invoke.mockResolvedValueOnce('from rust');
    expect(isTauri()).toBe(true);
    await expect(invoke('app.version', { channel: 'stable' })).resolves.toBe('from rust');
    expect(tauri.invoke).toHaveBeenCalledWith('app.version', { channel: 'stable' });

    tauri.invoke.mockRejectedValueOnce({ message: 'Denied' });
    await expect(invoke('tracking.stop')).rejects.toMatchObject({ command: 'tracking.stop', message: 'Denied' });

    const unlistenFn = vi.fn();
    tauri.listen.mockImplementationOnce((_event: string, handler: (message: { payload: unknown }) => void) => {
      handler({ payload: 'hello' });
      return Promise.resolve(unlistenFn);
    });
    const handler = vi.fn();
    const unlisten = await listen('state.tracking', handler);
    expect(handler).toHaveBeenCalledWith('hello');
    unlisten();
    expect(unlistenFn).toHaveBeenCalled();
  });
});
