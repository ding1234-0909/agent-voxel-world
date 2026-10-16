import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Player } from '@voxel/shared';
import type { Connection } from '../../network/connection';
import { LocalRecorder } from '../../audio/local-recorder';
import { ClipRecorder } from '../../audio/clip-recorder';
import { mentionQuery, consumeMention } from './chat-mentions';
import { chatApi } from './api';
export function useChatController(connection: Connection) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedAt, setCollapsedAt] = useState(0);
  const unread = collapsed
    ? connection.chats.filter(
        (entry) =>
          entry.seq > collapsedAt && entry.actor !== connection.room?.sessionId,
      ).length
    : 0;
  const [text, setText] = useState(''),
    [scope, setScope] = useState<'public' | 'private'>('public'),
    [recipients, setRecipients] = useState<Player[]>([]);
  const [picker, setPicker] = useState<
    | NonNullable<ReturnType<typeof mentionQuery>>
    | { source: 'button'; query: string }
    | null
  >(null);
  const [choice, setChoice] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const caret = useRef(0);
  const [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [mode, setMode] = useState<
      | 'idle'
      | 'permission'
      | 'dictating'
      | 'transcribing'
      | 'recording'
      | 'sending'
    >('idle');
  const [clipDuration, setClipDuration] = useState(0);
  const [clip, setClip] = useState<Blob>(),
    [preview, setPreview] = useState('');
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null),
    upload = useRef<AbortController | undefined>(undefined);
  const [dictation] = useState(() => new LocalRecorder()),
    [recorder] = useState(() => new ClipRecorder());
  const connected = connection.status === 'connected',
    busy = mode !== 'idle';
  const candidates = connection.players
    .filter(
      (p) =>
        p.connected &&
        p.id !== connection.room?.sessionId &&
        !recipients.some((r) => r.id === p.id) &&
        p.name
          .toLowerCase()
          .includes((picker?.query ?? '').trim().toLowerCase()),
    )
    .sort((a, b) => Number(b.kind !== 'human') - Number(a.kind !== 'human'));
  const activeChoice = candidates.length ? choice % candidates.length : 0;
  useEffect(() => {
    if (picker?.source === 'button') search.current?.focus();
  }, [picker?.source]);
  useEffect(() => {
    if (!picker) return;
    panel.current
      ?.querySelector('[role=option][aria-selected=true]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [choice, picker?.query]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setPicker(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    if (!clip) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(clip);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);
  const cancel = () => {
    dictation.cancel();
    recorder.cancel();
    upload.current?.abort();
    connection.chatRecording = false;
    setMode('idle');
    setStatus('');
  };
  useEffect(() => {
    if (!connected) cancel();
  }, [connected]);
  useEffect(
    () => () => {
      dictation.cancel();
      recorder.cancel();
      upload.current?.abort();
      connection.chatRecording = false;
    },
    [connection, dictation, recorder],
  );
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [connection.chats.length]);
  const openPicker = () => {
    setPicker({ source: 'button', query: '' });
    setChoice(0);
    setError('');
  };
  const select = (p: Player) => {
    if (recipients.some((r) => r.id === p.id)) return;
    if (recipients.length >= 8) {
      setError('最多选择 8 位接收者，请先移除一位。');
      return;
    }
    const next =
      picker?.source === 'input'
        ? consumeMention(text, picker.start, picker.end)
        : { text, caret: caret.current };
    setText(next.text);
    setRecipients((r) => [...r, p]);
    setPicker(null);
    setError('');
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms an IME candidate; it must never select a player or send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (!picker) return;
    if (e.key === 'Escape') {
      setPicker(null);
      e.preventDefault();
      e.stopPropagation();
      input.current?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setChoice(
        (n) =>
          (n +
            (e.key === 'ArrowDown' ? 1 : -1) +
            Math.max(1, candidates.length)) %
          Math.max(1, candidates.length),
      );
    }
    if (e.key === 'Enter' || (e.key === 'Tab' && candidates.length)) {
      e.preventDefault();
      if (candidates.length) select(candidates[activeChoice]);
    }
  };
  const record = (kind: 'text' | 'audio') => {
    if (connection.voiceLabRecording) {
      setError('请先结束语音设置中的录音。');
      return;
    }
    connection.stopSpatialInput();
    connection.chatRecording = true;
    setError('');
    setMode('permission');
    setStatus('正在请求麦克风…');
    const fail = (message: string) => {
      connection.chatRecording = false;
      setMode('idle');
      setError(message);
      setStatus('');
    };
    if (kind === 'text')
      void dictation.start('zh-CN', {
        onState: (state) => {
          setMode(state === 'listening' ? 'dictating' : 'transcribing');
          setStatus(
            state === 'listening'
              ? '听写中，结束后可编辑再发送。'
              : '正在服务器识别…',
          );
        },
        onText: (value) => {
          connection.chatRecording = false;
          setText((t) => (t + ' ' + value).trim().slice(0, 240));
          setMode('idle');
          setStatus('已转为文字，请确认后发送。');
        },
        onError: fail,
      });
    else
      void recorder.start(
        (blob, durationMs) => {
          connection.chatRecording = false;
          setClipDuration(durationMs);
          setClip(blob);
          setMode('idle');
          setStatus('');
        },
        fail,
        () => {
          setMode('recording');
          setStatus('录制语音消息中，最长 20 秒。');
        },
      );
  };
  const send = async () => {
    setError('');
    const ids = recipients.map((p) => p.id);
    if (scope === 'private' && !ids.length) {
      setError('请先通过 @ 选择私聊对象。');
      return;
    }
    if (
      ids.some(
        (id) => !connection.players.some((p) => p.id === id && p.connected),
      )
    ) {
      setError('接收对象已离线，请移除或重新选择。');
      return;
    }
    if (!clip && !text.trim()) return;
    setPicker(null);
    setMode('sending');
    const abort = new AbortController();
    upload.current = abort;
    try {
      if (clip) {
        setStatus('正在上传语音并由服务器转写…');
        const timer = setTimeout(() => abort.abort(), 125000);
        try {
          const data = await chatApi.uploadAudio(
            clip,
            scope,
            ids,
            connection.chatToken,
            abort.signal,
          );
          setStatus(
            data.transcriptAvailable
              ? '语音已发送，Agent 可读取转写。'
              : '语音已发送，暂未生成文字转写，Agent 无法理解此段录音。',
          );
        } finally {
          clearTimeout(timer);
        }
        setClip(undefined);
        setText('');
      } else {
        await connection.requestAction('chat', {
          text,
          scope,
          recipients: ids,
        });
        setText('');
        setStatus('已发送。');
      }
      if (scope === 'public') setRecipients([]);
      input.current?.focus();
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
      else setError('发送已取消或超时，请确认消息记录后再重试。');
    } finally {
      setMode('idle');
    }
  };

  return {
    connection,
    collapsed,
    setCollapsed,
    setCollapsedAt,
    unread,
    text,
    setText,
    scope,
    setScope,
    recipients,
    setRecipients,
    picker,
    setPicker,
    setChoice,
    panel,
    search,
    caret,
    status,
    setStatus,
    error,
    setError,
    mode,
    setMode,
    clipDuration,
    clip,
    setClip,
    preview,
    input,
    list,
    upload,
    dictation,
    recorder,
    connected,
    busy,
    candidates,
    activeChoice,
    cancel,
    openPicker,
    select,
    onKey,
    record,
    send,
  };
}
export type ChatController = ReturnType<typeof useChatController>;
