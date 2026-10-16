// SpeechRecognition is not yet included in TypeScript's standard DOM types.
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
const errors: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许，或改用文字输入。',
  'service-not-allowed': '浏览器不允许语音识别服务，请改用文字输入。',
  'audio-capture': '未找到可用麦克风，请检查设备或改用文字输入。',
  network:
    '浏览器在线识别服务无法连接，这不是世界连接故障。请点击“改用本机识别”后重新录音。',
  'no-speech': '没有听到语音，请重试。',
  'language-not-supported':
    '此浏览器不支持所选识别语言，请切换语言或使用文字输入。',
};
export class BrowserSpeech {
  private recognition?: Recognition;
  private generation = 0;
  constructor(private browser: SpeechWindow = window) {}
  get canListen() {
    return (
      !!(
        this.browser.SpeechRecognition ?? this.browser.webkitSpeechRecognition
      ) && this.browser.isSecureContext
    );
  }
  get canSpeak() {
    return !!this.browser.speechSynthesis;
  }
  stop() {
    this.generation++;
    this.recognition?.abort();
    this.recognition = undefined;
    this.browser.speechSynthesis?.cancel();
  }
  listen(
    lang: string,
    onText: (text: string) => void,
    onError: (error: string) => void,
    onEnd: () => void,
  ) {
    this.stop();
    const generation = this.generation;
    const Constructor =
      this.browser.SpeechRecognition ?? this.browser.webkitSpeechRecognition;
    if (!Constructor || !this.canListen) {
      onError(
        '当前浏览器无法识别语音。请使用支持语音识别的浏览器，在 localhost 或 HTTPS 下打开；也可直接输入文字。',
      );
      return;
    }
    try {
      const recognition = new Constructor();
      this.recognition = recognition;
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        if (generation !== this.generation) return;
        const text = Array.from(
          event.results,
          (result) => result[0]?.transcript ?? '',
        )
          .join('')
          .trim();
        // Stop before delivering to prevent an onend event from overwriting a new turn.
        this.stop();
        if (!text) {
          onError('没有识别到文字，请重试。');
          return;
        }
        if (text.length > 240) {
          onError('识别内容超过 240 字，请分成短句重试。');
          return;
        }
        onText(text);
      };
      recognition.onerror = (event) => {
        if (generation !== this.generation) return;
        this.stop();
        onError(
          errors[event.error] ??
            `语音识别失败（${event.error}），请重试或输入文字。`,
        );
      };
      recognition.onend = () => {
        if (generation !== this.generation) return;
        this.recognition = undefined;
        onEnd();
      };
      recognition.start();
    } catch {
      this.stop();
      onError('无法启动麦克风，请检查浏览器权限后重试。');
    }
  }
  speak(text: string, lang: string, onEnd: () => void, onError: () => void) {
    this.stop();
    const generation = this.generation;
    if (!this.canSpeak) {
      onError();
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      // Prefer installed voices; the browser may provide only network voices.
      const voices = this.browser.speechSynthesis.getVoices();
      const matches = voices.filter((v) =>
        v.lang.toLowerCase().startsWith(lang.split('-')[0]),
      );
      utterance.voice =
        matches.find((v) => v.localService) ?? matches[0] ?? null;
      utterance.onend = () => {
        if (generation === this.generation) onEnd();
      };
      utterance.onerror = () => {
        if (generation === this.generation) onError();
      };
      this.browser.speechSynthesis.speak(utterance);
    } catch {
      onError();
    }
  }
}
