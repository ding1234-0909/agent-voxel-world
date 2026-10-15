import { useEffect, useRef, useState } from 'react';
import type { Connection } from './connection';
import { SpatialVoice, type SpatialStatus } from './spatial-voice';
import {
  SpatialTranscriber,
  type TranscriptionState,
} from './spatial-transcriber';
export function SpatialVoicePanel({ connection }: { connection: Connection }) {
  const [state, setState] = useState<SpatialStatus>({
    sending: false,
    listening: false,
    pending: false,
    connected: 0,
    error: '',
  });
  const [transcript, setTranscript] = useState<TranscriptionState>({
    status: '麦克风开启时自动转写',
    text: '',
    error: '',
  });
  const engine = useRef<SpatialVoice | null>(null);
  useEffect(() => {
    const voice = new SpatialVoice(connection, setState);
    const transcriber = new SpatialTranscriber(
      () => connection.chatToken,
      setTranscript,
    );
    voice.onMicrophone = (stream) => {
      if (stream) void transcriber.start(stream);
      else transcriber.stop();
    };
    engine.current = voice;
    connection.onSpatialSignal = voice.signal;
    connection.stopSpatialInput = voice.stopMic;
    const unload = () => voice.dispose();
    window.addEventListener('pagehide', unload);
    return () => {
      window.removeEventListener('pagehide', unload);
      connection.onSpatialSignal = () => {};
      connection.stopSpatialInput = () => {};
      voice.dispose();
      transcriber.stop();
      engine.current = null;
    };
  }, [connection]);
  useEffect(() => {
    engine.current?.update();
  }, [connection.players, connection.status]);
  return (
    <section className="spatial-voice" aria-label="附近空间语音">
      <div className="chat-title">
        <strong>附近语音</strong>
        <small>
          {state.sending
            ? '● 正在外放'
            : state.pending
              ? '等待麦克风授权'
              : '麦克风已关闭'}
        </small>
      </div>
      <div className="spatial-actions">
        <button
          aria-pressed={state.sending}
          disabled={
            connection.status !== 'connected' || connection.chatRecording
          }
          onClick={() =>
            state.sending || state.pending
              ? engine.current?.stopMic()
              : void engine.current?.startMic()
          }
        >
          {state.pending
            ? '取消开启'
            : state.sending
              ? '关闭麦克风'
              : '开启麦克风'}
        </button>
        <button
          aria-pressed={state.listening}
          disabled={connection.status !== 'connected'}
          onClick={() => void engine.current?.setListening(!state.listening)}
        >
          {state.listening ? '关闭收听' : '开启收听'}
        </button>
      </div>
      <small>18 格内随距离、朝向变化 · {state.connected} 个语音连接</small>
      <small>开启麦克风会同步本机转写，附近 Agent 自动接收。</small>
      <small role="status">{transcript.status}</small>
      {transcript.text && <p className="spatial-caption">{transcript.text}</p>}
      {transcript.error && (
        <p role="alert" className="chat-error">
          {transcript.error}
        </p>
      )}
      {state.error && (
        <p role="alert" className="chat-error">
          {state.error}
        </p>
      )}
    </section>
  );
}
