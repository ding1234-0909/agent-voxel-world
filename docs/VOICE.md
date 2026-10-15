# 无需 Google Cloud 或信用卡的语音接入

Voice Lab 现在提供三种可选方案，进入世界后在右上角切换。默认选中浏览器语音，原有脚本客户端仍默认使用 mock。网页使用麦克风前会由浏览器申请权限。

| 方案       | 语音输入与播放                            | 回复来源                | 准备工作                                     |
| ---------- | ----------------------------------------- | ----------------------- | -------------------------------------------- |
| 浏览器语音 | Web Speech API 识别、SpeechSynthesis 朗读 | 复述输入，明确标注非 AI | 无需账号、密钥、信用卡；浏览器需支持相应 API |
| 本地 AI    | 同上                                      | 本机 Ollama 模型        | 安装 Ollama、下载本地模型、配置服务端        |
| Mock       | 无真实音频                                | 固定文字模拟            | 无                                           |

## 直接体验浏览器语音

1. `pnpm dev` 后打开 http://127.0.0.1:5173 ，进入世界。
2. 在“接入方案”选择“浏览器语音 · 回声体验（非 AI）”，选择中文或 English。
3. 点击“麦克风”，允许权限后说一句话，停顿后自动发送；也可以直接输入文字点击“发送”。每次最多 240 字。
4. 默认自动朗读；取消勾选可只看字幕。自动播放被浏览器阻止时可点击“朗读回复”重试。
5. “打断”会停止当前识别、服务端请求与朗读；切换方案、语言或连接断开也会停止旧会话。

语音识别的浏览器支持有限，需要 localhost 或 HTTPS。部分浏览器（例如 Chrome）会将音频交给厂商的在线识别服务，所以**无需 Google Cloud 账号不等于离线运行**，网络不可达时可能识别失败。界面会提示权限、网络、无麦克风、无语音等错误，不支持识别时仍可输入文字。朗读优先使用已安装且语言匹配的本地语音，实际可用性取决于浏览器与系统；其他语音可能联网。参见 [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) 和 [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)。

## 接入本机 Ollama AI

按 [Ollama 官方说明](https://docs.ollama.com/quickstart) 安装本地运行程序。本地模型无需 API key；不要选择 cloud 模型。首次下载模型需要网络、磁盘空间和适合模型大小的内存。

```sh
ollama serve             # 如果桌面应用已经启动服务，无需重复执行
# 另一个终端：
ollama pull qwen2.5:3b   # 示例，也可使用机器上已有的本地模型
ollama list
```

在项目 `.env` 中加入下面两行（保留已有数据库配置），重启 `pnpm dev`：

```dotenv
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

网页选择“本地 AI · Ollama + 浏览器语音”。如需让未指定方案的 SDK 请求也使用它，再设 `VOICE_PROVIDER=ollama`。`VOICE_PROVIDER` 可选 `mock`、`browser`、`ollama`；非法默认配置会拒绝启动。仅在界面选择未配置的 Ollama 时会显示配置错误，不影响其他方案。

服务器通过 Ollama 的 [POST /api/chat](https://docs.ollama.com/api/chat) 请求文字回复；默认超时 60 秒，限制生成长度，每轮独立，不保留聊天历史。请求只允许本机 HTTP 地址且不跟随重定向。模型使用本地安装的名称，不使用 cloud 模型。Ollama 不承担语音识别或合成：输入音频依然由浏览器处理，服务端只收到识别后的文字，因此整条语音链路不能保证离线。模型没有世界观察或操作工具，只能对话。

本项目不会自动安装 Ollama、下载模型、订阅服务或调用付费云 API。模型未安装、服务未启动、请求失败或超时时会明确报错，绝不切换成伪装的 AI 回复。

## 协议与测试边界

- `voice.start` 支持 `{ text, provider?: 'mock' | 'browser' | 'ollama' }`。省略 provider 使用 `VOICE_PROVIDER`，默认为 mock。
- `voice` 事件仅发给请求者，携带 `requestId` 对应 action 的 id；浏览器用它丢弃已打断或已替换请求的迟到事件。
- 真实朗读文本通过可选 `speakText` 返回，客户端负责音频状态。服务端 `idle` 表示回复已经生成，不意味着客户端已播完。
- 当前所有 provider 都拒绝原始 PCM 音频。这里接入的是“浏览器识别 → 文字回复 → 浏览器朗读”，没有原始音频上传或端到端实时音频模型。
- 自动化覆盖本地 API 契约、错误、超时、打断、旧请求隔离、浏览器权限失败与播放取消；模拟 API/浏览器对象的测试不代表真实麦克风或真实模型已验证。实际声音、识别率和本地模型速度需在目标设备验证。
