import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
import { AgentSpeech } from '../../src/agent/speech';
import { installChatRoutes } from '../../src/routes/chat.routes';
import { LocalTts } from '../../src/audio/local-tts';
import { validatePcmWav } from '../../src/audio/local-speech';
import { Session, until, delay } from '@voxel/agent-runtime';
import type { AgentSpeechEvent } from '@voxel/shared';
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5188';
const real = process.env.REAL_TTS === '1';
const app = express(),
  http = createServer(app),
  server = new Server({
    transport: new WebSocketTransport({ server: http, maxPayload: 16384 }),
    greet: false,
    gracefullyShutdown: false,
  });
server.define('world', WorldRoom);
const sessions: Session[] = [];
try {
  await server.listen(0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {}),
    room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  app.get('/world', (_q, r) => r.json({ roomId: listing.roomId }));
  let synthesisCount = 0;
  const tts = new LocalTts();
  room.agentSpeech.close();
  room.agentSpeech = new AgentSpeech(
    () => room.state.players.values(),
    (recipient, event) =>
      room.clients
        .find((c) => c.sessionId === recipient)
        ?.send('agent.speech', event),
    (_actor, message) => {
      throw Error(message);
    },
    {
      async synthesize(text, signal) {
        synthesisCount++;
        return real
          ? tts.synthesize(text, signal)
          : { bytes: Buffer.from('fixture-pcm'), durationMs: 1000 };
      },
    },
  );
  installChatRoutes(
    app,
    () => room.chat,
    undefined,
    () => room.agentSpeech,
  );
  for (const [name, kind] of [
    ['AI', 'ai-agent'],
    ['Receiver', 'human'],
    ['Other', 'human'],
    ['Far', 'human'],
  ]) {
    const s = new Session(url.replace('http', 'ws'));
    sessions.push(s);
    await s.join(name, kind);
  }
  const [ai, a, b, far] = sessions,
    received: AgentSpeechEvent[][] = sessions.map(() => []);
  sessions.forEach((s, i) =>
    s.room.onMessage('agent.speech', (e: AgentSpeechEvent) =>
      received[i].push(e),
    ),
  );
  await until(() => sessions.every((s) => !!s.chatToken));
  for (const s of sessions.slice(1))
    assert(
      (await s.request('spatial.state', { sending: false, listening: true }))
        .ok,
    );
  assert(!(await a.request('agent.voice', { enabled: true })).ok);
  assert((await ai.request('agent.voice', { enabled: true })).ok);
  const source = room.state.players.get(ai.room.sessionId)!;
  const distant = room.state.players.get(far.room.sessionId)!;
  distant.x = 12;
  distant.z = 12;
  const headers = (s: Session) => ({
    Origin: process.env.WEB_ORIGIN!,
    Authorization: `Bearer ${s.chatToken}`,
  });
  const audio = (event: AgentSpeechEvent, s: Session) =>
    fetch(`${url}/chat/agent-speech/${event.id}`, { headers: headers(s) });
  assert(
    (
      await ai.request('chat', {
        text: '你好，我是这里的建造助手。欢迎来到我们的共享世界。',
      })
    ).ok,
  );
  await until(
    () => received[1].length === 1 && received[2].length === 1,
    30000,
  );
  assert.equal(received[3].length, 0);
  assert.equal(synthesisCount, 1);
  const first = received[1][0];
  assert.equal(first.id, received[2][0].id);
  const wav = await audio(first, a);
  assert.equal(wav.status, 200);
  assert.equal(wav.headers.get('content-type')?.split(';')[0], 'audio/wav');
  const bytes = Buffer.from(await wav.arrayBuffer());
  if (real) assert.equal(validatePcmWav(bytes, 90.5), first.durationMs);
  assert.equal((await audio(first, far)).status, 404);
  await delay(310);
  assert(
    (
      await ai.request('chat', {
        scope: 'private',
        recipients: [a.room.sessionId],
        text: '这是一条私聊语音，只有你可以听见。',
      })
    ).ok,
  );
  await until(() => received[1].length === 2, 30000);
  await delay(100);
  assert.equal(received[2].length, 1);
  assert.equal(received[3].length, 0);
  const secret = received[1][1];
  assert.equal((await audio(secret, b)).status, 404);
  assert.equal((await audio(secret, a)).status, 200);
  assert(
    (await a.request('spatial.state', { sending: false, listening: false })).ok,
  );
  assert.equal((await audio(secret, a)).status, 404);
  assert((await ai.request('agent.voice', { enabled: false })).ok);
  assert.equal((await audio(first, b)).status, 404);
  await delay(310);
  assert((await ai.request('chat', { text: '语音已关闭，这条只有文字。' })).ok);
  await delay(150);
  assert.equal(synthesisCount, 2);
  assert.equal(received[2].length, 1);
  console.log(
    `PASS: ${real ? 'real macOS TTS → FFmpeg WAV' : 'fixture TTS'}, public proximity fanout, private event and HTTP ACL, mute/disable revocation, text-only fallback; no model calls. Agent at ${source.x},${source.z}.`,
  );
} finally {
  await Promise.allSettled(sessions.map((s) => s.close()));
  await server.gracefullyShutdown(false);
}
