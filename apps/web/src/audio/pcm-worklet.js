// Streaming mono downsampling to 16kHz PCM16 LE. Carries phase across render quanta.
class PCM16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.bytes = new ArrayBuffer(3200);
    this.view = new DataView(this.bytes);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data !== 'flush') return;
      if (this.offset) {
        const tail = this.bytes.slice(0, this.offset);
        this.port.postMessage(tail, [tail]);
        this.offset = 0;
      }
      this.port.postMessage({ flushed: true });
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      this.sum += value;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.view.setInt16(
          this.offset,
          Math.round(sample * (sample < 0 ? 32768 : 32767)),
          true,
        );
        this.sum = 0;
        this.count = 0;
        this.offset += 2;
        if (this.offset === 3200) {
          this.port.postMessage(this.bytes, [this.bytes]);
          this.bytes = new ArrayBuffer(3200);
          this.view = new DataView(this.bytes);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16-capture', PCM16Capture);
