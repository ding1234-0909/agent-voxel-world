import { spatialMix, type Player } from '@voxel/shared';
import type { Connection } from './connection';
import { AgentSpeechPlayback } from './agent-speech-playback';
export type SpatialStatus = {
  sending: boolean;
  listening: boolean;
  pending: boolean;
  connected: number;
  error: string;
  agentSpeaking?: string;
};
type Signal = {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
type Peer = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  makingOffer: boolean;
  ignoreOffer: boolean;
  candidates: RTCIceCandidateInit[];
  queue: Promise<void>;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  pan?: StereoPannerNode;
};
type Link = Pick<
  Connection,
  | 'players'
  | 'self'
  | 'status'
  | 'action'
  | 'chatRecording'
  | 'voiceLabRecording'
  | 'chatToken'
>;
export class SpatialVoice {
  readonly agentSpeech: AgentSpeechPlayback;
  state: SpatialStatus = {
    sending: false,
    listening: false,
    pending: false,
    connected: 0,
    error: '',
  };
  private peers = new Map<string, Peer>();
  private stream?: MediaStream;
  private context?: AudioContext;
  private generation = 0;
  private listenGeneration = 0;
  private disposed = false;
  onMicrophone: (stream: MediaStream | undefined) => void = () => {};
  constructor(
    private link: Link,
    private changed: (state: SpatialStatus) => void,
    private capture = () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      }),
  ) {
    this.agentSpeech = new AgentSpeechPlayback(
      link,
      () => this.context,
      () => this.state.listening,
      (text, error) => {
        this.state.agentSpeaking = text;
        if (error) this.state.error = error;
        this.emit();
      },
    );
  }
  private emit() {
    this.state.connected = [...this.peers.values()].filter(
      (p) => p.pc.connectionState === 'connected',
    ).length;
    this.changed({ ...this.state });
  }
  private announce() {
    this.link.action('spatial.state', {
      sending: this.state.sending,
      listening: this.state.listening,
    });
    this.update();
    this.emit();
  }
  async startMic() {
    if (this.disposed || this.state.sending || this.state.pending) return;
    if (
      this.link.status !== 'connected' ||
      this.link.chatRecording ||
      this.link.voiceLabRecording
    ) {
      this.state.error = '请先结束聊天录音并连接世界。';
      this.emit();
      return;
    }
    const generation = ++this.generation;
    this.state.pending = true;
    this.state.error = '';
    this.emit();
    try {
      const stream = await this.capture();
      if (
        this.disposed ||
        generation !== this.generation ||
        this.link.status !== 'connected' ||
        this.link.chatRecording ||
        this.link.voiceLabRecording
      ) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.state.sending = true;
      this.state.pending = false;
      stream
        .getAudioTracks()
        .forEach((track) =>
          track.addEventListener('ended', () => this.stopMic(), { once: true }),
        );
      this.announce();
      this.onMicrophone(stream);
    } catch (e) {
      if (generation !== this.generation) return;
      this.state.pending = false;
      this.state.error =
        (e as Error).name === 'NotAllowedError'
          ? '麦克风权限被拒绝，可在浏览器设置中允许。'
          : '无法打开麦克风，请检查设备或使用 HTTPS / localhost。';
      this.emit();
    }
  }
  stopMic = () => {
    this.onMicrophone(undefined);
    this.generation++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.state.sending = false;
    this.state.pending = false;
    for (const p of this.peers.values())
      void p.sender.replaceTrack(null).catch(() => {});
    this.announce();
  };
  async setListening(enabled: boolean) {
    if (this.disposed) return;
    const generation = ++this.listenGeneration;
    if (enabled) {
      try {
        this.context ??= new AudioContext();
        await this.context.resume();
        if (this.disposed || generation !== this.listenGeneration) return;
        if (this.context.state !== 'running') throw Error();
        this.state.error = '';
      } catch {
        this.state.error = '无法开启收听，请再次点击按钮。';
        this.emit();
        return;
      }
    }
    this.state.listening = enabled;
    if (!enabled) this.agentSpeech.stop();
    this.announce();
  }
  private ensure(id: string) {
    const existing = this.peers.get(id);
    if (existing) return existing;
    let iceServers: RTCIceServer[] = [];
    try {
      const value = import.meta.env.VITE_RTC_ICE_SERVERS;
      if (value) iceServers = JSON.parse(value);
    } catch {
      this.state.error = '空间语音网络配置无效。';
    }
    const pc = new RTCPeerConnection({ iceServers });
    const p: Peer = {
      pc,
      sender: pc.addTransceiver('audio', { direction: 'sendrecv' }).sender,
      makingOffer: false,
      ignoreOffer: false,
      candidates: [],
      queue: Promise.resolve(),
    };
    this.peers.set(id, p);
    const signal = (value: object) => {
      if (this.peers.get(id) === p)
        this.link.action('spatial.signal', { to: id, ...value });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) signal({ candidate: e.candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        signal({ description: pc.localDescription });
      } catch {
        if (pc.signalingState !== 'closed') {
          this.state.error = '语音协商失败，请关闭后重新开启。';
          this.emit();
        }
      } finally {
        p.makingOffer = false;
      }
    };
    pc.ontrack = (e) => {
      p.stream = new MediaStream([e.track]);
      this.attachAudio(p);
      const other = this.link.players.find((player) => player.id === id);
      if (other && this.link.self) this.mix(p, this.link.self, other);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed')
        this.state.error = '部分语音连接失败。跨网络连接可能需要 TURN 中继。';
      this.emit();
    };
    return p;
  }
  signal = (signal: Signal) => {
    if (
      this.disposed ||
      (!this.state.sending && !this.state.listening) ||
      !this.link.players.some(
        (p) => p.id === signal.from && p.connected && p.kind === 'human',
      )
    )
      return;
    const p = this.ensure(signal.from),
      pc = p.pc;
    p.queue = p.queue
      .then(async () => {
        if (pc.signalingState === 'closed') return;
        if (signal.description) {
          const collision =
            signal.description.type === 'offer' &&
            (p.makingOffer || pc.signalingState !== 'stable');
          p.ignoreOffer = collision && (this.link.self?.id ?? '') < signal.from;
          if (p.ignoreOffer) return;
          await pc.setRemoteDescription(signal.description);
          for (const candidate of p.candidates.splice(0))
            await pc.addIceCandidate(candidate);
          if (signal.description.type === 'offer') {
            await pc.setLocalDescription();
            this.link.action('spatial.signal', {
              to: signal.from,
              description: pc.localDescription,
            });
          }
        } else if (signal.candidate && !p.ignoreOffer) {
          if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
          else p.candidates.push(signal.candidate);
        }
      })
      .catch(() => {
        if (pc.signalingState !== 'closed') {
          this.state.error = '语音连接协商中断，请关闭后重新开启。';
          this.emit();
        }
      });
  };
  private attachAudio(p: Peer) {
    if (p.source || !p.stream || !this.context || !this.state.listening) return;
    p.source = this.context.createMediaStreamSource(p.stream);
    p.gain = this.context.createGain();
    p.gain.gain.value = 0;
    p.pan = this.context.createStereoPanner();
    p.source.connect(p.gain).connect(p.pan).connect(this.context.destination);
  }
  update() {
    this.agentSpeech.update();
    const self = this.link.self;
    if (this.link.status !== 'connected' || !self) {
      this.reset();
      return;
    }
    const desired = new Set<string>();
    for (const other of this.link.players) {
      if (other.id === self.id || !other.connected || other.kind !== 'human')
        continue;
      if (
        !(
          (this.state.sending && other.voiceListening) ||
          (this.state.listening && other.voiceSending)
        )
      )
        continue;
      desired.add(other.id);
      const p = this.ensure(other.id);
      const track =
        this.state.sending && other.voiceListening
          ? (this.stream?.getAudioTracks()[0] ?? null)
          : null;
      if (p.sender.track !== track)
        void p.sender.replaceTrack(track).catch(() => {});
      this.attachAudio(p);
      this.mix(p, self, other);
    }
    for (const [id, p] of this.peers)
      if (!desired.has(id)) {
        this.closePeer(p);
        this.peers.delete(id);
      }
  }
  private mix(p: Peer, self: Player, other: Player) {
    if (p.gain && p.pan && this.context) {
      const mix = spatialMix(self, other);
      p.gain.gain.setTargetAtTime(
        this.state.listening && other.voiceSending ? mix.gain : 0,
        this.context.currentTime,
        0.06,
      );
      p.pan.pan.setTargetAtTime(mix.pan, this.context.currentTime, 0.06);
    }
  }
  private closePeer(p: Peer) {
    p.pc.onconnectionstatechange = null;
    p.pc.onnegotiationneeded = null;
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.close();
    p.source?.disconnect();
    p.gain?.disconnect();
    p.pan?.disconnect();
  }
  private reset() {
    this.agentSpeech.stop();
    if (this.stream || this.state.pending) this.onMicrophone(undefined);
    this.generation++;
    this.listenGeneration++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    for (const p of this.peers.values()) this.closePeer(p);
    this.peers.clear();
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = undefined;
    }
    const wasActive =
      this.state.sending ||
      this.state.listening ||
      this.state.pending ||
      this.state.connected;
    this.state = {
      sending: false,
      listening: false,
      pending: false,
      connected: 0,
      error: '',
    };
    if (wasActive) this.emit();
  }
  dispose() {
    this.disposed = true;
    this.reset();
    this.link.action('spatial.state', { sending: false, listening: false });
  }
}
