import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatEntry, Player } from '@voxel/shared';
import type { Connection } from './connection';
import { LocalRecorder, voiceApi } from './local-recorder';
import { ClipRecorder } from './clip-recorder';
function AudioMessage({
  entry,
  connection,
}: {
  entry: ChatEntry;
  connection: Connection;
}) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const resource = useRef(''),
    controller = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (resource.current) URL.revokeObjectURL(resource.current);
    },
    [],
  );
  const load = async () => {
    setLoading(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const res = await fetch(
        `${voiceApi()}/chat/audio/${entry.data.audioId}`,
        {
          headers: { Authorization: `Bearer ${connection.chatToken}` },
          signal: abort.signal,
        },
      );
      if (!res.ok) throw Error('语音已过期或无法访问。');
      const blob = await res.blob();
      if (abort.signal.aborted) return;
      resource.current = URL.createObjectURL(blob);
      setUrl(resource.current);
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };
  return (
    <>
      {url ? (
        <audio controls src={url} preload="metadata" />
      ) : (
        <button type="button" disabled={loading} onClick={() => void load()}>
          {loading
            ? '加载中…'
            : `▶ 语音 ${(entry.data.durationMs! / 1000).toFixed(1)} 秒`}
        </button>
      )}
      {error && <small role="alert">{error}</small>}
      {entry.data.transcriptAvailable && (
        <p className="chat-transcript">{entry.data.text}</p>
      )}
    </>
  );
}
export function ChatPanel({ connection }: { connection: Connection }) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedAt, setCollapsedAt] = useState(0);
  const unread = collapsed
    ? connection.chats.filter(
        (entry) =>
          entry.seq > collapsedAt && entry.actor !== connection.room?.sessionId,
      ).length
    : 0;
  const [text, setText] = useState(''),
    [scope, setScope] = useState<'public' | 'private'>('public'),
    [recipients, setRecipients] = useState<Player[]>([]);
  const [query, setQuery] = useState<string | null>(null),
    [cursor, setCursor] = useState(0),
    [choice, setChoice] = useState(0);
  const [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [mode, setMode] = useState<
      | 'idle'
      | 'permission'
      | 'dictating'
      | 'transcribing'
      | 'recording'
      | 'sending'
    >('idle');
  const [clip, setClip] = useState<Blob>(),
    [preview, setPreview] = useState('');
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null),
    upload = useRef<AbortController | undefined>(undefined);
  const [dictation] = useState(() => new LocalRecorder()),
    [recorder] = useState(() => new ClipRecorder());
  const connected = connection.status === 'connected',
    busy = mode !== 'idle';
  const candidates = connection.players
    .filter(
      (p) =>
        p.connected &&
        p.id !== connection.room?.sessionId &&
        !recipients.some((r) => r.id === p.id) &&
        (query === '' ||
          p.name.toLowerCase().includes((query ?? '').toLowerCase())),
    )
    .slice(0, 8);
  useEffect(() => {
    if (!clip) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(clip);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);
  const cancel = () => {
    dictation.cancel();
    recorder.cancel();
    upload.current?.abort();
    connection.chatRecording = false;
    setMode('idle');
    setStatus('');
  };
  useEffect(() => {
    if (!connected) cancel();
  }, [connected]);
  useEffect(
    () => () => {
      dictation.cancel();
      recorder.cancel();
      upload.current?.abort();
      connection.chatRecording = false;
    },
    [connection, dictation, recorder],
  );
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [connection.chats.length]);
  const select = (p: Player) => {
    if (recipients.length >= 8) {
      setError('最多选择 8 位接收者。');
      return;
    }
    const before = text.slice(0, cursor),
      at = before.lastIndexOf('@');
    setText(
      (at >= 0 ? text.slice(0, at) : text) + `@${p.name} ` + text.slice(cursor),
    );
    setRecipients((r) => [...r, p]);
    setQuery(null);
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (query === null) return;
    if (e.key === 'Escape') {
      setQuery(null);
      e.preventDefault();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setChoice(
        (n) =>
          (n +
            (e.key === 'ArrowDown' ? 1 : -1) +
            Math.max(1, candidates.length)) %
          Math.max(1, candidates.length),
      );
    }
    if (e.key === 'Enter' && candidates.length) {
      e.preventDefault();
      select(candidates[choice % candidates.length]);
    }
  };
  const record = (kind: 'text' | 'audio') => {
    if (connection.voiceLabRecording) {
      setError('请先结束语音设置中的录音。');
      return;
    }
    connection.stopSpatialInput();
    connection.chatRecording = true;
    setError('');
    setMode('permission');
    setStatus('正在请求麦克风…');
    const fail = (message: string) => {
      connection.chatRecording = false;
      setMode('idle');
      setError(message);
      setStatus('');
    };
    if (kind === 'text')
      void dictation.start('zh-CN', {
        onState: (state) => {
          setMode(state === 'listening' ? 'dictating' : 'transcribing');
          setStatus(
            state === 'listening'
              ? '听写中，结束后可编辑再发送。'
              : '正在本机识别…',
          );
        },
        onText: (value) => {
          connection.chatRecording = false;
          setText((t) => (t + ' ' + value).trim().slice(0, 240));
          setMode('idle');
          setStatus('已转为文字，请确认后发送。');
        },
        onError: fail,
      });
    else
      void recorder.start(
        (blob) => {
          connection.chatRecording = false;
          setClip(blob);
          setMode('idle');
          setStatus('录音已保存为草稿，可试听后发送。');
        },
        fail,
        () => {
          setMode('recording');
          setStatus('录制语音消息中，最长 20 秒。');
        },
      );
  };
  const send = async () => {
    setError('');
    const ids = recipients.map((p) => p.id);
    if (scope === 'private' && !ids.length) {
      setError('请先通过 @ 选择私聊对象。');
      return;
    }
    if (
      ids.some(
        (id) => !connection.players.some((p) => p.id === id && p.connected),
      )
    ) {
      setError('接收对象已离线，请移除或重新选择。');
      return;
    }
    if (!clip && !text.trim()) return;
    setMode('sending');
    const abort = new AbortController();
    upload.current = abort;
    try {
      if (clip) {
        setStatus('正在上传并本机转写语音…');
        const timer = setTimeout(() => abort.abort(), 125000);
        try {
          const params = new URLSearchParams({
            scope,
            to: ids.join(','),
            language: 'zh',
          });
          const res = await fetch(`${voiceApi()}/chat/audio?${params}`, {
            method: 'POST',
            headers: {
              'Content-Type': clip.type,
              Authorization: `Bearer ${connection.chatToken}`,
            },
            body: clip,
            signal: abort.signal,
          });
          const data = await res.json();
          if (!res.ok) throw Error(data.error || '语音发送失败。');
          setStatus(
            data.transcriptAvailable
              ? '语音已发送，Agent 可读取转写。'
              : '语音已发送，暂未生成文字转写，Agent 无法理解此段录音。',
          );
        } finally {
          clearTimeout(timer);
        }
        setClip(undefined);
        setText('');
      } else {
        await connection.requestAction('chat', {
          text,
          scope,
          recipients: ids,
        });
        setText('');
        setStatus('已发送。');
      }
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
      else setError('发送已取消或超时，请确认消息记录后再重试。');
    } finally {
      setMode('idle');
    }
  };
  return (
    <section
      className={`chat enhanced-chat dock-panel${collapsed ? ' is-collapsed' : ''}`}
      aria-label="世界聊天"
    >
      <button
        className="dock-tab"
        aria-label={`展开世界聊天${unread ? `，${unread} 条未读` : ''}`}
        aria-expanded={false}
        hidden={!collapsed}
        onClick={() => setCollapsed(false)}
      >
        <span>‹ 聊天</span>
        <small aria-live="polite">
          {unread ? `${unread} 条未读` : busy ? '处理中' : '世界消息'}
        </small>
      </button>
      <div className="chat-title">
        <div className="eyebrow">WORLD CHAT</div>
        <select
          aria-label="发送方式"
          disabled={busy}
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="public">群聊 · 所有人</option>
          <option value="private">私聊 · 仅 @ 对象</option>
        </select>
        <button
          className="dock-collapse"
          aria-label="收起世界聊天"
          aria-expanded={true}
          title="收起到侧边"
          onClick={() => {
            setCollapsedAt(connection.chats.at(-1)?.seq ?? 0);
            setCollapsed(true);
          }}
        >
          ›
        </button>
      </div>
      <div className="messages" ref={list} aria-live="polite">
        {connection.chats.map((e) => (
          <article className="chat-message" key={e.seq}>
            <div>
              <strong>{e.data.name}</strong>{' '}
              <small>
                {e.data.scope === 'nearby'
                  ? '附近语音 · 转写'
                  : e.data.scope === 'private'
                    ? '私聊'
                    : '群聊'}
                {e.actor === connection.room?.sessionId ? ' · 你' : ''}
                {e.data.scope === 'private'
                  ? ' → ' +
                    e.data.recipients
                      .map(
                        (id) =>
                          connection.players.find((p) => p.id === id)?.name ??
                          '已离线玩家',
                      )
                      .join('、')
                  : ''}
              </small>
            </div>
            {e.data.kind === 'audio' ? (
              <AudioMessage entry={e} connection={connection} />
            ) : (
              <p>{e.data.text}</p>
            )}
          </article>
        ))}
      </div>
      {recipients.length > 0 && (
        <div className="chat-recipients">
          {recipients.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() =>
                setRecipients((r) => r.filter((x) => x.id !== p.id))
              }
              aria-label={`移除接收者 ${p.name}`}
            >
              @{p.name}
              {connection.players.some((x) => x.id === p.id && x.connected)
                ? ''
                : '（离线）'}{' '}
              ×
            </button>
          ))}
        </div>
      )}
      {preview && (
        <div className="voice-draft">
          <audio controls src={preview} />
          <button disabled={busy} onClick={() => setClip(undefined)}>
            丢弃录音
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="chat-input-wrap">
          <input
            ref={input}
            aria-label="Chat message"
            aria-expanded={query !== null}
            aria-controls="chat-mentions"
            placeholder={
              scope === 'private'
                ? '输入 @ 选择玩家或 Agent…'
                : '说点什么，@ 选择玩家…'
            }
            disabled={busy || !!clip}
            value={text}
            maxLength={240}
            onKeyDown={onKey}
            onChange={(e) => {
              setText(e.target.value);
              const pos = e.target.selectionStart ?? 0;
              setCursor(pos);
              const match = e.target.value
                .slice(0, pos)
                .match(/(?:^|\s)@([^@\n]*)$/);
              setQuery(match?.[1] ?? null);
              setChoice(0);
            }}
          />
          {query !== null && (
            <div
              id="chat-mentions"
              className="mention-list"
              role="listbox"
              aria-label="选择接收者"
            >
              {candidates.length ? (
                candidates.map((p, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={choice === i}
                    key={p.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(p)}
                  >
                    {p.name}{' '}
                    <small>
                      {p.kind === 'human' ? '玩家' : 'Agent'} · {p.id.slice(-4)}
                    </small>
                  </button>
                ))
              ) : (
                <p>没有匹配的在线玩家</p>
              )}
            </div>
          )}
        </div>
        <button
          className="chat-send"
          disabled={!connected || busy || (!clip && !text.trim())}
          aria-label="发送消息"
        >
          ↗
        </button>
      </form>
      <div className="chat-tools">
        {mode === 'dictating' || mode === 'recording' ? (
          <button
            onClick={() => {
              if (mode === 'dictating') {
                setMode('transcribing');
                dictation.finish();
              } else recorder.finish();
            }}
          >
            结束录音
          </button>
        ) : (
          <>
            <button
              disabled={!connected || busy || !!clip}
              onClick={() => record('text')}
            >
              语音转文字
            </button>
            <button
              disabled={!connected || busy || !!clip}
              onClick={() => record('audio')}
            >
              录语音
            </button>
          </>
        )}
        {busy && mode !== 'sending' && <button onClick={cancel}>取消</button>}
        {busy && mode === 'sending' && clip && (
          <button onClick={() => upload.current?.abort()}>取消发送</button>
        )}
        {!busy && (
          <button
            disabled={!!clip}
            onClick={() => {
              const next =
                text + (text && !text.endsWith(' ') ? ' ' : '') + '@';
              setCursor(next.length);
              setText(next);
              setQuery('');
              input.current?.focus();
            }}
          >
            {' '}
            @{' '}
          </button>
        )}
      </div>
      {scope === 'private' && (
        <small className="chat-help">
          仅发送给已选接收者（含 Agent），不会广播。
        </small>
      )}
      {status && (
        <p role="status" className="chat-help">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
    </section>
  );
}
