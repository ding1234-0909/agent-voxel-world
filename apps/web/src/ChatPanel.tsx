import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatEntry, Player } from '@voxel/shared';
import type { Connection } from './connection';
import { LocalRecorder, voiceApi } from './local-recorder';
import { ClipRecorder } from './clip-recorder';
import { mentionQuery, consumeMention } from './chat-mentions';
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
  const [picker, setPicker] = useState<
    | NonNullable<ReturnType<typeof mentionQuery>>
    | { source: 'button'; query: string }
    | null
  >(null);
  const [choice, setChoice] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const caret = useRef(0);
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
        p.name
          .toLowerCase()
          .includes((picker?.query ?? '').trim().toLowerCase()),
    )
    .sort((a, b) => Number(b.kind !== 'human') - Number(a.kind !== 'human'));
  const activeChoice = candidates.length ? choice % candidates.length : 0;
  useEffect(() => {
    if (picker?.source === 'button') search.current?.focus();
  }, [picker?.source]);
  useEffect(() => {
    if (!picker) return;
    panel.current
      ?.querySelector('[role=option][aria-selected=true]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [choice, picker?.query]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setPicker(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
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
  const openPicker = () => {
    setPicker({ source: 'button', query: '' });
    setChoice(0);
    setError('');
  };
  const select = (p: Player) => {
    if (recipients.some((r) => r.id === p.id)) return;
    if (recipients.length >= 8) {
      setError('最多选择 8 位接收者，请先移除一位。');
      return;
    }
    const next =
      picker?.source === 'input'
        ? consumeMention(text, picker.start, picker.end)
        : { text, caret: caret.current };
    setText(next.text);
    setRecipients((r) => [...r, p]);
    setPicker(null);
    setError('');
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms an IME candidate; it must never select a player or send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (!picker) return;
    if (e.key === 'Escape') {
      setPicker(null);
      e.preventDefault();
      e.stopPropagation();
      input.current?.focus();
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
    if (e.key === 'Enter' || (e.key === 'Tab' && candidates.length)) {
      e.preventDefault();
      if (candidates.length) select(candidates[activeChoice]);
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
    setPicker(null);
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
      if (scope === 'public') setRecipients([]);
      input.current?.focus();
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
      else setError('发送已取消或超时，请确认消息记录后再重试。');
    } finally {
      setMode('idle');
    }
  };
  return (
    <section
      ref={panel}
      className={`chat enhanced-chat dock-panel${collapsed ? ' is-collapsed' : ''}${picker ? ' is-picking' : ''}${picker?.source === 'button' ? ' picker-manual' : ''}`}
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
        <div className="chat-scope" role="group" aria-label="发送方式">
          <button
            type="button"
            aria-label="群聊 · 所有人"
            aria-pressed={scope === 'public'}
            disabled={busy}
            title="所有玩家和 Agent 都能收到"
            onClick={() => setScope('public')}
          >
            群聊
          </button>
          <button
            type="button"
            aria-label="私聊 · 仅 @ 对象"
            aria-pressed={scope === 'private'}
            disabled={busy}
            title="仅发送给选中的 @ 对象"
            onClick={() => {
              setScope('private');
              if (!recipients.length) openPicker();
            }}
          >
            私聊
          </button>
        </div>
        <button
          className="dock-collapse"
          aria-label="收起世界聊天"
          aria-expanded={true}
          title="收起到侧边"
          onClick={() => {
            setCollapsedAt(connection.chats.at(-1)?.seq ?? 0);
            setCollapsed(true);
            setPicker(null);
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
            {e.data.scope === 'public' && e.data.recipients.length > 0 && (
              <div className="chat-message-mentions">
                {e.data.recipients.map((id) => (
                  <span key={id}>
                    @
                    {connection.players.find((p) => p.id === id)?.name ??
                      '已离线玩家'}
                  </span>
                ))}
              </div>
            )}
            {e.data.kind === 'audio' ? (
              <AudioMessage entry={e} connection={connection} />
            ) : (
              <p>{e.data.text}</p>
            )}
          </article>
        ))}
      </div>
      {recipients.length > 0 && (
        <div className="chat-recipients" aria-label="已选对象">
          <span className="recipient-label">
            {scope === 'private' ? '发送给' : '提醒'}
          </span>
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
          <button
            type="button"
            disabled={busy}
            onClick={openPicker}
            aria-label="添加接收者"
          >
            ＋
          </button>
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
      {picker && (
        <div className="mention-picker">
          <div className="mention-heading">
            <strong>
              {scope === 'private' ? '选择私聊对象' : '想提醒谁？'}
            </strong>
            <small>{recipients.length}/8 已选</small>
            <button
              type="button"
              aria-label="关闭选人列表"
              onClick={() => {
                setPicker(null);
                input.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          {picker.source === 'button' && (
            <input
              ref={search}
              className="mention-search"
              aria-label="搜索玩家或 Agent"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls="chat-mentions"
              aria-activedescendant={
                candidates.length
                  ? `mention-${candidates[activeChoice].id}`
                  : undefined
              }
              placeholder="搜索玩家或 Agent…"
              value={picker.query}
              onKeyDown={onKey}
              onChange={(e) => {
                setPicker({ source: 'button', query: e.target.value });
                setChoice(0);
              }}
            />
          )}
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
                  id={`mention-${p.id}`}
                  aria-selected={activeChoice === i}
                  key={p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(p)}
                >
                  <span
                    className={`mention-avatar ${p.kind === 'human' ? 'human' : 'agent'}`}
                    aria-hidden="true"
                  >
                    {p.kind === 'human' ? '●' : '◇'}
                  </span>
                  <span className="mention-name">
                    {p.name}
                    <small>
                      {p.kind === 'human' ? '玩家' : 'Agent'} · 在线
                      {connection.players.filter(
                        (other) => other.name === p.name,
                      ).length > 1
                        ? ` · ${p.id.slice(-4)}`
                        : ''}
                    </small>
                  </span>
                  <span className="mention-pick" aria-hidden="true">
                    ↵
                  </span>
                </button>
              ))
            ) : (
              <p className="mention-empty">
                {picker.query.trim()
                  ? '没有找到匹配的玩家或 Agent'
                  : '没有其他可选的在线玩家'}
                <small>关闭列表后，可点击标签上的 × 移除已选对象。</small>
              </p>
            )}
          </div>
          <div className="mention-hint">↑ ↓ 选择 · Enter 确认 · Esc 关闭</div>
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
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={picker?.source === 'input'}
            aria-activedescendant={
              picker?.source === 'input' && candidates.length
                ? `mention-${candidates[activeChoice].id}`
                : undefined
            }
            aria-controls="chat-mentions"
            placeholder={
              scope === 'private'
                ? recipients.length
                  ? '发送私聊消息…'
                  : '先选择私聊对象…'
                : '说点什么，@ 选择玩家…'
            }
            disabled={busy || !!clip}
            value={text}
            maxLength={240}
            onKeyDown={onKey}
            onChange={(e) => {
              setText(e.target.value);
              const pos = e.target.selectionStart ?? 0;
              caret.current = pos;
              setPicker(mentionQuery(e.target.value, pos));
              setChoice(0);
            }}
            onSelect={(e) => {
              caret.current = e.currentTarget.selectionStart ?? 0;
              if (picker?.source !== 'button')
                setPicker(mentionQuery(e.currentTarget.value, caret.current));
            }}
          />
        </div>
        <button
          className="chat-send"
          disabled={
            !connected ||
            busy ||
            (!clip && !text.trim()) ||
            (scope === 'private' && !recipients.length)
          }
          aria-label="发送消息"
          title="发送消息"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z" />
            <path d="m10.5 13.5 5-5" />
          </svg>
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
            aria-label="选择要 @ 的玩家或 Agent"
            aria-expanded={picker !== null}
            aria-controls="chat-mentions"
            onClick={openPicker}
          >
            @ 选人
          </button>
        )}
      </div>
      <small className="chat-help chat-scope-help">
        {scope === 'private'
          ? '仅已选对象可收到，接收者会保留用于连续私聊。'
          : recipients.length
            ? '所有人可见，已选对象会被提醒；Agent 可被唤醒。'
            : '所有人可见，输入 @ 或点击选人来提醒对方。'}
      </small>
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
