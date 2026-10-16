import type { AgentSettings } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';

type Props = Pick<ConsoleController, 'agent' | 'setAgent' | 'selected'>;
export function AgentAdvancedSettings({ agent, setAgent, selected }: Props) {
  return (
    <details>
      <summary>高级参数 · 预算保护与推理</summary>
      <p className="agent-hint">
        以下为异常保护上限，不是要求执行的轮数。达到上限会暂停，手动继续才会开启新的预算额度。
      </p>
      <div className="agent-grid">
        <label>
          任务调用上限
          <input
            type="number"
            min={1}
            max={200}
            required
            value={agent.maxTurns}
            onChange={(e) =>
              setAgent({
                ...agent,
                maxTurns: e.target.valueAsNumber,
              })
            }
          />
        </label>
        <label>
          任务 token 预算
          <input
            type="number"
            min={1000}
            max={1000000}
            required
            value={agent.tokenBudget ?? 50000}
            onChange={(e) =>
              setAgent({
                ...agent,
                tokenBudget: e.target.valueAsNumber,
              })
            }
          />
        </label>
        <label>
          任务执行时间上限（分钟）
          <input
            type="number"
            min={1}
            max={120}
            required
            value={(agent.taskTimeoutMs ?? 900000) / 60000}
            onChange={(e) =>
              setAgent({
                ...agent,
                taskTimeoutMs: e.target.valueAsNumber * 60000,
              })
            }
          />
        </label>
      </div>
      <div className="agent-grid">
        <label>
          请求超时（毫秒）
          <input
            type="number"
            min={1000}
            max={120000}
            step={1000}
            required
            value={agent.timeoutMs}
            onChange={(e) =>
              setAgent({
                ...agent,
                timeoutMs: e.target.valueAsNumber,
              })
            }
          />
        </label>
        <label>
          最大输出 tokens
          <input
            type="number"
            min={128}
            max={16384}
            required
            value={agent.maxTokens}
            onChange={(e) =>
              setAgent({
                ...agent,
                maxTokens: e.target.valueAsNumber,
              })
            }
          />
        </label>
      </div>
      {selected?.type === 'deepseek' && (
        <div className="agent-grid">
          <label>
            思考模式
            <select
              value={agent.thinking}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  thinking: e.target.value as AgentSettings['thinking'],
                  maxTokens: e.target.value === 'enabled' ? 4096 : 512,
                })
              }
            >
              <option value="disabled">关闭</option>
              <option value="enabled">开启</option>
            </select>
          </label>
          <label>
            推理强度
            <select
              disabled={agent.thinking !== 'enabled'}
              value={agent.reasoningEffort}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  reasoningEffort: e.target
                    .value as AgentSettings['reasoningEffort'],
                })
              }
            >
              {['none', 'low', 'high', 'max'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </details>
  );
}
