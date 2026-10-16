import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { WorldRoom } from './room';
import { AgentManager, ProviderStore } from './agent-manager';
import { installAgentRoutes } from './agent-routes';
import { installPresenceRoutes } from './presence-routes';
import { Session, until, delay } from '../../agent/src/session';
import { ModelPlanner } from '../../agent/src/deepseek';
import type { ManagedAgentView } from '@voxel/shared';

process.env.DATABASE_URL = '';
process.env.VOICE_PROVIDER = 'mock';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5188';
const preview = process.env.TASK_PREVIEW === '1';
const dir = await mkdtemp(join(tmpdir(), 'voxel-tasks-'));
const app = express(),
  http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http }),
  greet: false,
  gracefullyShutdown: false,
});
server.define('world', WorldRoom);
let manager: AgentManager | undefined,
  human: Session | undefined,
  other: Session | undefined;
let calls = 0;
const prompts: any[] = [];
try {
  await server.listen(preview ? 2578 : 0, '127.0.0.1');
  const listing = await matchMaker.createRoom('world', {});
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.WEB_ORIGIN);
    next();
  });
  app.get('/world', (_req, res) => res.json({ roomId: listing.roomId }));
  installPresenceRoutes(app, () => room.getPresence());
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const store = new ProviderStore(join(dir, 'providers.json'));
  await store.load({ DEEPSEEK_API_KEY: 'fixture-only' });
  const request: typeof fetch = async (_url, init) => {
    calls++;
    const prompt = JSON.parse(
      JSON.parse(init!.body as string).messages[1].content,
    );
    prompts.push(prompt);
    const message = prompt.observation.attention?.data.text ?? '';
    const task = prompt.previous.task;
    let action: any = {
      type: 'wait',
      task: {
        intent: 'continue',
        status: 'completed',
        summary: '检查完成，在线待命。',
      },
    };
    if (message.includes('建造'))
      action = {
        type: 'edit',
        x: 2,
        y: 3,
        z: 1,
        material: 'wood',
        task: {
          intent: 'task',
          status: 'running',
          goal: '在空地放置木方块并确认',
          summary: '开始放置木方块。',
        },
      };
    else if (message === '格式错误测试')
      action = {
        type: 'unsupported',
        task: { intent: 'reply', status: 'completed', summary: '无效动作' },
      };
    else if (message === '到我这里来')
      action = {
        type: 'move',
        x: 1,
        z: 0,
        jump: false,
        durationMs: 300,
        task: {
          intent: 'task',
          goal: '靠近发送者',
          status: 'waiting',
          waitFor: 'world',
          summary: '正在靠近玩家',
        },
      };
    else if (task?.goal === '靠近发送者' && !message)
      action = {
        type: 'chat',
        text: '已检查移动结果。',
        task: {
          intent: 'continue',
          status: 'completed',
          summary: '已检查位置',
        },
      };
    else if (message)
      action = {
        type: 'chat',
        text: '收到，这是一条单次回复。',
        task: {
          intent: 'reply',
          status: 'completed',
          summary: '已回复消息。',
          goal: null,
          waitFor: null,
        },
      };
    else if (task?.goal.includes('木方块'))
      action = {
        type: 'chat',
        text: '木方块已放好。',
        task: {
          intent: 'continue',
          status: 'completed',
          summary: '观察结果确认目标木方块已存在。',
        },
      };
    else if (task?.goal.includes('等待'))
      action = {
        type: 'wait',
        task: {
          intent: 'continue',
          status: 'waiting',
          waitFor: 'world',
          summary: '等待附近方块变化。',
        },
      };
    else if (task?.goal.includes('循环'))
      action = {
        type: 'wait',
        task: {
          intent: 'continue',
          status: 'running',
          summary: '继续下一次检查。',
        },
      };
    else if (task?.goal.includes('慢请求')) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30000);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(Error('aborted'));
          },
          { once: true },
        );
      });
      action = {
        type: 'edit',
        x: 2,
        y: 4,
        z: 1,
        material: 'wood',
        task: { intent: 'continue', status: 'running', summary: '迟到动作' },
      };
    }
    return new Response(
      JSON.stringify({
        usage: { total_tokens: 120 },
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                action: { ...action, task: undefined },
                task: action.task,
              }),
            },
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  const makeManager = () =>
    new AgentManager(store, url.replace('http', 'ws'), {
      session: (url) => new Session(url),
      planner: (config, provider) =>
        new ModelPlanner(config, request, provider),
      models: async () => ['fixture-model'],
    });
  manager = makeManager();
  installAgentRoutes(app, manager);
  const api = async (path: string, method = 'POST', body: unknown = {}) => {
    const response = await fetch(`${url}/agents${path}`, {
      method,
      headers: {
        Origin: process.env.WEB_ORIGIN!,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    assert.equal(
      response.status,
      path === '' ? 201 : 200,
      await response.clone().text(),
    );
    return (await response.json()) as ManagedAgentView;
  };
  const job = await api('', 'POST', {
    providerId: 'deepseek',
    name: '任务测试员',
    goal: '检查附近环境一次',
    maxTurns: 30,
    intervalMs: 1000,
    allowEdits: true,
  });
  const current = () => manager!.list().find((j) => j.id === job.id)!;
  await until(() => current().task?.status === 'completed');
  const identity = current().sessionId;
  assert.equal(calls, 1);
  await delay(1100);
  assert.equal(calls, 1, 'completed task must not poll the model');
  if (preview) {
    await manager.assignTask(job.id, { goal: '等待附近方块变化' });
    await until(() => current().task?.status === 'waiting');
    console.log(
      'Task preview ready at backend 2578. All model responses are local fixtures.',
    );
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } else {
    human = await new Session(url.replace('http', 'ws')).join(
      '任务发起者',
      'human',
    );
    other = await new Session(url.replace('http', 'ws')).join(
      '旁观者',
      'human',
    );
    const say = (text: string) =>
      human!.request('chat', {
        scope: 'private',
        recipients: [identity],
        text,
      });
    await say('你好');
    await until(() => calls === 2 && current().status === 'idle');
    await delay(1100);
    assert.equal(calls, 2, 'private greeting must not trigger 30 calls');
    await say('请建造一个木方块');
    await until(
      () =>
        current().task?.goal.includes('木方块') === true &&
        current().task?.status === 'completed',
    );
    assert.equal(calls, 4, 'one instruction and one follow-up verification');
    assert.equal(room.blocks.get('2,3,1')?.material, 'wood');
    assert.equal(current().sessionId, identity);
    await until(() =>
      human!.events.some((e) => (e.data as any).text === '木方块已放好。'),
    );
    assert(
      !other.events.some((e) => (e.data as any).text === '木方块已放好。'),
      'private task report stays private',
    );
    assert.equal(prompts.at(-1).previous.previous.result.ok, true);
    const beforeFailure = calls;
    await human.request('chat', {
      scope: 'public',
      recipients: [identity],
      text: '格式错误测试',
    });
    await until(
      () => calls === beforeFailure + 1 && current().status === 'idle',
    );
    await until(() =>
      human!.events.some(
        (e) =>
          e.actor === identity &&
          (e.data as any).text?.includes('这条消息处理失败'),
      ),
    );
    assert(
      !other.events.some((e) =>
        (e.data as any).text?.includes('这条消息处理失败'),
      ),
      'failure receipts stay private',
    );
    const oldX = room.state.players.get(identity!)!.x;
    await human.request('chat', {
      scope: 'public',
      recipients: [identity],
      text: '到我这里来',
    });
    await until(
      () =>
        current().task?.goal === '靠近发送者' &&
        current().task?.status === 'completed',
    );
    assert.equal(
      calls,
      beforeFailure + 3,
      'failed mention followed by move and position verification',
    );
    assert(
      room.state.players.get(identity!)!.x > oldX,
      'movement really changes player position',
    );
    assert(
      human.events.some(
        (e) =>
          e.actor === identity &&
          (e.data as any).text?.includes('收到。正在靠近玩家'),
      ),
      'sender receives acknowledgement',
    );
    await api(`/${job.id}/task`, 'POST', { goal: '等待附近方块变化' });
    await until(() => current().task?.status === 'waiting');
    const waitingCalls = calls;
    await delay(2200);
    assert.equal(calls, waitingCalls, 'unchanged world polls use no model');
    await api(`/${job.id}/pause`);
    assert.equal(current().task?.status, 'paused');
    await api(`/${job.id}/resume`);
    await until(
      () => calls === waitingCalls + 1 && current().task?.status === 'waiting',
    );
    await api(`/${job.id}/cancel`);
    assert.equal(current().task?.status, 'cancelled');
    assert.equal(current().sessionId, identity);
    await api(`/${job.id}`, 'PUT', {
      intervalMode: 'random',
      intervalMinMs: 1000,
      intervalMaxMs: 1001,
      maxTurns: 2,
    });
    const beforeLoop = calls;
    await api(`/${job.id}/task`, 'POST', { goal: '循环检查' });
    await until(() => current().task?.status === 'budget');
    assert.equal(
      calls,
      beforeLoop + 2,
      'random polling performs one decision per interval and honors cap',
    );
    await api(`/${job.id}/resume`);
    await until(() => calls === beforeLoop + 3 && current().status === 'idle');
    await api(`/${job.id}/pause`);
    const beforeSlow = calls;
    await api(`/${job.id}/task`, 'POST', { goal: '慢请求测试' });
    await until(() => calls === beforeSlow + 1);
    await say('暂停');
    await until(() => current().task?.status === 'paused');
    assert(
      !room.blocks.has('2,4,1'),
      'cancelled inference cannot execute a late edit',
    );
    assert.equal(current().sessionId, identity);
    const beforeRestore = calls,
      savedTask = current().task;
    await manager.close();
    manager = makeManager();
    await manager.load();
    assert.equal(calls, beforeRestore, 'restore never spends model calls');
    assert.equal(current().task?.goal, savedTask?.goal);
    assert.equal(current().task?.status, 'paused');
    assert(current().usage!.calls >= beforeRestore);
    console.log(
      'PASS: private chat = one call; explicit task advances and verifies real edits; private report isolation; fixed/random one-step polling; unchanged waits cost zero calls; pause/resume/cancel preserve identity; budgets stop loops; chat pause aborts inference; persisted progress restores without inference. No cloud calls.',
    );
  }
} finally {
  await human?.close();
  await other?.close();
  await manager?.close();
  await server.gracefullyShutdown(false);
  await rm(dir, { recursive: true, force: true });
}
