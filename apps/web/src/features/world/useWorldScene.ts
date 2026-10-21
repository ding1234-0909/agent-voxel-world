import { useCallback, useEffect, useRef, useState } from 'react';
import type { Material } from '@voxel/shared';
import type { Connection } from '../../network/connection';
import { WorldScene } from '../../graphics/scene';
import { useVoiceChat } from './useVoiceChat';

export function useWorldScene(connection: Connection) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const [target, setTarget] = useState('Aim at a block');
  const [material, setMaterialState] = useState<Material>('wood');
  const [companionSay, setCompanionSay] = useState<{
    name: string;
    en: string;
    zh: string;
    at: number;
  } | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const world = new WorldScene(hostRef.current, connection);
    sceneRef.current = world;
    connection.onBlocks = world.scheduleRebuild;
    connection.onExtend = (e) => world.addBlocks(e.blocks);
    world.onTarget = setTarget;
    world.onCompanionSay = (en, zh, name) =>
      setCompanionSay({ name, en, zh, at: performance.now() });

    return () => {
      world.dispose();
      sceneRef.current = null;
    };
  }, [connection]);

  // Oral practice: hold V, speak English, DeepSeek replies, companion speaks.
  const voice = useVoiceChat((en, zh) => {
    sceneRef.current?.companionReply(en, zh);
  });

  const setMaterial = (m: Material) => {
    setMaterialState(m);
    if (sceneRef.current) {
      sceneRef.current.material = m;
    }
  };

  const editBlock = (place: boolean) => {
    sceneRef.current?.edit(place);
  };

  const leaveWorldScene = () => {
    sceneRef.current?.leaveWorld();
  };

  const speechAnchor = useCallback(
    (actor: string) => sceneRef.current?.speechAnchor(actor) ?? null,
    [],
  );

  return {
    hostRef,
    sceneRef,
    target,
    material,
    companionSay,
    voice,
    setMaterial,
    editBlock,
    leaveWorldScene,
    speechAnchor,
  };
}
