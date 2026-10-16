import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceSubscription } from './world-presence';

class Stream {
  static all: Stream[] = [];
  onmessage?: (message: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor(readonly url: string) {
    Stream.all.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Stream.all = [];
  vi.stubGlobal('EventSource', Stream);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('independent lobby presence', () => {
  it('receives changing rosters without joining a game', () => {
    const presence = new PresenceSubscription();
    presence.start();
    presence.start();
    expect(Stream.all).toHaveLength(1);
    expect(Stream.all[0].url).toMatch(/^http.*\/world\/presence$/);
    expect(presence.data).toBeUndefined();
    const roster = { players: [{ id: 'a', connected: true }], revision: 26 };
    Stream.all[0].emit(roster);
    expect(presence.status).toBe('live');
    expect(presence.data).toEqual(roster);
    Stream.all[0].emit({ players: [], revision: 27 });
    expect(presence.data?.players).toEqual([]);
    expect(presence.data?.revision).toBe(27);
    presence.stop();
  });
  it('retains stale data, retries failed HTTP streams and recovers', async () => {
    const presence = new PresenceSubscription();
    presence.start();
    const first = Stream.all[0];
    first.emit({ players: [{ id: 'a' }], revision: 26 });
    first.onerror?.();
    expect(first.close).toHaveBeenCalledOnce();
    expect(presence.status).toBe('reconnecting');
    expect(presence.data?.revision).toBe(26);
    await vi.advanceTimersByTimeAsync(2000);
    expect(Stream.all).toHaveLength(2);
    Stream.all[1].emit({ players: [], revision: 27 });
    first.emit({ players: [], revision: 0 });
    expect(presence.status).toBe('live');
    expect(presence.data?.revision).toBe(27);
    presence.stop();
  });
  it('reconnects when heartbeats stop and cancels retries on unmount', async () => {
    const presence = new PresenceSubscription();
    presence.start();
    Stream.all[0].emit({ players: [], revision: 26 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(presence.status).toBe('reconnecting');
    presence.stop();
    Stream.all[0].emit({ players: [], revision: 0 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(Stream.all).toHaveLength(1);
    expect(presence.data?.revision).toBe(26);
  });
  it('keeps unknown data distinct from an empty world on initial failure', async () => {
    const presence = new PresenceSubscription();
    presence.start();
    Stream.all[0].onerror?.();
    expect(presence.data).toBeUndefined();
    expect(presence.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(2000);
    Stream.all[1].emit({ players: [], revision: 26 });
    expect(presence.data?.players).toEqual([]);
    presence.stop();
  });
});
