import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Session } from './session';
import {
  agentConfig,
  DeepSeekPlanner,
  DeepSeekError,
  runAgent,
} from './deepseek';

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const abort = new AbortController();
let session: Session | undefined;
const stop = () => {
  abort.abort();
  // Close immediately even while an observation or join is awaiting a reply.
  void session?.close().catch(() => session?.room?.connection.close());
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const config = agentConfig();
  console.log(
    `DeepSeek AI 玩家 · ${config.model} · 任务驱动 · 保护上限 ${config.maxTurns} 次调用 · 方块修改${config.allowEdits ? '开启' : '关闭'}`,
  );
  console.log(
    '附近方块、玩家昵称、聊天事件及 Agent 目标将发送至 DeepSeek API。Ctrl+C 退出。',
  );
  session = new Session();
  await session.join(config.name, 'ai-agent');
  if (
    !abort.signal.aborted &&
    (await session.observe()).self.kind !== 'ai-agent'
  )
    throw new DeepSeekError(
      '当前世界服务尚未加载 AI 玩家支持，请使用最新代码重启世界服务后再运行。',
      true,
    );
  if (!abort.signal.aborted)
    await session.request('agent.voice', { enabled: !!config.voiceReplies });
  await runAgent(session, new DeepSeekPlanner(config), config, abort.signal);
} catch (error) {
  if (!abort.signal.aborted) {
    console.error(
      error instanceof DeepSeekError || !session
        ? (error as Error).message
        : '无法连接世界或运行 Agent，请确认 SERVER_URL 和世界服务。',
    );
    process.exitCode = 1;
  }
} finally {
  abort.abort();
  await session?.close().catch(() => session?.room?.connection.close());
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
