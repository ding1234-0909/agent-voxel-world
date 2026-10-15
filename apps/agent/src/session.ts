import { Client, type Room } from 'colyseus.js';
import type { Snapshot, Edit, Player, Block, WorldEvent } from '@voxel/shared';
export type Observation = {
  id: string;
  revision: number;
  self: Player;
  players: Player[];
  blocks: Block[];
  events: WorldEvent[];
  radius: number;
  allowedActions: string[];
};
export type Result = {
  id: string;
  ok: boolean;
  error?: string;
  revision: number;
};
export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
export async function until(predicate: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout)
      throw Error('Timed out waiting for state');
    await delay(25);
  }
}
export class Session {
  room!: Room;
  client: Client;
  constructor(
    private serverUrl = process.env.SERVER_URL ?? 'ws://127.0.0.1:2567',
  ) {
    this.client = new Client(serverUrl);
  }
  snapshot?: Snapshot;
  edits: Edit[] = [];
  events: WorldEvent[] = [];
  voice: unknown[] = [];
  chatToken = '';
  spatialSignals: unknown[] = [];
  private id = 0;
  private roomOpen = false;
  private closing?: Promise<void>;
  private pending = new Map<string, (value: any) => void>();
  async join(name: string, kind = 'scripted-agent') {
    const endpoint = this.serverUrl.replace(/^ws/, 'http');
    const info = (await fetch(`${endpoint}/world`).then((r) => r.json())) as {
      roomId: string;
    };
    this.attach(await this.client.joinById(info.roomId, { name, kind }));
    await until(() => !!this.snapshot);
    return this;
  }
  attach(room: Room) {
    this.room = room;
    this.roomOpen = true;
    this.closing = undefined;
    room.onLeave(() => {
      if (this.room === room) this.roomOpen = false;
    });
    room.onMessage('chat.auth', (v: { token: string }) => {
      this.chatToken = v.token;
    });
    room.onMessage('spatial.signal', (value) => {
      this.spatialSignals.push(value);
      if (this.spatialSignals.length > 100) this.spatialSignals.shift();
    });
    room.onMessage('snapshot', (s: Snapshot) => (this.snapshot = s));
    room.onMessage('edit', (e: Edit) => {
      this.edits.push(e);
      if (this.edits.length > 512) this.edits.shift();
    });
    room.onMessage('event', (e: WorldEvent) => {
      this.events.push(e);
      if (this.events.length > 100) this.events.shift();
    });
    room.onMessage('voice', (value) => {
      this.voice.push(value);
      if (this.voice.length > 100) this.voice.shift();
    });
    for (const type of ['result', 'observation'])
      room.onMessage(type, (value: { id: string }) => {
        this.pending.get(value.id)?.(value);
        this.pending.delete(value.id);
      });
    room.send('sync');
  }
  async request<T = Result>(type: string, payload: unknown = {}): Promise<T> {
    const id = `agent-${++this.id}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Timeout: ${type}`));
      }, 5000);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.room.send('action', { id, type, payload });
    });
  }
  move(x: number, z: number, jump = false) {
    this.room.send('action', {
      id: `move-${++this.id}`,
      type: 'move',
      payload: { x, z, jump, yaw: 0 },
    });
  }
  observe() {
    return this.request<Observation>('observe');
  }
  async reconnect() {
    const token = this.room.reconnectionToken;
    this.room.connection.close();
    await delay(200);
    this.attach(await this.client.reconnect(token));
    await delay(100);
  }
  async close() {
    if (this.closing) return this.closing;
    if (!this.roomOpen) return;
    const room = this.room;
    this.closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          room.leave(true),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 1500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        room.connection.close();
        this.roomOpen = false;
      }
    })();
    return this.closing;
  }
}
