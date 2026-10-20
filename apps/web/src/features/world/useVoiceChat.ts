import { useEffect, useRef, useState } from 'react';
import { LiveRecorder } from '../../audio/live-recorder';
import { speechTransport } from '../../audio/live-speech';

/**
 * Oral-practice companion chat: talk with the companions in English.
 * - Hold V (or tap the mic button): the server transcribes your speech with
 *   the local Whisper model (中文/英文都能识别，无需任何在线 API)。
 * - Or type English in the input box — works in every browser.
 * Either way DeepSeek answers with a short natural English reply + Chinese
 * translation, and a companion speaks it out loud.
 * A stable per-player session id gives the AI memory of the conversation.
 */

export function useVoiceChat(
  onReply: (en: string, zh: string) => void,
) {
  const [state, setState] = useState<
    'idle' | 'listening' | 'thinking' | 'error' | 'unsupported'
  >('idle');
  const recorderRef = useRef<LiveRecorder | null>(null);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const busyRef = useRef(false);

  // Stable per-player session id so the AI remembers the conversation.
  const [sessionId] = useState<string>(() => {
    try {
      let id = localStorage.getItem('voxel-chat-session');
      if (!id) {
        id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('voxel-chat-session', id);
      }
      return id;
    } catch {
      return `p-${Date.now().toString(36)}`;
    }
  });

  const sendText = (text: string) => {
    const clean = text.trim();
    if (!clean || busyRef.current) return;
    busyRef.current = true;
    setState('thinking');
    fetch('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, session: sessionId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { en?: string; zh?: string }) => {
        if (data.en) onReplyRef.current(data.en, data.zh ?? '');
      })
      .catch(() => setState('error'))
      .finally(() => {
        busyRef.current = false;
        setState('idle');
      });
  };

  useEffect(() => {
    const recorder = new LiveRecorder();
    recorderRef.current = recorder;
    return () => {
      recorder.cancel();
      recorderRef.current = null;
    };
  }, []);

  const startListening = () => {
    if (busyRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (!recorder.canRecord) {
      setState('unsupported');
      return;
    }
    void recorder.start(
      'zh-CN',
      {
        onPartial: () => {},
        onFinal: (text) => sendText(text),
        onStatus: () => {},
        onError: () => setState('error'),
        onEnd: () => {
          if (!busyRef.current) setState('idle');
        },
        onState: (_next, _message) => {},
      },
      undefined,
      speechTransport('zh-CN'),
    );
    setState('listening');
  };

  const stopListening = () => {
    void recorderRef.current?.finish();
  };

  return { state, startListening, stopListening, sendText };
}
