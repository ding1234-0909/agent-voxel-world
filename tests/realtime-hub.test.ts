import { it, expect, vi } from 'vitest';
import { RealtimeHub } from '../apps/server/src/realtime-hub';
it('cancels a pending demo handshake by owner request without accessing configuration', async () => {
  const events: any[] = [],
    config = vi.fn(() => {
      throw Error('configuration must stay untouched');
    });
  const hub = new RealtimeHub(
    () => {
      throw Error('scene not consented');
    },
    (owner, event) => events.push({ owner, ...event }),
    config,
  );
  hub.handle('owner', 'realtime.start', { mode: 'demo', request: 'pending' });
  expect(() =>
    hub.handle('other', 'realtime.stop', { request: 'pending' }),
  ).toThrow();
  hub.handle('owner', 'realtime.stop', { request: 'pending' });
  await new Promise((resolve) => setImmediate(resolve));
  expect(events.map((e) => e.kind)).toEqual(['closed']);
  expect(events[0]).toMatchObject({
    owner: 'owner',
    request: 'pending',
    demo: true,
  });
  expect(config).not.toHaveBeenCalled();
  hub.dispose();
});
