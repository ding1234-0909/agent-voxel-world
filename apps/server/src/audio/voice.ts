export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';
export type VoiceEvent = {
  provider: string;
  state: VoiceState;
  turn: number;
  subtitle: string;
  error?: string;
  speakText?: string;
};
export type VoiceInput =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; pcm: Uint8Array; sampleRate: 16000 };
/** Server-only provider boundary. A future provider must implement audio transport and credentials here. */
export interface VoiceSession {
  push(input: VoiceInput): void;
  interrupt(): void;
  close(): void;
}
export interface VoiceProvider {
  readonly id: string;
  create(emit: (event: VoiceEvent) => void): VoiceSession;
}
export class MockVoiceProvider implements VoiceProvider {
  readonly id = 'mock-text-no-audio';
  create(emit: (event: VoiceEvent) => void): VoiceSession {
    let turn = 0,
      closed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const clear = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
    const send = (state: VoiceState, subtitle = '', error?: string) => {
      if (!closed) emit({ provider: this.id, state, turn, subtitle, error });
    };
    const later = (ms: number, fn: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!closed) fn();
      }, ms);
      timers.add(timer);
    };
    return {
      push(input) {
        if (closed) return;
        clear();
        turn++;
        if (input.kind === 'audio') {
          send('error', '', 'mock-does-not-process-audio');
          return;
        }
        if (!input.text.trim() || input.text.length > 240) {
          send('error', '', 'invalid-text');
          return;
        }
        send('listening', `[Mock input] ${input.text}`);
        later(150, () =>
          send('thinking', '[Mock] Preparing scripted response…'),
        );
        const reply = `[Mock — not AI, no audio] You said: ${input.text}`;
        later(450, () =>
          send('speaking', reply.slice(0, Math.ceil(reply.length / 2))),
        );
        later(950, () => send('speaking', reply));
        later(1800, () => send('idle', reply));
      },
      interrupt() {
        if (closed) return;
        clear();
        turn++;
        send('interrupted', '[Mock] Response interrupted.');
      },
      close() {
        clear();
        closed = true;
      },
    };
  }
}
export class BrowserVoiceProvider implements VoiceProvider {
  readonly id = 'browser';
  create(emit: (event: VoiceEvent) => void): VoiceSession {
    let turn = 0,
      closed = false;
    return {
      push(input) {
        if (closed) return;
        turn++;
        if (
          input.kind !== 'text' ||
          !input.text.trim() ||
          input.text.length > 240
        ) {
          emit({
            provider: 'browser',
            state: 'error',
            turn,
            subtitle: '请输入 1–240 字文字；音频识别由浏览器完成。',
          });
          return;
        }
        emit({
          provider: 'browser',
          state: 'idle',
          turn,
          subtitle: `语音回声（非 AI）：${input.text}`,
          speakText: input.text,
        });
      },
      interrupt() {
        if (!closed)
          emit({
            provider: 'browser',
            state: 'interrupted',
            turn: ++turn,
            subtitle: '已打断。',
          });
      },
      close() {
        closed = true;
      },
    };
  }
}

/** Local text inference only; the browser owns recognition and playback. */
export class OllamaVoiceProvider implements VoiceProvider {
  readonly id = 'ollama';
  private endpoint: string;
  constructor(
    private model: string,
    baseUrl = 'http://127.0.0.1:11434',
    private timeoutMs = 60000,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw Error('OLLAMA_BASE_URL 必须是本机 HTTP 地址。');
    if (!model.trim() || /cloud/i.test(model))
      throw Error('请设置 OLLAMA_MODEL 为已下载的本地模型。');
    this.endpoint = new URL('/api/chat', url).href;
  }
  create(emit: (event: VoiceEvent) => void): VoiceSession {
    let turn = 0,
      closed = false,
      controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      controller?.abort();
      clearTimeout(timer);
    };
    const send = (state: VoiceState, subtitle: string, speakText?: string) => {
      if (!closed)
        emit({ provider: this.id, state, turn, subtitle, speakText });
    };
    return {
      push: (input) => {
        if (closed) return;
        cancel();
        const current = ++turn;
        if (
          input.kind !== 'text' ||
          !input.text.trim() ||
          input.text.length > 240
        ) {
          send('error', '请输入 1–240 字文字；音频识别由浏览器完成。');
          return;
        }
        const request = new AbortController();
        controller = request;
        timer = setTimeout(() => request.abort(), this.timeoutMs);
        send('thinking', '本机模型正在回复…');
        void (async () => {
          try {
            const response = await fetch(this.endpoint, {
              method: 'POST',
              redirect: 'error',
              signal: request.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: this.model,
                stream: false,
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are a friendly voxel world companion. Reply briefly in the user’s language. You cannot observe or change the world. Do not claim you performed actions.',
                  },
                  { role: 'user', content: input.text },
                ],
                options: { num_predict: 256 },
              }),
            });
            if (!response.ok)
              throw Error(
                `Ollama HTTP ${response.status}；请确认服务已启动且模型已下载。`,
              );
            const data = await response.json();
            const reply = data.message?.content;
            if (typeof reply !== 'string' || !reply.trim())
              throw Error('本机模型未返回文字。');
            if (!closed && current === turn && !request.signal.aborted)
              send('idle', reply.slice(0, 2000), reply.slice(0, 2000));
          } catch (error) {
            if (!closed && current === turn)
              send(
                'error',
                request.signal.aborted
                  ? '本机模型响应超时，请换用更小的模型后重试。'
                  : error instanceof Error &&
                      error.message.startsWith('Ollama HTTP')
                    ? error.message
                    : '无法获得本机模型回复，请检查 Ollama 服务和模型配置。',
              );
          } finally {
            if (current === turn) {
              clearTimeout(timer);
              controller = undefined;
            }
          }
        })();
      },
      interrupt: () => {
        if (!closed) {
          turn++;
          cancel();
          send('interrupted', '已打断。');
        }
      },
      close: () => {
        closed = true;
        turn++;
        cancel();
      },
    };
  }
}

export function createVoiceProvider(
  id = process.env.VOICE_PROVIDER ?? 'mock',
): VoiceProvider {
  switch (id) {
    case 'mock':
      return new MockVoiceProvider();
    case 'browser':
      return new BrowserVoiceProvider();
    case 'ollama':
      return new OllamaVoiceProvider(
        process.env.OLLAMA_MODEL ?? '',
        process.env.OLLAMA_BASE_URL,
      );
    default:
      throw Error('VOICE_PROVIDER 仅支持 mock、browser 或 ollama。');
  }
}
