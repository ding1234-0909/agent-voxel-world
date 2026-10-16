import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from '../../src/world/room';
// Deliberately never load dotenv, provider stores, saved agents, or production data.
process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.BAILIAN_REALTIME_ENABLED = 'false';
const app = express();
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5188');
  next();
});
const server = new Server({
  transport: new WebSocketTransport({
    server: createServer(app),
    maxPayload: 16384,
  }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
await server.listen(2598, '127.0.0.1');
const room = await matchMaker.createRoom('world', {});
app.get('/world', (_req, res) => res.json({ roomId: room.roomId }));
console.log(
  'Offline memory sandbox: http://127.0.0.1:2598 (real voice disabled)',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void server.gracefullyShutdown(false).then(() => process.exit(0));
  });
