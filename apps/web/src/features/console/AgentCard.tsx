import type { ManagedAgentView } from '@voxel/shared';
import type { ConsoleController } from './useConsoleController';
import { isActive, statusNames, taskStatusNames } from './model';
import { AgentLogViewer } from './AgentLogViewer';

type Props = Pick<
  ConsoleController,
  | 'busy'
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
> & { job: ManagedAgentView };
export function AgentCard({
  busy,
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
  job,
}: Props) {
  return (
    <article
      className="agent-job"
      key={job.id}
      data-task-status={job.task?.status}
    >
      <div className="agent-job-title">
        <div className="agent-identity">
          <span className="agent-avatar" aria-hidden="true">
            {job.name.slice(0, 1)}
          </span>
          <div>
            <strong>{job.name}</strong>
            <p className="agent-job-model">
              {job.providerName} · {job.model}
            </p>
          </div>
        </div>
        <span className={`agent-badge ${isActive(job) ? 'active' : ''}`}>
          {job.status === 'idle' && job.task
            ? taskStatusNames[job.task.status]
            : statusNames[job.status]}
        </span>
      </div>
      <p className="agent-job-goal">
        <span className="agent-detail-label">任务目标</span>
        {job.task?.goal ?? job.goal}
      </p>
      {job.task && (
        <div className="agent-task-progress">
          <p>
            <span className="agent-detail-label">最近进展</span>
            {job.task.summary}
          </p>
          {job.task.reason && job.task.reason !== job.task.summary && (
            <p className="agent-task-notice">
              <span aria-hidden="true">●</span> {job.task.reason}
            </p>
          )}
        </div>
      )}
      <div className="agent-card-actions">
        {!isActive(job) && job.task?.status !== 'running' && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void resumeAgent(job)}
          >
            {job.task?.status === 'budget'
              ? '确认追加预算并继续'
              : job.sessionId
                ? ['completed', 'cancelled'].includes(job.task?.status ?? '')
                  ? '重新执行任务'
                  : '继续任务'
                : '重新加入并执行'}
          </button>
        )}
        {job.sessionId && !['joining', 'stopping'].includes(job.status) && (
          <>
            {['running', 'waiting'].includes(job.task?.status ?? '') && (
              <button disabled={busy} onClick={() => void pauseAgent(job)}>
                暂停任务
              </button>
            )}
            {!['completed', 'cancelled'].includes(job.task?.status ?? '') && (
              <button disabled={busy} onClick={() => void cancelTask(job)}>
                取消任务
              </button>
            )}
          </>
        )}
        <button
          disabled={busy || ['joining', 'stopping'].includes(job.status)}
          onClick={() => {
            setTaskEditor(taskEditor === job.id ? undefined : job.id);
            setTaskGoal('');
          }}
        >
          布置新任务
        </button>
        <button
          disabled={busy || isActive(job) || job.task?.status === 'running'}
          title={isActive(job) ? '请先暂停任务再编辑' : undefined}
          onClick={() => openAgentEditor(job)}
        >
          编辑参数
        </button>
        {(isActive(job) ||
          job.sessionId ||
          job.status === 'idle' ||
          job.status === 'failed') && (
          <button
            className="agent-close-action"
            disabled={busy || job.status === 'stopping'}
            onClick={() => void stopAgent(job)}
          >
            关闭 Agent
          </button>
        )}
      </div>
      {taskEditor === job.id && (
        <form
          className="agent-task-form"
          onSubmit={(e) => {
            e.preventDefault();
            void assignTask(job);
          }}
        >
          <label>
            新任务
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={taskGoal}
              onChange={(e) => setTaskGoal(e.target.value)}
              placeholder="例如：在东侧空地建一间木屋，门朝南"
            />
          </label>
          <p className="agent-hint">
            提交后替换当前任务；角色和已完成的建筑保留。
          </p>
          <div className="agent-card-actions">
            <button className="primary" disabled={busy || !taskGoal.trim()}>
              开始任务
            </button>
            <button type="button" onClick={() => setTaskEditor(undefined)}>
              返回
            </button>
          </div>
        </form>
      )}
      <details className="agent-card-details">
        <summary>
          用量与配置{' '}
          <span>
            {job.task
              ? `${job.task.calls} / ${job.maxTurns} 次调用`
              : '查看详情'}
          </span>
        </summary>
        {job.task && (
          <p className="agent-hint">
            本额度 {job.task.calls} / {job.maxTurns} 次调用 ·{' '}
            {job.task.estimated ? '约 ' : ''}
            {job.task.tokens.toLocaleString()} tokens
          </p>
        )}
        {job.usage && (
          <p className="agent-hint">
            累计 {job.usage.calls} 次调用 · {job.usage.estimated ? '约 ' : ''}
            {job.usage.tokens.toLocaleString()} tokens
          </p>
        )}
        <div className="agent-job-meta">
          <span>任务驱动</span>
          <span>
            {job.intervalMode === 'random'
              ? `随机 ${job.intervalMinMs}–${job.intervalMaxMs} ms`
              : `间隔 ${job.intervalMs} ms`}
          </span>
          <span>
            {job.allowEdits ? '允许建造' : '仅探索与交流'} ·{' '}
            {job.voiceReplies ? '语音回复开启' : '语音回复关闭'}
            {job.voiceServiceName ? ` · ${job.voiceServiceName}` : ''}
          </span>
        </div>
        <button
          disabled={
            busy ||
            !job.voiceServiceId ||
            ['joining', 'stopping'].includes(job.status)
          }
          aria-pressed={!!job.voiceReplies}
          onClick={() => void toggleVoiceReplies(job)}
        >
          {!job.voiceServiceId
            ? '请先编辑参数选择语音服务'
            : job.voiceReplies
              ? '关闭语音回复'
              : '开启语音回复'}
        </button>
      </details>
      <AgentLogViewer job={job} />
    </article>
  );
}
