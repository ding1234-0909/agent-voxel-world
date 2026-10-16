import type { ProviderType, ProviderView } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';
import { freshProvider } from './model';

type Props = Pick<
  ConsoleController,
  | 'providers'
  | 'editing'
  | 'draft'
  | 'setDraft'
  | 'busy'
  | 'editingProvider'
  | 'editProvider'
  | 'saveProvider'
  | 'removeProvider'
>;
export function ProviderEditor({
  providers,
  editing,
  draft,
  setDraft,
  busy,
  editingProvider,
  editProvider,
  saveProvider,
  removeProvider,
}: Props) {
  return (
    <div className="agent-columns">
      <aside className="agent-sidebar">
        <h3>已保存的服务商</h3>
        {providers.map((p) => (
          <button
            key={p.id}
            aria-pressed={editing === p.id}
            onClick={() => editProvider(p)}
            disabled={busy}
          >
            {p.name}
            <small>
              {p.type === 'ollama'
                ? '本机 · 无需密钥'
                : p.hasApiKey
                  ? '密钥已配置'
                  : '尚未配置密钥'}{' '}
              · {p.defaultModel || '未设默认模型'}
            </small>
          </button>
        ))}
        <button onClick={() => editProvider()} disabled={busy}>
          ＋ 添加服务商
        </button>
        <p>
          密钥仅保存在本机服务端，不会返回到浏览器。已有环境变量会在首次启动时导入。
        </p>
      </aside>
      <form onSubmit={saveProvider} className="agent-form">
        <h3>{editing ? '编辑服务商' : '添加模型服务商'}</h3>
        <fieldset disabled={busy}>
          <label>
            服务商类型
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft(freshProvider(e.target.value as ProviderType))
              }
            >
              <option value="deepseek">DeepSeek</option>
              <option value="ollama">本机 Ollama</option>
              <option value="compatible">OpenAI 兼容服务</option>
            </select>
          </label>
          <label>
            服务商名称
            <input
              value={draft.name}
              required
              maxLength={50}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            API Base URL
            <input
              type="url"
              value={draft.baseUrl}
              required
              placeholder="https://api.example.com/v1"
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </label>
          {draft.type !== 'ollama' && (
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={draft.apiKey}
                placeholder={
                  editingProvider?.hasApiKey
                    ? '已配置，留空保持现有密钥'
                    : '输入服务商 API Key'
                }
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
            </label>
          )}
          <label>
            默认模型 ID
            <input
              value={draft.defaultModel}
              maxLength={128}
              placeholder="填写该服务商支持的模型 ID"
              onChange={(e) =>
                setDraft({ ...draft, defaultModel: e.target.value })
              }
            />
          </label>
          <details>
            <summary>接口兼容设置</summary>
            <label className="agent-check">
              <input
                type="checkbox"
                checked={draft.jsonMode}
                onChange={(e) =>
                  setDraft({ ...draft, jsonMode: e.target.checked })
                }
              />
              请求 JSON 输出模式
            </label>
            <label>
              输出长度参数
              <select
                value={draft.tokenField}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    tokenField: e.target.value as ProviderView['tokenField'],
                  })
                }
              >
                <option>max_tokens</option>
                <option>max_completion_tokens</option>
              </select>
            </label>
          </details>
          <p className="agent-hint">
            支持 OpenAI Chat Completions
            兼容接口。保存配置不会启动推理；新建或继续运行 Agent
            时使用最新配置。
          </p>
          <div className="agent-actions">
            <button className="primary">
              {busy ? '保存中…' : '保存服务商'}
            </button>
            {editing && (
              <button type="button" onClick={() => void removeProvider()}>
                删除服务商
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
