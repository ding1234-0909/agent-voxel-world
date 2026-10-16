import { AudioPlayer } from './AudioPlayer';

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
  return (
    <section className="voice-draft" aria-label="录音草稿">
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
      <AudioPlayer
        src={src}
        durationMs={durationMs}
        busy={busy}
        label="录音试听"
        idleLabel="仅自己可听"
        playLabel="试听录音"
        pauseLabel="暂停试听"
      />
    </section>
  );
}
