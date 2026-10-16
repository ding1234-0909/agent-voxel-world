import { useEffect, useRef, useState } from 'react';
import {
  LocalRecorder,
  type SpeechCapabilities,
} from '../../audio/local-recorder';
import type { Connection } from '../../network/connection';
import { voiceApi } from './api';

export function SpeechRecognitionPanel({
  active,
  connection,
}: {
  active: boolean;
  connection: Connection;
}) {
  const [recorder] = useState(() => new LocalRecorder());
  const [capabilities, setCapabilities] = useState<SpeechCapabilities>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [retry, setRetry] = useState(0);
  const [language, setLanguage] = useState('zh-CN');
  const [state, setState] = useState<'idle' | 'listening' | 'thinking'>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const ownsMicrophone = useRef(false);
  const release = () => {
    if (ownsMicrophone.current) connection.voiceLabRecording = false;
    ownsMicrophone.current = false;
  };
  const stop = () => {
    recorder.cancel();
    release();
    setState('idle');
    setStatus('已停止识别。');
  };
  useEffect(() => {
    setState('idle');
    setStatus('');
    return () => {
      recorder.cancel();
      release();
    };
  }, [active, connection, recorder]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    setChecking(true);
    setCheckError('');
    setCapabilities(undefined);
    const timeout = setTimeout(() => {
      abort.abort();
      setChecking(false);
      setCheckError('检查超时，请确认项目服务正在运行后重试。');
    }, 10000);
    void voiceApi
      .capabilities(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setCapabilities(value);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setCheckError('无法连接语音识别服务，请确认项目服务正在运行。');
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!abort.signal.aborted) setChecking(false);
      });
    return () => {
      clearTimeout(timeout);
      abort.abort();
    };
  }, [active, retry]);
  const busy = state !== 'idle';
  const ready =
    active && capabilities?.local.available && !checking && !checkError;
  const start = (file?: File) => {
    if (!ready || busy) return;
    setError('');
    if (!file) {
      if (connection.chatRecording || connection.voiceLabRecording) {
        setError('麦克风正被其他录音使用，请结束录音后重试。');
        return;
      }
      connection.stopSpatialInput();
      connection.voiceLabRecording = true;
      ownsMicrophone.current = true;
    }
    setText('');
    const callbacks = {
      onState: (next: 'listening' | 'thinking', message: string) => {
        setState(next);
        setStatus(message);
      },
      onText: (value: string) => {
        release();
        setText(value);
        setState('idle');
        setStatus('识别完成，结果仅显示在这里。');
      },
      onError: (message: string) => {
        release();
        setState('idle');
        setStatus('');
        setError(message);
      },
    };
    if (file) void recorder.transcribeFile(file, language, callbacks);
    else void recorder.start(language, callbacks);
  };
  return (
    <section aria-labelledby="asr-title">
      <div className="console-section-heading">
        <h3 id="asr-title">语音识别（ASR）</h3>
        <p>
          将说话内容转为文字，检查识别服务并试用转写效果。当前试用在录音结束后返回结果。
        </p>
      </div>
      <div className="voice-services-layout">
        <div className="console-voice-guide asr-service-status">
          <h4>自托管 Whisper</h4>
          <p role="status">
            {checking
              ? '正在检查服务…'
              : checkError
                ? '服务连接失败'
                : capabilities?.local.available
                  ? '服务器识别服务已就绪'
                  : '服务未就绪'}
          </p>
          {checkError && (
            <p role="alert" className="agent-error">
              {checkError}
            </p>
          )}
          {capabilities && (
            <p className="agent-hint">{capabilities.local.reason}</p>
          )}
          <div>
            <button
              type="button"
              disabled={checking || busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              重新检查
            </button>
          </div>
          <p className="agent-hint">
            聊天录音和附近语音也使用自托管
            Whisper。识别模型部署在服务器上，玩家无需安装。
          </p>
          {!capabilities?.local.available && (
            <p className="agent-hint">
              服务未就绪时，可在服务器的项目目录运行{' '}
              <code>pnpm voice:setup</code> 准备识别模型。
            </p>
          )}
        </div>
        <div className="agent-form">
          <h4>试用语音识别</h4>
          <label>
            识别语言
            <select
              value={language}
              disabled={busy}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">英语</option>
            </select>
          </label>
          <div className="voice-service-actions">
            <button
              type="button"
              disabled={!ready || busy || !recorder.canRecord}
              onClick={() => start()}
            >
              开始录音
            </button>
            {state === 'listening' && (
              <button type="button" onClick={() => recorder.finish()}>
                结束录音
              </button>
            )}
            {busy && (
              <button type="button" onClick={stop}>
                取消识别
              </button>
            )}
          </div>
          {!recorder.canRecord && (
            <p className="agent-hint">
              当前浏览器无法录音，可选择音频文件进行识别。
            </p>
          )}
          <label>
            选择音频文件（最长 20 秒 / 5 MiB）
            <input
              type="file"
              accept=".wav,.webm,.mp4,.m4a,.ogg"
              disabled={!ready || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) start(file);
              }}
            />
          </label>
          <small className="asr-help">
            录音或文件会发送到项目服务器识别。试用结果不会发送到聊天或触发
            Agent；切换页面或关闭控制台会停止录音和识别。
          </small>
          {status && <p role="status">{status}</p>}
          {error && (
            <p role="alert" className="agent-error">
              {error}
            </p>
          )}
          <label>
            识别结果
            <textarea
              rows={4}
              readOnly
              value={text}
              placeholder="转写完成后，文字会显示在这里"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
