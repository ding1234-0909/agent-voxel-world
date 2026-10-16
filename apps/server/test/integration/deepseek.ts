import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
import { Session, until } from '../../../agent/src/session';
import {
  agentConfig,
  DeepSeekPlanner,
  runAgent,
} from '../../../agent/src/deepseek';
import { houseBlocks, type BuildAction } from '../../../agent/src/building';

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
  const house: Extract<BuildAction, { type: 'house' }> = {
    type: 'house',
    x: 1,
    y: 3,
    z: 0,
    width: 3,
    depth: 3,
    height: 4,
    material: 'wood',
    door: 'west',
  };
  const actions = [
    { type: 'move', x: 1, z: 0, jump: false, durationMs: 300 },
    { type: 'chat', text: 'SDK fixture hello' },
    { type: 'edit', x: 2, y: 3, z: 1, material: 'wood' },
    house,
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
            message: {
              content: JSON.stringify({
                ...actions.shift(),
                task: {
                  intent: 'continue',
                  status: 'running',
                  summary: '继续测试任务',
                },
              }),
            },
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
    maxTurns: 4,
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
    session.events.some(
      (e) =>
        e.type === 'chat' &&
        (e.data as { text: string }).text === 'SDK fixture hello',
    ),
  );
  const blueprint = houseBlocks(house);
  assert.equal(blueprint.length, 32);
  assert.equal(
    last.revision,
    first.revision + blueprint.length,
    JSON.stringify({
      self: last.self,
      missing: blueprint.filter(
        (b) => !room.blocks.has(`${b.x},${b.y},${b.z}`),
      ),
    }),
  );
  for (const block of blueprint)
    assert.equal(
      room.blocks.get(`${block.x},${block.y},${block.z}`)?.material,
      'wood',
    );
  assert.equal(room.blocks.has('1,4,1'), false, 'door remains open');
  assert.equal(room.blocks.has('2,4,1'), false, 'interior remains hollow');
  assert.equal(room.blocks.get('2,3,1')?.material, 'wood');
  assert.equal(
    calls.length,
    4,
    'one model call constructs all 32 house blocks',
  );
  assert(
    JSON.parse(calls[1].body as string).messages[1].content.includes(
      '移动输入已发送',
    ),
  );
  await session.close();
  await session.close(); // SIGINT + finally cleanup must be idempotent.
  await until(() => room.state.players.size === 0);
  console.log(
    'PASS: OpenAI SDK JSON requests, AI identity, movement, chat, a 32-block hollow house from one model call with revision-checked edits, idempotent cleanup. Inference uses fixture responses, no external API calls.',
  );
} finally {
  await session?.close();
  await server.gracefullyShutdown(false);
}
