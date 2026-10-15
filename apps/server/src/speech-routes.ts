import express, { type Express, type ErrorRequestHandler } from 'express';
import { LocalSpeech, SpeechError, MAX_AUDIO_BYTES } from './local-speech';
import { createVoiceProvider } from './voice';
import { LocalTts } from './local-tts';
export function installSpeechRoutes(app: Express, speech = new LocalSpeech()) {
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  app.use('/voice', (req, res, next) => {
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      res.status(403).json({ error: '不允许此页面访问本机语音服务。' });
      return;
    }
    res.header('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.status(204).end();
      return;
    }
    next();
  });
  app.get('/voice/capabilities', async (_req, res) => {
    let ollamaConfigured = false;
    try {
      createVoiceProvider('ollama');
      ollamaConfigured = true;
    } catch {
      /* Optional. */
    }
    res.json({
      local: await speech.status(),
      ollamaConfigured,
      agentSpeech: await new LocalTts().status(),
    });
  });
  app.post(
    '/voice/transcribe',
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      const controller = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', cancel);
      try {
        const text = await speech.transcribe(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers['content-type'] ?? '',
          String(req.query.language ?? 'zh'),
          controller.signal,
        );
        if (!controller.signal.aborted) res.json({ text });
      } catch (error) {
        if (!controller.signal.aborted)
          res.status(error instanceof SpeechError ? error.status : 500).json({
            error:
              error instanceof SpeechError
                ? error.message
                : '本机识别失败，请重试。',
          });
      } finally {
        res.off('close', cancel);
      }
    },
  );
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    res
      .status(error.type === 'entity.too.large' ? 413 : 400)
      .json({ error: '无法读取音频，请使用不超过 5 MiB 的文件。' });
  };
  app.use('/voice', handleError);
}
