import { useEffect, useState } from 'react';
import type { Connection } from './connection';
import { PresenceSubscription } from './world-presence';

export function WorldPanel({
  connection,
  hidden = false,
  onClose,
}: {
  connection: Connection;
  hidden?: boolean;
  onClose?: () => void;
}) {
  const [presence] = useState(() => new PresenceSubscription());
  const [, render] = useState(0);
  useEffect(() => {
    presence.onChange = () => render((n) => n + 1);
    presence.start();
    return () => presence.stop();
  }, [presence]);
  const { data, status } = presence;
  const players = data?.players ?? [];
  const humans = players.filter(
    (p) => p.connected && p.kind !== 'scripted-agent',
  ).length;
  const agents = players.filter(
    (p) => p.connected && p.kind === 'scripted-agent',
  ).length;
  const reconnecting = players.filter((p) => !p.connected).length;
  const selfId =
    connection.status === 'connected' ? connection.room?.sessionId : undefined;
  return (
    <aside
      id="world-panel"
      className="panel world-panel"
      aria-label="世界实时玩家数据"
      hidden={hidden}
    >
      {onClose && (
        <button
          className="panel-close"
          aria-label="收起玩家面板"
          onClick={onClose}
        >
          收起 ×
        </button>
      )}
      <div className="eyebrow">THE MEADOW · 共享世界</div>
      <h1>谁在这里</h1>
      <div className={`presence-status ${status}`} role="status">
        <i />
        {status === 'live'
          ? '实时更新 · 每秒同步'
          : status === 'loading'
            ? '正在获取世界状态…'
            : '同步中断 · 正在重连'}
      </div>
      {status === 'reconnecting' && (
        <p className="presence-notice">
          {data
            ? '以下为最后一次收到的数据，暂未更新。'
            : '世界服务暂不可用，在线人数未知。'}
        </p>
      )}
      <div className="stats">
        <div>
          <strong>{data ? humans : '—'}</strong>
          <small>在线玩家</small>
        </div>
        <div>
          <strong>{data ? agents : '—'}</strong>
          <small>在线代理</small>
        </div>
      </div>
      <p className="world-occupancy">
        {data
          ? `在线 ${humans + agents} / ${data.capacity} · 重连中 ${reconnecting}`
          : '等待玩家列表'}
      </p>
      <div className="rule" />
      <div className="eyebrow">玩家列表</div>
      <div className="player-list">
        {players.map((p) => (
          <div className={`player ${p.connected ? '' : 'away'}`} key={p.id}>
            <div className="player-name">
              <span aria-hidden="true">
                {p.kind === 'scripted-agent' ? '◆' : '●'}
              </span>
              {p.name}
              {p.id === selfId ? ' · 你' : ''}
            </div>
            <small>
              {p.kind === 'scripted-agent' ? '脚本代理' : '玩家'} ·{' '}
              {p.connected ? '在线' : '重连中'}
            </small>
            <small className="player-position">
              位置 {p.x.toFixed(1)}, {p.y.toFixed(1)}, {p.z.toFixed(1)}
            </small>
          </div>
        ))}
        {data && players.length === 0 && (
          <p>
            {status === 'live'
              ? '当前暂无在线玩家，进入世界成为第一位探索者。'
              : '上次同步时没有玩家。'}
          </p>
        )}
      </div>
      <div className="world-membership">
        {connection.status === 'connected'
          ? '你已进入世界'
          : connection.status === 'lobby'
            ? '你尚未进入世界 · 可查看实时玩家'
            : '你的游戏连接正在恢复'}
      </div>
      <div className="storage">
        世界版本 {data?.revision ?? '—'} ·{' '}
        {data
          ? data.persistence === 'memory'
            ? '临时存储'
            : '持久存储'
          : '等待同步'}
      </div>
    </aside>
  );
}
