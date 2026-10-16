import { useEffect, useRef } from 'react';
import type { ChatEntry } from '@voxel/shared';
import type { Connection } from '../../network/connection';
import { AudioPlayer } from './AudioPlayer';
import { chatApi } from './api';
export function AudioMessage({
  entry,
  connection,
}: {
  entry: ChatEntry;
  connection: Connection;
}) {
  const resource = useRef(''),
    controller = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (resource.current) URL.revokeObjectURL(resource.current);
    },
    [],
  );
  const load = async () => {
    if (resource.current) return resource.current;
    const abort = new AbortController();
    controller.current = abort;
    const blob = await chatApi.downloadAudio(
      entry.data.audioId!,
      connection.chatToken,
      abort.signal,
    );
    resource.current = URL.createObjectURL(blob);
    return resource.current;
  };
  return (
    <div
      className={`chat-audio-message${entry.actor === connection.room?.sessionId ? ' is-own' : ''}`}
    >
      <AudioPlayer
        compact
        loadSource={load}
        durationMs={entry.data.durationMs ?? 0}
      />
      {entry.data.transcriptAvailable && (
        <details className="chat-transcript">
          <summary>转文字</summary>
          <p>{entry.data.text}</p>
        </details>
      )}
    </div>
  );
}
