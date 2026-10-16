import type { Express } from 'express';
import type { WorldPresence } from '@voxel/shared';

/** Read-only world presence. Viewing the lobby never reserves a player seat. */
export function installPresenceRoutes(
  app: Express,
  read: () => WorldPresence | undefined,
) {
  app.get('/world/presence', (req, res) => {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173')
    ) {
      res.sendStatus(403);
      return;
    }
    if (origin) res.header('Access-Control-Allow-Origin', origin);
    if (!read()) {
      res.sendStatus(503);
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = () => {
      const state = read();
      if (!state) {
        res.end();
        return;
      }
      // A heartbeat on every tick also detects loss of the world service.
      if (!res.writableNeedDrain)
        res.write(`data: ${JSON.stringify(state)}\n\n`);
    };
    const interval = setInterval(send, 1000);
    res.on('close', () => clearInterval(interval));
    send();
  });
}
