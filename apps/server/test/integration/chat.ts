import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
import { installChatRoutes } from '../../src/routes/chat.routes';
import { LocalSpeech } from '../../src/audio/local-speech';
import { Session, until, delay } from '../../../agent/src/session';
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5187';
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
  const speech = new LocalSpeech();
  speech.normalize = async () => ({
    bytes: Buffer.from('normalized-audio'),
    durationMs: 1000,
  });
  speech.transcribe = async () => 'fixture transcript';
  installChatRoutes(app, () => room.chat, speech);
  for (const [name, kind] of [
    ['Sender', 'human'],
    ['Receiver', 'human'],
    ['AI', 'ai-agent'],
    ['Outsider', 'human'],
  ]) {
    const s = new Session(url.replace('http', 'ws'));
    sessions.push(s);
    await s.join(name, kind);
  }
  const [a, b, ai, out] = sessions,
    ids = sessions.map((s) => s.room.sessionId);
  await until(() => sessions.every((s) => !!s.chatToken));
  assert((await a.request('chat', { text: 'public hello' })).ok);
  await until(() =>
    sessions.every((s) => s.events.some((e) => e.type === 'chat')),
  );
  await delay(310);
  const secret = 'only recipients can see';
  assert(
    (
      await a.request('chat', {
        text: secret,
        scope: 'private',
        recipients: [ids[1], ids[2]],
      })
    ).ok,
  );
  await until(() => ai.events.some((e) => (e.data as any).text === secret));
  await delay(100);
  assert(!out.events.some((e) => (e.data as any).text === secret));
  for (const s of [a, b, ai])
    assert(
      (await s.observe()).events.some((e) => (e.data as any).text === secret),
    );
  assert(
    !(await out.observe()).events.some((e) => (e.data as any).text === secret),
  );
  assert(
    !(
      await a.request('chat', {
        text: 'invalid',
        scope: 'private',
        recipients: ['offline'],
      })
    ).ok,
  );
  const headers = (s: Session) => ({
    Origin: process.env.WEB_ORIGIN!,
    Authorization: `Bearer ${s.chatToken}`,
  });
  const upload = await fetch(
    `${url}/chat/audio?scope=private&to=${ids[1]},${ids[2]}`,
    {
      method: 'POST',
      headers: { ...headers(a), 'Content-Type': 'audio/webm' },
      body: 'fixture-encoded',
    },
  );
  assert.equal(upload.status, 201);
  const clip = (await upload.json()) as {
    audioId: string;
    transcriptAvailable: boolean;
  };
  assert(clip.transcriptAvailable);
  await until(() =>
    ai.events.some((e) => (e.data as any).audioId === clip.audioId),
  );
  assert(!out.events.some((e) => (e.data as any).audioId === clip.audioId));
  for (const s of [a, b, ai])
    assert.equal(
      (
        await fetch(`${url}/chat/audio/${clip.audioId}`, {
          headers: headers(s),
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await fetch(`${url}/chat/audio/${clip.audioId}`, {
        headers: headers(out),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${url}/chat/audio/${clip.audioId}`, {
        headers: { Origin: process.env.WEB_ORIGIN! },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${url}/chat/audio/${clip.audioId}`, {
        headers: { ...headers(a), Origin: 'https://other.example' },
      })
    ).status,
    403,
  );
  const oldToken = b.chatToken;
  await b.reconnect();
  assert.notEqual(oldToken, b.chatToken);
  assert.equal(
    (
      await fetch(`${url}/chat/audio/${clip.audioId}`, {
        headers: { ...headers(b), Authorization: `Bearer ${oldToken}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(`${url}/chat/audio/${clip.audioId}`, { headers: headers(b) }))
      .status,
    200,
  );
  // Only explicitly participating humans receive signaling, never agents or bystanders.
  assert(
    (await a.request('spatial.state', { sending: true, listening: false })).ok,
  );
  assert(
    (await b.request('spatial.state', { sending: false, listening: true })).ok,
  );
  assert(
    !(await ai.request('spatial.state', { sending: true, listening: true })).ok,
  );
  a.room.send('action', {
    id: 'signal',
    type: 'spatial.signal',
    payload: { to: ids[1], description: { type: 'offer', sdp: 'fixture' } },
  });
  await until(() => b.spatialSignals.length === 1);
  assert.equal(out.spatialSignals.length, 0);
  assert.equal(ai.spatialSignals.length, 0);
  assert(
    (await b.request('spatial.state', { sending: false, listening: false })).ok,
  );
  a.room.send('action', {
    id: 'signal2',
    type: 'spatial.signal',
    payload: { to: ids[1], description: { type: 'offer', sdp: 'fixture' } },
  });
  await delay(100);
  assert.equal(b.spatialSignals.length, 1);
  a.room.send('action', {
    id: 'yaw',
    type: 'move',
    payload: { x: 0, z: 0, jump: false, yaw: 1.2 },
  });
  await delay(450);
  assert(Math.abs(room.state.players.get(ids[0])!.yaw - 1.2) < 0.001);
  // Nearby speech uses authenticated, single-use capture tickets and restricted events.
  room.state.players.get(ids[2])!.x = room.state.players.get(ids[0])!.x;
  room.state.players.get(ids[2])!.z = room.state.players.get(ids[0])!.z - 2;
  const startSpeech = async () =>
    fetch(`${url}/chat/spatial/start`, { method: 'POST', headers: headers(a) });
  const ticketResponse = await startSpeech();
  assert.equal(ticketResponse.status, 200);
  const ticket = (await ticketResponse.json()) as { id: string };
  const captionResponse = await fetch(`${url}/chat/spatial/${ticket.id}`, {
    method: 'POST',
    headers: { ...headers(a), 'Content-Type': 'audio/webm' },
    body: 'fixture speech',
  });
  assert.equal(captionResponse.status, 200);
  const caption = (await captionResponse.json()) as {
    scope: string;
    recipients: string[];
  };
  assert.equal(caption.scope, 'nearby');
  assert(caption.recipients.includes(ids[2]));
  assert(!caption.recipients.includes(ids[3]));
  await until(() => ai.events.some((e) => (e.data as any).scope === 'nearby'));
  assert(
    (await ai.observe()).events.some((e) => (e.data as any).scope === 'nearby'),
  );
  assert(
    !(await out.observe()).events.some(
      (e) => (e.data as any).scope === 'nearby',
    ),
  );
  assert.equal(
    (
      await fetch(`${url}/chat/spatial/${ticket.id}`, {
        method: 'POST',
        headers: { ...headers(a), 'Content-Type': 'audio/webm' },
        body: 'replay',
      })
    ).status,
    409,
  );
  const late = (await (await startSpeech()).json()) as { id: string };
  await a.request('spatial.state', { sending: false, listening: false });
  assert.equal(
    (
      await fetch(`${url}/chat/spatial/${late.id}`, {
        method: 'POST',
        headers: { ...headers(a), 'Content-Type': 'audio/webm' },
        body: 'late',
      })
    ).status,
    409,
  );
  assert.equal((await startSpeech()).status, 409);
  // A mute also aborts an already-running inference; a late completion cannot publish.
  await a.request('spatial.state', { sending: true, listening: false });
  const inflightTicket = (await (await startSpeech()).json()) as { id: string };
  let inferenceSignal: AbortSignal | undefined,
    finishInference!: (text: string) => void;
  speech.transcribe = async (_audio, _type, _language, signal) => {
    inferenceSignal = signal;
    return new Promise((resolve) => {
      finishInference = resolve;
    });
  };
  const inFlight = fetch(`${url}/chat/spatial/${inflightTicket.id}`, {
    method: 'POST',
    headers: { ...headers(a), 'Content-Type': 'audio/webm' },
    body: 'inflight',
  });
  await until(() => !!inferenceSignal);
  const beforeCancel = ai.events.filter(
    (e) => (e.data as any).scope === 'nearby',
  ).length;
  await a.request('spatial.state', { sending: false, listening: false });
  assert(inferenceSignal!.aborted);
  finishInference('must never publish');
  assert.equal((await inFlight).status, 400);
  await delay(60);
  assert.equal(
    ai.events.filter((e) => (e.data as any).scope === 'nearby').length,
    beforeCancel,
  );
  const token = a.chatToken;
  await a.close();
  await until(() => !room.state.players.has(ids[0]));
  assert.throws(() => room.chat.authenticate(token));
  console.log(
    'PASS: four real WebSocket clients, public/private events and agent observation isolation, private audio HTTP ACL, token rotation/revocation, origin checks, opt-in human-only signaling, nearby speech agent delivery/observation isolation, replay/mute rejection, idle yaw. Audio conversion/transcript are fixtures.',
  );
} finally {
  await Promise.all(sessions.map((s) => s.close()));
  await server.gracefullyShutdown(false);
}
