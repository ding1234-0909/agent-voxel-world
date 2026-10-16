import { AgentCard } from './AgentCard';

import type { ConsoleController } from './useConsoleController';
import { isActive } from './model';

type Props = Pick<
  ConsoleController,
  | 'jobs'
  | 'busy'
  | 'pollError'
  | 'taskEditor'
  | 'setTaskEditor'
  | 'taskGoal'
  | 'setTaskGoal'
  | 'openAgentEditor'
  | 'resumeAgent'
  | 'pauseAgent'
  | 'cancelTask'
  | 'stopAgent'
  | 'assignTask'
  | 'toggleVoiceReplies'
>;
export function AgentList({
  jobs,
  busy,
  pollError,
  taskEditor,
  setTaskEditor,
  taskGoal,
  setTaskGoal,
  openAgentEditor,
  resumeAgent,
  pauseAgent,
  cancelTask,
  stopAgent,
  assignTask,
  toggleVoiceReplies,
}: Props) {
  return (
    <section className="agent-runs" aria-label="Agent 运行状态">
      <div className="agent-list-heading">
        <div>
          <h3>我的 Agent</h3>
          <p className="agent-hint">
            {jobs.filter((j) => j.sessionId || isActive(j)).length} / 4 在线 ·
            待命时可通过 @ 唤醒
          </p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => openAgentEditor()}
        >
          ＋ 创建 Agent
        </button>
      </div>
      {pollError && (
        <p role="alert" className="agent-error">
          {pollError}
        </p>
      )}
      {!jobs.length && (
        <div className="agent-empty">
          还没有 Agent 玩家
          <br />
          <small>创建一位 AI 伙伴，一起探索与搭建。</small>
        </div>
      )}
      <div className="agent-job-list">
        {jobs.map((job) => (
          <AgentCard
            key={job.id}
            job={job}
            busy={busy}
            taskEditor={taskEditor}
            setTaskEditor={setTaskEditor}
            taskGoal={taskGoal}
            setTaskGoal={setTaskGoal}
            openAgentEditor={openAgentEditor}
            resumeAgent={resumeAgent}
            pauseAgent={pauseAgent}
            cancelTask={cancelTask}
            stopAgent={stopAgent}
            assignTask={assignTask}
            toggleVoiceReplies={toggleVoiceReplies}
          />
        ))}
      </div>
      <p className="agent-list-note">
        关闭控制台不会停止 Agent。暂停或取消任务后角色仍在线；私聊和 @
        可交流或安排任务。
      </p>
    </section>
  );
}
