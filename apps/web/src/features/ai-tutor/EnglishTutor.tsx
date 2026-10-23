import { useEffect, useRef, useState } from 'react';
import { releasePointerLock } from '../../utils/pointer-lock';
import { sendTutorChat, splitTranslation, TutorError } from './api';
import {
  clearHistory,
  loadConfig,
  loadHistory,
  saveConfig,
  saveHistory,
} from './storage';
import type { ChatMessage, TutorConfig } from './types';

/**
 * AI 英语陪练对话框（移植自原版 index.html 第 95-117 行样式、
 * 133-146 行结构、3712-4135 行逻辑）。
 * 纯前端直连 OpenAI 兼容接口；配置与多轮对话持久化到 localStorage；
 * 打开面板时自动释放指针锁定，输入框为 input/button，不触发游戏移动。
 */

// webkitSpeechRecognition 的最小本地类型（DOM lib 默认不含）
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SREvent {
  resultIndex: number;
  results: SRResult[];
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speakEn(text: string): void {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.92;
    utterance.pitch = 1.05;
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang?.startsWith('en'));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* 语音朗读不可用时静默 */
  }
}

export function EnglishTutor() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<TutorConfig>(() => loadConfig());
  const [draft, setDraft] = useState<TutorConfig>(() => loadConfig());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionCtor = getSpeechRecognition();

  // 自动滚动到底部
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages, loading, open, collapsed]);

  // 卸载时停止识别与朗读
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const stopRecognition = () => {
    setRecording(false);
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  const openPanel = () => {
    releasePointerLock();
    setOpen(true);
    setCollapsed(false);
  };

  const closePanel = () => {
    stopRecognition();
    setOpen(false);
    setSettingsOpen(false);
    setError('');
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const hasAiConfig = !!(
      config.baseURL.trim() &&
      config.apiKey.trim() &&
      config.model.trim()
    );

    setInput('');
    setError('');
    setNotice('');
    if (!hasAiConfig) {
      setNotice(
        '未配置 AI 接口，正在使用离线陪练模式（不联网也能练口语）。想更聪明可在设置里填接口地址与 Key。',
      );
      setSettingsOpen(false);
    }
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    saveHistory(next);
    setLoading(true);

    try {
      const reply = await sendTutorChat(config, next);
      const after: ChatMessage[] = [
        ...next,
        { role: 'assistant', content: reply.raw },
      ];
      setMessages(after);
      saveHistory(after);
      speakEn(reply.en);
    } catch (err) {
      setError(
        err instanceof TutorError
          ? err.message
          : '请求失败，请检查接口配置与网络后重试。',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void send();
    }
  };

  const toggleMic = () => {
    if (!recognitionCtor) {
      setError('当前浏览器不支持语音输入（建议使用 Chrome / Edge），请直接在下方打字。');
      return;
    }
    if (recording) {
      stopRecognition();
      return;
    }
    setError('');
    let recognition = recognitionRef.current;
    if (!recognition) {
      recognition = new recognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (e: SREvent) => {
        let transcript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) transcript += e.results[i][0].transcript + ' ';
        }
        if (transcript.trim()) {
          setInput((prev) =>
            prev.trim() ? `${prev.trim()} ${transcript.trim()}` : transcript.trim(),
          );
        }
      };
      recognition.onend = () => setRecording(false);
      recognition.onerror = (e: SRErrorEvent) => {
        setRecording(false);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError('麦克风权限被拒绝：请在浏览器地址栏允许麦克风，或直接打字。');
        } else if (e.error === 'network') {
          setError('语音识别需要联网（网络错误），请直接打字。');
        } else if (e.error !== 'no-speech') {
          setError(`语音输入出错（${e.error}），请直接打字。`);
        }
      };
      recognitionRef.current = recognition;
    }
    try {
      recognition.start();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };

  const clearChat = () => {
    stopRecognition();
    clearHistory();
    setMessages([]);
    setError('');
    setNotice('记忆已清空，我们开始新对话吧！');
  };

  const saveSettings = () => {
    const next: TutorConfig = {
      baseURL: draft.baseURL.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
    };
    setConfig(next);
    saveConfig(next);
    setSettingsOpen(false);
    setError('');
    setNotice('设置已保存。');
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ai-tutor-dock"
        onClick={openPanel}
        aria-label="打开 AI 英语陪练"
      >
        <span aria-hidden="true">🎤</span> 英语陪练
      </button>
    );
  }

  const configured =
    !!config.baseURL.trim() && !!config.apiKey.trim() && !!config.model.trim();

  return (
    <section className="ai-tutor" aria-label="AI 英语陪练">
      <header className="ai-tutor__header">
        <div className="ai-tutor__title">
          <span className="ai-tutor__dot" />
          AI 英语陪练
        </div>
        <div className="ai-tutor__header-actions">
          <button
            type="button"
            className="ai-tutor__icon-btn"
            title={configured ? '修改接口配置' : '配置接口地址 / API Key / 模型'}
            onClick={() => {
              setDraft(config);
              setSettingsOpen((v) => !v);
            }}
          >
            ⚙
          </button>
          <button
            type="button"
            className="ai-tutor__reset"
            title="清除对话记忆"
            onClick={clearChat}
          >
            清空记忆
          </button>
          <button
            type="button"
            className="ai-tutor__icon-btn"
            title={collapsed ? '展开' : '收起'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className="ai-tutor__icon-btn"
            title="关闭（再次点击左下角按钮打开）"
            onClick={closePanel}
          >
            ✕
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="ai-tutor__settings">
          <label>
            接口地址 baseURL（OpenAI 兼容，通常以 /v1 结尾）
            <input
              type="text"
              value={draft.baseURL}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              onChange={(e) => setDraft((d) => ({ ...d, baseURL: e.target.value }))}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={draft.apiKey}
              placeholder="sk-..."
              autoComplete="off"
              onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
            />
          </label>
          <label>
            模型 model
            <input
              type="text"
              value={draft.model}
              placeholder="gpt-3.5-turbo / gpt-4o-mini"
              autoComplete="off"
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
            />
          </label>
          <div className="ai-tutor__settings-actions">
            <button type="button" className="ai-tutor__save" onClick={saveSettings}>
              保存设置
            </button>
            <button
              type="button"
              className="ai-tutor__ghost"
              onClick={() => setSettingsOpen(false)}
            >
              取消
            </button>
          </div>
          <p className="ai-tutor__hint">
            配置仅保存在本机浏览器；接口需服务商允许浏览器跨域（CORS）直连。
          </p>
        </div>
      )}

      {!collapsed && (
        <>
          <div className="ai-tutor__body" ref={bodyRef}>
            {messages.length === 0 && !loading && (
              <div className="ai-msg ai">
                Hello! I am Builder, your AI English partner. Type English below,
                or click the microphone and speak!
                <span className="ai-msg__zh">
                  你好！我是 Builder，你的 AI 英语陪练。在下方打英语，或点麦克风说英语！
                </span>
              </div>
            )}
            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              const { en, zh } = isUser
                ? { en: m.content, zh: '' }
                : splitTranslation(m.content);
              return (
                <div
                  key={i}
                  className={`ai-msg ${isUser ? 'user' : 'ai'}`}
                >
                  {en}
                  {zh && <span className="ai-msg__zh">{zh}</span>}
                </div>
              );
            })}
            {loading && (
              <div className="ai-msg ai ai-msg--thinking">Thinking…</div>
            )}
            {notice && <div className="ai-tutor__notice">{notice}</div>}
            {error && (
              <div className="ai-tutor__error" role="alert">
                {error}
              </div>
            )}
          </div>

          <div className="ai-tutor__input-row">
            <input
              type="text"
              value={input}
              placeholder="Type English here... 输入英语"
              autoComplete="off"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className={`ai-tutor__mic${recording ? ' recording' : ''}`}
              title={
                recognitionCtor
                  ? '点击开始/结束语音输入（English）'
                  : '当前浏览器不支持语音输入（建议使用 Chrome），请直接打字'
              }
              disabled={!recognitionCtor}
              onClick={toggleMic}
            >
              {recording ? '⏹' : '🎤'}
            </button>
            <button
              type="button"
              className="ai-tutor__send"
              title="发送"
              disabled={loading || !input.trim()}
              onClick={() => void send()}
            >
              ➤
            </button>
          </div>
        </>
      )}
    </section>
  );
}
