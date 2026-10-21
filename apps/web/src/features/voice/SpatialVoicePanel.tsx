import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../network/connection';
import type { SpeechAnchor } from '../../graphics/speech-anchor';
import type { BailianAsrDraft } from '@voxel/shared';
import { SpatialVoice, type SpatialStatus } from '../../audio/spatial-voice';
import {
  SpatialTranscriber,
  type TranscriptionState,
} from '../../audio/spatial-transcriber';
import { voiceApi } from './api';
export function SpatialVoicePanel({
  connection,
  speechAnchor,
}: {
  connection: Connection;
  speechAnchor: (actor: string) => SpeechAnchor | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [state, setState] = useState<SpatialStatus>({
    sending: false,
    listening: false,
    pending: false,
    connected: 0,
    error: '',
  });
  const [transcript, setTranscript] = useState<TranscriptionState>({
    status: '麦克风开启时自动转写',
    text: '',
    partial: '',
    error: '',
  });
  const engine = useRef<SpatialVoice | null>(null);
  useEffect(() => {
    const voice = new SpatialVoice(connection, setState);
    const transcriber = new SpatialTranscriber(
      () => connection.chatToken,
      setTranscript,
    );
    voice.onMicrophone = (stream) => {
      if (stream) void transcriber.start(stream);
      else transcriber.stop();
    };
    engine.current = voice;
    connection.onSpatialSignal = voice.signal;
    connection.onAgentSpeech = voice.agentSpeech.receive;
    connection.stopSpatialInput = voice.stopMic;
    const unload = () => voice.dispose();
    window.addEventListener('pagehide', unload);
    return () => {
      window.removeEventListener('pagehide', unload);
      connection.onSpatialSignal = () => {};
      connection.onAgentSpeech = () => {};
      connection.stopSpatialInput = () => {};
      voice.dispose();
      transcriber.stop();
      engine.current = null;
    };
  }, [connection]);
  useEffect(() => {
    engine.current?.update();
  }, [connection.players, connection.status]);
  return (
    <section
      className={`spatial-voice dock-panel${collapsed ? ' is-collapsed' : ''}`}
      aria-label="附近空间语音"
    >
      <button
        className="dock-tab"
        aria-label="展开附近语音"
        aria-expanded={false}
        hidden={!collapsed}
        onClick={() => setCollapsed(false)}
      >
        <span>‹ 语音</span>
        <small className={state.sending ? 'dock-live' : ''}>
          {state.sending
            ? '● 外放中'
            : state.pending
              ? '授权中'
              : state.listening
                ? '收听中'
                : '已关闭'}
        </small>
        {(state.error || transcript.error) && <small>有错误</small>}
      </button>
      <div className="chat-title">
        <strong>附近语音</strong>
        <small>
          {state.sending
            ? '● 正在外放'
            : state.pending
              ? '等待麦克风授权'
              : '麦克风已关闭'}
        </small>
        <button
          className="dock-collapse"
          aria-label="收起附近语音"
          aria-expanded={true}
          title="收起到侧边（保持语音状态）"
          onClick={() => setCollapsed(true)}
        >
          ›
        </button>
      </div>
      <div className="spatial-actions">
        <button
          aria-pressed={state.sending}
          disabled={
            connection.status !== 'connected' || connection.chatRecording
          }
          onClick={() =>
            state.sending || state.pending
              ? engine.current?.stopMic()
              : void engine.current?.startMic()
          }
        >
          {state.pending
            ? '取消开启'
            : state.sending
              ? '关闭麦克风'
              : '开启麦克风'}
        </button>
        <button
          aria-pressed={state.listening}
          disabled={connection.status !== 'connected'}
          onClick={() => void engine.current?.setListening(!state.listening)}
        >
          {state.listening ? '关闭收听' : '开启收听'}
        </button>
      </div>
      <small>18 格内随距离、朝向变化 · {state.connected} 个语音连接</small>
      <small>说话时显示临时字幕，整句确认后附近 Agent 才会收到。</small>
      <small>开启收听可听见附近 Agent 的语音回复；私聊仅接收者可听。</small>
      <AsrEngineSelector />
      {state.agentSpeaking && (
        <AgentCaptionBubble
          key={state.agentSpeaking}
          text={state.agentSpeaking}
          anchor={
            state.agentSpeakingActor
              ? speechAnchor(state.agentSpeakingActor)
              : null
          }
        />
      )}
      <small role="status">{transcript.status}</small>
      {transcript.partial && (
        <p className="speech-interim" role="status">
          临时字幕 · {transcript.partial}
        </p>
      )}
      {transcript.text && <p className="spatial-caption">{transcript.text}</p>}
      {transcript.error && (
        <p role="alert" className="chat-error">
          {transcript.error}
        </p>
      )}
      {state.error && (
        <p role="alert" className="chat-error">
          {state.error}
        </p>
      )}
    </section>
  );
}

/** 伙伴语音播放时的世界内字幕气泡：跟随角色屏幕位置，2.6 秒后淡出。 */
function AgentCaptionBubble({
  text,
  anchor,
}: {
  text: string;
  anchor: SpeechAnchor | null;
}) {
  const [visible, setVisible] = useState(true);
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 1 });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStyle({ opacity: 0 });
      window.setTimeout(() => setVisible(false), 400);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [text]);
  if (!visible) return null;
  return (
    <div
      className="agent-caption-bubble"
      role="status"
      style={{
        ...style,
        ...(anchor
          ? {
              left: `${Math.min(880, Math.max(20, anchor.x))}px`,
              top: `${Math.max(8, anchor.y - 40)}px`,
            }
          : { left: '50%', top: '20%', transform: 'translateX(-50%)' }),
        transition: 'opacity 0.4s ease',
      }}
    >
      {text}
    </div>
  );
}

