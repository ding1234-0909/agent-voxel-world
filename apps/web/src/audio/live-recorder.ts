import {
  LiveSpeechSession,
  speechTransport,
  type LiveSpeechEvents,
  type SpeechTransport,
} from './live-speech';

/** Captures raw PCM with ownership-aware cleanup; borrowed spatial tracks remain alive. */
export class SpeechCapture {
  private generation = 0;
  private context?: AudioContext;
  private stream?: MediaStream;
  private owned = false;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private flushed?: () => void;
  private ended?: () => void;
  get canRecord() {
    return (
      window.isSecureContext &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }
  async start(
    frame: (bytes: Uint8Array) => void,
    ended: () => void,
    borrowed?: MediaStream,
  ) {
    this.stop();
    const generation = this.generation;
    const stream =
      borrowed ??
      (await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      }));
    if (generation !== this.generation) {
      if (!borrowed) stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    this.stream = stream;
    this.owned = !borrowed;
    this.ended = ended;
    stream
      .getAudioTracks()
      .forEach((track) => track.addEventListener('ended', ended));
    try {
      const context = (this.context = new AudioContext());
      await context.audioWorklet.addModule(
        new URL('./pcm-worklet.js', import.meta.url),
      );
      if (generation !== this.generation) return false;
      await context.resume();
      if (generation !== this.generation) return false;
      const node = (this.node = new AudioWorkletNode(context, 'pcm16-capture'));
      node.port.onmessage = (
        event: MessageEvent<ArrayBuffer | { flushed: boolean }>,
      ) => {
        if (generation !== this.generation) return;
        if (event.data instanceof ArrayBuffer)
          frame(new Uint8Array(event.data));
        else if (event.data.flushed) this.flushed?.();
      };
      node.onprocessorerror = ended;
      const mute = context.createGain();
      mute.gain.value = 0;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(node).connect(mute).connect(context.destination);
      return true;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }
  async finish() {
    const generation = this.generation;
    if (this.node)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        this.flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        this.node!.port.postMessage('flush');
      });
    if (generation === this.generation) this.stop();
  }
  stop() {
    ++this.generation;
    this.flushed?.();
    this.flushed = undefined;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.onprocessorerror = null;
      this.node.disconnect();
      this.node = undefined;
    }
    this.source?.disconnect();
    this.source = undefined;
    if (this.ended)
      this.stream
        ?.getAudioTracks()
        .forEach((track) => track.removeEventListener('ended', this.ended!));
    if (this.owned) this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.ended = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}

export type LiveRecordingEvents = LiveSpeechEvents & {
  onState: (state: 'listening' | 'thinking', message: string) => void;
};
export class LiveRecorder {
  private generation = 0;
  private session?: LiveSpeechSession;
  private timer?: ReturnType<typeof setTimeout>;
  private finishing = false;
  private events?: LiveRecordingEvents;
  constructor(private capture = new SpeechCapture()) {}
  get canRecord() {
    return this.capture.canRecord;
  }
  async start(
    language: string,
    events: LiveRecordingEvents,
    stream?: MediaStream,
    transport?: SpeechTransport,
  ) {
    this.cancel();
    const generation = this.generation;
    this.events = events;
    const fail = (text: string) => {
      if (generation !== this.generation) return;
      this.cancel();
      events.onPartial('');
      events.onError(text);
    };
    this.session = new LiveSpeechSession(
      transport ?? speechTransport(language),
      {
        ...events,
        onError: fail,
        onEnd: () => {
          if (generation !== this.generation) return;
          this.cancel();
          events.onPartial('');
          events.onEnd();
        },
      },
    );
    events.onState(
      'thinking',
      stream ? '正在接入实时识别…' : '正在请求麦克风权限…',
    );
    try {
      const started = await this.capture.start(
        (frame) => this.session?.feed(frame),
        () => fail('麦克风或音频处理已中断，未确认内容已取消。'),
        stream,
      );
      if (!started || generation !== this.generation) return;
      events.onState('listening', '正在听取讲话，停顿后自动确认整句。');
      this.timer = setTimeout(() => void this.finish(), 5 * 60 * 1000);
    } catch (error) {
      fail(
        (error as Error).name === 'NotAllowedError'
          ? '麦克风权限被拒绝，请允许录音或选择音频文件。'
          : '无法启动实时录音，请检查麦克风和浏览器支持。',
      );
    }
  }
  async finish() {
    if (!this.session || this.finishing) return;
    this.finishing = true;
    clearTimeout(this.timer);
    const generation = this.generation;
    await this.capture.finish();
    if (generation !== this.generation) return;
    this.events?.onState('thinking', '录音已结束，正在确认最后一句…');
    this.session?.finish();
  }
  cancel() {
    ++this.generation;
    clearTimeout(this.timer);
    this.capture.stop();
    this.session?.cancel();
    this.session = undefined;
    this.events = undefined;
    this.finishing = false;
  }
}
