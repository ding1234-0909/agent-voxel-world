import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type Material } from '@voxel/shared';
import { Connection } from './connection';
import { WorldScene } from './scene';
import './style.css';
const connection = new Connection();
if (import.meta.hot) import.meta.hot.dispose(() => connection.dispose());
const savedName = sessionStorage.getItem('voxel-name');
function App() {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<WorldScene | null>(null);
  const [, render] = useState(0);
  const [voiceText, setVoiceText] = useState('Hello, meadow'),
    [voice, setVoice] = useState({
      state: 'idle',
      subtitle: 'Text simulation only. No microphone, audio or AI.',
    });
  const [name, setName] = useState(savedName ?? 'Explorer'),
    [joined, setJoined] = useState(!!savedName),
    [chat, setChat] = useState(''),
    [target, setTarget] = useState('Aim at a block'),
    [material, setMaterial] = useState<Material>('wood');
  useEffect(() => {
    connection.onChange = () => render((n) => n + 1);
    connection.onVoice = (value) => setVoice(value as typeof voice);
    const world = new WorldScene(host.current!, connection);
    scene.current = world;
    connection.onBlocks = world.rebuild;
    world.onTarget = setTarget;
    if (savedName) void connection.connect(savedName);
    return () => world.dispose();
  }, []);
  return (
    <main>
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
          {connection.status} <span>WORLD 01</span>
        </div>
      </header>
      <aside className="panel">
        <div className="eyebrow">THE MEADOW</div>
        <h1>
          Make room
          <br />
          for possibility.
        </h1>
        <p>
          A small, persistent world.
          <br />
          Build something together.
        </p>
        <div className="stats">
          <div>
            <strong>{connection.players.length}</strong>
            <small>EXPLORERS</small>
          </div>
          <div>
            <strong>{connection.revision}</strong>
            <small>WORLD REVISION</small>
          </div>
        </div>
        <div className="rule" />
        <div className="eyebrow">IN THIS WORLD</div>
        {connection.players.map((p) => (
          <div className="player" key={p.id}>
            <span>{p.kind === 'scripted-agent' ? '◆' : '●'}</span>
            {p.name}
            {p.id === connection.room?.sessionId ? ' · you' : ''}
            <small>
              {p.kind === 'scripted-agent'
                ? 'SCRIPTED TEST AGENT'
                : p.connected
                  ? 'ONLINE'
                  : 'RECONNECTING'}
            </small>
          </div>
        ))}
        <div className="storage">Storage · {connection.persistence}</div>
      </aside>
      {!joined && (
        <div className="join">
          <div className="eyebrow">STEP INTO THE WORLD</div>
          <h2>Your next idea starts here.</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setJoined(true);
              sessionStorage.setItem('voxel-name', name);
              void connection.connect(name);
            }}
          >
            <label htmlFor="name">Explorer name</label>
            <input
              id="name"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <button>Enter world ↗</button>
          </form>
          <small>Local multiplayer prototype · no paid services</small>
        </div>
      )}
      <div className="crosshair">+</div>
      <div className="target">{target}</div>
      <section className="voice">
        <div className="eyebrow">VOICE LAB · MOCK ONLY</div>
        <div className="voice-state">{voice.state}</div>
        <p aria-live="polite">{voice.subtitle}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connection.action('voice.start', { text: voiceText });
          }}
        >
          <input
            aria-label="Mock voice text"
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            maxLength={240}
          />
          <button disabled={!joined}>Simulate</button>
        </form>
        <button
          className="interrupt"
          onClick={() => connection.action('voice.interrupt')}
        >
          Interrupt
        </button>
        <small>No microphone · No audio · No real AI</small>
      </section>
      <section className="chat">
        <div className="eyebrow">WORLD CHAT</div>
        <div className="messages">
          {connection.messages.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connection.action('chat', { text: chat });
            setChat('');
          }}
        >
          <input
            aria-label="Chat message"
            placeholder="Say something…"
            value={chat}
            maxLength={240}
            onChange={(e) => setChat(e.target.value)}
          />
          <button disabled={!joined}>↗</button>
        </form>
      </section>
      <footer>
        <div className="controls">
          <b>W A S D</b> move <b>SPACE</b> jump <b>CLICK</b> look <b>ESC</b>{' '}
          release
          <br />
          <span>
            Left click removes · Right click places · Aim within 6 blocks
          </span>
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
          <button onClick={() => scene.current?.edit(false)}>Remove</button>
          <button onClick={() => scene.current?.edit(true)}>Place block</button>
        </div>
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
