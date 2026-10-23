import { installChatRoutes } from './routes/chat.routes';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
import express from 'express';
import { createServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from './world/room';
import { installSpeechRoutes } from './routes/speech.routes';
import { installPresenceRoutes } from './routes/presence.routes';
import { AgentManager, ProviderStore } from './agent/manager';
import { installAgentRoutes } from './routes/agent.routes';
import { installAiChatRoutes } from './routes/ai.routes';
import { installTtsRoutes } from './routes/tts.routes';
import { checkStartupDatabase } from './startup';
import { VoiceServiceStore } from './audio/voice-services';
import { LocalSpeech } from './audio/local-speech';

try {
  await checkStartupDatabase();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const app = express();
app.use((req, res, next) => {
  // 本地游戏服务：允许任意来源（127.0.0.1 / localhost / 局域网 IP）访问。
  // 服务器只监听 127.0.0.1，外部网络无法访问，无跨站风险。
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  next();
});
const speech = new LocalSpeech();
installSpeechRoutes(app, speech);
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
const voiceServices = new VoiceServiceStore();
await voiceServices.load();
server.define('world', WorldRoom, { voiceServices });
const port = Number(process.env.PORT ?? 2567);
const providers = new ProviderStore();
await providers.load();
const agents = new AgentManager(
  providers,
  `ws://127.0.0.1:${port}`,
  undefined,
  voiceServices,
);
installAgentRoutes(app, agents);
installAiChatRoutes(app, providers);
installTtsRoutes(app, voiceServices);
server.onBeforeShutdown(() => agents.close());
await server.listen(port, '127.0.0.1');
const world = await matchMaker.createRoom('world', {});
app.get('/world', (_req, res) => res.json({ roomId: world.roomId }));
await agents.load();
installChatRoutes(
  app,
  () =>
    (matchMaker.getLocalRoomById(world.roomId) as WorldRoom | undefined)?.chat,
  speech,
  () =>
    (matchMaker.getLocalRoomById(world.roomId) as WorldRoom | undefined)
      ?.agentSpeech,
);
installPresenceRoutes(app, () =>
  (
    matchMaker.getLocalRoomById(world.roomId) as WorldRoom | undefined
  )?.getPresence(),
);
console.log(`Voxel server http://127.0.0.1:${port}`);

// restart-1792225922

// switch-1792226151

// switch2-1792226183
// revive-1792226532
// final-1792227174
// gate-1792227252
// ai-route-1792227778
// ai-json-1792227814
// tts-1792284516
// afconvert-1792286226
// male-voice-1792288571
// terrain-v5-1792292778
// memory-1792293010
