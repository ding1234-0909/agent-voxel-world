import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type Material } from '@voxel/shared';
import { Connection } from './connection';
import { WorldScene } from './scene';
import { VoiceDialog } from './VoiceDialog';
import { WorldPanel } from './WorldPanel';
import { AgentManagerPanel } from './AgentManagerPanel';
import { ChatPanel } from './ChatPanel';
import { SpatialVoicePanel } from './SpatialVoicePanel';
import './style.css';
const connection = new Connection();
if (import.meta.hot) import.meta.hot.dispose(() => connection.dispose());
const savedName = sessionStorage.getItem('voxel-name');
function App() {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<WorldScene | null>(null);
  const [, render] = useState(0);
  const [activePanel, setActivePanel] = useState<'players' | 'voice' | null>(
    null,
  );
  const [agentPanel, setAgentPanel] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const openAgents = () => {
    if (document.pointerLockElement) document.exitPointerLock();
    window.dispatchEvent(new Event('blur'));
    setActivePanel(null);
    setAgentPanel(true);
  };
  const [voiceActivity, setVoiceActivity] = useState('idle');
  const [name, setName] = useState(savedName ?? 'Explorer'),
    [joined, setJoined] = useState(!!savedName),
    [target, setTarget] = useState('Aim at a block'),
    [material, setMaterial] = useState<Material>('wood');
  useEffect(() => {
    connection.onChange = () => render((n) => n + 1);
    const world = new WorldScene(host.current!, connection);
    scene.current = world;
    connection.onBlocks = world.rebuild;
    world.onTarget = setTarget;
    if (savedName) void connection.connect(savedName);
    return () => world.dispose();
  }, []);
  useEffect(() => {
    const closePanels = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActivePanel(null);
        setShowControls(false);
      }
    };
    window.addEventListener('keydown', closePanels);
    return () => window.removeEventListener('keydown', closePanels);
  }, []);
  const joinWorld = async () => {
    if (connection.status === 'connected') return true;
    const explorerName = name.trim() || 'Explorer';
    setName(explorerName);
    setActivePanel(null);
    setJoined(true);
    sessionStorage.setItem('voxel-name', explorerName);
    await connection.connect(explorerName);
    return connection.status === 'connected';
  };
  const leaveWorld = () => {
    scene.current?.leaveWorld();
    connection.leave();
    setJoined(false);
    setActivePanel(null);
    setShowControls(false);
  };
  return (
    <main className={joined ? 'in-game' : 'in-lobby'}>
      <div className="world" ref={host} />
      <header>
        <div className="brand">
          <span className="brand-icon">◈</span>
          <div>
            <strong>VOXEL / FIELD</strong>
            <small>A shared world for people & agents</small>
          </div>
        </div>
        <div className="status">
          <i className={connection.status === 'connected' ? 'online' : ''} />
          {joined ? connection.status : '游戏大厅'} <span>WORLD 01</span>
          <button className="exit-game" onClick={openAgents}>
            Agent 管理
          </button>
          <nav className="game-panels" aria-label="游戏面板">
            {joined && (
              <button
                aria-expanded={activePanel === 'players'}
                aria-controls="world-panel"
                onClick={() =>
                  setActivePanel(activePanel === 'players' ? null : 'players')
                }
              >
                玩家
              </button>
            )}
            <button
              aria-expanded={activePanel === 'voice'}
              aria-haspopup="dialog"
              aria-controls="voice-panel"
              onClick={() => {
                if (document.pointerLockElement) document.exitPointerLock();
                window.dispatchEvent(new Event('blur'));
                setActivePanel(activePanel === 'voice' ? null : 'voice');
              }}
            >
              语音设置
              {(
                {
                  listening: ' · 录音中',
                  transcribing: ' · 识别中',
                  thinking: ' · 回复中',
                  speaking: ' · 朗读中',
                } as Record<string, string>
              )[voiceActivity] ?? ''}
            </button>
          </nav>
          {joined && (
            <button
              className="exit-game"
              onClick={leaveWorld}
              title="退出当前世界并返回进入页面"
            >
              退出游戏
            </button>
          )}
        </div>
      </header>
      <div className="lobby-layout">
        {!joined && (
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
                void joinWorld();
              }}
            >
              <label htmlFor="name">玩家昵称</label>
              <input
                id="name"
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button>进入世界 ↗</button>
            </form>
            <button className="join-agents" onClick={openAgents}>
              创建 Agent 玩家
            </button>
            <small>同一个共享世界 · 真人与 AI 一起创造</small>
          </div>
        )}
        <WorldPanel
          connection={connection}
          hidden={joined && activePanel !== 'players'}
          onClose={joined ? () => setActivePanel(null) : undefined}
        />
      </div>
      {joined && (
        <>
          <div className="crosshair">+</div>
          <div className="target">{target}</div>
        </>
      )}
      <VoiceDialog
        open={activePanel === 'voice'}
        onClose={() => setActivePanel(null)}
        connection={connection}
        onJoin={joinWorld}
        onActivityChange={setVoiceActivity}
      />
      {joined && (
        <div className="communication">
          <SpatialVoicePanel connection={connection} />
          <ChatPanel connection={connection} />
        </div>
      )}
      {agentPanel && <AgentManagerPanel onClose={() => setAgentPanel(false)} />}
      {joined && (
        <footer>
          <div className="controls">
            <button
              className="controls-toggle"
              aria-expanded={showControls}
              aria-controls="controls-help"
              onClick={() => setShowControls(!showControls)}
            >
              <span aria-hidden="true">?</span> 操作帮助
            </button>
            {showControls && (
              <section
                id="controls-help"
                className="controls-help"
                aria-label="操作帮助"
              >
                <div className="chat-title">
                  <strong>操作帮助</strong>
                  <button
                    aria-label="关闭操作帮助"
                    onClick={() => setShowControls(false)}
                  >
                    ×
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>
                      <kbd>W A S D</kbd>
                    </dt>
                    <dd>移动</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>Space</kbd>
                    </dt>
                    <dd>跳跃</dd>
                  </div>
                  <div>
                    <dt>点击画面</dt>
                    <dd>锁定鼠标视角</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>Esc</kbd>
                    </dt>
                    <dd>释放鼠标 / 关闭帮助</dd>
                  </div>
                  <div>
                    <dt>鼠标左键 / 右键</dt>
                    <dd>移除 / 放置方块</dd>
                  </div>
                  <div>
                    <dt>点击底部材质栏</dt>
                    <dd>切换方块材质</dd>
                  </div>
                </dl>
                <p>瞄准 6 格内的方块进行搭建。</p>
              </section>
            )}
          </div>
          <div className="hotbar">
            {(['grass', 'dirt', 'stone', 'wood'] as Material[]).map((m, i) => (
              <button
                key={m}
                aria-pressed={material === m}
                onClick={() => {
                  setMaterial(m);
                  if (scene.current) scene.current.material = m;
                }}
              >
                <span className={`swatch ${m}`} />
                <small>
                  {i + 1} {m}
                </small>
              </button>
            ))}
          </div>
          <div className="build-actions">
            <button
              disabled={connection.status !== 'connected'}
              onClick={() => scene.current?.edit(false)}
            >
              Remove
            </button>
            <button
              disabled={connection.status !== 'connected'}
              onClick={() => scene.current?.edit(true)}
            >
              Place block
            </button>
          </div>
        </footer>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
