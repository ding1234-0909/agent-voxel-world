import { useEffect, useRef, useState } from 'react';
import type { Connection } from './connection';
import { BrowserSpeech } from './browser-speech';
import {
  LocalRecorder,
  voiceApi,
  type SpeechCapabilities,
  type RecordingCallbacks,
} from './local-recorder';
type VoiceEvent = {
  requestId?: string;
  state: string;
  subtitle: string;
  speakText?: string;
};
export function VoicePanel({
  connection,
  onJoin,
  hidden = false,
  onClose,
  onActivityChange,
}: {
  connection: Connection;
  onJoin: () => Promise<boolean>;
  hidden?: boolean;
  onClose?: () => void;
  onActivityChange?: (state: string) => void;
}) {
  const [speech] = useState(() => new BrowserSpeech());
  const [recorder] = useState(() => new LocalRecorder());
  const [recognizer, setRecognizer] = useState('local');
  const [capabilities, setCapabilities] = useState<SpeechCapabilities>();
  const [capabilityError, setCapabilityError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCapabilityError('');
    void fetch(`${voiceApi()}/voice/capabilities`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error('capabilities');
        const value = await response.json();
        if (typeof value.local?.available !== 'boolean')
          throw Error('capabilities');
        if (!controller.signal.aborted) setCapabilities(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCapabilities(undefined);
          setCapabilityError('无法检测本机语音服务，请确认服务已启动后重试。');
        }
      });
    return () => controller.abort();
  }, [connection.status, refresh]);
  const [provider, setProvider] = useState('browser');
  const [lang, setLang] = useState('zh-CN');
  const [text, setText] = useState('你好，欢迎来到体素世界');
  const [readAloud, setReadAloud] = useState(true);
  const [voice, setVoice] = useState<VoiceEvent>({
    state: 'idle',
    subtitle: '选择方案，输入文字或点击麦克风开始。',
  });
  const request = useRef<string | undefined>(undefined);
  useEffect(() => {
    onActivityChange?.(voice.state);
  }, [voice.state, onActivityChange]);
  const operation = useRef(0);
  const joining = useRef(false);
  const connected = connection.status === 'connected';
  const connecting = connection.status === 'connecting';
  const actionLabel = provider === 'mock' ? '模拟' : '发送';
  const stop = () => {
    operation.current++;
    request.current = undefined;
    speech.stop();
    recorder.cancel();
    connection.action('voice.interrupt');
  };
  useEffect(() => {
    connection.onVoice = (value) => {
      const event = value as VoiceEvent;
      if (!event.requestId) {
        request.current = undefined;
        speech.stop();
        recorder.cancel();
        operation.current++;
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
  }, [connection, speech, recorder, lang, readAloud]);
  useEffect(
    () => () => {
      operation.current++;
      speech.stop();
      recorder.cancel();
      connection.action('voice.interrupt');
    },
    [connection, speech, recorder],
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
  const recordingCallbacks: RecordingCallbacks = {
    onState: (state, subtitle) => setVoice({ state, subtitle }),
    onText: (value) => {
      setText(value);
      void send(value);
    },
    onError: (subtitle) => setVoice({ state: 'error', subtitle }),
  };
  const localReady = capabilities?.local.available === true;
  const micAvailable =
    recognizer === 'local'
      ? localReady && recorder.canRecord
      : speech.canListen;
  return (
    <section
      id="voice-panel"
      className="voice"
      aria-label="语音实验室"
      hidden={hidden}
    >
      {onClose && (
        <button
          className="panel-close"
          aria-label="收起语音面板"
          onClick={onClose}
        >
          收起 ×
        </button>
      )}
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
          <option value="browser">语音回声 · 非 AI</option>
          <option value="ollama" disabled={!capabilities?.ollamaConfigured}>
            本地 AI · Ollama{capabilities?.ollamaConfigured ? '' : '（未配置）'}
          </option>
          <option value="mock">Mock · 仅文字模拟</option>
        </select>
      </label>
      {provider !== 'mock' && (
        <label className="voice-label">
          语音识别方式
          <select
            aria-label="语音识别方式"
            value={recognizer}
            onChange={(e) => {
              stop();
              setRecognizer(e.target.value);
              setVoice({ state: 'idle', subtitle: '识别方式已切换。' });
            }}
          >
            <option value="local">本机 Whisper · 无需联网识别</option>
            <option value="browser">浏览器在线识别 · 需网络</option>
          </select>
        </label>
      )}
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
                setVoice((v) =>
                  v.state === 'speaking' ? { ...v, state: 'idle' } : v,
                );
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
            disabled={!connected || !micAvailable}
            onClick={() => {
              if (recognizer === 'local' && voice.state === 'listening') {
                recorder.finish();
                return;
              }
              stop();
              if (recognizer === 'local') {
                void recorder.start(lang, recordingCallbacks);
                return;
              }
              setVoice({
                state: 'listening',
                subtitle: '浏览器在线识别中，停顿后自动发送…',
              });
              speech.listen(
                lang,
                recordingCallbacks.onText,
                recordingCallbacks.onError,
                () =>
                  setVoice({
                    state: 'idle',
                    subtitle: '录音结束。可以重试或输入文字。',
                  }),
              );
            }}
          >
            {recognizer === 'local' && voice.state === 'listening'
              ? '结束录音'
              : '麦克风'}
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
      {provider !== 'mock' && recognizer === 'local' && (
        <>
          <label className="voice-label">
            或选择音频文件（最长 20 秒 / 5 MiB）
            <input
              type="file"
              aria-label="选择音频文件"
              accept=".wav,.webm,.mp4,.m4a,.ogg"
              disabled={!connected || !localReady}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  stop();
                  void recorder.transcribeFile(file, lang, recordingCallbacks);
                }
              }}
            />
          </label>
          <small role="status">
            {capabilityError ||
              capabilities?.local.reason ||
              '正在检测本机识别服务…'}
          </small>
          {!localReady && (
            <button onClick={() => setRefresh((n) => n + 1)}>重新检测</button>
          )}
        </>
      )}
      {provider !== 'mock' &&
        recognizer === 'browser' &&
        voice.state === 'error' && (
          <button
            onClick={() => {
              stop();
              setRecognizer('local');
              setRefresh((n) => n + 1);
              setVoice({
                state: 'idle',
                subtitle: '已切换到本机 Whisper，请重新点击麦克风录音。',
              });
            }}
          >
            改用本机识别
          </button>
        )}
      <small>
        {provider === 'mock'
          ? '文字模拟 · 无麦克风、音频或真实 AI'
          : provider === 'browser'
            ? '无需账号或信用卡。复述你的话，用于体验识别与朗读。'
            : '本机 Ollama 生成回复，每轮独立，不控制世界。'}
      </small>
      {provider !== 'mock' && (
        <small>
          {recognizer === 'local'
            ? '录音仅发往本机服务，识别后删除临时文件。朗读仍使用浏览器语音。'
            : '在线识别可能将音频发送给浏览器厂商；网络不可达时请改用本机识别。'}
          {!micAvailable && ' 当前无法录音，可输入文字或检查识别服务。'}
          {!speech.canSpeak && ' 当前无法朗读，仅显示文字。'}
        </small>
      )}
    </section>
  );
}
