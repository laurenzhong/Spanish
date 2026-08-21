# ADR-0002：首个 STT 供应商采用 OpenAI 文件转写

- 日期：2026-08-21
- 状态：Proposed

## 背景

ALPHA-010 已完成录音能力抽象和文字降级，但训练流程还没有真实的语音转写 provider。个人 Alpha 需要先支持录音停止后的转写，再由后续任务决定评估、证据和画像如何消费转写结果。

该决策同时影响供应商凭据、音频传输、错误重试、成本记录、置信度语义和数据保留，因此需要记录为 ADR。

## 决定

1. 首个真实 STT provider 采用 OpenAI Audio Transcription API 的 `gpt-transcribe` 模型。
2. 只支持录音完成后的同步文件转写；不提前接入 Realtime transcription。
3. provider 通过内部 `SpeechToTextProvider` 接口暴露，使用 `Uint8Array` 音频输入和内部 `TranscriptResult` 输出。
4. 服务端使用原生 `fetch`，不把 OpenAI SDK 或供应商 DTO 扩散到业务模块。
5. API key 只存在服务端环境变量 `OPENAI_API_KEY`，Web、Flutter 和浏览器 bundle 不接触该密钥。
6. 单文件最大 25 MB，使用支持的音频 MIME 白名单，并保留 `retentionPolicy: "ephemeral"`。
7. 默认不自动重试。可重试错误只返回稳定分类，application 层必须在 attempt 幂等检查后决定是否重试。
8. OpenAI 响应未提供本产品可直接信任的置信度时，内部 `confidence` 保持 `null`，不能伪造评分依据。
9. provider 只返回统一转写结果和调用元数据，不直接写入 evidence、profile、training 或 provider_calls；持久化由 application 层负责。

## 备选方案

- **OpenAI 官方 Node SDK**：类型和请求封装更方便，但会增加依赖；当前只需要 multipart 请求和 JSON 校验，原生 `fetch` 的边界更小。
- **Deepgram、AssemblyAI 或其他 STT provider**：可以作为后续比较对象，但现在会引入新的凭据、数据处理条款和准确率评估，不应在首个 Alpha 适配器中并行接入。
- **独立 STT 网关**：便于统一切换供应商，但当前没有性能、团队所有权或部署隔离需求，违反 Alpha 不提前拆服务的原则。

## 后果

### 正面

- 复用已有录音结果和 provider_calls 数据模型。
- 保持后续 evaluator、evidence 和 profile 对供应商不可知。
- 使用 fake 和注入式 fetch 可以在不产生费用的情况下覆盖失败和取消。
- 同步文件转写与当前“录音停止后进入下一状态”的训练流程匹配。

### 代价与限制

- 当前没有实时字幕或双向语音能力。
- OpenAI 转写结果不能直接作为高置信度学习证据。
- 没有 Mac/Xcode 时无法把本地 Windows 验证表述为 iOS 真机音频验收。
- 供应商可用性、价格、区域和数据处理条件需要在启用真实 key 前由部署者确认；默认 CI 永不调用真实收费 API。

## 隐私与运维约束

- 普通录音仅用于当前尝试，转写调用完成后不建立长期音频资产。
- 日志只记录内部 ID、provider、模型、请求 ID、延迟、状态和错误分类。
- 不记录原始录音、完整私密对话、完整转写正文、令牌或签名 URL。
- 供应商错误正文必须经过清洗，不直接返回给客户端。

