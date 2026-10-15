import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from './room';
import { AgentManager, ProviderStore } from './agent-manager';
import { installAgentRoutes } from './agent-routes';
import { Session, until } from '../../agent/src/session';
import { ModelPlanner } from '../../agent/src/deepseek';
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5187';
const dir = await mkdtemp(join(tmpdir(), 'voxel-manager-'));
const app = express(),
  http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
let manager: AgentManager | undefined;
let calls = 0;
try {
  await server.listen(0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const store = new ProviderStore(join(dir, 'providers.json'));
  await store.load({ DEEPSEEK_API_KEY: 'fixture-secret' });
  const request: typeof fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                type: 'chat',
                text: 'Managed fixture hello',
              }),
            },
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  manager = new AgentManager(store, url.replace('http', 'ws'), {
    session: (url) => new Session(url),
    planner: (config, provider) => new ModelPlanner(config, request, provider),
    models: async () => ['fixture-model'],
  });
  installAgentRoutes(app, manager);
  const api = async (
    path: string,
    method = 'GET',
    body?: unknown,
    origin: string | undefined = process.env.WEB_ORIGIN,
  ) =>
    fetch(`${url}/agents${path}`, {
      method,
      headers: {
        ...(origin ? { Origin: origin } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal(
    (await api('/providers', 'GET', undefined, 'https://untrusted.example'))
      .status,
    403,
  );
  assert.equal((await fetch(`${url}/agents/providers`)).status, 403);
  assert.equal((await api('/providers', 'OPTIONS')).status, 204);
  const publicProviders = await (await api('/providers')).text();
  assert(!publicProviders.includes('fixture-secret'));
  assert(publicProviders.includes('hasApiKey'));
  assert.equal(
    (
      await api('', 'POST', {
        providerId: 'deepseek',
        name: 'AI',
        goal: 'Hi',
        maxTurns: 201,
      })
    ).status,
    400,
  );
  assert.equal((await api('', 'POST', { providerId: 'missing' })).status, 404);
  assert.equal(
    (await api('/providers', 'POST', { name: 'A'.repeat(40000) })).status,
    413,
  );
  assert.equal(calls, 0, 'Configuration must not start inference');
  assert.deepEqual(await (await api('/providers/deepseek/models')).json(), {
    models: ['fixture-model'],
  });
  const customResponse = await api('/providers', 'POST', {
    name: 'Fixture gateway',
    type: 'compatible',
    baseUrl: 'https://fixture.example/v1',
    apiKey: 'fixture-second',
    defaultModel: 'org/model',
  });
  assert.equal(customResponse.status, 201);
  const custom = (await customResponse.json()) as { id: string };
  for (const providerId of ['deepseek', custom.id]) {
    const response = await api('', 'POST', {
      providerId,
      name: 'Managed AI',
      goal: 'Say hello once',
      maxTurns: 1,
    });
    assert.equal(response.status, 201);
    const job = (await response.json()) as { id: string };
    await until(
      () =>
        manager!.list().find((j) => j.id === job.id)?.status === 'completed',
    );
    assert.equal(room.state.players.size, 0);
    assert(
      manager
        .list()
        .find((j) => j.id === job.id)
        ?.logs.some((s) => s.includes('chat')),
    );
  }
  assert.equal(calls, 2);
  const created = [] as string[];
  for (let i = 0; i < 4; i++) {
    const res = await api('', 'POST', {
      providerId: 'deepseek',
      name: `Loop ${i}`,
      goal: 'Observe',
      maxTurns: 1,
      continuous: true,
      intervalMode: 'random',
      intervalMinMs: 60000,
      intervalMaxMs: 60000,
    });
    assert.equal(res.status, 201);
    created.push(((await res.json()) as { id: string }).id);
  }
  await until(() => room.state.players.size === 4);
  await until(() =>
    created.every((id) =>
      manager!
        .list()
        .find((j) => j.id === id)
        ?.logs.some((s) => s.includes('持续运行')),
    ),
  );
  assert([...room.state.players.values()].every((p) => p.kind === 'ai-agent'));
  assert.equal(
    (
      await api('', 'POST', {
        providerId: 'deepseek',
        name: 'Overflow',
        goal: 'Observe',
      })
    ).status,
    409,
  );
  assert.equal((await api('/providers/deepseek', 'DELETE')).status, 409);
  assert.equal((await api(`/${created[0]}/stop`, 'POST', {})).status, 200);
  await until(
    () =>
      manager!.list().find((j) => j.id === created[0])?.status === 'stopped',
  );
  assert.equal(room.state.players.size, 3);
  assert(
    manager
      .list()
      .filter((j) => j.status === 'running')
      .every((j) => j.continuous && j.intervalMode === 'random'),
  );
  assert(
    manager
      .list()
      .find((j) => j.id === created[0])
      ?.logs.some((s) => s.includes('持续运行')),
  );
  await manager.close();
  await until(() => room.state.players.size === 0);
  assert(!JSON.stringify(manager.list()).includes('fixture-secret'));
  assert(
    manager
      .list()
      .every((j) => !['joining', 'running', 'stopping'].includes(j.status)),
  );
  console.log(
    'PASS: origin guard, credential redaction, input limits, provider CRUD/model discovery, multi-provider managed AI join/chat/exit, concurrency limit, explicit stop and shutdown cleanup. Model responses are fixtures.',
  );
} finally {
  await manager?.close();
  await server.gracefullyShutdown(false);
  await rm(dir, { recursive: true, force: true });
}