/** 识别引擎选择：本地 Whisper（默认）/ 阿里云百炼；配置仅存服务器与浏览器本机。 */
function AsrEngineSelector() {
  const [engine, setEngine] = useState<'local' | 'bailian'>(() => {
    try {
      return localStorage.getItem('voxel-asr-engine') === 'bailian'
        ? 'bailian'
        : 'local';
    } catch {
      return 'local';
    }
  });
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Partial<BailianAsrDraft>>({});
  const [draft, setDraft] = useState<Partial<BailianAsrDraft>>({
    region: 'beijing',
    model: 'paraformer-realtime-v2',
    workspaceId: '',
    apiKey: '',
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void voiceApi
      .getBailianSettings()
      .then((settings) => {
        setSaved(settings);
        if (settings.region) setDraft((d) => ({ ...d, region: settings.region }));
        if (settings.model) setDraft((d) => ({ ...d, model: settings.model }));
        if (settings.workspaceId)
          setDraft((d) => ({ ...d, workspaceId: settings.workspaceId }));
      })
      .catch(() => {});
  }, []);

  const pick = (next: 'local' | 'bailian') => {
    setEngine(next);
    try {
      localStorage.setItem('voxel-asr-engine', next);
    } catch {
      /* 忽略 */
    }
  };

  const save = () => {
    setBusy(true);
    setMessage('');
    void voiceApi
      .saveBailianSettings(draft)
      .then((settings) => {
        setSaved(settings);
        setMessage('√ 已保存');
        setOpen(false);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '保存失败'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="asr-engine-box">
      <label className="asr-engine-row">
        识别引擎
        <select
          value={engine}
          onChange={(e) => pick(e.target.value as 'local' | 'bailian')}
        >
          <option value="local">本地 Whisper（默认）</option>
          <option value="bailian">阿里云百炼（快）</option>
        </select>
      </label>
      {engine === 'bailian' && (
        <button
          type="button"
          className="asr-config-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起配置' : '配置百炼密钥'}
        </button>
      )}
      {saved.apiKey && saved.apiKey !== '' && (
        <small className="asr-saved-hint">已保存：{saved.region} · {saved.model} · {saved.workspaceId || '默认空间'}</small>
      )}
      {open && (
        <div className="asr-config-form">
          <label>
            地域
            <select
              value={draft.region ?? 'beijing'}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  region: e.target.value as 'beijing' | 'singapore',
                }))
              }
            >
              <option value="beijing">北京（国内）</option>
              <option value="singapore">新加坡（海外）</option>
            </select>
          </label>
          <label>
            模型
            <select
              value={draft.model ?? 'paraformer-realtime-v2'}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  model: e.target.value as BailianAsrDraft['model'],
                }))
              }
            >
              <option value="paraformer-realtime-v2">paraformer-realtime-v2</option>
              <option value="fun-asr-realtime">fun-asr-realtime</option>
            </select>
          </label>
          <label>
            业务空间 ID（可留空）
            <input
              value={draft.workspaceId ?? ''}
              placeholder="默认业务空间可留空"
              onChange={(e) =>
                setDraft((d) => ({ ...d, workspaceId: e.target.value }))
              }
            />
          </label>
          <label>
            API Key（百炼控制台创建，形如 sk-…）
            <input
              type="password"
              value={draft.apiKey ?? ''}
              placeholder={saved.apiKey ? '已保存，留空保持不变' : 'sk-…'}
              onChange={(e) =>
                setDraft((d) => ({ ...d, apiKey: e.target.value }))
              }
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="asr-save-btn"
          >
            {busy ? '保存中…' : '保存设置'}
          </button>
          {message && <small className="asr-msg">{message}</small>}
        </div>
      )}
    </div>
  );
}
