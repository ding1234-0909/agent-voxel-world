import type { ChatController } from './useChatController';
type Props = Pick<
  ChatController,
  | 'connection'
  | 'scope'
  | 'recipients'
  | 'picker'
  | 'setPicker'
  | 'setChoice'
  | 'search'
  | 'input'
  | 'candidates'
  | 'activeChoice'
  | 'select'
  | 'onKey'
>;
export function MentionPicker({
  connection,
  scope,
  recipients,
  picker,
  setPicker,
  setChoice,
  search,
  input,
  candidates,
  activeChoice,
  select,
  onKey,
}: Props) {
  if (!picker) return null;
  return (
    <div className="mention-picker">
      <div className="mention-heading">
        <strong>{scope === 'private' ? '选择私聊对象' : '想提醒谁？'}</strong>
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
                  {connection.players.filter((other) => other.name === p.name)
                    .length > 1
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
  );
}
