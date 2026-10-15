import { Client, type Room } from 'colyseus.js';
import {
  key,
  type Block,
  type Player,
  type Snapshot,
  type Edit,
  type WorldEvent,
  type ChatEntry,
  type AgentSpeechEvent,
} from '@voxel/shared';
export class Connection {
  room?: Room;
  blocks = new Map<string, Block>();
  players: Player[] = [];
  revision = 0;
  status = 'lobby';
  persistence = 'memory';
  messages: string[] = [];
  chats: ChatEntry[] = [];
  chatToken = '';
  private recording = false;
  get chatRecording() {
    return this.recording;
  }
  set chatRecording(value: boolean) {
    if (value !== this.recording) {
      this.recording = value;
      this.onChange();
    }
  }
  voiceLabRecording = false;
  stopSpatialInput = () => {};
  onSpatialSignal: (value: any) => void = () => {};
  onAgentSpeech: (value: AgentSpeechEvent) => void = () => {};
  private replies = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  async requestAction(type: string, payload: unknown) {
    if (this.status !== 'connected') throw Error('尚未连接世界。');
    const id = this.action(type, payload)!;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.replies.delete(id);
        reject(Error('发送超时，请检查连接。'));
      }, 8000);
      this.replies.set(id, { resolve, reject, timer });
    });
  }
  private clearCommunication() {
    this.chatToken = '';
    this.stopSpatialInput();
    for (const reply of this.replies.values()) {
      clearTimeout(reply.timer);
      reply.reject(Error('游戏连接已断开。'));
    }
    this.replies.clear();
  }
  onChange = () => {};
  onBlocks = () => {};
  onVoice = (value: unknown) => {};
  private counter = 0;
  private stopped = false;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  async connect(name: string) {
    if (
      this.stopped ||
      this.status === 'connecting' ||
      this.status === 'connected'
    )
      return;
    const generation = ++this.generation;
    const current = () => !this.stopped && generation === this.generation;
    clearTimeout(this.retry);
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
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
        if (!current()) return;
        const endpoint = (
          import.meta.env.VITE_SERVER_URL ?? 'ws://127.0.0.1:2567'
        ).replace(/^ws/, 'http');
        const info = await fetch(`${endpoint}/world`, {
          signal: request.signal,
        }).then((r) => {
          if (!r.ok) throw Error(`World service: HTTP ${r.status}`);
          return r.json();
        });
        if (!current()) return;
        room = await client.joinById(info.roomId, { name });
      }
      if (!current()) {
        void room.leave(true).catch(() => room.connection.close());
        return;
      }
      this.room = room;
      const activeRoom = () => current() && this.room === room;
      sessionStorage.setItem('voxel-reconnect', room.reconnectionToken);
      room.onMessage('snapshot', (s: Snapshot) => {
        if (!activeRoom()) return;
        this.blocks = new Map(s.blocks.map((b) => [key(b), b]));
        this.revision = s.revision;
        this.persistence = s.persistence;
        this.onBlocks();
        this.onChange();
      });
      room.onMessage('edit', (e: Edit) => {
        if (!activeRoom()) return;
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
      room.onMessage('chat.auth', (value: { token: string }) => {
        if (activeRoom()) {
          this.chatToken = value.token;
          this.onChange();
        }
      });
      room.onMessage('spatial.signal', (value) => {
        if (activeRoom()) this.onSpatialSignal(value);
      });
      room.onMessage('agent.speech', (value: AgentSpeechEvent) => {
        if (activeRoom()) this.onAgentSpeech(value);
      });
      room.onMessage('event', (e: WorldEvent) => {
        if (!activeRoom()) return;
        if (e.type === 'chat') {
          this.chats = [...this.chats, e as ChatEntry].slice(-50);
          const d = e.data as { name: string; text: string };
          this.messages = [...this.messages, `${d.name}: ${d.text}`].slice(-30);
          this.onChange();
        }
      });
      room.onMessage(
        'result',
        (r: { id?: string; ok: boolean; error?: string }) => {
          if (!activeRoom()) return;
          const reply = r.id ? this.replies.get(r.id) : undefined;
          if (reply) {
            clearTimeout(reply.timer);
            this.replies.delete(r.id!);
            if (r.ok) reply.resolve();
            else reply.reject(Error(r.error || '发送失败。'));
          }
          if (!r.ok && r.error !== 'voice-provider-unavailable') {
            this.messages = [...this.messages, `⚠ ${r.error}`].slice(-30);
            this.onChange();
          }
        },
      );
      room.onMessage('voice', (value) => {
        if (activeRoom()) this.onVoice(value);
      });
      room.onMessage('observation', () => {});
      room.onStateChange((state) => {
        if (!activeRoom()) return;
        this.players = [...state.players.values()].map((p: Player) => ({
          ...p,
        }));
        this.onChange();
      });
      room.onLeave(() => {
        if (!activeRoom()) return;
        this.clearCommunication();
        this.room = undefined;
        this.status = 'disconnected';
        this.onVoice({
          state: 'interrupted',
          subtitle: '连接中断，语音会话已停止。',
        });
        this.onChange();
        this.retry = setTimeout(() => {
          if (current() && this.status === 'disconnected')
            void this.connect(name);
        }, 1000);
      });
      room.onError((_code, message) => {
        if (!activeRoom()) return;
        this.messages.push(`Connection: ${message}`);
        this.onChange();
      });
      this.status = 'connected';
      room.send('sync');
      this.onChange();
    } catch (error) {
      if (!current()) return;
      this.status = 'offline';
      this.messages.push(String(error));
      this.onChange();
      this.retry = setTimeout(() => {
        if (current() && this.status === 'offline') void this.connect(name);
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
  /** Explicit exit: leave consentfully, invalidate pending joins and disable retries. */
  leave() {
    this.generation++;
    clearTimeout(this.retry);
    this.request?.abort();
    const room = this.room;
    this.room = undefined;
    this.status = 'lobby';
    this.players = [];
    this.messages = [];
    this.chats = [];
    this.clearCommunication();
    sessionStorage.removeItem('voxel-reconnect');
    sessionStorage.removeItem('voxel-name');
    this.onVoice({
      state: 'idle',
      subtitle: '已退出游戏，录音、识别和朗读已停止。',
    });
    this.onChange();
    if (room) void room.leave(true).catch(() => room.connection.close());
  }
  dispose() {
    this.clearCommunication();
    this.stopped = true;
    this.generation++;
    clearTimeout(this.retry);
    this.request?.abort();
    this.room?.connection.close();
    this.room = undefined;
  }
  get self() {
    return this.players.find((p) => p.id === this.room?.sessionId);
  }
}
