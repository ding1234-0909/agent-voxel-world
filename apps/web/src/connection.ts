import { Client, type Room } from 'colyseus.js';
import {
  key,
  type Block,
  type Player,
  type Snapshot,
  type Edit,
  type WorldEvent,
} from '@voxel/shared';
export class Connection {
  room?: Room;
  blocks = new Map<string, Block>();
  players: Player[] = [];
  revision = 0;
  status = 'lobby';
  persistence = 'memory';
  messages: string[] = [];
  onChange = () => {};
  onBlocks = () => {};
  onVoice = (value: unknown) => {};
  private counter = 0;
  private stopped = false;
  async connect(name: string) {
    if (
      this.stopped ||
      this.status === 'connecting' ||
      this.status === 'connected'
    )
      return;
    this.status = 'connecting';
    this.onChange();
    const client = new Client(
      import.meta.env.VITE_SERVER_URL ?? 'ws://127.0.0.1:2567',
    );
    try {
      const token = sessionStorage.getItem('voxel-reconnect');
      let room: Room;
      try {
        if (!token) throw Error('new');
        room = await client.reconnect(token);
      } catch {
        const endpoint = (
          import.meta.env.VITE_SERVER_URL ?? 'ws://127.0.0.1:2567'
        ).replace(/^ws/, 'http');
        const info = await fetch(`${endpoint}/world`).then((r) => r.json());
        room = await client.joinById(info.roomId, { name });
      }
      this.room = room;
      sessionStorage.setItem('voxel-reconnect', room.reconnectionToken);
      room.onMessage('snapshot', (s: Snapshot) => {
        this.blocks = new Map(s.blocks.map((b) => [key(b), b]));
        this.revision = s.revision;
        this.persistence = s.persistence;
        this.onBlocks();
        this.onChange();
      });
      room.onMessage('edit', (e: Edit) => {
        if (e.revision !== this.revision + 1) {
          room.send('sync');
          return;
        }
        if (e.material === null) this.blocks.delete(key(e));
        else
          this.blocks.set(key(e), {
            x: e.x,
            y: e.y,
            z: e.z,
            material: e.material,
          });
        this.revision = e.revision;
        this.onBlocks();
        this.onChange();
      });
      room.onMessage('event', (e: WorldEvent) => {
        if (e.type === 'chat') {
          const d = e.data as { name: string; text: string };
          this.messages = [...this.messages, `${d.name}: ${d.text}`].slice(-30);
          this.onChange();
        }
      });
      room.onMessage('result', (r: { ok: boolean; error?: string }) => {
        if (!r.ok) {
          this.messages = [...this.messages, `⚠ ${r.error}`].slice(-30);
          this.onChange();
        }
      });
      room.onMessage('voice', (value) => this.onVoice(value));
      room.onMessage('observation', () => {});
      room.onStateChange((state) => {
        this.players = [...state.players.values()].map((p: Player) => ({
          ...p,
        }));
        this.onChange();
      });
      room.onLeave(() => {
        this.status = 'disconnected';
        this.onVoice({
          state: 'interrupted',
          subtitle: '连接中断，语音会话已停止。',
        });
        this.onChange();
        setTimeout(() => {
          if (!this.stopped && this.status === 'disconnected')
            void this.connect(name);
        }, 1000);
      });
      room.onError((_code, message) => {
        this.messages.push(`Connection: ${message}`);
        this.onChange();
      });
      this.status = 'connected';
      room.send('sync');
      this.onChange();
    } catch (error) {
      this.status = 'offline';
      this.messages.push(String(error));
      this.onChange();
      setTimeout(() => {
        if (!this.stopped && this.status === 'offline') void this.connect(name);
      }, 3000);
    }
  }
  action(type: string, payload: unknown = {}) {
    if (this.status === 'connected' && this.room) {
      const id = `web-${++this.counter}`;
      this.room.send('action', { id, type, payload });
      return id;
    }
  }
  dispose() {
    this.stopped = true;
    this.room?.connection.close();
  }
  get self() {
    return this.players.find((p) => p.id === this.room?.sessionId);
  }
}
