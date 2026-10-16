import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { AgentManager, ManagementError } from '../agent/manager';
export function installAgentRoutes(app: Express, manager: AgentManager) {
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  app.use(
    '/agents',
    (req, res, next) => {
      // These local controls can spend API credit. Require the configured page origin.
      if (req.headers.origin !== origin) {
        res.status(403).json({ error: '仅允许配置的本机游戏页面管理 Agent。' });
        return;
      }
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Cache-Control', 'no-store');
      if (req.method === 'OPTIONS') {
        res.header(
          'Access-Control-Allow-Methods',
          'GET, POST, PUT, DELETE, OPTIONS',
        );
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        res.sendStatus(204);
        return;
      }
      if (['POST', 'PUT'].includes(req.method) && !req.is('application/json')) {
        res.status(415).json({ error: '请使用 JSON 请求。' });
        return;
      }
      next();
    },
    express.json({ limit: '32kb' }),
  );
  const route =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
    };
  app.get(
    '/agents/providers',
    route((_req, res) => res.json(manager.providers.list())),
  );
  app.post(
    '/agents/providers',
    route(async (req, res) =>
      res.status(201).json(await manager.providers.save(req.body)),
    ),
  );
  app.put(
    '/agents/providers/:id',
    route(async (req, res) =>
      res.json(await manager.providers.save(req.body, String(req.params.id))),
    ),
  );
  app.delete(
    '/agents/providers/:id',
    route(async (req, res) => {
      await manager.removeProvider(String(req.params.id));
      res.sendStatus(204);
    }),
  );
  app.get(
    '/agents/providers/:id/models',
    route(async (req, res) =>
      res.json({ models: await manager.models(String(req.params.id)) }),
    ),
  );
  app.get(
    '/agents',
    route((_req, res) => res.json(manager.list())),
  );
  app.post(
    '/agents',
    route((req, res) => res.status(201).json(manager.create(req.body))),
  );
  for (const operation of ['pause', 'cancel'] as const)
    app.post(
      `/agents/:id/${operation}`,
      route(async (req, res) =>
        res.json(await manager.controlTask(String(req.params.id), operation)),
      ),
    );
  app.post(
    '/agents/:id/task',
    route(async (req, res) =>
      res.json(await manager.assignTask(String(req.params.id), req.body)),
    ),
  );
  app.post(
    '/agents/:id/voice',
    route(async (req, res) =>
      res.json(await manager.setVoice(String(req.params.id), req.body)),
    ),
  );
  app.post(
    '/agents/:id/resume',
    route((req, res) =>
      res.json(manager.resume(String(req.params.id), req.body)),
    ),
  );
  app.put(
    '/agents/:id',
    route(async (req, res) =>
      res.json(await manager.update(String(req.params.id), req.body)),
    ),
  );
  app.post(
    '/agents/:id/stop',
    route((req, res) => res.json(manager.stop(String(req.params.id)))),
  );
  app.use('/agents', (_req, res) => {
    res.status(404).json({ error: 'Agent 接口不存在，请确认前后端版本一致。' });
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ManagementError)
      res.status(error.status).json({ error: error.message });
    else
      res
        .status(
          error.type === 'entity.too.large'
            ? 413
            : error instanceof SyntaxError
              ? 400
              : 500,
        )
        .json({ error: '无法处理请求，请检查输入或本机配置文件权限。' });
  };
  app.use('/agents', errors);
}
