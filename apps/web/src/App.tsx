import { useEffect, useState } from 'react';
import type { Connection } from './network/connection';
import { WorldPanel } from './features/world/WorldPanel';
import { LobbyCard } from './features/world/LobbyCard';
import { useWorldScene } from './features/world/useWorldScene';
import { ControlConsole } from './features/console/ControlConsole';
import { ChatPanel } from './features/chat/ChatPanel';
import { SpatialVoicePanel } from './features/voice/SpatialVoicePanel';
import { GameHeader } from './features/hud/GameHeader';
import { GameFooter } from './features/hud/GameFooter';
import { InventoryPanel } from './features/survival/InventoryPanel';
import { Crosshair } from './features/hud/Crosshair';
import { Minimap } from './features/hud/Minimap';
import { EnglishTutor } from './features/ai-tutor/EnglishTutor';
import { unlockTtsAudio } from './graphics/companion';
import { releasePointerLock } from './utils/pointer-lock';

const savedName = sessionStorage.getItem('voxel-name');

export function App({ connection }: { connection: Connection }) {
  const [, render] = useState(0);
  const [activePanel, setActivePanel] = useState<'players' | null>(null);
  const [consoleEntry, setConsoleEntry] = useState<{
    initialTab?: 'agents';
  } | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [chatText, setChatText] = useState('');
  const [name, setName] = useState(savedName ?? 'Explorer');
  const [joined, setJoined] = useState(!!savedName);

  const { hostRef, target, material, companionSay, voice, setMaterial, editBlock, leaveWorldScene } =
    useWorldScene(connection);

  useEffect(() => {
    connection.onChange = () => render((n) => n + 1);
    if (savedName) void connection.connect(savedName);
    return () => {
      connection.onChange = () => {};
    };
  }, [connection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActivePanel(null);
        setShowControls(false);
      }
      // Hold V: speak to the companions (oral practice). Release submits.
      if (event.code === 'KeyV' && joined) {
        voice.startListening();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'KeyV') {
        voice.stopListening();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [joined, voice]);

  const openConsole = (initialTab?: 'agents') => {
    releasePointerLock();
    setActivePanel(null);
    setConsoleEntry({ initialTab });
  };

  const joinWorld = async () => {
    if (connection.status === 'connected') return true;
    const explorerName = name.trim() || 'Explorer';
    setName(explorerName);
    setActivePanel(null);
    setJoined(true);
    sessionStorage.setItem('voxel-name', explorerName);
    // User gesture: unlock audio so companion speech can play.
    unlockTtsAudio();
    await connection.connect(explorerName);
    return connection.status === 'connected';
  };

  const leaveWorld = () => {
    leaveWorldScene();
    connection.leave();
    setJoined(false);
    setActivePanel(null);
    setShowControls(false);
  };

  return (
    <main className={joined ? 'in-game' : 'in-lobby'}>
      <div className="world" ref={hostRef} />

      <GameHeader
        connectionStatus={connection.status}
        joined={joined}
        isConsoleOpen={consoleEntry !== null}
        isPlayersOpen={activePanel === 'players'}
        onOpenConsole={() => openConsole()}
        onTogglePlayers={() =>
          setActivePanel((prev) => (prev === 'players' ? null : 'players'))
        }
        onLeaveWorld={leaveWorld}
      />

      <div className="lobby-layout">
        {!joined && (
          <LobbyCard
            name={name}
            onNameChange={setName}
            onJoin={joinWorld}
            onCreateAgent={() => openConsole('agents')}
          />
        )}
        <WorldPanel
          connection={connection}
          hidden={joined && activePanel !== 'players'}
          onClose={joined ? () => setActivePanel(null) : undefined}
        />
      </div>

      {joined && (
        <>
          <Crosshair />
          <div className="target">{target}</div>
          <Minimap connection={connection} />
          <EnglishTutor />
          <InventoryPanel />
        </>
      )}
      {joined && companionSay && (
        <div key={companionSay.at} className="companion-bubble">
          <span className="companion-bubble-name">{companionSay.name}</span>{' '}
          <span className="companion-bubble-en">{companionSay.en}</span>
          <div className="companion-bubble-zh">{companionSay.zh}</div>
        </div>
      )}
      {joined && (
        <div className="voice-chat-hint" data-state={voice.state}>
          {voice.state === 'listening'
            ? '正在听你说话…'
            : voice.state === 'thinking'
              ? '伙伴正在想…'
              : voice.state === 'error'
                ? '没听清或服务不可用，再试一次'
                : voice.state === 'unsupported'
                  ? '此浏览器不支持语音识别，可打字练习'
                  : '按住 V 说英语，或直接打字，和伙伴练口语'}
        </div>
      )}
      {joined && (
        <form
          className="oral-input"
          onSubmit={(e) => {
            e.preventDefault();
            const value = chatText.trim();
            if (!value) return;
            voice.sendText(value);
            setChatText('');
          }}
        >
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Type English and press Enter…"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" disabled={voice.state === 'thinking'}>
            发送
          </button>
        </form>
      )}

      <ControlConsole
        connection={connection}
        open={consoleEntry !== null}
        initialTab={consoleEntry?.initialTab}
        onClose={() => setConsoleEntry(null)}
      />

      {joined && (
        <div className="communication">
          <SpatialVoicePanel connection={connection} />
          <ChatPanel connection={connection} />
        </div>
      )}

      {joined && (
        <GameFooter
          isConnected={connection.status === 'connected'}
          showControls={showControls}
          onToggleControls={() => setShowControls((prev) => !prev)}
          onCloseControls={() => setShowControls(false)}
          onSelectMaterial={setMaterial}
          onEditBlock={editBlock}
        />
      )}
    </main>
  );
}
