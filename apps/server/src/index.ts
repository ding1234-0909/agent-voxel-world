import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from './room';
const app = express();
app.use((req, res, next) => {
  if (
    req.headers.origin === (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173')
  )
    res.header('Access-Control-Allow-Origin', req.headers.origin);
  next();
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    protocol: 1,
    persistence: process.env.DATABASE_URL ? 'postgresql' : 'memory',
    voice: process.env.VOICE_PROVIDER ?? 'mock',
    voiceProviders: [
      'mock',
      'browser',
      ...(process.env.OLLAMA_MODEL ? ['ollama'] : []),
    ],
  }),
);
const http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http, maxPayload: 16384 }),
  greet: false,
});
server.define('world', WorldRoom);
const port = Number(process.env.PORT ?? 2567);
await server.listen(port, '127.0.0.1');
const world = await matchMaker.createRoom('world', {});
app.get('/world', (_req, res) => res.json({ roomId: world.roomId }));
console.log(`Voxel server http://127.0.0.1:${port}`);
