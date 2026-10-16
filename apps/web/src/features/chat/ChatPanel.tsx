import type { Connection } from '../../network/connection';
import { VoiceDraft } from './VoiceDraft';
import { mentionQuery } from './chat-mentions';
import { useChatController } from './useChatController';
import { ChatMessages } from './ChatMessages';
import { MentionPicker } from './MentionPicker';
export function ChatPanel({ connection }: { connection: Connection }) {
  const controller = useChatController(connection);
  const {
    collapsed,
    setCollapsed,
    setCollapsedAt,
    unread,
    text,
    setText,
    scope,
    setScope,
    recipients,
    setRecipients,
    picker,
    setPicker,
    setChoice,
    panel,
    caret,
    status,
    setStatus,
    error,
    setError,
    mode,
    setMode,
    partial,
    overflow,
    setOverflow,
    clipDuration,
    clip,
    setClip,
    preview,
    input,
    upload,
    dictation,
    recorder,
    connected,
    busy,
    candidates,
    activeChoice,
    cancel,
    openPicker,
    onKey,
    record,
    send,
  } = controller;
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
      <ChatMessages {...controller} />
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
        <VoiceDraft
          key={preview}
          src={preview}
          durationMs={clipDuration}
          busy={busy}
          onDiscard={() => {
            setClip(undefined);
            setStatus('');
            setError('');
          }}
        />
      )}
      {picker && <MentionPicker {...controller} />}
      <form
        className={clip ? 'chat-audio-send-row' : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {clip ? (
          <span className="chat-audio-caption">试听满意后，再发送</span>
        ) : (
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
        )}
        <button
          className={`chat-send${clip ? ' chat-send-audio' : ''}`}
          disabled={
            !connected ||
            busy ||
            (!clip && !text.trim()) ||
            (scope === 'private' && !recipients.length)
          }
          aria-label={clip ? '发送语音' : '发送消息'}
          title={clip ? '发送语音' : '发送消息'}
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
          {clip && <span>{mode === 'sending' ? '发送中…' : '发送语音'}</span>}
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
          !clip && (
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
          )
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
      {partial && (
        <p className="speech-interim" role="status">
          临时字幕 · {partial}
        </p>
      )}
      {overflow && (
        <div className="speech-interim">
          <label>
            待发送的已确认句子
            <textarea readOnly value={overflow} rows={2} />
          </label>
          <button
            disabled={busy || !!text.trim()}
            onClick={() => {
              setText(overflow);
              setOverflow('');
              setError('');
              setStatus('已填入，请确认后发送。');
            }}
          >
            填入空白输入框
          </button>
        </div>
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
