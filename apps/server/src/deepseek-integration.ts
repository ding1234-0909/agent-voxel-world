import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from './room';
import { Session, until } from '../../agent/src/session';
import {
  agentConfig,
  DeepSeekPlanner,
  runAgent,
} from '../../agent/src/deepseek';

process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
const app = express(),
  http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
let session: Session | undefined;
try {
  await server.listen(0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
  process.env.SERVER_URL = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  session = await new Session().join('DeepSeek fixture', 'ai-agent');
  const first = await session.observe();
  assert.equal(first.self.kind, 'ai-agent');
  const actions = [
    { type: 'move', x: 1, z: 0, jump: false, durationMs: 300 },
    { type: 'chat', text: 'SDK fixture hello' },
    { type: 'edit', x: 2, y: 3, z: 1, material: 'wood' },
  ];
  const calls: RequestInit[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    calls.push(init!);
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(actions.shift()) },
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  const config = {
    ...agentConfig({
      DEEPSEEK_API_KEY: 'fixture-only',
      AGENT_ALLOW_EDITS: 'true',
    }),
    maxTurns: 3,
    intervalMs: 0,
  };
  await runAgent(
    session,
    new DeepSeekPlanner(config, request),
    config,
    new AbortController().signal,
    () => {},
  );
  const last = await session.observe();
  assert(last.self.x > first.self.x);
  assert(
    last.events.some(
      (e) =>
        e.type === 'chat' &&
        (e.data as { text: string }).text === 'SDK fixture hello',
    ),
  );
  assert.equal(last.revision, first.revision + 1);
  assert.equal(room.blocks.get('2,3,1')?.material, 'wood');
  assert.equal(calls.length, 3);
  assert(
    JSON.parse(calls[1].body as string).messages[1].content.includes(
      '移动输入已发送',
    ),
  );
  await session.close();
  await session.close(); // SIGINT + finally cleanup must be idempotent.
  await until(() => room.state.players.size === 0);
  console.log(
    'PASS: OpenAI SDK JSON requests, AI identity, observations, movement, chat, revision-checked edits, idempotent cleanup. Inference uses fixture responses, no external API calls.',
  );
} finally {
  await session?.close();
  await server.gracefullyShutdown(false);
}
