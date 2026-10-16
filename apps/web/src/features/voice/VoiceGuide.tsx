export function VoiceGuide({ realtime }: { realtime: boolean }) {
  return (
    <aside className="console-voice-guide" aria-label="语音使用说明">
      <h4>{realtime ? '百炼实时对话' : '识别与朗读'}</h4>
      {realtime ? (
        <>
          <p>
            百炼直接接收文字或录音，并返回语音和字幕，无需单独选择识别与朗读方式。
          </p>
          <p>
            离线演示只产生合成提示音，不调用模型或麦克风。真实服务需要服务端配置，并在左侧同意发送本次输入。
          </p>
          <small>
            切换接入方案、切换控制台分类或关闭控制台，会结束本次百炼会话。
          </small>
        </>
      ) : (
        <>
          <p>
            先选择回复来源，再设置识别方式与语言。语音回声复述你的话；本地 AI
            使用 Ollama 生成回复。
          </p>
          <p>
            本机 Whisper 负责识别，浏览器负责朗读。也可以选择在线识别，或使用
            Mock 体验文字流程。
          </p>
          <small>
            关闭控制台会保留设置；需要结束录音或朗读时，点击“打断”。切换接入方案会停止当前对话。
          </small>
        </>
      )}
      <h4 className="voice-guide-world">在世界中交流</h4>
      <p>
        附近语音和聊天录音仍在游戏侧边使用。这里的接入方案用于试用语音对话，不会更改附近语音或
        Agent 的配置。
      </p>
    </aside>
  );
}
