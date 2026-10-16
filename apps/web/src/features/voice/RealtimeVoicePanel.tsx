import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../network/connection';
import type { RealtimeEvent } from '../../../../../packages/shared/src/realtime';
import { PCMPlayer, PCMCapture } from '../../audio/realtime-audio';
import './realtime.css';
export function RealtimeVoicePanel({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose(): void;
}) {
  const [status, setStatus] = useState('未连接 · 真实调用默认关闭');
  const [subtitle, setSubtitle] = useState('');
  const [sceneConsent, setSceneConsent] = useState(false);
  const [audioConsent, setAudioConsent] = useState(false);
  const [text, setText] = useState('请描述附近地形。');
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(true);
  const [recording, setRecording] = useState(false);
  const [proposals, setProposals] = useState<
    NonNullable<RealtimeEvent['proposal']>[]
  >([]);
  const generation = useRef(0);
  const current = useRef('');
  const requestKey = useRef('');
  const opening = useRef(false);
  const disposed = useRef(false);
  const audio = useRef<AudioContext | undefined>(undefined);
  const player = useRef<PCMPlayer | undefined>(undefined);
  const capture = useRef(new PCMCapture());
  const clearMedia = () => {
    capture.current.stop();
    player.current?.stop();
    connection.voiceLabRecording = false;
    setRecording(false);
    setReady(false);
    setProposals([]);
  };
  const stop = () => {
    ++generation.current;
    if (current.current || opening.current)
      connection.action('realtime.stop', {
        session: current.current,
        request: requestKey.current,
      });
    opening.current = false;
    current.current = '';
    requestKey.current = '';
    clearMedia();
    setStatus('已中断并关闭会话');
  };
  const request = async (type: string, payload: unknown) => {
    const started = generation.current;
    try {
      await connection.requestAction(type, payload);
    } catch (error) {
      if (started !== generation.current || disposed.current) return;
      stop();
      setStatus(error instanceof Error ? error.message : '请求失败');
    }
  };
  useEffect(() => {
    disposed.current = false;
    connection.onRealtimeReset = () => {
      ++generation.current;
      requestKey.current = '';
      current.current = '';
      opening.current = false;
      clearMedia();
      setStatus('连接已断开；不会自动重开语音');
    };
    connection.onRealtime = (event) => {
      if (disposed.current || event.request !== requestKey.current) return;
      if (!current.current && opening.current) current.current = event.session;
      if (event.kind === 'ready' && opening.current) {
        opening.current = false;
        current.current = event.session;
        setDemo(event.demo);
        setReady(true);
        setStatus(event.demo ? '离线模拟 · 非 AI' : '百炼会话已连接');
        return;
      }
      if (event.session !== current.current) return;
      if (event.kind === 'audio' && event.audio) {
        try {
          player.current?.play(event.audio);
          setStatus(event.demo ? '模拟合成提示音 · 非 AI' : '播放模型语音');
        } catch {
          stop();
          setStatus('播放暂停或缓冲已满，会话已关闭');
        }
      }
      if (event.kind === 'subtitle')
        setSubtitle((old) => (old + (event.text ?? '')).slice(-4000));
      if (event.kind === 'proposal' && event.proposal)
        setProposals((old) => [...old, event.proposal!].slice(-8));
      if (event.kind === 'done') {
        setReady(true);
        setStatus('本轮生成结束');
      }
      if (event.kind === 'error') {
        clearMedia();
        setStatus(event.text ?? '语音服务错误');
      }
      if (event.kind === 'closed') {
        current.current = '';
        opening.current = false;
        clearMedia();
      }
    };
    const hide = () => {
      if (document.hidden) stop();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hide);
    return () => {
      stop();
      disposed.current = true;
      connection.onRealtime = () => {};
      connection.onRealtimeReset = () => {};
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('keydown', escape);
      void audio.current?.close().catch(() => {});
    };
  }, [connection]);
  const start = async (mode: 'demo' | 'real') => {
    stop();
    const started = generation.current;
    setSubtitle('');
    try {
      if (connection.status !== 'connected') throw Error('请先进入世界。');
      audio.current ??= new AudioContext();
      await audio.current.resume();
      if (disposed.current || started !== generation.current) return;
      player.current ??= new PCMPlayer(audio.current);
      opening.current = true;
      requestKey.current = crypto.randomUUID();
      setDemo(mode === 'demo');
      setStatus('连接中…');
      await request('realtime.start', {
        mode,
        sceneConsent,
        audioConsent,
        request: requestKey.current,
      });
    } catch (e) {
      stop();
      setStatus(e instanceof Error ? e.message : '音频初始化失败');
    }
  };
  const commit = async (value?: string) => {
    player.current?.stop();
    capture.current.stop();
    connection.voiceLabRecording = false;
    setRecording(false);
    setReady(false);
    setSubtitle('');
    setStatus('等待回复…');
    await request('realtime.commit', {
      session: current.current,
      ...(value === undefined ? {} : { text: value }),
    });
  };
  const record = async () => {
    if (
      demo ||
      !ready ||
      connection.chatRecording ||
      connection.voiceLabRecording
    )
      return;
    player.current?.stop();
    connection.stopSpatialInput();
    connection.voiceLabRecording = true;
    setRecording(true);
    try {
      const active = await capture.current.start(
        (chunk) => {
          if (current.current)
            connection.action('realtime.audio', {
              session: current.current,
              audio: chunk,
            });
        },
        () => {
          void commit();
        },
      );
      if (!active) {
        connection.voiceLabRecording = false;
        setRecording(false);
      }
    } catch {
      stop();
      setStatus('无法开启麦克风，请检查权限。');
    }
  };
  return (
    <section className="realtime-panel" role="dialog" aria-label="百炼实时语音">
      <div className="realtime-title">
        <h2>百炼实时语音</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      <p>
        离线演示只产生合成提示音，不访问模型或麦克风。真实会话需要服务端另行启用。
      </p>
      <label>
        <input
          type="checkbox"
          checked={sceneConsent}
          disabled={!!current.current || opening.current}
          onChange={(e) => setSceneConsent(e.target.checked)}
        />
        允许读取附近地形并提出方块修改建议（不含玩家信息或聊天）
      </label>
      <label>
        <input
          type="checkbox"
          checked={audioConsent}
          disabled={!!current.current || opening.current}
          onChange={(e) => setAudioConsent(e.target.checked)}
        />
        真实会话：同意发送本次输入的文字或录音至阿里云
      </label>
      <div className="realtime-actions">
        <button disabled={opening.current} onClick={() => void start('demo')}>
          连接离线演示
        </button>
        <button
          disabled={!audioConsent || opening.current}
          onClick={() => void start('real')}
        >
          连接真实服务
        </button>
        <button onClick={stop}>中断并关闭</button>
      </div>
      <p role="status">{status}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void commit(text);
        }}
      >
        <input
          aria-label="本轮文字"
          value={text}
          maxLength={240}
          disabled={recording}
          onChange={(e) => setText(e.target.value)}
        />
        <button disabled={!ready || recording || !text.trim()}>发送文字</button>
      </form>
      <div className="realtime-actions">
        <button
          disabled={demo || !ready || recording}
          onClick={() => void record()}
        >
          开始录音（最长14秒）
        </button>
        <button disabled={!recording} onClick={() => void commit()}>
          结束并发送
        </button>
      </div>
      <p className="realtime-subtitle" aria-live="polite">
        {subtitle || '字幕将在这里显示'}
      </p>
      {proposals.map((p) => (
        <div key={p.id} className="realtime-proposal">
          <span>
            建议：({p.edit.x}, {p.edit.y}, {p.edit.z}) →{' '}
            {p.edit.material ?? '移除'} · 30秒内有效
          </span>
          <button
            onClick={() => {
              setProposals((old) => old.filter((x) => x.id !== p.id));
              void request('realtime.approve', {
                session: current.current,
                proposalId: p.id,
              });
            }}
          >
            确认修改
          </button>
          <button
            onClick={() =>
              setProposals((old) => old.filter((x) => x.id !== p.id))
            }
          >
            忽略
          </button>
        </div>
      ))}
    </section>
  );
}
