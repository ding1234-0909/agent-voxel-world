import { RealtimeHub } from '../realtime/hub';
import { WorldChat } from '../chat/chat';
import { AgentSpeech } from '../agent/speech';
import { createVoiceProvider, type VoiceSession } from '../audio/voice';
import { WorldStore } from './store';
import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import {
  terrain,
  key,
  simulate,
  validateEdit,
  parseInput,
  distance,
  WORLD_ID,
  visibleEvent,
  type ChatData,
  type WorldPresence,
  type Block,
  type Input,
  type Edit,
  type WorldEvent,
} from '@voxel/shared';
class Avatar extends Schema {
  id = '';
  name = '';
  kind = 'human';
  x = 0;
  y = 2.55;
  z = 0;
  yaw = 0;
  connected = true;
  voiceSending = false;
  voiceListening = false;
  voiceReplies = false;
}
defineTypes(Avatar, {
  id: 'string',
  name: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  z: 'number',
  yaw: 'number',
  connected: 'boolean',
  voiceSending: 'boolean',
  voiceListening: 'boolean',
  voiceReplies: 'boolean',
});
class WorldState extends Schema {
  players = new MapSchema<Avatar>();
  revision = 0;
}
defineTypes(WorldState, { players: { map: Avatar }, revision: 'number' });
const zero: Input = { x: 0, z: 0, jump: false, yaw: 0 };
let activeRoom = false;
export class WorldRoom extends Room<WorldState> {
  agentSpeech = new AgentSpeech(
    () => this.state.players.values(),
    (recipient, event) =>
      this.clients
        .find((c) => c.sessionId === recipient)
        ?.send('agent.speech', event),
    (actor, message) =>
      this.clients
        .find((c) => c.sessionId === actor)
        ?.send('agent.speech.error', { message }),
  );
  chat = new WorldChat(
    () => this.state.players.values(),
    (actor, data) => this.chatEvent(actor, data),
  );
  blocks = terrain();
  store = new WorldStore();
  private bodies = new Map<
    string,
    { vy: number; grounded: boolean; input: Input; lastInput: number }
  >();
  private budget = new Map<string, { at: number; count: number }>();
  private signalBudget = new Map<string, { at: number; count: number }>();
  private events: WorldEvent[] = [];
  private seq = 0;
  private ownsActive = false;
  private voiceProvider = createVoiceProvider();
  private voices = new Map<string, VoiceSession>();
  private realtime = new RealtimeHub(
    (owner) => ({
      revision: () => this.state.revision,
      observe: () => {
        const player = this.state.players.get(owner);
        if (!player?.connected) throw Error('disconnected');
        return {
          revision: this.state.revision,
          self: { x: player.x, y: player.y, z: player.z, yaw: player.yaw },
          blocks: [...this.blocks.values()]
            .filter((b) => distance(b, player) <= 6)
            .sort((a, b) => distance(a, player) - distance(b, player))
            .slice(0, 64),
        };
      },
    }),
    (owner, event) =>
      this.clients.find((c) => c.sessionId === owner)?.send('realtime', event),
  );
  private queue: Promise<void> = Promise.resolve();
  autoDispose = false;
  maxClients = 16;
  async onCreate() {
    if (activeRoom)
      throw new Error('Single world is full; join the existing room');
    activeRoom = true;
    this.ownsActive = true;
    this.setState(new WorldState());
    try {
      this.state.revision = await this.store.load(this.blocks);
    } catch (error) {
      activeRoom = false;
      throw error;
    }
    this.setPatchRate(50);
    this.onMessage('sync', (client) => {
      if (this.allow(client)) this.snapshot(client);
    });
    this.onMessage('action', (client, value) => {
      if (!this.allow(client, value?.type === 'spatial.signal')) return;
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.id !== 'string' ||
        value.id.length > 80
      )
        return this.reply(client, '', false, 'invalid-envelope');
      let { id, type, payload } = value;
      if (typeof type === 'string' && type.startsWith('realtime.')) {
        try {
          if (this.state.players.get(client.sessionId)?.kind !== 'human')
            throw Error('human-session-required');
          if (type === 'realtime.approve') {
            payload = this.realtime.approve(client.sessionId, payload);
            type = 'edit'; // Reuse the authoritative serialized edit validation and persistence below.
          } else {
            this.realtime.handle(client.sessionId, type, payload);
            return this.reply(client, id, true);
          }
        } catch (error) {
          return this.reply(
            client,
            id,
            false,
            error instanceof Error ? error.message : 'realtime-failed',
          );
        }
      }
      if (type === 'agent.voice') {
        const player = this.state.players.get(client.sessionId);
        if (
          !player ||
          !['ai-agent', 'scripted-agent'].includes(player.kind) ||
          typeof payload?.enabled !== 'boolean'
        )
          return this.reply(client, id, false, 'invalid-agent-voice');
        player.voiceReplies = payload.enabled;
        if (!payload.enabled) this.agentSpeech.cancel(player.id);
        return this.reply(client, id, true);
      }
      if (type === 'rename') {
        const player = this.state.players.get(client.sessionId);
        if (
          !player ||
          typeof payload?.name !== 'string' ||
          !payload.name.trim() ||
          payload.name.trim().length > 24
        )
          return this.reply(client, id, false, 'invalid-name');
        player.name = payload.name.trim();
        return this.reply(client, id, true);
      }
      if (type === 'move') {
        const input = parseInput(payload),
          body = this.bodies.get(client.sessionId);
        if (!input || !body)
          return this.reply(client, id, false, 'invalid-input');
        body.input = input;
        body.lastInput = Date.now();
        return;
      }
      if (type === 'voice.start') {
        if (
          typeof payload?.text !== 'string' ||
          !payload.text.trim() ||
          payload.text.length > 240
        )
          return this.reply(client, id, false, 'invalid-voice-input');
        this.voices.get(client.sessionId)?.close();
        this.voices.delete(client.sessionId);
        let provider;
        try {
          if (
            payload.provider !== undefined &&
            typeof payload.provider !== 'string'
          )
            throw Error('无效语音方案。');
          provider =
            payload.provider === undefined
              ? this.voiceProvider
              : createVoiceProvider(payload.provider);
        } catch (error) {
          client.send('voice', {
            requestId: id,
            provider: payload.provider,
            state: 'error',
            turn: 0,
            subtitle: error instanceof Error ? error.message : '语音配置错误。',
          });
          return this.reply(client, id, false, 'voice-provider-unavailable');
        }
        const voice = provider.create((event) =>
          client.send('voice', { ...event, requestId: id }),
        );
        this.voices.set(client.sessionId, voice);
        voice.push({ kind: 'text', text: payload.text });
        return this.reply(client, id, true);
      }
      if (type === 'voice.interrupt') {
        this.voices.get(client.sessionId)?.interrupt();
        return this.reply(client, id, true);
      }
      if (type === 'observe') {
        this.observe(client, id);
        return;
      }
      if (type === 'chat') {
        try {
          this.chat.send(client.sessionId, payload);
          return this.reply(client, id, true);
        } catch (error) {
          return this.reply(
            client,
            id,
            false,
            error instanceof Error ? error.message : 'invalid-chat',
          );
        }
      }
      if (type === 'spatial.state') {
        const player = this.state.players.get(client.sessionId);
        if (
          !player ||
          player.kind !== 'human' ||
          typeof payload?.sending !== 'boolean' ||
          typeof payload?.listening !== 'boolean'
        )
          return this.reply(client, id, false, 'invalid-spatial-state');
        if (!payload.sending) this.chat.cancelSpatial(client.sessionId);
        player.voiceSending = payload.sending;
        player.voiceListening = payload.listening;
        return this.reply(client, id, true);
      }
      if (type === 'spatial.signal') {
        const source = this.state.players.get(client.sessionId),
          target = this.state.players.get(payload?.to);
        if (
          !source?.connected ||
          !target?.connected ||
          source.id === target.id ||
          source.kind !== 'human' ||
          target.kind !== 'human' ||
          !(source.voiceSending || source.voiceListening) ||
          !(target.voiceSending || target.voiceListening)
        )
          return;
        const description = payload?.description,
          candidate = payload?.candidate;
        if (
          description &&
          ['offer', 'answer'].includes(description.type) &&
          typeof description.sdp === 'string' &&
          description.sdp.length <= 12000
        )
          this.clients
            .find((c) => c.sessionId === target.id)
            ?.send('spatial.signal', {
              from: source.id,
              description: { type: description.type, sdp: description.sdp },
            });
        else if (
          candidate &&
          typeof candidate.candidate === 'string' &&
          candidate.candidate.length <= 2000 &&
          (candidate.sdpMid === null ||
            (typeof candidate.sdpMid === 'string' &&
              candidate.sdpMid.length < 100)) &&
          (candidate.sdpMLineIndex === null ||
            Number.isInteger(candidate.sdpMLineIndex))
        )
          this.clients
            .find((c) => c.sessionId === target.id)
            ?.send('spatial.signal', {
              from: source.id,
              candidate: {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
              },
            });
        return;
      }
      if (type === 'edit') {
        this.queue = this.queue
          .then(async () => {
            if (!this.state.players.get(client.sessionId)?.connected)
              return this.reply(client, id, false, 'disconnected');
            if (!payload || typeof payload !== 'object')
              return this.reply(client, id, false, 'invalid-edit');
            const error = validateEdit(
              payload as Edit,
              this.state.players.get(client.sessionId)!,
              [...this.state.players.values()],
              this.blocks,
              this.state.revision,
            );
            if (error) {
              this.reply(client, id, false, error);
              if (error === 'conflict') this.snapshot(client);
              return;
            }
            const edit = payload as Edit;
            await this.store.save(edit);
            if (edit.material === null) this.blocks.delete(key(edit));
            else
              this.blocks.set(key(edit), {
                x: edit.x,
                y: edit.y,
                z: edit.z,
                material: edit.material,
              });
            this.state.revision++;
            this.broadcast('edit', { ...edit, revision: this.state.revision });
            this.event('block-edited', client.sessionId, edit);
            this.reply(client, id, true);
          })
          .catch((error) => {
            console.error('edit failed', error);
            this.reply(client, id, false, 'storage-unavailable');
          });
        return;
      }
      this.reply(client, id, false, 'unknown-action');
    });
    this.setSimulationInterval((delta) => {
      const dt = Math.min(delta / 1000, 0.05);
      for (const [id, body] of this.bodies) {
        const p = this.state.players.get(id);
        if (!p?.connected) continue;
        const input =
          Date.now() - body.lastInput < 250
            ? body.input
            : { ...zero, yaw: p.yaw };
        const b = {
          x: p.x,
          y: p.y,
          z: p.z,
          vy: body.vy,
          grounded: body.grounded,
        };
        simulate(b, input, this.blocks, dt);
        p.x = b.x;
        p.y = b.y;
        p.z = b.z;
        p.yaw = input.yaw;
        body.vy = b.vy;
        body.grounded = b.grounded;
      }
    }, 50);
  }
  onJoin(client: Client, options: { name?: string; kind?: string }) {
    const p = new Avatar();
    p.id = client.sessionId;
    p.name =
      typeof options.name === 'string' ? options.name.slice(0, 24) : 'Explorer';
    p.kind =
      options.kind === 'ai-agent'
        ? 'ai-agent'
        : options.kind === 'scripted-agent'
          ? 'scripted-agent'
          : 'human';
    const slot = this.state.players.size;
    p.x = (slot % 3) - 1;
    p.z = (Math.floor(slot / 3) % 3) - 1;
    // Spawn above the highest edited cell to avoid trapping new players.
    p.y =
      Math.max(
        2,
        ...[...this.blocks.values()]
          .filter((b) => b.x === Math.round(p.x) && b.z === Math.round(p.z))
          .map((b) => b.y),
      ) + 0.55;
    this.state.players.set(p.id, p);
    this.bodies.set(p.id, {
      vy: 0,
      grounded: false,
      input: { ...zero },
      lastInput: 0,
    });
    this.snapshot(client);
    client.send('chat.auth', { token: this.chat.issue(p.id) });
    this.event('joined', p.id, { name: p.name, kind: p.kind });
  }
  async onLeave(client: Client, consented: boolean) {
    this.realtime.close(client.sessionId);
    this.agentSpeech.cancel(client.sessionId);
    this.voices.get(client.sessionId)?.close();
    this.voices.delete(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    this.chat.revoke(client.sessionId);
    if (p) {
      p.connected = false;
      p.voiceSending = false;
      p.voiceListening = false;
    }
    const body = this.bodies.get(client.sessionId);
    if (body) body.input = { ...zero };
    if (!consented) {
      try {
        const reconnected = await this.allowReconnection(client, 20);
        if (p) p.connected = true;
        this.snapshot(reconnected);
        reconnected.send('chat.auth', {
          token: this.chat.issue(client.sessionId),
        });
        this.event('reconnected', client.sessionId, {});
        return;
      } catch {}
    }
    this.state.players.delete(client.sessionId);
    this.bodies.delete(client.sessionId);
    this.budget.delete(client.sessionId);
    this.signalBudget.delete(client.sessionId);
    this.event('left', client.sessionId, {});
  }
  async onDispose() {
    this.realtime.dispose();
    this.agentSpeech.close();
    for (const voice of this.voices.values()) voice.close();
    this.voices.clear();
    this.chat.clear();
    await this.queue;
    await this.store.close();
    if (this.ownsActive) activeRoom = false;
  }
  getPresence(): WorldPresence {
    return {
      worldId: WORLD_ID,
      roomId: this.roomId,
      revision: this.state.revision,
      capacity: this.maxClients,
      persistence: this.store.mode,
      updatedAt: Date.now(),
      players: [...this.state.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        connected: p.connected,
      })),
    };
  }
  private snapshot(client: Client) {
    client.send('snapshot', {
      blocks: [...this.blocks.values()],
      revision: this.state.revision,
      persistence: this.store.mode,
    });
  }
  private reply(client: Client, id: string, ok: boolean, error?: string) {
    client.send('result', { id, ok, error, revision: this.state.revision });
  }
  private allow(client: Client, signaling = false) {
    const budget = signaling ? this.signalBudget : this.budget;
    const limit = signaling ? 120 : 45;
    const now = Date.now(),
      b = budget.get(client.sessionId) ?? { at: now, count: 0 };
    if (now - b.at > 1000) {
      b.at = now;
      b.count = 0;
    }
    b.count++;
    budget.set(client.sessionId, b);
    if (b.count > limit) {
      if (b.count === limit + 1) this.reply(client, '', false, 'rate-limited');
      return false;
    }
    return true;
  }
  private event(type: string, actor: string, data: unknown) {
    const event = { seq: ++this.seq, type, actor, data, at: Date.now() };
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
    this.broadcast('event', event);
  }
  private chatEvent(actor: string, data: ChatData) {
    const event = {
      actorKind: this.state.players.get(actor)?.kind,
      seq: ++this.seq,
      type: 'chat',
      actor,
      data,
      at: Date.now(),
    };
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
    for (const client of this.clients)
      if (visibleEvent(event, client.sessionId)) client.send('event', event);
    this.agentSpeech.enqueue(actor, data);
  }
  private observe(client: Client, id: string) {
    const self = this.state.players.get(client.sessionId)!;
    client.send('observation', {
      id,
      protocol: 1,
      revision: this.state.revision,
      self: self.toJSON(),
      radius: 8,
      blocks: [...this.blocks.values()]
        .filter((b) => distance(self, b) <= 8)
        .sort((a, b) => distance(self, a) - distance(self, b))
        .slice(0, 500),
      players: [...this.state.players.values()]
        .filter((p) => distance(self, p) <= 8)
        .map((p) => p.toJSON()),
      events: this.events
        .filter((event) => visibleEvent(event, client.sessionId))
        .slice(-30),
      allowedActions: [
        'move',
        'edit',
        'chat',
        'observe',
        'voice.start',
        'voice.interrupt',
      ],
    });
  }
}
