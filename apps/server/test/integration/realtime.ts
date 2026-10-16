import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
import { Session, until, delay } from '../../../agent/src/session';
import type { RealtimeEvent } from '../../../../packages/shared/src/realtime';
// Isolated ephemeral world. Does not load .env, provider stores, agents, credentials or production data.
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.BAILIAN_REALTIME_ENABLED = 'false';
const app = express(),
  http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http, maxPayload: 16384 }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
const sessions: Session[] = [];
try {
  await server.listen(0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  app.get('/world', (_q, r) => r.json({ roomId: listing.roomId }));
  const url = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  for (const kind of ['human', 'human', 'scripted-agent']) {
    const s = new Session(url);
    sessions.push(s);
    await s.join(`test-${sessions.length}`, kind);
  }
  const [a, b, agent] = sessions;
  const events: RealtimeEvent[] = [],
    other: RealtimeEvent[] = [];
  a.room.onMessage('realtime', (e: RealtimeEvent) => events.push(e));
  b.room.onMessage('realtime', (e: RealtimeEvent) => other.push(e));
  agent.room.onMessage('realtime', () =>
    assert.fail('agent received private audio'),
  );
  const start = { mode: 'demo', sceneConsent: true, request: 'offline-test' };
  assert(!(await agent.request('realtime.start', start)).ok);
  assert.equal(
    (
      await a.request('realtime.start', {
        mode: 'real',
        audioConsent: true,
        request: 'real-disabled',
      })
    ).error,
    'bailian-disabled',
  );
  events.length = 0;
  assert((await a.request('realtime.start', start)).ok);
  await until(() => events.some((e) => e.kind === 'ready'));
  const session = events.find((e) => e.kind === 'ready')!.session;
  assert(
    (await a.request('realtime.commit', { session, text: 'offline fixture' }))
      .ok,
  );
  await until(() => events.some((e) => e.kind === 'done'));
  const proposal = events.find((e) => e.kind === 'proposal')!.proposal!;
  assert(events.some((e) => e.kind === 'audio'));
  assert.equal(a.edits.length, 0, 'model proposal must not edit');
  assert.equal(other.length, 0, 'private voice events must not broadcast');
  assert(
    !(await b.request('realtime.approve', { session, proposalId: proposal.id }))
      .ok,
  );
  assert(
    (await a.request('realtime.approve', { session, proposalId: proposal.id }))
      .ok,
  );
  await until(() => sessions.every((s) => s.edits.length === 1));
  assert(
    !(await a.request('realtime.approve', { session, proposalId: proposal.id }))
      .ok,
  );
  assert((await a.request('realtime.stop', { session })).ok);
  assert(!(await a.request('realtime.commit', { session, text: 'stale' })).ok);
  assert(
    (
      await a.request('realtime.start', {
        ...start,
        request: 'disconnect-test',
      })
    ).ok,
  );
  await until(() => events.filter((e) => e.kind === 'ready').length === 2);
  const disconnected = events.filter((e) => e.kind === 'ready').at(-1)!.session;
  await a.close();
  const replacement = new Session(url);
  sessions.push(replacement);
  await replacement.join('replacement', 'human');
  replacement.room.onMessage('realtime', () => {});
  assert(
    !(
      await replacement.request('realtime.commit', {
        session: disconnected,
        text: 'stale',
      })
    ).ok,
  );
  await delay(50);
  console.log(
    'PASS: isolated 2 players + scripted agent; real gate; private demo audio; tool proposal approval; synchronized edit; replay and disconnect rejection.',
  );
} finally {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  await server.gracefullyShutdown(false);
}
