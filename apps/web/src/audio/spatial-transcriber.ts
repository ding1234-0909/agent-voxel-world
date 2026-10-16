import { serverHttpUrl } from '../network/endpoints';
export type TranscriptionState = {
  status: string;
  text: string;
  error: string;
};
type Chunk = { id: string; blob: Blob };
/** Uses the live mic's existing stream; never acquires or stops its tracks. */
export class SpatialTranscriber {
  private generation = 0;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private requests = new Set<AbortController>();
  private tickets = new Set<string>();
  private queue: Chunk[] = [];
  private working = false;
  private state: TranscriptionState = {
    status: '麦克风开启时自动转写',
    text: '',
    error: '',
  };
  constructor(
    private token: () => string,
    private changed: (state: TranscriptionState) => void,
    private request: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  private report(update: Partial<TranscriptionState>) {
    this.state = { ...this.state, ...update };
    this.changed({ ...this.state });
  }
  private async api(path: string, method: string, body?: Blob) {
    const abort = new AbortController();
    this.requests.add(abort);
    const timer = setTimeout(() => abort.abort(), 30000);
    try {
      const res = await this.request(
        `${serverHttpUrl()}/chat/spatial/${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.token()}`,
            ...(body ? { 'Content-Type': body.type } : {}),
          },
          body,
          signal: abort.signal,
        },
      );
      if (res.status === 204) return {};
      const data = await res.json();
      if (!res.ok) throw Error(data.error || '附近语音转写失败。');
      return data;
    } finally {
      clearTimeout(timer);
      this.requests.delete(abort);
    }
  }
  private release(id: string) {
    this.tickets.delete(id);
    void this.api(id, 'DELETE').catch(() => {});
  }
  async start(stream: MediaStream) {
    this.stop();
    const generation = this.generation;
    this.report({ status: '正在启动本机转写…', text: '', error: '' });
    try {
      if (typeof MediaRecorder === 'undefined')
        throw Error('浏览器不支持语音分段录制。');
      this.context = new AudioContext();
      await this.context.resume();
      if (generation !== this.generation) return;
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.source.connect(this.analyser);
      void this.segment(stream, generation);
    } catch (e) {
      if (generation === this.generation)
        this.report({
          status: '实时音频仍可使用',
          error: (e as Error).message,
        });
    }
  }
  private async segment(stream: MediaStream, generation: number) {
    if (generation !== this.generation || !stream.active) return;
    let id = '';
    try {
      const ticket = await this.api('start', 'POST');
      id = ticket.id;
      if (generation !== this.generation) {
        this.release(id);
        return;
      }
      this.tickets.add(id);
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) throw Error('浏览器没有可用的语音编码。');
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0,
        voicedMs = 0,
        lastVoice = performance.now();
      const began = lastVoice;
      recorder.ondataavailable = (e) => {
        bytes += e.data.size;
        if (e.data.size && bytes <= 1024 * 1024) chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        clearInterval(this.timer);
        this.recorder = undefined;
        if (voicedMs >= 400 && bytes > 0 && bytes <= 1024 * 1024) {
          if (this.queue.length < 2) {
            this.queue.push({ id, blob: new Blob(chunks, { type: mimeType }) });
            void this.pump(generation);
          } else {
            this.release(id);
            this.report({
              error: '本机转写跟不上讲话速度，已跳过一段以避免延迟累积。',
            });
          }
        } else this.release(id);
        void this.segment(stream, generation);
      };
      recorder.onerror = () => {
        if (generation === this.generation) {
          this.release(id);
          this.stop();
          this.report({
            status: '实时音频仍可使用',
            error: '分段录音中断，请重新开启麦克风。',
          });
        }
      };
      recorder.start(200);
      this.report({
        status: this.working
          ? '正在本机转写，同时继续收音…'
          : '正在听取附近讲话…',
      });
      const samples = new Float32Array(2048);
      this.timer = setInterval(() => {
        if (generation !== this.generation || recorder.state !== 'recording')
          return;
        this.analyser?.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
            samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
          ),
          now = performance.now();
        if (rms >= 0.008) {
          voicedMs += 200;
          lastVoice = now;
        }
        if (
          now - began >= 6000 ||
          (voicedMs >= 400 && now - lastVoice >= 900 && now - began >= 1000)
        )
          recorder.stop();
      }, 200);
    } catch (e) {
      if (id) this.release(id);
      if (generation !== this.generation) return;
      this.report({
        status: '实时音频仍可使用',
        error:
          (e as Error).name === 'AbortError'
            ? '本机转写连接超时。'
            : (e as Error).message,
      });
      this.retry = setTimeout(
        () => void this.segment(stream, generation),
        3000,
      );
    }
  }
  private async pump(generation: number) {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length && generation === this.generation) {
        const chunk = this.queue.shift()!;
        this.report({ status: '正在本机转写，同时继续收音…' });
        try {
          const data = await this.api(chunk.id, 'POST', chunk.blob);
          if (generation === this.generation)
            this.report({
              status: '转写已送达附近听者',
              text: data.text,
              error: '',
            });
        } catch (e) {
          if (generation === this.generation)
            this.report({
              status: '实时音频仍可使用',
              error:
                (e as Error).name === 'AbortError'
                  ? '本机转写超时，已跳过此段。'
                  : (e as Error).message,
            });
        } finally {
          this.tickets.delete(chunk.id);
        }
      }
    } finally {
      if (generation === this.generation) this.working = false;
    }
  }
  stop() {
    this.generation++;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    for (const request of this.requests) request.abort();
    this.requests.clear();
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      if (this.recorder.state === 'recording') this.recorder.stop();
      this.recorder = undefined;
    }
    for (const id of this.tickets) this.release(id);
    this.tickets.clear();
    this.queue = [];
    this.working = false;
    this.source?.disconnect();
    this.source = undefined;
    this.analyser = undefined;
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = undefined;
    }
    this.report({ status: '转写已停止', error: '' });
  }
}
