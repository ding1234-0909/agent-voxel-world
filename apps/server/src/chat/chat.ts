import { randomBytes, randomUUID } from 'node:crypto';
import {
  parseChatRoute,
  spatialMix,
  SPEECH_HEARING_THRESHOLD,
  visibleEvent,
  type ChatData,
  type Player,
  type WorldEvent,
} from '@voxel/shared';
export class ChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
type Clip = { bytes: Buffer; actor: string; data: ChatData; expires: number };
type SpeechTicket = {
  actor: string;
  recipients: string[];
  expires: number;
  controller: AbortController;
  claimed: boolean;
};
export class WorldChat {
  private speechTickets = new Map<string, SpeechTicket>();
  private tokens = new Map<string, string>();
  private clips = new Map<string, Clip>();
  private uploads = new Set<string>();
  private sent = new Map<string, number>();
  constructor(
    private players: () => Iterable<Player>,
    private emit: (actor: string, data: ChatData) => void,
  ) {}
  issue(id: string) {
    this.revoke(id);
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, id);
    return token;
  }
  revoke(id: string) {
    this.cancelSpatial(id);
    this.sent.delete(id);
    for (const [token, owner] of this.tokens)
      if (owner === id) this.tokens.delete(token);
  }
  authenticate(token: string) {
    const id = this.tokens.get(token);
    if (!id || ![...this.players()].some((p) => p.id === id && p.connected))
      throw new ChatError('游戏连接已失效，请重新进入。', 401);
    return id;
  }
  route(actor: string, value: unknown) {
    const route = parseChatRoute(value),
      players = [...this.players()];
    if (!players.some((p) => p.id === actor && p.connected))
      throw new ChatError('你尚未连接世界。', 401);
    if (
      route.recipients.some(
        (id) =>
          id === actor || !players.some((p) => p.id === id && p.connected),
      )
    )
      throw new ChatError('接收对象已离线或无效，请重新选择。');
    return route;
  }
  send(actor: string, value: unknown) {
    const route = this.route(actor, value),
      text = (value as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim() || text.length > 240)
      throw new ChatError('消息需为 1–240 字。');
    // Resolve typed public mentions too. Duplicate nicknames require the picker.
    if (route.scope === 'public') {
      const players = [...this.players()].filter(
        (p) => p.connected && p.id !== actor,
      );
      for (const player of players) {
        if (players.filter((p) => p.name === player.name).length !== 1)
          continue;
        const escaped = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (
          new RegExp(
            `(?:^|\\s)@${escaped}(?=$|\\s|[，。！？、,:;!?])`,
            'u',
          ).test(text) &&
          !route.recipients.includes(player.id)
        )
          route.recipients.push(player.id);
      }
      if (route.recipients.length > 8)
        throw new ChatError('接收对象最多选择 8 位。');
    }
    if (Date.now() - (this.sent.get(actor) ?? 0) < 300)
      throw new ChatError('发送过快，请稍候。', 429);
    this.sent.set(actor, Date.now());
    this.emit(actor, {
      ...route,
      text: text.trim(),
      kind: 'text',
      name: [...this.players()].find((p) => p.id === actor)!.name,
    });
  }
  beginUpload(actor: string, value: unknown) {
    this.route(actor, value);
    if (this.uploads.has(actor))
      throw new ChatError('上一段语音仍在处理中。', 429);
    this.uploads.add(actor);
  }
  endUpload(actor: string) {
    this.uploads.delete(actor);
  }
  publishAudio(
    actor: string,
    value: unknown,
    bytes: Buffer,
    durationMs: number,
    text: string,
  ) {
    const route = this.route(actor, value);
    this.prune();
    while (
      this.clips.size >= 100 ||
      [...this.clips.values()].reduce((n, c) => n + c.bytes.length, 0) +
        bytes.length >
        32 * 1024 * 1024
    )
      this.clips.delete(this.clips.keys().next().value!);
    const audioId = randomUUID(),
      data: ChatData = {
        ...route,
        name: [...this.players()].find((p) => p.id === actor)!.name,
        kind: 'audio',
        audioId,
        durationMs,
        text: text || '[语音消息：暂无文字转写]',
        transcriptAvailable: !!text,
      };
    this.clips.set(audioId, {
      bytes,
      actor,
      data,
      expires: Date.now() + 10 * 60 * 1000,
    });
    this.emit(actor, data);
    return data;
  }
  private speaker(actor: string) {
    const p = [...this.players()].find(
      (p) =>
        p.id === actor && p.connected && p.kind === 'human' && p.voiceSending,
    );
    if (!p) throw new ChatError('附近麦克风已关闭，转写已停止。', 409);
    return p;
  }
  private hearing(actor: string) {
    const speaker = this.speaker(actor);
    return [...this.players()]
      .filter(
        (p) =>
          p.id !== actor &&
          p.connected &&
          (p.kind !== 'human' || p.voiceListening) &&
          spatialMix(p, speaker).gain >= SPEECH_HEARING_THRESHOLD,
      )
      .map((p) => p.id);
  }
  beginSpatial(actor: string) {
    this.pruneSpeech();
    const recipients = this.hearing(actor);
    if (
      [...this.speechTickets.values()].filter((t) => t.actor === actor)
        .length >= 4
    )
      throw new ChatError('转写队列已满，请稍候。', 429);
    const id = randomUUID();
    this.speechTickets.set(id, {
      actor,
      recipients,
      expires: Date.now() + 45000,
      controller: new AbortController(),
      claimed: false,
    });
    return id;
  }
  claimSpatial(actor: string, id: string) {
    this.pruneSpeech();
    this.speaker(actor);
    const ticket = this.speechTickets.get(id);
    if (!ticket || ticket.actor !== actor || ticket.claimed)
      throw new ChatError('该语音片段已过期或处理过。', 409);
    ticket.claimed = true;
    return ticket.controller.signal;
  }
  publishSpatial(actor: string, id: string, text: string) {
    this.pruneSpeech();
    const ticket = this.speechTickets.get(id);
    if (
      !ticket ||
      ticket.actor !== actor ||
      !ticket.claimed ||
      ticket.controller.signal.aborted
    )
      throw new ChatError('语音片段已取消。', 409);
    const current = new Set(this.hearing(actor));
    const recipients = ticket.recipients.filter((id) => current.has(id));
    if (!text.trim() || text.length > 240)
      throw new ChatError('识别结果为空或过长。');
    const data: ChatData = {
      scope: 'nearby',
      recipients,
      kind: 'text',
      name: this.speaker(actor).name,
      text,
      transcriptAvailable: true,
    };
    this.speechTickets.delete(id);
    this.emit(actor, data);
    return data;
  }
  endSpatial(actor: string, id: string) {
    const ticket = this.speechTickets.get(id);
    if (ticket?.actor === actor) {
      ticket.controller.abort();
      this.speechTickets.delete(id);
    }
  }
  cancelSpatial(actor: string) {
    for (const [id, ticket] of this.speechTickets)
      if (ticket.actor === actor) this.endSpatial(actor, id);
  }
  private pruneSpeech() {
    for (const [id, ticket] of this.speechTickets)
      if (ticket.expires <= Date.now()) this.endSpatial(ticket.actor, id);
  }
  audio(id: string, viewer: string) {
    this.prune();
    const clip = this.clips.get(id);
    if (
      !clip ||
      !visibleEvent(
        { type: 'chat', actor: clip.actor, data: clip.data } as WorldEvent,
        viewer,
      )
    )
      throw new ChatError('语音已过期或不可访问。', 404);
    return clip.bytes;
  }
  private prune() {
    for (const [id, c] of this.clips)
      if (c.expires < Date.now()) this.clips.delete(id);
  }
  clear() {
    for (const ticket of this.speechTickets.values()) ticket.controller.abort();
    this.speechTickets.clear();
    this.tokens.clear();
    this.clips.clear();
    this.uploads.clear();
    this.sent.clear();
  }
}
