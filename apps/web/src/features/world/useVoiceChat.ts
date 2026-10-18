import { useEffect, useRef, useState } from 'react';

/**
 * Oral-practice companion chat: talk with the companions in English.
 * - Hold V (or tap the mic button): the browser transcribes your speech.
 * - Or type English in the input box — works in every browser.
 * Either way DeepSeek answers with a short natural English reply + Chinese
 * translation, and a companion speaks it out loud.
 * A stable per-player session id gives the AI memory of the conversation.
 */

type Recognition = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
};

export function useVoiceChat(
  onReply: (en: string, zh: string) => void,
) {
  const [state, setState] = useState<
    'idle' | 'listening' | 'thinking' | 'error' | 'unsupported'
  >('idle');
  const recognitionRef = useRef<Recognition | null>(null);
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
    const SR = (
      window as unknown as {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      }
    ).SpeechRecognition ?? (
      window as unknown as {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      }
    ).webkitSpeechRecognition;
    if (!SR) {
      setState('unsupported');
      return;
    }
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim() ?? '';
      if (!text) return;
      sendText(text);
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      setState('error');
    };
    recognition.onend = () => {
      if (!busyRef.current) setState('idle');
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const startListening = () => {
    if (busyRef.current) return;
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      setState('listening');
      recognition.start();
    } catch {
      setState('error');
    }
  };

  return { state, startListening, sendText };
}
