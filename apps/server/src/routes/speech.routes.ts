import express, { type Express, type ErrorRequestHandler } from 'express';
import {
  LocalSpeech,
  SpeechError,
  MAX_AUDIO_BYTES,
} from '../audio/local-speech';
import { createVoiceProvider } from '../audio/voice';
import { LocalTts } from '../audio/local-tts';
import { scheduleSpeech } from '../audio/speech-scheduler';
import { transcribeWithBailian } from '../audio/bailian-asr';
import { AsrSettingsStore, maskBailianSettings } from '../audio/asr-settings';
export function installSpeechRoutes(app: Express, speech = new LocalSpeech(), asr = new AsrSettingsStore()) {
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  app.use('/voice', (req, res, next) => {
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      res.status(403).json({ error: '不允许此页面访问服务器语音服务。' });
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
    const bailian = await asr.get();
    res.json({
      local: await speech.status(),
      ollamaConfigured,
      agentSpeech: await new LocalTts().status(),
      bailian: {
        engine: 'bailian',
        available: !!bailian,
        settings: maskBailianSettings(bailian),
      },
    });
  });
  app.get('/voice/asr/settings', async (_req, res) => {
    res.json({ settings: maskBailianSettings(await asr.get()) });
  });
  app.put(
    '/voice/asr/settings',
    express.json({ limit: '16kb' }),
    async (req, res) => {
      try {
        const previous = await asr.get();
        const next = await asr.set({ ...previous, ...req.body });
        res.json({ ok: true, settings: maskBailianSettings(next) });
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : '配置无效。' });
      }
    },
  );
  app.delete('/voice/asr/settings', async (_req, res) => {
    await asr.clear();
    res.json({ ok: true });
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
      let language = String(req.query.language ?? 'zh');
      if (language !== 'en' && language !== 'auto') {
        language = 'zh';
      }
      try {
        if (req.query.engine === 'bailian') {
          const bailian = await asr.get();
          if (!bailian)
            throw new SpeechError(
              '尚未配置阿里云百炼识别，请先在设置里填写并保存。',
              400,
            );
          const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
          const { text } = await transcribeWithBailian(bytes, language, bailian);
          if (!controller.signal.aborted) res.json({ text });
        } else {
          const text = await scheduleSpeech(speech).transcribe(
            Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
            req.headers['content-type'] ?? '',
            language,
            controller.signal,
            req.query.partial === '1',
          );
          if (!controller.signal.aborted) res.json({ text });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          res.status(error instanceof SpeechError ? error.status : 500).json({
            error:
              error instanceof SpeechError
                ? error.message
                : '服务器识别失败，请重试。',
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
