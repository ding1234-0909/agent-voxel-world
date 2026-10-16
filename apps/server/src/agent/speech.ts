import { randomUUID } from 'node:crypto';
import {
  spatialMix,
  SPEECH_HEARING_THRESHOLD,
  type AgentSpeechEvent,
  type ChatData,
  type Player,
} from '@voxel/shared';
import { ChatError } from '../chat/chat';
import { LocalTts, type SpeechSynthesizer } from '../audio/local-tts';

type Pending = {
  actor: string;
  data: ChatData;
  recipients: string[];
  controller: AbortController;
  at: number;
};
type Clip = { event: AgentSpeechEvent; bytes: Buffer; recipients: string[] };
export class AgentSpeech {
  private queue: Pending[] = [];
  private current?: Pending;
  private clips = new Map<string, Clip>();
  private closed = false;
  constructor(
    private players: () => Iterable<Player>,
    private notify: (recipient: string, event: AgentSpeechEvent) => void,
    private report: (actor: string, message: string) => void,
    private tts:
      | SpeechSynthesizer
      | ((actor: string) => SpeechSynthesizer) = new LocalTts(),
  ) {}
  private speaker(actor: string) {
    return [...this.players()].find(
      (p) =>
        p.id === actor &&
        p.connected &&
        p.voiceReplies &&
        (p.kind === 'ai-agent' || p.kind === 'scripted-agent'),
    );
  }
  private canHear(viewer: string, actor: string) {
    const speaker = this.speaker(actor);
    const listener = [...this.players()].find(
      (p) =>
        p.id === viewer &&
        p.connected &&
        p.kind === 'human' &&
        p.voiceListening,
    );
    return (
      !!speaker &&
      !!listener &&
      spatialMix(listener, speaker).gain >= SPEECH_HEARING_THRESHOLD
    );
  }
  enqueue(actor: string, data: ChatData) {
    if (
      this.closed ||
      !this.speaker(actor) ||
      data.kind !== 'text' ||
      data.scope === 'nearby'
    )
      return;
    const recipients = [...this.players()]
      .filter(
        (p) =>
          (data.scope === 'public' || data.recipients.includes(p.id)) &&
          this.canHear(p.id, actor),
      )
      .map((p) => p.id);
    if (!recipients.length) return;
    if (
      this.queue.length >= 8 ||
      this.queue.filter((p) => p.actor === actor).length >= 2
    ) {
      this.report(actor, '语音队列已满，本条仅发送文字。');
      return;
    }
    this.queue.push({
      actor,
      data: { ...data, recipients: [...data.recipients] },
      recipients,
      controller: new AbortController(),
      at: Date.now(),
    });
    void this.pump();
  }
  private async pump() {
    if (this.current || this.closed) return;
    const pending = this.queue.shift();
    if (!pending) return;
    this.current = pending;
    try {
      if (!this.speaker(pending.actor) || Date.now() - pending.at > 30000)
        return;
      const tts =
        typeof this.tts === 'function' ? this.tts(pending.actor) : this.tts;
      const audio = await tts.synthesize(
        pending.data.text,
        pending.controller.signal,
      );
      if (
        pending.controller.signal.aborted ||
        this.closed ||
        !this.speaker(pending.actor)
      )
        return;
      const recipients = pending.recipients.filter((id) =>
        this.canHear(id, pending.actor),
      );
      if (!recipients.length) return;
      const event: AgentSpeechEvent = {
        id: randomUUID(),
        actor: pending.actor,
        text: pending.data.text,
        scope: pending.data.scope === 'private' ? 'private' : 'public',
        durationMs: audio.durationMs,
        expiresAt: Date.now() + 120000,
      };
      if (!audio.bytes.length || audio.bytes.length > 3 * 1024 * 1024)
        throw Error('合成音频过大');
      this.prune();
      while (
        this.clips.size >= 24 ||
        [...this.clips.values()].reduce((n, c) => n + c.bytes.length, 0) +
          audio.bytes.length >
          32 * 1024 * 1024
      )
        this.clips.delete(this.clips.keys().next().value!);
      this.clips.set(event.id, { event, bytes: audio.bytes, recipients });
      for (const recipient of recipients) this.notify(recipient, event);
    } catch (error) {
      if (!pending.controller.signal.aborted)
        this.report(
          pending.actor,
          error instanceof Error
            ? error.message
            : '语音合成失败，文字回复已保留。',
        );
    } finally {
      this.current = undefined;
      void this.pump();
    }
  }
  audio(id: string, viewer: string) {
    this.prune();
    const clip = this.clips.get(id);
    if (
      !clip ||
      !clip.recipients.includes(viewer) ||
      !this.canHear(viewer, clip.event.actor)
    )
      throw new ChatError('语音已过期或不可访问。', 404);
    return clip.bytes;
  }
  cancel(actor: string) {
    if (this.current?.actor === actor) this.current.controller.abort();
    this.queue = this.queue.filter((p) => p.actor !== actor);
    for (const [id, clip] of this.clips)
      if (clip.event.actor === actor) this.clips.delete(id);
  }
  private prune() {
    for (const [id, clip] of this.clips)
      if (clip.event.expiresAt <= Date.now()) this.clips.delete(id);
  }
  close() {
    this.closed = true;
    this.current?.controller.abort();
    this.queue = [];
    this.clips.clear();
  }
}
