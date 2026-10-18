interface LobbyCardProps {
  name: string;
  onNameChange: (name: string) => void;
  onJoin: () => void;
  onCreateAgent: () => void;
}

export function LobbyCard({
  name,
  onNameChange,
  onJoin,
  onCreateAgent,
}: LobbyCardProps) {
  return (
    <div className="join">
      <div className="eyebrow">THE MEADOW / WORLD 01</div>
      <h2>
        把想法，
        <br />
        建成一个世界。
      </h2>
      <p className="lobby-description">
        和朋友一起探索、搭建，或邀请 AI 伙伴加入。
        <br />
        从这里开始，让这个世界多一点可能。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onJoin();
        }}
      >
        <label htmlFor="name">玩家昵称</label>
        <input
          id="name"
          value={name}
          maxLength={24}
          onChange={(e) => onNameChange(e.target.value)}
          required
        />
        <button>进入世界 ↗</button>
      </form>
      <button className="join-agents" onClick={onCreateAgent}>
        创建 Agent 玩家
      </button>
      <button
        className="join-agents"
        onClick={() => window.open('/ai-school/index.html', '_blank')}
      >
        打开 AI 小学版（精致画面）
      </button>
      <small>同一个共享世界 · 真人与 AI 一起创造</small>
    </div>
  );
}
