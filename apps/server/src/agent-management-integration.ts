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
import { Session, until, type Observation } from '../../agent/src/session';
import { ModelPlanner } from '../../agent/src/deepseek';
import type { ManagedAgentView } from '@voxel/shared';
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
const observations: Observation[] = [];
let speaker: Session | undefined;
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
    planner: (config, provider) => {
      const planner = new ModelPlanner(config, request, provider);
      const decide = planner.decide.bind(planner);
      planner.decide = (...args) => {
        observations.push(args[0]);
        return decide(...args);
      };
      return planner;
    },
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
  const missingRoute = await api('/missing/endpoint', 'POST', {});
  assert.equal(missingRoute.status, 404);
  assert.equal(typeof (await missingRoute.json()).error, 'string');
  const missingAgent = await api('/nonexistent/resume', 'POST', {});
  assert.equal(missingAgent.status, 404);
  assert.equal(typeof (await missingAgent.json()).error, 'string');
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
      () => manager!.list().find((j) => j.id === job.id)?.status === 'idle',
    );
    assert.equal(
      room.state.players.size,
      1,
      'completed rounds keep the player online',
    );
    const idle: ManagedAgentView = manager.list().find((j) => j.id === job.id)!;
    const original = room.state.players.get(idle.sessionId!)!;
    const originalPosition = { x: original.x, y: original.y, z: original.z };
    assert.equal(
      (await api(`/${job.id}/resume`, 'POST', { goal: 'A different task' }))
        .status,
      200,
    );
    await until(
      () => manager!.list().find((j) => j.id === job.id)?.status === 'idle',
    );
    const resumed: ManagedAgentView = manager
      .list()
      .find((j) => j.id === job.id)!;
    assert.equal(resumed.sessionId, idle.sessionId);
    assert.equal(resumed.goal, 'A different task');
    const current = room.state.players.get(resumed.sessionId!)!;
    assert.deepEqual(
      { x: current.x, y: current.y, z: current.z },
      originalPosition,
    );
    assert(
      manager
        .list()
        .find((j) => j.id === job.id)
        ?.logs.some((s) => s.includes('chat')),
    );
    const callsWhenIdle: number = calls;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(calls, callsWhenIdle, 'idle does not invoke the model');
    const edited = await api(`/${job.id}`, 'PUT', {
      name: 'Renamed AI',
      intervalMode: 'random',
      intervalMinMs: 4000,
      intervalMaxMs: 8000,
      maxTokens: 1024,
    });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).sessionId, idle.sessionId);
    assert.equal(room.state.players.get(idle.sessionId!)!.name, 'Renamed AI');
    assert.deepEqual(
      { x: current.x, y: current.y, z: current.z },
      originalPosition,
    );
    assert.equal(calls, callsWhenIdle);
    speaker = new Session(url.replace('http', 'ws'));
    await speaker.join('Human caller', 'human');
    await speaker.request('chat', {
      text: '@Renamed AI change site',
      scope: 'public',
    });
    await until(
      () =>
        calls === callsWhenIdle + 1 &&
        manager!.list().find((j) => j.id === job.id)?.status === 'idle',
    );
    assert.equal(observations.at(-1)?.attention?.actor, speaker.room.sessionId);
    assert.equal(
      manager.list().find((j) => j.id === job.id)?.sessionId,
      idle.sessionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    await speaker.request('chat', {
      text: 'Private instruction',
      scope: 'private',
      recipients: [idle.sessionId],
    });
    await until(
      () =>
        calls === callsWhenIdle + 2 &&
        manager!.list().find((j) => j.id === job.id)?.status === 'idle',
    );
    assert.equal(
      (observations.at(-1)?.attention?.data as { scope: string }).scope,
      'private',
    );
    await until(() =>
      speaker!.events.some(
        (e) =>
          e.actor === idle.sessionId &&
          (e.data as { scope?: string }).scope === 'private',
      ),
    );
    await speaker.close();
    speaker = undefined;
    assert.equal((await api(`/${job.id}/stop`, 'POST', {})).status, 200);
    await until(
      () => manager!.list().find((j) => j.id === job.id)?.status === 'stopped',
    );
    assert.equal(room.state.players.size, 0);
    assert(
      manager.list().some((j) => j.id === job.id),
      'closing retains reusable config',
    );
  }
  assert.equal(calls, 8);
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
    created.every(
      (id) =>
        manager!.list().find((j) => j.id === id)?.task?.status === 'completed',
    ),
  );
  assert([...room.state.players.values()].every((p) => p.kind === 'ai-agent'));
  speaker = new Session(url.replace('http', 'ws'));
  await speaker.join('Human caller', 'human');
  const sleeping = manager.list().find((j) => j.id === created[0])!;
  const beforeWake = calls;
  assert.equal(
    (await api(`/${created[0]}`, 'PUT', { maxTurns: 9 })).status,
    200,
  );
  await speaker.request('chat', {
    text: 'Wake now',
    scope: 'public',
    recipients: [sleeping.sessionId],
  });
  await until(() => calls === beforeWake + 1, 3000);
  assert.equal(
    observations.at(-1)?.self.id,
    sleeping.sessionId,
    'only the addressed agent skips its 60s interval',
  );
  await speaker.close();
  speaker = undefined;
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
    manager.list().find((j) => j.id === created[0])?.task?.status ===
      'completed',
  );
  await manager.close();
  await until(() => room.state.players.size === 0);
  assert(!JSON.stringify(manager.list()).includes('fixture-secret'));
  assert(
    manager
      .list()
      .every((j) => !['joining', 'running', 'stopping'].includes(j.status)),
  );
  const beforeRestore = calls;
  manager = new AgentManager(store, url.replace('http', 'ws'), {
    session: (url) => new Session(url),
    planner: (config, provider) => new ModelPlanner(config, request, provider),
    models: async () => ['fixture-model'],
  });
  await manager.load();
  assert.equal(calls, beforeRestore, 'restoration never spends inference');
  assert.equal(room.state.players.size, 3);
  assert.equal(manager.list().filter((j) => j.status === 'idle').length, 3);
  const stopped = manager.list().find((j) => j.id === created[0])!;
  assert.equal(stopped.status, 'stopped');
  manager.resume(stopped.id);
  assert.throws(() => manager!.resume(stopped.id), /正在运行/);
  await until(
    () => manager!.list().find((j) => j.id === stopped.id)?.status === 'idle',
  );
  assert.equal(room.state.players.size, 4);
  assert.throws(
    () =>
      manager!.create({ providerId: 'deepseek', name: 'overflow', goal: 'Hi' }),
    /最多同时在线/,
  );
  for (const j of manager.list().filter((j) => j.sessionId)) manager.stop(j.id);
  await until(() => room.state.players.size === 0);
  console.log(
    'PASS: origin guard, credential redaction, task completion stays online, reuse preserves player identity/position, task replacement, idle spends no inference, close/rejoin, online capacity and restart restoration without inference. Model responses are fixtures.',
  );
} finally {
  await speaker?.close();
  await manager?.close();
  await server.gracefullyShutdown(false);
  await rm(dir, { recursive: true, force: true });
}
