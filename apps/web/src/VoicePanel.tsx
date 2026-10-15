import { useEffect, useRef, useState } from 'react';
import type { Connection } from './connection';
import { BrowserSpeech } from './browser-speech';
type VoiceEvent = {
  requestId?: string;
  state: string;
  subtitle: string;
  speakText?: string;
};
export function VoicePanel({
  connection,
  onJoin,
}: {
  connection: Connection;
  onJoin: () => Promise<boolean>;
}) {
  const [speech] = useState(() => new BrowserSpeech());
  const [provider, setProvider] = useState('browser');
  const [lang, setLang] = useState('zh-CN');
  const [text, setText] = useState('你好，欢迎来到体素世界');
  const [readAloud, setReadAloud] = useState(true);
  const [voice, setVoice] = useState<VoiceEvent>({
    state: 'idle',
    subtitle: '选择方案，输入文字或点击麦克风开始。',
  });
  const request = useRef<string | undefined>(undefined);
  const operation = useRef(0);
  const joining = useRef(false);
  const connected = connection.status === 'connected';
  const connecting = connection.status === 'connecting';
  const actionLabel = provider === 'mock' ? '模拟' : '发送';
  const stop = () => {
    operation.current++;
    request.current = undefined;
    speech.stop();
    connection.action('voice.interrupt');
  };
  useEffect(() => {
    connection.onVoice = (value) => {
      const event = value as VoiceEvent;
      if (!event.requestId) {
        request.current = undefined;
        speech.stop();
        setVoice(event);
        return;
      }
      if (event.requestId !== request.current) return;
      setVoice(event);
      if (event.speakText && readAloud && speech.canSpeak) {
        setVoice({ ...event, state: 'speaking' });
        speech.speak(
          event.speakText,
          lang,
          () => setVoice({ ...event, state: 'idle' }),
          () =>
            setVoice({
              ...event,
              state: 'error',
              subtitle: `${event.subtitle}\n朗读失败，可查看文字回复，或点击“朗读回复”重试。`,
            }),
        );
      }
    };
    return () => {
      connection.onVoice = () => {};
    };
  }, [connection, speech, lang, readAloud]);
  useEffect(
    () => () => {
      speech.stop();
      connection.action('voice.interrupt');
    },
    [connection, speech],
  );
  const send = async (value: string) => {
    if (!value.trim() || joining.current || connecting) return;
    stop();
    const current = operation.current;
    if (connection.status !== 'connected') {
      joining.current = true;
      setVoice({
        state: 'connecting',
        subtitle: '正在进入世界，连接成功后将发送这句话…',
      });
      try {
        const ready = await onJoin();
        if (current !== operation.current) return;
        if (!ready) {
          setVoice({
            state: 'error',
            subtitle:
              '无法连接世界服务，内容已保留。请检查服务是否启动，连接恢复后再次发送。',
          });
          return;
        }
      } catch {
        if (current === operation.current)
          setVoice({
            state: 'error',
            subtitle: '连接失败，内容已保留，请重试。',
          });
        return;
      } finally {
        joining.current = false;
      }
    }
    if (current !== operation.current) return;
    request.current = connection.action('voice.start', {
      text: value,
      provider,
    });
    setVoice(
      request.current
        ? { state: 'thinking', subtitle: '等待回复…' }
        : { state: 'error', subtitle: '连接已断开，请重试。' },
    );
  };
  return (
    <section className="voice" aria-label="语音实验室">
      <div className="eyebrow">VOICE LAB · 无需云账号</div>
      <label className="voice-label">
        接入方案
        <select
          aria-label="语音接入方案"
          value={provider}
          onChange={(e) => {
            stop();
            setProvider(e.target.value);
            setVoice({
              state: 'idle',
              subtitle: '方案已切换，可以开始新一轮对话。',
            });
          }}
        >
          <option value="browser">浏览器语音 · 回声体验（非 AI）</option>
          <option value="ollama">本地 AI · Ollama + 浏览器语音</option>
          <option value="mock">Mock · 仅文字模拟</option>
        </select>
      </label>
      {provider !== 'mock' && (
        <div className="voice-options">
          <select
            aria-label="语音语言"
            value={lang}
            onChange={(e) => {
              stop();
              setLang(e.target.value);
              setVoice({ state: 'idle', subtitle: '语言已切换。' });
            }}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={readAloud}
              disabled={!speech.canSpeak}
              onChange={(e) => {
                speech.stop();
                setReadAloud(e.target.checked);
                setVoice((v) => ({ ...v, state: 'idle' }));
              }}
            />
            自动朗读
          </label>
        </div>
      )}
      <div className="voice-state">{voice.state}</div>
      <p aria-live="polite">{voice.subtitle}</p>
      {!connected && (
        <small role="status" className="voice-connection">
          {connecting
            ? '正在连接世界，请稍候…'
            : connection.status === 'lobby'
              ? '尚未进入世界。点击下方按钮，将使用左侧昵称进入并发送；麦克风在连接后可用。'
              : '世界服务未连接，正在尝试恢复。可点击下方按钮重试，输入内容会保留。'}
        </small>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          aria-label="语音文字输入"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={240}
          required
        />
        <button disabled={connecting || !text.trim()}>
          {connecting
            ? '连接中…'
            : connected
              ? actionLabel
              : connection.status === 'lobby'
                ? `进入并${actionLabel}`
                : `重连并${actionLabel}`}
        </button>
      </form>
      <div className="voice-actions">
        {provider !== 'mock' && (
          <button
            disabled={!connected || !speech.canListen}
            onClick={() => {
              stop();
              setVoice({
                state: 'listening',
                subtitle: '请说一句话，停顿后自动发送…',
              });
              speech.listen(
                lang,
                (value) => {
                  setText(value);
                  void send(value);
                },
                (error) => setVoice({ state: 'error', subtitle: error }),
                () =>
                  setVoice({
                    state: 'idle',
                    subtitle: '录音结束。可以重试或输入文字。',
                  }),
              );
            }}
          >
            麦克风
          </button>
        )}
        <button
          onClick={() => {
            stop();
            setVoice({
              state: 'interrupted',
              subtitle: '已停止识别、回复和朗读。',
            });
          }}
        >
          打断
        </button>
        {provider !== 'mock' && (
          <button
            disabled={!speech.canSpeak || !voice.speakText}
            onClick={() => {
              const reply = voice.speakText!;
              stop();
              setVoice({ ...voice, state: 'speaking' });
              speech.speak(
                reply,
                lang,
                () => setVoice({ ...voice, state: 'idle' }),
                () =>
                  setVoice({
                    ...voice,
                    state: 'error',
                    subtitle: `${voice.subtitle}\n浏览器无法朗读，请检查语音或音频设置。`,
                  }),
              );
            }}
          >
            朗读回复
          </button>
        )}
      </div>
      <small>
        {provider === 'mock'
          ? '文字模拟 · 无麦克风、音频或真实 AI'
          : provider === 'browser'
            ? '无需账号或信用卡。复述你的话，用于体验识别与朗读。'
            : '需先安装 Ollama、下载本地模型并设置 OLLAMA_MODEL，重启服务。每轮独立回复，不控制世界。'}
      </small>
      {provider !== 'mock' && (
        <small>
          浏览器识别可能将音频发送给浏览器厂商，并依赖网络；朗读取决于已安装的语音。
          {!speech.canListen && ' 当前无法使用语音识别，请输入文字。'}
          {!speech.canSpeak && ' 当前无法朗读，仅显示文字。'}
        </small>
      )}
    </section>
  );
}
