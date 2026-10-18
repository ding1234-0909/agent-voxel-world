import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { VoiceServiceStore } from '../audio/voice-services';

/**
 * /tts — server-side speech synthesis for the companion characters.
 * Uses the same local macOS `say` pipeline that powers agent voice replies
 * (verified working), so it does not depend on the browser's SpeechSynthesis
 * API, which can be silent in embedded browsers without system voices.
 * Output: audio/wav bytes. Responses are cached by the client.
 */
export function installTtsRoutes(app: Express, voiceServices: VoiceServiceStore) {
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
    };

  app.get(
    '/tts',
    route(async (req, res) => {
      const text = String(req.query.text ?? '').trim().slice(0, 240);
      if (!text)
        return res.status(400).json({ error: '请提供要朗读的文本。' });
      try {
        const { bytes } = await voiceServices.synthesize(
          'local-default',
          text,
          new AbortController().signal,
        );
        res.set('Content-Type', 'audio/wav');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('X-Duration-Ms', '');
        res.send(bytes);
      } catch (error) {
        const status =
          typeof (error as { status?: unknown }).status === 'number'
            ? (error as { status: number }).status
            : 500;
        res.status(status).json({
          error: status === 503
            ? '本机语音合成不可用（需要 macOS say 与 ffmpeg）。'
            : '语音合成失败。',
        });
      }
    }),
  );
}
