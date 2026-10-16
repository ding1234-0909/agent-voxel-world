export function pcmFloats(base64: string): Float32Array {
  if (
    base64.length > 8600 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    throw Error('invalid-audio');
  const raw = atob(base64);
  if (!raw.length || raw.length % 2) throw Error('invalid-audio');
  const samples = new Float32Array(raw.length / 2);
  for (let i = 0; i < samples.length; i++) {
    let n = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    if (n >= 32768) n -= 65536;
    samples[i] = n / 32768;
  }
  return samples;
}
export class PCMPlayer {
  private sources = new Set<AudioBufferSourceNode>();
  private next = 0;
  constructor(private context: AudioContext) {}
  play(base64: string) {
    if (this.context.state !== 'running') throw Error('audio-output-suspended');
    if (this.next - this.context.currentTime > 2)
      throw Error('audio-output-backpressure');
    const samples = pcmFloats(base64);
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    this.sources.add(source);
    this.next = Math.max(this.next, this.context.currentTime);
    source.start(this.next);
    this.next += buffer.duration;
  }
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.next = 0;
  }
}
/** Explicitly started only for real sessions. Cancellation also covers pending permission prompts. */
export class PCMCapture {
  private generation = 0;
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private timer?: ReturnType<typeof setTimeout>;
  async start(send: (base64: string) => void, ended: () => void) {
    this.stop();
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    try {
      const context = (this.context = new AudioContext());
      await context.audioWorklet.addModule(
        new URL('./pcm-worklet.js', import.meta.url),
      );
      if (generation !== this.generation) return false;
      await context.resume();
      if (generation !== this.generation) return false;
      const node = (this.node = new AudioWorkletNode(context, 'pcm16-capture'));
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (generation !== this.generation) return;
        const bytes = new Uint8Array(event.data);
        send(btoa(String.fromCharCode(...bytes)));
      };
      const mute = context.createGain();
      mute.gain.value = 0;
      context
        .createMediaStreamSource(stream)
        .connect(node)
        .connect(mute)
        .connect(context.destination);
      this.timer = setTimeout(() => {
        this.stop();
        ended();
      }, 14000);
      return true;
    } catch (e) {
      this.stop();
      throw e;
    }
  }
  stop() {
    ++this.generation;
    clearTimeout(this.timer);
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = undefined;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
