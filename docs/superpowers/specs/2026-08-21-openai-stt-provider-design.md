# ALPHA-011：OpenAI 文件转写供应商设计

- 日期：2026-08-21
- 状态：Proposed
- 任务：选择并接入首个 STT 供应商适配器

## 1. 背景与目标

ALPHA-010 已经提供浏览器和 Flutter 的录音能力抽象、统一音频元数据、稳定平台错误，以及录音失败时的文字降级。下一步需要把一段已经完成的录音转换为可供后续评估器使用的内部转写结果。

本任务只建立 STT provider 层和契约测试。它不写入 `evidence_events`、`user_skill_states` 或 `practice_attempts`，不实现发音评分，不实现实时双向语音，也不把供应商原始响应暴露给客户端。

## 2. 选择结果

首个真实供应商采用 OpenAI Audio Transcription API，默认模型为 `gpt-transcribe`。

采用录音停止后的同步文件转写：

```text
RecordedAudio -> SpeechToTextProvider -> TranscriptResult
```

本任务不使用 Realtime transcription。官方文件转写支持已完成音频，当前文档规定单文件上限为 25 MB，并支持 `webm`、`wav`、`mp3`、`mp4`、`m4a` 等格式。参考：[OpenAI File transcription](https://platform.openai.com/docs/guides/speech-to-text)。

## 3. 内部接口

业务层只依赖内部接口，不依赖 OpenAI SDK、HTTP 响应类型或供应商错误文本。

```ts
export type SpeechToTextInput = Readonly<{
  audioBytes: Uint8Array;
  mimeType: string;
  fileName: string;
  languageTag?: string;
}>;

export type TranscriptResult = Readonly<{
  text: string;
  detectedLanguages: readonly string[];
  confidence: number | null;
  confidenceAvailability: "unavailable" | "provider";
  provider: "openai";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  retentionPolicy: "ephemeral";
}>;

export interface SpeechToTextProvider {
  transcribe(
    input: SpeechToTextInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TranscriptResult>;
}
```

接口使用 `Uint8Array`，避免把浏览器 `Blob` 或 Flutter 类型传播到服务端领域代码。录音格式和大小由 application 层校验，provider 仍做二次防御校验。

## 4. OpenAI 适配器

`OpenAITranscriptionProvider` 位于服务端 provider 模块，使用原生 `fetch` 调用 `/v1/audio/transcriptions`。不引入 SDK，原因是当前仓库没有 OpenAI 运行时依赖，而请求只需要 multipart 上传和 JSON 响应解析。

适配器职责：

- 从服务端环境读取 `OPENAI_API_KEY`，不允许客户端注入。
- 将内存音频封装为 multipart `FormData`。
- 使用 `gpt-transcribe` 和西班牙语 language hint。
- 设置可注入的超时，默认 30 秒，并尊重调用者的 `AbortSignal`。
- 解析 `text` 与可选的 detected languages。
- 读取供应商 `x-request-id`，记录延迟和模型版本。
- 返回 `retentionPolicy: "ephemeral"`，不保存音频。

OpenAI 当前文件转写响应不能提供本产品可直接信任的评估置信度，因此 `confidence` 返回 `null`，`confidenceAvailability` 返回 `"unavailable"`。后续 evaluator 不得把 `null` 转换成高置信度。

## 5. 数据流与失败语义

### 5.1 请求前校验

- 音频必须非空。
- 音频不得超过 25 MB。
- MIME 类型必须在 provider 支持列表中。
- 文件名只用于 multipart 文件名，不写入诊断日志。

### 5.2 错误分类

内部错误至少覆盖：

- `audio-invalid`
- `audio-too-large`
- `audio-format-unsupported`
- `provider-auth-failed`
- `provider-rate-limited`
- `provider-timeout`
- `provider-cancelled`
- `provider-unavailable`
- `provider-response-invalid`

格式、大小、鉴权和响应结构错误不可重试。超时、网络错误、限流和供应商 5xx 可标记为可重试，但适配器默认不自动重试，以避免同一尝试重复产生供应商费用。application 层未来只有在 attempt 幂等检查通过后才可以显式重试。

空转写是成功的供应商调用，但表示当前没有足够的可用语音内容。它不能进入负面评估或能力扣分。

取消必须尽快终止请求并映射为 `provider-cancelled`，不触发重试。

### 5.3 隐私和观测

provider 调用元数据交给 application 层持久化到 `provider_calls`，包括 provider、模型、请求 ID、状态、延迟、可选估算成本和 retention policy。禁止保存：

- 原始音频内容。
- 完整转写正文到普通日志。
- API key、访问令牌或长期签名 URL。

技术失败、空转写和不可用置信度不会直接创建负面能力证据。评估和证据写入属于后续任务。

## 6. 测试设计

### 6.1 Fake provider

fake 实现覆盖成功文本、空文本、取消、超时、限流、供应商故障和响应无效，供 application 和训练测试注入。默认测试不调用真实收费 API。

### 6.2 OpenAI 适配器契约

通过注入 fake `fetch` 验证：

- multipart 包含音频、模型和语言提示。
- 25 MB 上限和 MIME 白名单在网络请求前生效。
- 成功响应正确映射文本、语言、请求 ID、模型和延迟。
- 缺少 `text` 或结构损坏映射为 `provider-response-invalid`。
- 401/403、429、5xx、网络异常、超时和取消映射到稳定错误及正确 retryable 标记。
- 默认只发起一次请求。
- 测试结果和错误不会包含 API key、音频正文或完整转写正文。

### 6.3 后续集成边界

后续 application 任务再补充：用户身份和 attempt 所有权、幂等重试、`provider_calls` 事务写入、训练状态机转写回调，以及低置信度不污染 evidence/profile 的集成测试。

## 7. 非目标

- Realtime transcription 或实时双向语音。
- 发音、音素、重音、语流和停顿评分。
- 直接写入证据、画像或场景状态。
- 长期原始音频媒体库。
- OpenAI SDK 的通用封装或独立供应商网关。

