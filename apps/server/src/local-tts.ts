import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { executable, SpeechError, validatePcmWav } from './local-speech';

const exec = promisify(execFile);
export type SynthesizedSpeech = { bytes: Buffer; durationMs: number };
export interface SpeechSynthesizer {
  synthesize(text: string, signal: AbortSignal): Promise<SynthesizedSpeech>;
}

/** Server-local TTS; outputs a file, never the server's speakers. */
export class LocalTts implements SpeechSynthesizer {
  async status() {
    const available =
      process.platform === 'darwin' &&
      !!(await executable('/usr/bin/say')) &&
      !!(await executable(process.env.FFMPEG_BIN ?? 'ffmpeg'));
    return {
      available,
      reason: available
        ? '本机语音合成已就绪，Agent 回复可由附近玩家收听。'
        : 'Agent 语音合成需要 macOS say 和 ffmpeg；当前仍可使用文字回复。',
    };
  }
  async synthesize(
    text: string,
    signal: AbortSignal,
  ): Promise<SynthesizedSpeech> {
    if (!text.trim() || text.length > 240)
      throw new SpeechError('语音文字需为 1–240 字。');
    signal.throwIfAborted();
    const status = await this.status();
    if (!status.available) throw new SpeechError(status.reason, 503);
    const dir = await mkdtemp(join(tmpdir(), 'voxel-tts-'));
    try {
      const input = join(dir, 'text.txt'),
        source = join(dir, 'speech.aiff'),
        output = join(dir, 'speech.wav');
      // File input keeps model text out of shell syntax and command options.
      await writeFile(input, text, { mode: 0o600 });
      const voice = /[\u3400-\u9fff]/u.test(text)
        ? (process.env.TTS_VOICE_ZH ?? 'Tingting')
        : (process.env.TTS_VOICE_EN ?? 'Samantha');
      const options = {
        signal,
        timeout: 30000,
        killSignal: 'SIGKILL' as const,
        maxBuffer: 256 * 1024,
      };
      await exec(
        '/usr/bin/say',
        ['-v', voice, '-r', '200', '-f', input, '-o', source],
        options,
      );
      await exec(
        process.env.FFMPEG_BIN ?? 'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          source,
          '-t',
          '91',
          '-vn',
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          output,
        ],
        options,
      );
      signal.throwIfAborted();
      const bytes = await readFile(output);
      return { bytes, durationMs: validatePcmWav(bytes, 90.5) };
    } catch (error) {
      if (signal.aborted || error instanceof SpeechError) throw error;
      throw new SpeechError(
        'Agent 语音合成失败，请检查本机音色和 ffmpeg；文字回复已保留。',
        502,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
