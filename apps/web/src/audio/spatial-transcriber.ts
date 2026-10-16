import { LiveRecorder } from './live-recorder';
import { speechTransport } from './live-speech';
export type TranscriptionState = {
  status: string;
  text: string;
  partial: string;
  error: string;
};
/** Shares the spatial microphone. Only the final endpoint may publish to listeners. */
export class SpatialTranscriber {
  private state: TranscriptionState = {
    status: '麦克风开启时自动转写',
    text: '',
    partial: '',
    error: '',
  };
  constructor(
    private token: () => string,
    private changed: (state: TranscriptionState) => void,
    private request: typeof fetch = (input, init) => fetch(input, init),
    private live = new LiveRecorder(),
  ) {}
  private report(update: Partial<TranscriptionState>) {
    this.state = { ...this.state, ...update };
    this.changed({ ...this.state });
  }
  async start(stream: MediaStream) {
    this.stop();
    this.report({ text: '', partial: '', error: '' });
    await this.live.start(
      'zh-CN',
      {
        onState: (_state, status) => this.report({ status }),
        onStatus: (status) => this.report({ status }),
        onPartial: (partial) => this.report({ partial }),
        onFinal: (text) =>
          this.report({
            text,
            error: '',
            status: '整句已确认并送达附近听者，继续听取讲话…',
          }),
        onError: (error) =>
          this.report({
            partial: '',
            error,
            status: '转写已停止，实时音频仍可使用',
          }),
        onEnd: () =>
          this.report({
            partial: '',
            status: '本次转写已结束，重新开启麦克风可继续',
          }),
      },
      stream,
      speechTransport('zh-CN', this.token, this.request),
    );
  }
  stop() {
    this.live.cancel();
    this.report({ status: '转写已停止', partial: '', error: '' });
  }
}
