import type { ManagedAgentView } from '@voxel/shared';
export function AgentLogViewer({ job }: { job: ManagedAgentView }) {
  return (
    <details className="agent-run-log">
      <summary>运行记录</summary>
      {job.lastResponse && (
        <p className="agent-hint">最近处理结果：{job.lastResponse}</p>
      )}
      <pre>{job.logs.join('\n') || '暂无运行记录'}</pre>
    </details>
  );
}
