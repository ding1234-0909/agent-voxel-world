import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserSpeech,
  type Recognition,
} from '../apps/web/src/audio/browser-speech';
class FakeRecognition implements Recognition {
  static last: FakeRecognition;
  constructor() {
    FakeRecognition.last = this;
  }
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  start = vi.fn();
  abort = vi.fn();
}
const setup = () => {
  const synthesis = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] };
  const speech = new BrowserSpeech({
    SpeechRecognition: FakeRecognition,
    isSecureContext: true,
    speechSynthesis: synthesis,
  } as unknown as Window);
  return { speech, synthesis };
};
afterEach(() => vi.unstubAllGlobals());
describe('browser speech lifecycle', () => {
  it('supports prefixed recognition and provides an unsupported fallback', () => {
    const speech = new BrowserSpeech({
      webkitSpeechRecognition: FakeRecognition,
      isSecureContext: true,
    } as unknown as Window);
    expect(speech.canListen).toBe(true);
    const unsupported = new BrowserSpeech({} as Window);
    const error = vi.fn();
    unsupported.listen('zh-CN', vi.fn(), error, vi.fn());
    expect(error).toHaveBeenCalledWith(expect.stringContaining('文字'));
    expect(unsupported.canSpeak).toBe(false);
  });
  it('delivers final recognition once and ignores events after stop', () => {
    const { speech } = setup();
    const text = vi.fn(),
      error = vi.fn(),
      end = vi.fn();
    speech.listen('zh-CN', text, error, end);
    const recognition = FakeRecognition.last;
    expect(recognition.lang).toBe('zh-CN');
    recognition.onresult?.({ results: [[{ transcript: '你好' }]] });
    recognition.onend?.();
    recognition.onresult?.({ results: [[{ transcript: 'late' }]] });
    expect(text).toHaveBeenCalledExactlyOnceWith('你好');
    expect(end).not.toHaveBeenCalled();
    expect(recognition.abort).toHaveBeenCalled();
  });
  it('shows permission failures and does not overwrite them on end', () => {
    const { speech } = setup();
    const error = vi.fn(),
      end = vi.fn();
    speech.listen('zh-CN', vi.fn(), error, end);
    const recognition = FakeRecognition.last;
    recognition.onerror?.({ error: 'not-allowed' });
    recognition.onend?.();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('权限被拒绝'));
    expect(end).not.toHaveBeenCalled();
  });
  it('does not silently truncate long recognition', () => {
    const { speech } = setup();
    const text = vi.fn(),
      error = vi.fn();
    speech.listen('zh-CN', text, error, vi.fn());
    FakeRecognition.last.onresult?.({
      results: [[{ transcript: '字'.repeat(241) }]],
    });
    expect(text).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('240'));
  });
  it('cancels audio and suppresses late playback callbacks', () => {
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    );
    const { speech, synthesis } = setup();
    const end = vi.fn(),
      error = vi.fn();
    speech.speak('你好', 'zh-CN', end, error);
    const utterance = synthesis.speak.mock.calls[0][0];
    speech.stop();
    utterance.onend();
    utterance.onerror();
    expect(end).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(synthesis.cancel).toHaveBeenCalled();
  });
});
