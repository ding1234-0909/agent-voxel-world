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
import { releasePointerLock } from './utils/pointer-lock';

const savedName = sessionStorage.getItem('voxel-name');

export function App({ connection }: { connection: Connection }) {
  const [, render] = useState(0);
  const [activePanel, setActivePanel] = useState<'players' | null>(null);
  const [consoleEntry, setConsoleEntry] = useState<{
    initialTab?: 'agents';
  } | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [name, setName] = useState(savedName ?? 'Explorer');
  const [joined, setJoined] = useState(!!savedName);

  const { hostRef, target, material, setMaterial, editBlock, leaveWorldScene } =
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
          <div className="crosshair">+</div>
          <div className="target">{target}</div>
        </>
      )}

      <ControlConsole
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
          material={material}
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
