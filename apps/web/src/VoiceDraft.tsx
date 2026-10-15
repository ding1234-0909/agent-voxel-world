import { useEffect, useRef, useState, type CSSProperties } from 'react';

const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Local preview only: playing or seeking never uploads the recording. */
export function VoiceDraft({
  src,
  durationMs,
  busy,
  onDiscard,
}: {
  src: string;
  durationMs: number;
  busy: boolean;
  onDiscard: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationMs / 1000);
  const [error, setError] = useState('');
  useEffect(() => {
    if (busy) audio.current?.pause();
  }, [busy]);
  const toggle = async () => {
    const player = audio.current;
    if (!player || busy) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    setError('');
    if (player.ended) player.currentTime = 0;
    try {
      await player.play();
    } catch {
      setError('暂时无法试听，请重试。');
    }
  };
  return (
    <section className="voice-draft" aria-label="录音草稿">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError('录音无法播放，请重新录制。');
        }}
      />
      <div className="voice-draft-heading">
        <strong>语音草稿</strong>
        <span>{busy ? '发送中' : '待发送'}</span>
        <button
          type="button"
          className="voice-draft-discard"
          disabled={busy}
          onClick={onDiscard}
          aria-label="丢弃录音"
          title="丢弃录音"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
          </svg>
        </button>
      </div>
      <div className="voice-draft-player">
        <button
          type="button"
          className="voice-draft-play"
          aria-label={playing ? '暂停试听' : '试听录音'}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
            aria-hidden="true"
          >
            {playing ? (
              <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
            ) : (
              <path d="m9 5 11 7-11 7z" />
            )}
          </svg>
        </button>
        <div className="voice-draft-track">
          <input
            type="range"
            style={
              {
                '--voice-progress': `${duration ? Math.min(100, (current / duration) * 100) : 0}%`,
              } as CSSProperties
            }
            aria-label="录音试听进度"
            aria-valuetext={`${clock(current)} / ${clock(duration)}`}
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(current, duration)}
            disabled={busy || !duration}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (audio.current) audio.current.currentTime = value;
              setCurrent(value);
            }}
          />
          <div className="voice-draft-time">
            <span>
              {clock(current)} / {clock(duration)}
            </span>
            <span>{playing ? '正在试听' : '仅自己可听'}</span>
          </div>
        </div>
      </div>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
