import { AgentAdvancedSettings } from './AgentAdvancedSettings';
import type { AgentSettings } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';

type Props = Pick<
  ConsoleController,
  | 'providers'
  | 'agent'
  | 'setAgent'
  | 'editingAgent'
  | 'setShowAgentForm'
  | 'models'
  | 'busy'
  | 'loadingModels'
  | 'setNotice'
  | 'setError'
  | 'selected'
  | 'chooseProvider'
  | 'readModels'
  | 'saveAgent'
>;
export function AgentForm({
  providers,
  agent,
  setAgent,
  editingAgent,
  setShowAgentForm,
  models,
  busy,
  loadingModels,
  setNotice,
  setError,
  selected,
  chooseProvider,
  readModels,
  saveAgent,
}: Props) {
  return (
    <div className="agent-editor">
      <button
        className="agent-back"
        type="button"
        disabled={busy}
        onClick={() => {
          setShowAgentForm(false);
          setError('');
          setNotice('');
        }}
      >
        ‹ 返回 Agent 列表
      </button>
      <form
        className="agent-form"
        onSubmit={(e) => {
          e.preventDefault();
          void saveAgent();
        }}
      >
        <h3>{editingAgent ? '修改 Agent 参数' : '创建 Agent 玩家'}</h3>
        {editingAgent && (
          <p className="agent-hint">
            保存不会启动任务，角色与位置保留。运行中的 Agent
            请先暂停任务再修改。
          </p>
        )}
        <fieldset disabled={busy}>
          <h4 className="agent-section-title">基本信息</h4>
          <div className="agent-grid">
            <label>
              选择服务商
              <select
                required
                value={agent.providerId}
                onChange={(e) => chooseProvider(e.target.value)}
              >
                <option value="" disabled>
                  请先添加服务商
                </option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.type !== 'ollama' && !p.hasApiKey ? ' · 未配置密钥' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              选择模型
              <input
                list="agent-models"
                required
                value={agent.model}
                maxLength={128}
                placeholder="获取模型列表，或输入模型 ID"
                onChange={(e) => setAgent({ ...agent, model: e.target.value })}
              />
              <datalist id="agent-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>
          <button
            className="agent-model-test"
            type="button"
            disabled={!selected || loadingModels}
            onClick={() => void readModels(agent.providerId)}
          >
            {loadingModels ? '连接中…' : '测试连接 / 获取模型列表'}
          </button>
          <label>
            Agent 昵称
            <input
              required
              maxLength={24}
              value={agent.name}
              onChange={(e) => setAgent({ ...agent, name: e.target.value })}
            />
          </label>
          <label>
            任务目标
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={agent.goal}
              onChange={(e) => setAgent({ ...agent, goal: e.target.value })}
            />
            <small className="agent-hint">
              填写希望 Agent
              完成的目标；具体方案和执行情况会显示在卡片的“最近执行进展”中。
            </small>
          </label>
          <h4 className="agent-section-title">运行安排</h4>
          <p className="agent-hint">
            任务按实际进展继续，完成、受阻或需要确认时自动停下；达到保护预算也会暂停。普通聊天只回复一次。
          </p>
          <label>
            轮询方式
            <select
              value={agent.intervalMode}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  intervalMode: e.target.value as AgentSettings['intervalMode'],
                })
              }
            >
              <option value="fixed">固定间隔</option>
              <option value="random">随机区间</option>
            </select>
          </label>
          {agent.intervalMode === 'fixed' ? (
            <label>
              唤醒间隔（毫秒）
              <input
                type="number"
                min={1000}
                max={60000}
                required
                value={Number.isNaN(agent.intervalMs) ? '' : agent.intervalMs}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    intervalMs: e.target.valueAsNumber,
                  })
                }
              />
            </label>
          ) : (
            <div className="agent-grid">
              <label>
                间隔下限（毫秒）
                <input
                  type="number"
                  min={1000}
                  max={agent.intervalMaxMs || 60000}
                  required
                  value={
                    Number.isNaN(agent.intervalMinMs) ? '' : agent.intervalMinMs
                  }
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      intervalMinMs: e.target.valueAsNumber,
                    })
                  }
                />
              </label>
              <label>
                间隔上限（毫秒）
                <input
                  type="number"
                  min={agent.intervalMinMs || 1000}
                  max={60000}
                  required
                  value={
                    Number.isNaN(agent.intervalMaxMs) ? '' : agent.intervalMaxMs
                  }
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      intervalMaxMs: e.target.valueAsNumber,
                    })
                  }
                />
              </label>
            </div>
          )}
          <p className="agent-hint">
            每次间隔只推进一次决策。等待期间先在本地检查环境，空闲或条件未变时不调用模型。新消息及时唤醒，同一
            Agent 不并发推理。
          </p>
          <AgentAdvancedSettings
            agent={agent}
            setAgent={setAgent}
            selected={selected}
          />
          <label className="agent-check">
            <input
              type="checkbox"
              checked={agent.allowEdits}
              onChange={(e) =>
                setAgent({ ...agent, allowEdits: e.target.checked })
              }
            />
            允许放置 / 移除方块
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={!!agent.voiceReplies}
              onChange={(e) =>
                setAgent({ ...agent, voiceReplies: e.target.checked })
              }
            />
            语音回复（附近玩家可听见）
          </label>
          <p className="agent-hint">
            使用服务器本机语音合成；私聊仅指定接收者可听，玩家需开启附近语音收听。
          </p>
          <p className="agent-hint">
            {editingAgent
              ? '保存后保持当前状态，下次运行使用新参数。'
              : '创建后加入世界并开始任务。'}
            云端模型按服务商规则计费。
          </p>
          <div className="agent-editor-actions">
            <button
              type="button"
              onClick={() => {
                setShowAgentForm(false);
                setError('');
                setNotice('');
              }}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={
                !selected || (selected.type !== 'ollama' && !selected.hasApiKey)
              }
            >
              {busy ? '处理中…' : editingAgent ? '保存参数' : '创建并加入世界'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
