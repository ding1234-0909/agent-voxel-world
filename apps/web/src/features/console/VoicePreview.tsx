import { useEffect, useRef, useState } from 'react';
import { consoleApi } from './api';

export function VoicePreview({
  serviceId,
  active,
  disabled = false,
}: {
  serviceId?: string;
  active: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(
    '你好，我是你的 AI 伙伴，很高兴和你一起探索这个世界。',
  );
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const stop = () => {
    request.current?.abort();
    audio.current?.pause();
    setUrl('');
    setBusy(false);
    setStatus('');
  };
  useEffect(() => {
    stop();
    return () => {
      request.current?.abort();
      audio.current?.pause();
    };
  }, [serviceId, active, disabled]);
  useEffect(() => {
    if (!url) return;
    void audio.current
      ?.play()
      .catch(() => setStatus('音频已生成，请点击播放器开始试听。'));
    return () => URL.revokeObjectURL(url);
  }, [url]);
  const preview = async () => {
    if (!serviceId || disabled || !active) return;
    stop();
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setStatus('正在连接并生成试听音频…');
    try {
      const blob = await consoleApi.previewVoice(serviceId, text, abort.signal);
      if (abort.signal.aborted) return;
      setUrl(URL.createObjectURL(blob));
      setStatus('连接成功，试听音频已生成。');
    } catch (error) {
      if (!abort.signal.aborted)
        setStatus(error instanceof Error ? error.message : '试听失败。');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className="voice-preview" aria-label="语音试听">
      <h4>试听</h4>
      <label>
        试听文字
        <textarea
          rows={2}
          maxLength={240}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="voice-service-actions">
        <button
          type="button"
          disabled={!serviceId || disabled || busy || !text.trim()}
          onClick={() => void preview()}
        >
          {busy ? '合成中…' : '测试连接并试听'}
        </button>
        {(busy || url) && (
          <button type="button" onClick={stop}>
            停止试听
          </button>
        )}
      </div>
      <small>
        使用已保存的服务配置；云端合成会发送这段文字，并按服务商规则计费。
      </small>
      {status && <p role="status">{status}</p>}
      <audio
        ref={audio}
        controls
        hidden={!url}
        src={url || undefined}
        aria-label="试听音频"
        onError={() => setStatus('音频播放失败，请重试或检查浏览器音频设置。')}
      />
    </section>
  );
}
