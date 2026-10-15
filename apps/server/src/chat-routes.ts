import express, { type Express, type ErrorRequestHandler } from 'express';
import { ChatError, type WorldChat } from './chat';
import { LocalSpeech, SpeechError } from './local-speech';
export function installChatRoutes(
  app: Express,
  getChat: () => WorldChat | undefined,
  speech = new LocalSpeech(),
) {
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  app.use('/chat', (req, res, next) => {
    if (req.headers.origin !== origin) {
      res.status(403).json({ error: '不允许此页面访问聊天音频。' });
      return;
    }
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Cache-Control', 'no-store');
    res.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.sendStatus(204);
      return;
    }
    try {
      const chat = getChat();
      if (!chat) throw new ChatError('世界服务尚未就绪。', 503);
      res.locals.chat = chat;
      res.locals.actor = chat.authenticate(
        (req.headers.authorization ?? '').replace(/^Bearer /, ''),
      );
      next();
    } catch (e) {
      next(e);
    }
  });
  app.post(
    '/chat/audio',
    express.raw({ type: () => true, limit: '1mb' }),
    async (req, res, next) => {
      const chat = res.locals.chat as WorldChat,
        actor = res.locals.actor as string;
      const route = {
        scope: req.query.scope,
        recipients:
          typeof req.query.to === 'string' && req.query.to
            ? req.query.to.split(',')
            : [],
      };
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on('close', cancel);
      let started = false;
      try {
        chat.beginUpload(actor, route);
        started = true;
        const normalized = await speech.normalize(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers['content-type'] ?? '',
          abort.signal,
        );
        let text = '';
        try {
          text = await speech.transcribe(
            normalized.bytes,
            'audio/wav',
            req.query.language === 'en' ? 'en' : 'zh',
            abort.signal,
          );
        } catch {
          abort.signal.throwIfAborted();
        }
        abort.signal.throwIfAborted();
        chat.authenticate(
          (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        res
          .status(201)
          .json(
            chat.publishAudio(
              actor,
              route,
              normalized.bytes,
              normalized.durationMs,
              text,
            ),
          );
      } catch (e) {
        if (!abort.signal.aborted) next(e);
      } finally {
        if (started) chat.endUpload(actor);
        res.off('close', cancel);
      }
    },
  );
  app.post('/chat/spatial/start', (req, res, next) => {
    try {
      res.json({
        id: (res.locals.chat as WorldChat).beginSpatial(res.locals.actor),
      });
    } catch (e) {
      next(e);
    }
  });
  app.delete('/chat/spatial/:id', (req, res) => {
    (res.locals.chat as WorldChat).endSpatial(
      res.locals.actor,
      String(req.params.id),
    );
    res.sendStatus(204);
  });
  app.post(
    '/chat/spatial/:id',
    express.raw({ type: () => true, limit: '1mb' }),
    async (req, res, next) => {
      const chat = res.locals.chat as WorldChat,
        actor = res.locals.actor as string,
        id = String(req.params.id);
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on('close', cancel);
      try {
        const signal = AbortSignal.any([
          abort.signal,
          chat.claimSpatial(actor, id),
        ]);
        const text = await speech.transcribe(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers['content-type'] ?? '',
          'zh',
          signal,
        );
        signal.throwIfAborted();
        chat.authenticate(
          (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        res.json(chat.publishSpatial(actor, id, text));
      } catch (e) {
        if (!abort.signal.aborted) next(e);
      } finally {
        chat.endSpatial(actor, id);
        res.off('close', cancel);
      }
    },
  );
  app.get('/chat/audio/:id', (req, res, next) => {
    try {
      res
        .type('audio/wav')
        .send(
          (res.locals.chat as WorldChat).audio(
            String(req.params.id),
            res.locals.actor,
          ),
        );
    } catch (e) {
      next(e);
    }
  });
  const errors: ErrorRequestHandler = (e, _req, res, _next) =>
    res
      .status(
        e instanceof ChatError || e instanceof SpeechError
          ? e.status
          : e.type === 'entity.too.large'
            ? 413
            : 400,
      )
      .json({
        error:
          e instanceof ChatError || e instanceof SpeechError
            ? e.message
            : '无法处理语音消息，请检查输入。',
      });
  app.use('/chat', errors);
}
