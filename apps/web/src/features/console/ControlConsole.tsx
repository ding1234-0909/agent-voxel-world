import { VoiceServices } from './VoiceServices';
import { SpeechRecognitionPanel } from '../voice/SpeechRecognitionPanel';
import type { Connection } from '../../network/connection';
import { useConsoleController } from './useConsoleController';
import { isActive } from './model';
import { ProviderEditor } from './ProviderEditor';
import { AgentForm } from './AgentForm';
import { AgentList } from './AgentList';
type ConsoleProps = {
  connection: Connection;
  open: boolean;
  initialTab?: 'agents';
  onClose: () => void;
};
export function ControlConsole({
  connection,
  open,
  initialTab,
  onClose,
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
            文本转语音（TTS）
          </button>
          <button aria-pressed={tab === 'asr'} onClick={() => setTab('asr')}>
            语音识别（ASR）
          </button>
        </nav>
      </div>
      <div className="agent-body" ref={body}>
        <div className="console-voice" hidden={tab !== 'voice'}>
          <div className="console-section-heading">
            <h3>文本转语音（TTS）</h3>
            <p>
              将回复文字合成为声音。保存音色配置、试听效果，在创建 Agent
              时选择使用。
            </p>
          </div>
          {error && (
            <p role="alert" className="agent-error">
              {error}
            </p>
          )}
          <VoiceServices
            services={controller.voiceServices}
            onChange={controller.setVoiceServices}
            active={open && tab === 'voice'}
          />
        </div>
        <div className="console-voice" hidden={tab !== 'asr'}>
          <SpeechRecognitionPanel
            connection={connection}
            active={open && tab === 'asr'}
          />
        </div>
        <div hidden={tab === 'voice' || tab === 'asr'}>
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
            <AgentForm {...controller} active={open && tab === 'agents'} />
          ) : (
            <AgentList {...controller} />
          )}
        </div>
      </div>
    </dialog>
  );
}
