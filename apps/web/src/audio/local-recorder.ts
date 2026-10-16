import { serverHttpUrl } from '../network/endpoints';
export type SpeechCapabilities = {
  local: { available: boolean; reason: string };
  ollamaConfigured: boolean;
};
export type RecordingCallbacks = {
  onState: (state: 'listening' | 'thinking', message: string) => void;
  onText: (text: string) => void;
  onError: (message: string) => void;
};
const MAX_BYTES = 5 * 1024 * 1024;
export class LocalRecorder {
  private generation = 0;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  get canRecord() {
    return (
      window.isSecureContext &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }
  private release() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
  cancel() {
    this.generation++;
    this.controller?.abort();
    if (this.recorder && this.recorder.state !== 'inactive')
      this.recorder.stop();
    this.recorder = undefined;
    this.release();
  }
  finish() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.release();
  }
  async start(language: string, callbacks: RecordingCallbacks) {
    this.cancel();
    const generation = this.generation;
    if (!this.canRecord) {
      callbacks.onError(
        '当前浏览器无法录音，请在 localhost / HTTPS 下打开并允许麦克风，或选择音频文件。',
      );
      return;
    }
    callbacks.onState('thinking', '正在请求麦克风权限…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        this.cancel();
        callbacks.onError('浏览器没有受支持的录音格式，请使用音频文件。');
        return;
      }
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (generation !== this.generation) return;
        size += event.data.size;
        if (size > MAX_BYTES) {
          this.cancel();
          callbacks.onError('录音超过 5 MiB，请缩短录音。');
          return;
        }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation === this.generation) {
          this.cancel();
          callbacks.onError('录音失败，请检查麦克风权限和设备。');
        }
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        this.release();
        this.recorder = undefined;
        void this.upload(
          new Blob(chunks, { type: mimeType }),
          language,
          callbacks,
          generation,
        );
      };
      recorder.start(250);
      callbacks.onState(
        'listening',
        '录音中，请说话后点击“结束录音”；20 秒后自动结束。',
      );
      this.timer = setTimeout(() => this.finish(), 20000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      callbacks.onError(
        error instanceof Error && error.name === 'NotAllowedError'
          ? '麦克风权限被拒绝，请在浏览器中允许，或选择音频文件。'
          : '无法打开麦克风，请检查设备，或选择音频文件。',
      );
    }
  }
  async transcribeFile(
    file: File,
    language: string,
    callbacks: RecordingCallbacks,
  ) {
    this.cancel();
    // Browsers often label audio-only WebM/MP4 files as video/*.
    const types: Record<string, string> = {
      wav: 'audio/wav',
      webm: 'audio/webm',
      mp4: 'audio/mp4',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
    };
    const type =
      types[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? file.type;
    await this.upload(
      new Blob([file], { type }),
      language,
      callbacks,
      this.generation,
    );
  }
  private async upload(
    audio: Blob,
    language: string,
    callbacks: RecordingCallbacks,
    generation: number,
  ) {
    if (!audio.size || audio.size > MAX_BYTES) {
      callbacks.onError('音频不能为空且不能超过 5 MiB。');
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 110000);
    callbacks.onState('thinking', '服务器上的 Whisper 正在识别录音…');
    try {
      const response = await fetch(
        `${serverHttpUrl()}/voice/transcribe?language=${language.startsWith('zh') ? 'zh' : 'en'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': audio.type || 'application/octet-stream' },
          body: audio,
          signal: controller.signal,
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(
          typeof result.error === 'string' ? result.error : '服务器识别失败。',
        );
      if (
        typeof result.text !== 'string' ||
        !result.text.trim() ||
        result.text.length > 240
      )
        throw Error('识别结果为空或超过 240 字，请录制更短的语音。');
      if (generation === this.generation) callbacks.onText(result.text);
    } catch (error) {
      if (generation === this.generation)
        callbacks.onError(
          controller.signal.aborted
            ? '服务器识别超时，请录制更短的语音后重试。'
            : error instanceof TypeError
              ? '无法连接服务器识别服务，请确认项目服务正在运行。'
              : error instanceof Error
                ? error.message
                : '服务器识别失败，请重试。',
        );
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
    }
  }
}
