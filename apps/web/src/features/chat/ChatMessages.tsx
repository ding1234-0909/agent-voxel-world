import { AudioMessage } from './AudioMessage';
import type { ChatController } from './useChatController';
type Props = Pick<
  ChatController,
  'connection' | 'text' | 'scope' | 'recipients' | 'list'
>;
export function ChatMessages({
  connection,
  text,
  scope,
  recipients,
  list,
}: Props) {
  return (
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
  );
}
