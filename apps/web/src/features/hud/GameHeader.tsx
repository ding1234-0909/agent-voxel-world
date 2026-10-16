interface GameHeaderProps {
  connectionStatus: string;
  joined: boolean;
  isConsoleOpen: boolean;
  voiceActivity: string;
  isPlayersOpen: boolean;
  onOpenConsole: () => void;
  onTogglePlayers: () => void;
  onLeaveWorld: () => void;
}

const VOICE_ACTIVITY_LABELS: Record<string, string> = {
  listening: ' · 录音中',
  transcribing: ' · 识别中',
  thinking: ' · 回复中',
  speaking: ' · 朗读中',
};

export function GameHeader({
  connectionStatus,
  joined,
  isConsoleOpen,
  voiceActivity,
  isPlayersOpen,
  onOpenConsole,
  onTogglePlayers,
  onLeaveWorld,
}: GameHeaderProps) {
  const isConnected = connectionStatus === 'connected';

  return (
    <header>
      <div className="brand">
        <span className="brand-icon">◈</span>
        <div>
          <strong>VOXEL / FIELD</strong>
          <small>A shared world for people & agents</small>
        </div>
      </div>
      <div className="status">
        <i className={isConnected ? 'online' : ''} />
        {joined ? connectionStatus : '游戏大厅'} <span>WORLD 01</span>
        <button
          className="exit-game"
          aria-haspopup="dialog"
          aria-expanded={isConsoleOpen}
          aria-controls="control-console"
          onClick={onOpenConsole}
        >
          控制台
          {VOICE_ACTIVITY_LABELS[voiceActivity] ?? ''}
        </button>
        {joined && (
          <nav className="game-panels" aria-label="游戏面板">
            <button
              aria-expanded={isPlayersOpen}
              aria-controls="world-panel"
              onClick={onTogglePlayers}
            >
              玩家
            </button>
          </nav>
        )}
        {joined && (
          <button
            className="exit-game"
            onClick={onLeaveWorld}
            title="退出当前世界并返回进入页面"
          >
            退出游戏
          </button>
        )}
      </div>
    </header>
  );
}
