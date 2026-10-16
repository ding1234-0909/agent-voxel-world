import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { WorldPresence } from '@voxel/shared';
import { installPresenceRoutes } from './presence.routes';

describe('read-only world presence stream', () => {
  let server: Server, url: string, state: WorldPresence | undefined;
  const read = vi.fn(() => state);
  beforeEach(async () => {
    vi.stubEnv('WEB_ORIGIN', 'http://127.0.0.1:5187');
    state = {
      worldId: 'meadow',
      roomId: 'world',
      revision: 26,
      capacity: 16,
      persistence: 'memory',
      updatedAt: Date.now(),
      players: [
        {
          id: 'a',
          name: 'Alice',
          kind: 'human',
          x: 1,
          y: 2.5,
          z: 3,
          yaw: 0,
          connected: true,
        },
      ],
    };
    read.mockClear();
    const app = express();
    installPresenceRoutes(app, read);
    server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  it('streams current roster, movement and departures without creating players', async () => {
    const controller = new AbortController();
    const response = await fetch(`${url}/world/presence`, {
      headers: { Origin: 'http://127.0.0.1:5187' },
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:5187',
    );
    const reader = response.body!.getReader();
    const next = async () => {
      const { value } = await reader.read();
      return JSON.parse(
        new TextDecoder().decode(value).trim().slice(6),
      ) as WorldPresence;
    };
    expect((await next()).players).toEqual(state!.players);
    state!.players[0].x = 4;
    state!.players[0].connected = false;
    expect((await next()).players[0]).toMatchObject({ x: 4, connected: false });
    state!.players = [];
    expect((await next()).players).toEqual([]);
    controller.abort();
    await reader.cancel().catch(() => {});
  });
  it('rejects unexpected origins and returns unavailable rather than an empty roster', async () => {
    const blocked = await fetch(`${url}/world/presence`, {
      headers: { Origin: 'https://example.com' },
    });
    expect(blocked.status).toBe(403);
    state = undefined;
    const unavailable = await fetch(`${url}/world/presence`);
    expect(unavailable.status).toBe(503);
  });
});
