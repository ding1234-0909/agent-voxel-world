/** A recording remains a local draft until the player explicitly sends it. */
export class ClipRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(
    private capture = () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      }),
  ) {}
  cancel() {
    this.generation++;
    clearTimeout(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }
  finish() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    clearTimeout(this.timer);
  }
  async start(
    onDone: (blob: Blob, durationMs: number) => void,
    onError: (message: string) => void,
    onReady: () => void,
  ) {
    this.cancel();
    const generation = this.generation;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw Error('请在支持录音的 localhost / HTTPS 浏览器中打开。');
      const stream = await this.capture();
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mimeType) throw Error('当前浏览器没有可用的录音编码。');
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      this.recorder = recorder;
      const startedAt = performance.now();
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (e) => {
        if (generation !== this.generation) return;
        bytes += e.data.size;
        if (bytes > 1024 * 1024) {
          this.cancel();
          onError('录音过大，请缩短到 20 秒以内。');
          return;
        }
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = undefined;
        clearTimeout(this.timer);
        this.recorder = undefined;
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size) onDone(blob, Math.max(1, performance.now() - startedAt));
        else onError('录音为空，请重试。');
      };
      recorder.onerror = () => {
        if (generation === this.generation) {
          this.cancel();
          onError('录音中断，请检查麦克风。');
        }
      };
      recorder.start(250);
      this.timer = setTimeout(() => this.finish(), 20000);
      onReady();
    } catch (error) {
      if (generation === this.generation) {
        this.cancel();
        onError(
          error instanceof Error && error.name === 'NotAllowedError'
            ? '麦克风权限被拒绝，请允许后重试。'
            : error instanceof Error
              ? error.message
              : '无法录音。',
        );
      }
    }
  }
}
