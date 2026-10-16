import type { ComponentProps } from 'react';
import { VoicePanel } from '../voice/VoicePanel';
import { useConsoleController } from './useConsoleController';
import { isActive } from './model';
import { ProviderEditor } from './ProviderEditor';
import { AgentForm } from './AgentForm';
import { AgentList } from './AgentList';
type ConsoleProps = Omit<
  ComponentProps<typeof VoicePanel>,
  'hidden' | 'onClose'
> & { open: boolean; initialTab?: 'agents'; onClose: () => void };
export function ControlConsole({
  open,
  initialTab,
  onClose,
  ...voiceProps
}: ConsoleProps) {
  const controller = useConsoleController(open, initialTab);
  const {
    dialog,
    tab,
    setTab,
    providers,
    jobs,
    showAgentForm,
    setShowAgentForm,
    body,
    notice,
    setNotice,
    error,
    setError,
    selected,
    editProvider,
  } = controller;
  return (
    <dialog
      ref={dialog}
      id="control-console"
      className="agent-dialog"
      aria-labelledby="agent-title"
      onCancel={onClose}
    >
      <div className="agent-chrome">
        <div className="agent-heading">
          <div>
            <div className="eyebrow">WORLD CONSOLE</div>
            <h2 id="agent-title">控制台</h2>
            <p>管理 AI 伙伴、连接模型服务，设置语音交流。</p>
          </div>
          <button type="button" aria-label="关闭控制台" onClick={onClose}>
            关闭 ×
          </button>
        </div>
        <nav className="agent-tabs" aria-label="控制台分类">
          <button
            aria-pressed={tab === 'agents'}
            onClick={() => {
              setTab('agents');
              setShowAgentForm(false);
              setError('');
              setNotice('');
            }}
          >
            Agent 玩家{' '}
            <small>
              {
                jobs.filter((j) => isActive(j) || j.task?.status === 'running')
                  .length
              }{' '}
              运行中 ·{' '}
              {
                jobs.filter(
                  (j) => j.status === 'idle' && j.task?.status !== 'running',
                ).length
              }{' '}
              待命
            </small>
          </button>
          <button
            aria-pressed={tab === 'providers'}
            onClick={() => {
              setTab('providers');
              editProvider(selected ?? providers[0]);
            }}
          >
            模型服务商
          </button>
          <button
            aria-pressed={tab === 'voice'}
            onClick={() => setTab('voice')}
          >
            语音设置
          </button>
        </nav>
      </div>
      <div className="agent-body" ref={body}>
        <div className="console-voice" hidden={tab !== 'voice'}>
          <div className="console-section-heading">
            <h3>语音设置</h3>
            <p>选择识别与朗读方式，在这里试试语音对话。</p>
          </div>
          <div className="console-voice-layout">
            <VoicePanel {...voiceProps} />
            <aside className="console-voice-guide" aria-label="语音使用说明">
              <h4>在世界中交流</h4>
              <p>
                附近语音：进入世界后，在侧边语音面板开启麦克风和收听。声音随距离与朝向变化，附近
                Agent 会收到转写。
              </p>
              <p>
                聊天语音：在聊天框中使用语音转文字或录语音，也可以 @ 玩家与
                Agent 私聊。
              </p>
              <small>
                此处的识别与朗读选项用于语音实验室。切换页面或关闭控制台会保留设置；需要结束录音或朗读时，点击“打断”。
              </small>
            </aside>
          </div>
        </div>
        <div hidden={tab === 'voice'}>
          {error && (
            <p role="alert" className="agent-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="agent-notice">
              {notice}
            </p>
          )}
          {tab === 'providers' ? (
            <ProviderEditor {...controller} />
          ) : showAgentForm ? (
            <AgentForm {...controller} />
          ) : (
            <AgentList {...controller} />
          )}
        </div>
      </div>
    </dialog>
  );
}
