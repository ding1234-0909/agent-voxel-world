import { spatialMix, type AgentSpeechEvent } from '@voxel/shared';
import type { Connection } from '../network/connection';
import { serverHttpUrl } from '../network/endpoints';

type Link = Pick<Connection, 'players' | 'self' | 'status' | 'chatToken'>;
/** Live speech only: no history replay when listening is enabled later. */
export class AgentSpeechPlayback {
  private queue: AgentSpeechEvent[] = [];
  private seen = new Set<string>();
  private active?: {
    event: AgentSpeechEvent;
    abort: AbortController;
    source?: AudioBufferSourceNode;
    gain?: GainNode;
    pan?: StereoPannerNode;
  };
  constructor(
    private link: Link,
    private context: () => AudioContext | undefined,
    private listening: () => boolean,
    private changed: (text: string, error?: string) => void,
    private fetchAudio: typeof fetch = (...args) => fetch(...args),
  ) {}
  receive = (event: AgentSpeechEvent) => {
    if (
      !this.listening() ||
      this.link.status !== 'connected' ||
      !event ||
      !/^[\w-]{1,80}$/.test(event.id) ||
      !Number.isFinite(event.expiresAt) ||
      event.expiresAt <= Date.now() ||
      this.seen.has(event.id)
    )
      return;
    this.seen.add(event.id);
    if (this.seen.size > 200)
      this.seen.delete(this.seen.values().next().value!);
    if (this.queue.length < 8) this.queue.push(event);
    void this.next();
  };
  private speaker(event: AgentSpeechEvent) {
    return this.link.players.find(
      (p) =>
        p.id === event.actor &&
        p.connected &&
        p.voiceReplies &&
        ['ai-agent', 'scripted-agent'].includes(p.kind),
    );
  }
  private async next() {
    if (this.active || !this.listening() || this.link.status !== 'connected')
      return;
    const event = this.queue.shift();
    if (!event) return;
    const speaker = this.speaker(event),
      self = this.link.self,
      context = this.context();
    if (
      !speaker ||
      !self ||
      !context ||
      event.expiresAt <= Date.now() ||
      spatialMix(self, speaker).gain === 0
    ) {
      void this.next();
      return;
    }
    const active: NonNullable<AgentSpeechPlayback['active']> = {
      event,
      abort: new AbortController(),
    };
    this.active = active;
    try {
      const response = await this.fetchAudio(
        `${serverHttpUrl()}/chat/agent-speech/${event.id}`,
        {
          headers: { Authorization: `Bearer ${this.link.chatToken}` },
          signal: active.abort.signal,
        },
      );
      if (!response.ok) {
        // Walking away, disabling speech, or expiry can revoke the clip while loading.
        if (response.status === 404) return;
        throw Error('Agent 语音加载失败，仍可查看文字回复。');
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 3 * 1024 * 1024)
        throw Error('Agent 语音过大，已跳过。');
      const buffer = await context.decodeAudioData(bytes);
      if (
        this.active !== active ||
        active.abort.signal.aborted ||
        !this.listening() ||
        !this.speaker(event) ||
        event.expiresAt <= Date.now()
      )
        return;
      if (context.state !== 'running')
        throw Error('请重新点击开启收听，以播放 Agent 语音。');
      active.source = context.createBufferSource();
      active.gain = context.createGain();
      active.pan = context.createStereoPanner();
      active.source.buffer = buffer;
      active.gain.gain.value = 0;
      active.source
        .connect(active.gain)
        .connect(active.pan)
        .connect(context.destination);
      active.source.onended = () => {
        if (this.active === active) {
          this.finish();
          void this.next();
        }
      };
      this.update();
      if (this.active !== active) return;
      active.source.start();
      this.changed(`${speaker.name}：${event.text}`);
    } catch (error) {
      if (!active.abort.signal.aborted) {
        this.finish();
        this.changed(
          '',
          error instanceof Error ? error.message : 'Agent 语音播放失败。',
        );
        void this.next();
      }
    } finally {
      if (this.active === active && !active.source) {
        this.finish();
        void this.next();
      }
    }
  }
  update() {
    if (!this.listening() || this.link.status !== 'connected') {
      this.stop();
      return;
    }
    this.queue = this.queue.filter(
      (e) => e.expiresAt > Date.now() && !!this.speaker(e),
    );
    const active = this.active;
    if (!active) return;
    const speaker = this.speaker(active.event),
      self = this.link.self,
      context = this.context();
    if (!speaker || !self || !context) {
      this.finish();
      void this.next();
      return;
    }
    const mix = spatialMix(self, speaker);
    active.gain?.gain.setTargetAtTime(mix.gain, context.currentTime, 0.04);
    active.pan?.pan.setTargetAtTime(mix.pan, context.currentTime, 0.04);
  }
  private finish() {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.abort.abort();
    if (active.source) {
      active.source.onended = null;
      try {
        active.source.stop();
      } catch {
        /* Not started yet. */
      }
      active.source.disconnect();
    }
    active.gain?.disconnect();
    active.pan?.disconnect();
    this.changed('');
  }
  stop() {
    this.queue = [];
    this.finish();
  }
}
