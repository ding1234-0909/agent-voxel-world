import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const formats: Record<string, string> = {
  'audio/webm': 'matroska',
  'audio/mp4': 'mov',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};
export class SpeechError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type CommandRunner = (
  file: string,
  args: string[],
  signal: AbortSignal,
  timeout: number,
) => Promise<void>;
const run: CommandRunner = async (file, args, signal, timeout) => {
  await exec(file, args, {
    signal,
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 512 * 1024,
  });
};
export async function executable(name: string) {
  const candidates = name.includes('/')
    ? [name]
    : (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, name));
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try next PATH entry. */
    }
  }
  return undefined;
}
/** Validate FFmpeg's mono PCM16 output and avoid sending silence to Whisper. */
export function validatePcmWav(wav: Buffer, maxSeconds = 20.5) {
  if (
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new SpeechError('音频转换失败。');
  let pcm: Buffer | undefined,
    validFormat = false;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString('ascii', offset, offset + 4),
      size = wav.readUInt32LE(offset + 4);
    if (offset + 8 + size > wav.length)
      throw new SpeechError('音频文件不完整。');
    if (id === 'fmt ' && size >= 16)
      validFormat =
        wav.readUInt16LE(offset + 8) === 1 &&
        wav.readUInt16LE(offset + 10) === 1 &&
        wav.readUInt32LE(offset + 12) === 16000 &&
        wav.readUInt16LE(offset + 22) === 16;
    if (id === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!validFormat || !pcm || pcm.length % 2)
    throw new SpeechError('音频格式不正确。');
  const seconds = pcm.length / 32000;
  if (seconds < 0.25) throw new SpeechError('录音太短，请至少说一句话。');
  if (seconds > maxSeconds)
    throw new SpeechError(
      maxSeconds === 20.5
        ? '录音超过 20 秒，请分段录音。'
        : '音频过长，请分段发送。',
    );
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2)
    sum += (pcm.readInt16LE(i) / 32768) ** 2;
  if (Math.sqrt(sum / (pcm.length / 2)) < 0.003)
    throw new SpeechError('没有检测到清晰声音，请靠近麦克风后重试。');
  return Math.round(seconds * 1000);
}
export class LocalSpeech {
  private busy = false;
  constructor(
    private model = process.env.WHISPER_MODEL ??
      fileURLToPath(
        new URL('../../../../.data/voice/ggml-small.bin', import.meta.url),
      ),
    private whisper =
      process.env.WHISPER_BIN ??
      fileURLToPath(
        new URL('../../../../.data/tools/whisper-cli', import.meta.url),
      ),
    private ffmpeg = process.env.FFMPEG_BIN ?? 'ffmpeg',
    private runner: CommandRunner = run,
  ) {}
  async status() {
    try {
      const [model, whisper] = await Promise.all([
        stat(this.model),
        executable(this.whisper),
      ]);
      if (model.size < 1024 * 1024 || !model.isFile()) throw Error('model');
      if (!whisper)
        return {
          available: false,
          reason: '缺少 whisper-cli，请按语音配置文档安装。',
        };
      return {
        available: true,
        reason:
          '自托管 Whisper 已就绪。音频上传至项目服务器，由服务器完成识别。',
      };
    } catch {
      return {
        available: false,
        reason: '缺少本地语音模型，请运行 pnpm voice:setup 后重试。',
      };
    }
  }
  async normalize(audio: Buffer, contentType: string, signal: AbortSignal) {
    const format = formats[contentType.split(';')[0].trim().toLowerCase()];
    if (!format || !audio.length || audio.length > MAX_AUDIO_BYTES)
      throw new SpeechError('音频格式或大小无效。');
    const dir = await mkdtemp(join(tmpdir(), 'voxel-clip-'));
    try {
      const input = join(dir, 'input'),
        output = join(dir, 'audio.wav');
      await writeFile(input, audio, { mode: 0o600 });
      await this.runner(
        this.ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-f',
          format,
          '-i',
          input,
          '-t',
          '21',
          '-vn',
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          output,
        ],
        signal,
        15000,
      );
      const bytes = await readFile(output);
      const durationMs = validatePcmWav(bytes);
      return { bytes, durationMs };
    } catch (error) {
      if (error instanceof SpeechError || signal.aborted) throw error;
      throw new SpeechError(
        '无法处理录音，请检查服务器上的 FFmpeg 或重试。',
        502,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async transcribe(
    audio: Buffer,
    contentType: string,
    language: string,
    signal: AbortSignal,
  ) {
    const format = formats[contentType.split(';')[0].trim().toLowerCase()];
    if (!format)
      throw new SpeechError(
        '不支持的音频格式，请使用 WAV、WebM、MP4 或 Ogg。',
        415,
      );
    if (!audio.length || audio.length > MAX_AUDIO_BYTES)
      throw new SpeechError('音频不能为空且不能超过 5 MiB。', 413);
    if (!['zh', 'en'].includes(language))
      throw new SpeechError('只支持中文或英文识别。');
    if (this.busy)
      throw new SpeechError('服务器正在识别另一段录音，请稍后重试。', 429);
    this.busy = true;
    let dir: string | undefined;
    try {
      const status = await this.status();
      if (!status.available) throw new SpeechError(status.reason, 503);
      signal.throwIfAborted();
      dir = await mkdtemp(join(tmpdir(), 'voxel-speech-'));
      const input = join(dir, 'input'),
        wav = join(dir, 'audio.wav'),
        output = join(dir, 'transcript');
      await writeFile(input, audio, { mode: 0o600 });
      if (format === 'wav') {
        // Direct pass-through for server-standard WAV (16 kHz mono PCM16),
        // so speech works without FFmpeg on this machine.
        validatePcmWav(await readFile(input));
        await writeFile(wav, await readFile(input), { mode: 0o600 });
      } else {
        if (!(await executable(this.ffmpeg)))
          throw new SpeechError(
            '服务器缺少 FFmpeg，无法转换该音频格式，请使用 WAV。',
            415,
          );
        await this.runner(
          this.ffmpeg,
          [
            '-nostdin',
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-f',
            format,
            '-i',
            input,
            '-t',
            '21',
            '-vn',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-c:a',
            'pcm_s16le',
            wav,
          ],
          signal,
          15000,
        );
        validatePcmWav(await readFile(wav));
      }
      await this.runner(
        this.whisper,
        [
          '-m',
          this.model,
          '-f',
          wav,
          '-l',
          'auto',
          '-otxt',
          '-of',
          output,
          '-nt',
          '-np',
          '-t',
          '4',
        ],
        signal,
        90000,
      );
      signal.throwIfAborted();
      const text = (await readFile(`${output}.txt`, 'utf8'))
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || /^\[.*\]$/.test(text))
        throw new SpeechError('没有识别到文字，请重试。');
      if (text.length > 240)
        throw new SpeechError('识别超过 240 字，请分成更短的句子。');
      return text;
    } catch (error) {
      if (error instanceof SpeechError || signal.aborted) throw error;
      throw new SpeechError(
        '服务器识别失败或超时，请使用有效短录音，并检查 Whisper 模型与工具。',
        502,
      );
    } finally {
      try {
        if (dir) await rm(dir, { recursive: true, force: true });
      } finally {
        this.busy = false;
      }
    }
  }
}
