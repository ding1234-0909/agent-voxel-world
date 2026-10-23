import { serverHttpUrl } from '../network/endpoints';

/** 识别引擎：固定使用本地 faster-whisper（免费离线，无需任何密钥配置）。 */
export function asrEngineParam(): string {
  return '';
}

export type LiveSpeechEvents = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus: (text: string) => void;
  onError: (text: string) => void;
  onEnd: () => void;
};
export type SpeechTransport = {
  begin: (signal: AbortSignal) => Promise<string>;
  recognize: (
    id: string,
    audio: Blob,
    partial: boolean,
    signal: AbortSignal,
  ) => Promise<string>;
  release: (id: string) => void;
};

export function speechTransport(
  language: string,
  token?: () => string,
  request: typeof fetch = (url, init) => fetch(url, init),
): SpeechTransport {
  const credential = token?.();
  const headers = (): Record<string, string> =>
    token ? { Authorization: `Bearer ${credential}` } : {};
  const call = async (path: string, signal: AbortSignal, body?: Blob) => {
    const response = await request(`${serverHttpUrl()}${path}`, {
      method: 'POST',
      headers: {
        ...headers(),
        ...(body ? { 'Content-Type': 'audio/wav' } : {}),
      },
      body,
      signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error || '语音识别失败。'), {
        status: response.status,
      });
    return value;
  };
  return {
    begin: async (signal) =>
      token ? (await call('/chat/spatial/start', signal)).id : '',
    recognize: async (id, audio, partial, signal) => {
      const path = token
        ? `/chat/spatial/${encodeURIComponent(id)}${partial ? '/preview' : ''}`
        : `/voice/transcribe?language=${language}${partial ? '&partial=1' : ''}${asrEngineParam()}`;
      const value = await call(path, signal, audio);
      if (
        typeof value.text !== 'string' ||
        !value.text.trim() ||
        value.text.length > 240
      )
        throw Error('识别结果为空或过长，请分成短句。');
      return value.text;
    },
    release: (id) => {
      if (token && id)
        void request(
          `${serverHttpUrl()}/chat/spatial/${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            headers: headers(),
            signal: AbortSignal.timeout(5000),
          },
        ).catch(() => {});
    },
  };
}

/** Every snapshot is an independently decodable 16 kHz WAV, not a MediaRecorder fragment. */
export function pcmWav(frames: Uint8Array[]) {
  const size = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
  const buffer = new ArrayBuffer(44 + size),
    bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, size, true);
  let offset = 44;
  for (const frame of frames) {
    bytes.set(frame, offset);
    offset += frame.byteLength;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
type Sentence = {
  id: Promise<string>;
  frames: Uint8Array[];
  duration: number;
  voiced: number;
  silence: number;
  previewAt: number;
  ended: boolean;
};
/** Audio-clock VAD, replaceable previews, ordered final results and bounded memory. */
export class LiveSpeechSession {
  private abort = new AbortController();
  private current?: Sentence;
  private preRoll: Uint8Array[] = [];
  private finals: Sentence[] = [];
  private tickets = new Set<string>();
  private working = false;
  private preview?: { sentence: Sentence; controller: AbortController };
  private finishing = false;
  private ended = false;
  constructor(
    private transport: SpeechTransport,
    private events: LiveSpeechEvents,
  ) {}
  feed(frame: Uint8Array) {
    if (
      this.abort.signal.aborted ||
      this.finishing ||
      !frame.length ||
      frame.length > 3200 ||
      frame.length % 2
    )
      return;
    const ms = frame.length / 32,
      view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    let sum = 0;
    for (let i = 0; i < frame.length; i += 2)
      sum += (view.getInt16(i, true) / 32768) ** 2;
    const voiced = Math.sqrt(sum / (frame.length / 2)) >= 0.008;
    if (!this.current) {
      if (!voiced) {
        this.preRoll.push(frame.slice());
        if (this.preRoll.length > 3) this.preRoll.shift();
        return;
      }
      if (this.finals.length >= 2) {
        this.fail(
          '识别跟不上讲话速度，已停止后续转写。请查看消息记录后再继续。',
        );
        return;
      }
      const id = this.transport
        .begin(AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]))
        .then((value) => {
          if (this.abort.signal.aborted) this.transport.release(value);
          else this.tickets.add(value);
          return value;
        });
      // Attach immediately: permission/ticket failures must not become unhandled rejections.
      void id.catch((error) => {
        if (!this.abort.signal.aborted) this.fail((error as Error).message);
      });
      this.current = {
        id,
        frames: this.preRoll,
        duration: this.preRoll.reduce((n, x) => n + x.length / 32, 0),
        voiced: 0,
        silence: 0,
        previewAt: 0,
        ended: false,
      };
      this.preRoll = [];
      this.events.onPartial('');
    }
    const sentence = this.current;
    sentence.frames.push(frame.slice());
    sentence.duration += ms;
    if (voiced) {
      sentence.voiced += ms;
      sentence.silence = 0;
    } else sentence.silence += ms;
    if (sentence.silence >= 900 || sentence.duration >= 12000) this.finalize();
    void this.pump();
  }
  private finalize() {
    const sentence = this.current;
    if (!sentence) return;
    sentence.ended = true;
    if (this.preview?.sentence === sentence) this.preview.controller.abort();
    this.current = undefined;
    this.events.onPartial('');
    if (sentence.voiced >= 400) {
      this.finals.push(sentence);
      this.events.onStatus(
        this.finishing ? '正在确认最后一句…' : '正在确认整句，仍可继续讲话…',
      );
    } else
      void sentence.id.then(
        (id) => this.release(id),
        () => {},
      );
  }
  private release(id: string) {
    this.tickets.delete(id);
    this.transport.release(id);
  }
  private async pump() {
    if (this.working || this.abort.signal.aborted) return;
    const final = this.finals[0];
    const sentence = final ?? this.current;
    if (
      !sentence ||
      (!final &&
        (sentence.voiced < 400 ||
          sentence.duration - sentence.previewAt < 1200))
    ) {
      this.checkEnd();
      return;
    }
    this.working = true;
    const audio = pcmWav(sentence.frames);
    sentence.previewAt = sentence.duration;
    const request = new AbortController();
    if (!final) this.preview = { sentence, controller: request };
    try {
      const id = await sentence.id;
      this.abort.signal.throwIfAborted();
      const text = await this.transport.recognize(
        id,
        audio,
        !final,
        AbortSignal.any([
          this.abort.signal,
          request.signal,
          AbortSignal.timeout(final ? 35000 : 10000),
        ]),
      );
      if (this.abort.signal.aborted) return;
      if (final) this.events.onFinal(text);
      else if (sentence === this.current && !sentence.ended)
        this.events.onPartial(text);
    } catch (error) {
      if (!this.abort.signal.aborted) {
        // A transient preview failure never substitutes for a confirmed result.
        if (final)
          this.fail((error as Error).message || '整句识别失败，未发送此句。');
        else if (!sentence.ended)
          this.events.onStatus('临时字幕暂不可用，正在等待整句确认…');
      }
    } finally {
      if (final) {
        this.finals.shift();
        void sentence.id.then(
          (id) => this.release(id),
          () => {},
        );
      }
      this.working = false;
      if (this.preview?.controller === request) this.preview = undefined;
      if (!this.abort.signal.aborted) void this.pump();
    }
  }
  finish() {
    if (this.finishing || this.abort.signal.aborted) return;
    this.finishing = true;
    this.finalize();
    void this.pump();
  }
  private checkEnd() {
    if (this.finishing && !this.working && !this.finals.length && !this.ended) {
      this.ended = true;
      this.events.onEnd();
    }
  }
  private fail(message: string) {
    this.cancel();
    this.events.onError(message);
  }
  cancel() {
    this.abort.abort();
    this.current = undefined;
    this.finals = [];
    this.preRoll = [];
    for (const id of this.tickets) this.transport.release(id);
    this.tickets.clear();
  }
}
