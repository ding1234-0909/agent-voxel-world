interface ControlsHelpProps {
  onClose: () => void;
}

export function ControlsHelp({ onClose }: ControlsHelpProps) {
  return (
    <section id="controls-help" className="controls-help" aria-label="操作帮助">
      <div className="chat-title">
        <strong>操作帮助</strong>
        <button aria-label="关闭操作帮助" onClick={onClose}>
          ×
        </button>
      </div>
      <dl>
        <div>
          <dt>
            <kbd>W A S D</kbd>
          </dt>
          <dd>移动</dd>
        </div>
        <div>
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>跳跃</dd>
        </div>
        <div>
          <dt>点击画面</dt>
          <dd>锁定鼠标视角</dd>
        </div>
        <div>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>释放鼠标 / 关闭帮助</dd>
        </div>
        <div>
          <dt>鼠标左键 / 右键</dt>
          <dd>移除 / 放置方块</dd>
        </div>
        <div>
          <dt>点击底部材质栏</dt>
          <dd>切换方块材质</dd>
        </div>
      </dl>
      <p>瞄准 6 格内的方块进行搭建。</p>
    </section>
  );
}
