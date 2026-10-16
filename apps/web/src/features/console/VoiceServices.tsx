import { useEffect, useState } from 'react';
import type {
  VoiceServiceDraft,
  VoiceServiceType,
  VoiceServiceView,
} from '@voxel/shared';
import { consoleApi } from './api';
import { VoicePreview } from './VoicePreview';

const labels: Record<VoiceServiceType, string> = {
  local: '本机语音',
  bailian: '百炼语音合成',
  compatible: '兼容语音接口',
};
const fresh = (type: VoiceServiceType = 'local'): VoiceServiceDraft => ({
  name: labels[type],
  type,
  apiKey: '',
  speed: 1,
  baseUrl:
    type === 'bailian'
      ? 'https://dashscope.aliyuncs.com/api/v1'
      : type === 'compatible'
        ? 'https://api.openai.com/v1'
        : '',
  model:
    type === 'bailian'
      ? 'qwen3-tts-flash'
      : type === 'compatible'
        ? 'tts-1'
        : '',
  voice: type === 'bailian' ? 'Cherry' : type === 'compatible' ? 'alloy' : '',
});
export function VoiceServices({
  services,
  onChange,
  active,
}: {
  services: VoiceServiceView[];
  onChange: (list: VoiceServiceView[]) => void;
  active: boolean;
}) {
  const [selected, setSelected] = useState<string | null | undefined>();
  const [draft, setDraft] = useState(fresh);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const saved = services.find((s) => s.id === selected);
  const choose = (service?: VoiceServiceView) => {
    setSelected(service?.id ?? null);
    setDraft(service ? { ...service, apiKey: '' } : fresh());
    setDirty(!service);
    setNotice('');
    setError('');
  };
  useEffect(() => {
    if (selected === undefined && services.length) choose(services[0]);
  }, [services, selected]);
  const change = (patch: Partial<VoiceServiceDraft>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
    setNotice('');
    setError('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await consoleApi.saveVoiceService(
        draft,
        selected ?? undefined,
      );
      onChange(
        selected
          ? services.map((s) => (s.id === selected ? value : s))
          : [...services, value],
      );
      choose(value);
      setNotice('已保存。可在这里试听，或在创建 Agent 时选择此服务。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await consoleApi.deleteVoiceService(selected);
      const next = services.filter((s) => s.id !== selected);
      onChange(next);
      choose(next[0]);
      setNotice('语音服务已删除。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="voice-services-layout">
      <aside className="agent-sidebar" aria-label="语音服务列表">
        <h3>已保存的语音服务</h3>
        {services.map((service) => (
          <button
            key={service.id}
            aria-pressed={selected === service.id}
            disabled={busy}
            onClick={() => choose(service)}
          >
            {service.name}
            <small>
              {labels[service.type]} · 语音合成
              <br />
              {service.voice || '自动选择音色'}
            </small>
          </button>
        ))}
        <button disabled={busy} onClick={() => choose()}>
          ＋ 添加语音服务
        </button>
        <p>同一服务商可保存多份音色配置，供不同 Agent 复用。</p>
      </aside>
      <div className="agent-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>{selected ? '编辑语音服务' : '添加语音服务'}</h3>
          <p className="agent-hint">
            将 Agent 的文字回复合成为声音；回复内容仍由 Agent 的思考模型决定。
          </p>
          {error && (
            <p className="agent-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="agent-notice" role="status">
              {notice}
            </p>
          )}
          <fieldset disabled={busy}>
            <label>
              服务名称
              <input
                required
                maxLength={50}
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              服务类型
              <select
                value={draft.type}
                onChange={(e) => {
                  setDraft({
                    ...fresh(e.target.value as VoiceServiceType),
                    name: draft.name,
                  });
                  setDirty(true);
                }}
              >
                {Object.entries(labels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.type !== 'local' && (
              <>
                <label>
                  API Base URL
                  {draft.type === 'bailian' ? (
                    <select
                      value={draft.baseUrl}
                      onChange={(e) => change({ baseUrl: e.target.value })}
                    >
                      <option value="https://dashscope.aliyuncs.com/api/v1">
                        北京 · dashscope.aliyuncs.com
                      </option>
                      <option value="https://dashscope-intl.aliyuncs.com/api/v1">
                        新加坡 · dashscope-intl.aliyuncs.com
                      </option>
                    </select>
                  ) : (
                    <input
                      type="url"
                      required
                      value={draft.baseUrl}
                      onChange={(e) => change({ baseUrl: e.target.value })}
                    />
                  )}
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={draft.apiKey}
                    placeholder={
                      saved?.hasApiKey ? '已配置，留空保留' : '填写服务密钥'
                    }
                    onChange={(e) => change({ apiKey: e.target.value })}
                  />
                </label>
                <label>
                  语音模型
                  <input
                    required
                    maxLength={128}
                    value={draft.model}
                    onChange={(e) => change({ model: e.target.value })}
                  />
                </label>
                <small>
                  密钥仅保存在服务端。更换接口地址或服务类型时需重新填写。
                </small>
              </>
            )}
            <label>
              音色
              <input
                required={draft.type !== 'local'}
                maxLength={100}
                value={draft.voice}
                placeholder={
                  draft.type === 'local'
                    ? '留空按中英文自动选择，或填 Tingting / Samantha'
                    : '服务支持的音色 ID'
                }
                onChange={(e) => change({ voice: e.target.value })}
              />
            </label>
            {draft.type !== 'bailian' && (
              <label>
                语速（0.5–2 倍）
                <input
                  type="number"
                  required
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={Number.isNaN(draft.speed) ? '' : draft.speed}
                  onChange={(e) => change({ speed: e.target.valueAsNumber })}
                />
              </label>
            )}
            {draft.type === 'local' && (
              <p className="agent-hint">
                使用服务器上的 macOS say 与
                ffmpeg，合成的声音发送给玩家，不从服务器扬声器播放。
              </p>
            )}
            {draft.type === 'bailian' && (
              <p className="agent-hint">
                使用百炼 Qwen-TTS 语音合成接口；音色须与所选模型匹配。
              </p>
            )}
            <div className="voice-service-actions">
              <button className="primary" disabled={!dirty}>
                {busy ? '保存中…' : '保存服务'}
              </button>
              {selected && (
                <button type="button" onClick={() => void remove()}>
                  删除服务
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {dirty && <p className="agent-hint">请先保存修改，再试听当前配置。</p>}
        <VoicePreview
          serviceId={selected ?? undefined}
          active={active}
          disabled={dirty || busy}
        />
      </div>
    </div>
  );
}
