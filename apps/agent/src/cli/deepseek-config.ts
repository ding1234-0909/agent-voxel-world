import type { AgentConfig } from '@voxel/agent-runtime';

export function agentConfig(env = process.env): AgentConfig {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw Error('请在项目 .env 或环境变量中设置 DEEPSEEK_API_KEY。');
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw Error(`${key} 必须是 ${min}–${max} 之间的整数。`);
    return value;
  };
  if (
    env.AGENT_ALLOW_EDITS &&
    !['true', 'false'].includes(env.AGENT_ALLOW_EDITS)
  )
    throw Error('AGENT_ALLOW_EDITS 仅支持 true 或 false。');
  if (env.AGENT_CONTINUOUS && !['true', 'false'].includes(env.AGENT_CONTINUOUS))
    throw Error('AGENT_CONTINUOUS 仅支持 true 或 false。');
  const intervalMode = env.AGENT_INTERVAL_MODE ?? 'fixed';
  if (intervalMode !== 'fixed' && intervalMode !== 'random')
    throw Error('AGENT_INTERVAL_MODE 仅支持 fixed 或 random。');
  const intervalMinMs = integer('AGENT_INTERVAL_MIN_MS', 4000, 1000, 60000);
  const intervalMaxMs = integer('AGENT_INTERVAL_MAX_MS', 8000, 1000, 60000);
  if (intervalMinMs > intervalMaxMs) throw Error('随机间隔下限不能大于上限。');
  const thinking = env.DEEPSEEK_THINKING ?? 'disabled';
  if (thinking !== 'enabled' && thinking !== 'disabled')
    throw Error('DEEPSEEK_THINKING 仅支持 enabled 或 disabled。');
  const reasoningEffort = env.DEEPSEEK_REASONING_EFFORT ?? 'high';
  if (!['none', 'low', 'high', 'max'].includes(reasoningEffort))
    throw Error('DEEPSEEK_REASONING_EFFORT 仅支持 none、low、high 或 max。');
  const model = env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash';
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model))
    throw Error('DEEPSEEK_MODEL 格式无效。');
  const goal =
    env.AGENT_GOAL?.trim() ||
    '探索附近环境，用中文简短介绍你的观察，友好回应附近玩家，不要反复发送相同消息。';
  if (goal.length > 2000) throw Error('AGENT_GOAL 最多 2000 字。');
  return {
    apiKey,
    continuous: env.AGENT_CONTINUOUS === 'true',
    intervalMode,
    intervalMinMs,
    intervalMaxMs,
    thinking,
    reasoningEffort: reasoningEffort as AgentConfig['reasoningEffort'],
    maxTokens: integer(
      'DEEPSEEK_MAX_TOKENS',
      thinking === 'enabled' ? 4096 : 512,
      128,
      16384,
    ),
    model,
    goal,
    name: (env.AGENT_NAME?.trim() || 'DeepSeek · AI').slice(0, 24),
    allowEdits: env.AGENT_ALLOW_EDITS === 'true',
    voiceReplies: env.AGENT_VOICE_REPLIES === 'true',
    maxTurns: integer('AGENT_MAX_TURNS', 100, 1, 200),
    tokenBudget: integer('AGENT_TOKEN_BUDGET', 50000, 1000, 1000000),
    taskTimeoutMs: integer('AGENT_TASK_TIMEOUT_MS', 900000, 1000, 7200000),
    intervalMs: integer('AGENT_INTERVAL_MS', 3000, 1000, 60000),
    timeoutMs: integer('DEEPSEEK_TIMEOUT_MS', 30000, 1000, 120000),
  };
}
