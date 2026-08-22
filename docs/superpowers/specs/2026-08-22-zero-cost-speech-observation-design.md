# 零成本语音信号观察与可选供应商校准设计

- 日期：2026-08-22
- 状态：待用户审阅
- 关联任务：ALPHA-018（待协调者正式编号）
- 前置任务：ALPHA-017，已合并 `d4a30a5`

## 1. 背景

Speechace 适合做西班牙语发音与流利度校准，但按默认训练路径调用会产生持续供应商费用。当前仓库已经有 `PronunciationProvider`、Speechace 适配器和 training application，但没有真实音频回放执行器，也不应把教材示范音频直接当作学习者负面证据。

产品需要一个不依赖付费供应商的默认路径，同时保留少量、明确触发的供应商校准能力。该路径必须继续保护以下不变量：技术失败和低质量音频不扣分；本地音频信号不等价于发音能力；`mastery` 与 `confidence` 不由客户端或供应商分数直接决定；普通录音完成后不长期保存。

## 2. 决定

采用“本地语音信号观察为默认、Speechace 为可选校准”的双路径：

1. 默认训练不调用 Speechace、OpenAI、Azure 或其他收费模型。
2. 本地路径只提取有限的语音信号观察，例如录音时长、能量启发式的语音占比、停顿次数和停顿占比。它们用于提示恢复、录音质量诊断和待验证状态，不直接产生发音分数、语境成功、`mastery` 或 `confidence`。
3. Speechace 适配器保留在内部 provider 边界，只能由明确的人工校准或抽样复核流程调用。每次调用必须是短音频、带 `attemptId`/`generationId`，并使用现有的超时、取消、错误和 `observation-only` 语义。
4. 本地音频和教材音频都不进入 Git。回放输入使用本机外部目录；仓库只保存脱敏的样本 ID、来源类型、许可确认、哈希和标注结果。
5. 不在本阶段引入本地离线 ASR、音素级评分模型、媒体库或新的付费服务。需要转写时仍按现有 STT provider 规则显式触发，不能把转写当作发音证据。

## 3. 范围

### 包含

- 定义独立于 `PronunciationProvider` 的 `SpeechSignalObservation` 内部 DTO。
- 增加纯 TypeScript 的有界信号分析器和 deterministic fake，覆盖空音频、静音、清晰音频、停顿、格式失败和过期 generation。
- 为本地路径增加 application 编排：可取消、旧 generation 忽略、结果只进入观察或待验证状态。
- 增加一个只读本地回放清单工具，扫描外部音频目录并生成文件哈希、格式、大小和可选时长；不复制音频，不上传音频。
- 为可选 Speechace 校准定义显式开关、单批次上限和审计字段，默认关闭。

### 不包含

- 不把教材音频整库上传到 Speechace。
- 不把教材母语示范音频标注为学习者的发音错误、噪声或静音样本。
- 不实现离线 ASR、音素对齐、自动母语者标注或自动更新画像。
- 不接入训练 UI、数据库迁移、长期音频存储或 Flutter iOS 真机能力。
- 不修改 `PronunciationProvider` 的供应商分数契约来承载本地信号。

## 4. 内部边界

本地信号使用独立接口，避免将启发式诊断伪装成发音评测：

```ts
interface SpeechSignalAnalyzer {
  analyze(
    input: SpeechSignalInput,
    options?: { signal?: AbortSignal },
  ): Promise<SpeechSignalObservation>;
}
```

`SpeechSignalInput` 只接受当前短期音频、MIME、`attemptId`、`generationId` 和 locale。`SpeechSignalObservation` 只包含有限信号、分析版本、延迟、音频保留策略和结果质量，不包含完整转写、供应商 DTO、能力分数或原始音频。

推荐的最小信号字段：

- `durationMs`
- `voicedRatio: number | null`
- `pauseCount: number | null`
- `pauseRatio: number | null`
- `quality: "usable" | "insufficient"`
- `analyzer: "local-signal"`
- `algorithmVersion`
- `retentionPolicy: "ephemeral"`

所有比例和时长都由服务端或 application 做范围校验。客户端计算结果只能作为诊断输入，不能成为能力事实；无法验证的结果统一为 `insufficient`。

## 5. 数据流

1. 训练流程产生带 `attemptId`/`generationId` 的短期录音。
2. 默认路径在本地运行信号分析；分析器释放解码缓冲和对象 URL，不创建长期媒体资产。
3. training application 检查 generation、输出方式和音频边界，映射为 `observed`、`pending-verification`、`recoverable-error` 或 `stale`。
4. 只有后续独立 evidence application 在满足语境成功、音频质量和校准门槛时，才可以消费有限观察；本阶段不写 `evidence_events`。
5. 可选校准流程在用户明确触发并通过批次限制后，才把选中的短音频交给 Speechace。原始响应只在内存中转换为内部 DTO，不写仓库或普通日志。

## 6. 本地回放与标注

用户目录中的教材音频只作为外部输入。第一批回放应优先选择短、单句、清晰的 MP3；`.downloading` 文件、WMA 和无法确认完整性的文件跳过。清晰教材音频只能作为正向基线，不能覆盖学习者错误、噪声、静音和截断类别。

回放清单保存：

- 稳定的内部 `sampleId`，不保存绝对路径。
- 文件 SHA-256、格式、大小和时长。
- 来源类型、用户授权确认和处理时间。
- 标注状态、观察范围和不应更新的技能。

真实音频处理完成后删除临时副本和解码缓冲。仓库不得保存音频、完整教材文本、供应商原始响应或长期签名 URL。

## 7. 失败与隐私

- 空音频、格式不支持、静音、过短、无法解码和低质量输入进入 `pending-verification` 或稳定可恢复错误。
- 取消、超时、过期 generation 和本地分析异常不得产生负面能力证据。
- 默认路径没有供应商费用；可选 Speechace 流程必须记录调用次数、耗时、供应商请求 ID 和估算成本，但不记录音频正文。
- 回放工具默认 dry-run，只做清单和哈希。上传需要显式 `--provider speechace` 之类的开关和批次上限。
- API key 只能来自本机未提交环境变量，不接受命令行参数、不写日志、不写清单。

## 8. 测试与验收

必须覆盖：

- 纯分析器对清晰、静音、停顿、空输入和边界比例的确定性结果。
- 旧 generation 不调用或不覆盖当前结果。
- 取消、超时、解码失败和格式失败均无负面证据。
- 本地观察结果不含 transcript、`mastery`、`confidence` 或 provider 专有字段。
- 回放工具不复制音频、不读取 `.downloading` 文件、不把绝对路径写入输出。
- Speechace 开关默认关闭，批次限制和 key 缺失都能安全失败。
- `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:contracts` 和 `pnpm build` 通过。

验收完成后仍需单独记录：本地启发式信号不能替代母语者发音标注；Windows 公共代码通过不能表述为 Flutter iOS 真机验证通过。

## 9. 取舍

本方案牺牲音素级发音诊断，换取默认零供应商费用、较好的隐私和可恢复性。Speechace 仍可用于少量质量校准，但不会成为训练产品的默认依赖。未来若需要真正的离线音素评分，必须另立架构任务，评估模型许可、设备性能、模型包大小和跨 Web/Flutter 一致性。
