# 授权音频转写与 MiniMax 标注校准批处理设计

- 日期：2026-08-22
- 状态：已批准并实现
- 关联任务：授权音频小批量标注校准
- 前置任务：ALPHA-020，已合并 `a8893a1`

## 1. 背景

ALPHA-020 已提供外部音频 manifest 和授权前置门禁。当前仓库已有 OpenAI
文件转写 provider 与 MiniMax 文本标注草稿 provider，但没有将授权音频按
样本逐条转写、生成草稿、恢复和保存结果的批处理入口。临时命令无法稳定
回传逐条结果，也无法在中断后安全恢复，容易重复消耗供应商额度。

本任务处理一批最多 20 条、当前首批 5 条的自有 MP3。OpenAI 只负责取得
转写文本；MiniMax 只接收转写文本和明确的 `speechSignal: null`。没有本地
MP3 解码器时，不伪造时长、停顿、语音占比或发音观察。

## 2. 决定

新增 server-only 的批处理编排器和只读输入/外部结果 CLI：

1. 解析 replay manifest 与授权记录，并再次运行 ALPHA-020 门禁。
2. 扫描外部音频目录，用 SHA-256 将文件匹配到 manifest entry；结果不保存
    绝对路径或文件名。
3. 以稳定的 `attemptId = calibration.<sampleId>` 和固定 generation `0`
   调用内部 `SpeechToTextProvider`。
4. 将转写文本、locale、内容版本和 `speechSignal: null` 交给
   `AnnotationDraftProvider`。MiniMax prompt 明确禁止从文本推断发音、
   韵律、流利度、mastery 或 confidence。
5. 每完成一条就通过临时文件加 rename 原子更新外部结果 JSON。已完成条目
   默认跳过；只有显式 `--retry-failed` 才重试失败条目。
6. 结果只包含脱敏的样本 ID、转写、结构化草稿、供应商请求 ID、延迟、
   状态和稳定错误码；不包含原始音频、供应商原始响应、API key 或绝对路径。

## 3. 范围

### 包含

- 可注入 provider 和文件读取端口的纯 TypeScript 批处理编排器。
- `speechSignal` 可为空的 annotation 输入契约、MiniMax prompt 和 fake 更新。
- 外部目录扫描、哈希匹配、结果 JSON schema、原子写入和幂等恢复。
- OpenAI → MiniMax 顺序调用；每个样本独立成功或失败。
- 取消、超时、供应商错误和旧结果跳过语义。
- 单元测试、契约测试和 CLI 的 blocked/ready/retry 行为测试。

### 不包含

- Speechace、Azure 或其他发音评分供应商调用。
- MP3 解码、停顿/语音占比分析、音素评分或发音结论。
- 写入 `evidence_events`、`mastery`、`confidence` 或数据库。
- Web/Flutter UI、后台队列、长期音频存储或自动人工标注通过。
- 将音频、完整教材文本或供应商原始响应提交到 Git。

## 4. 组件与边界

### `src/modules/evidence/replay/annotation-calibration.ts`

定义批处理输入、每条结果和运行结果 DTO，并导出：

- `runAnnotationCalibrationBatch()`：接收已验证 manifest、文件哈希读取器、
  STT provider、annotation provider、结果快照和取消信号。
- `CalibrationBatchResult`：`completed`、`partial-failure` 或 `cancelled`。
- `CalibrationSampleResult`：`completed`、`failed` 或 `skipped`。

编排器不依赖 Node 文件系统、Next.js、React、数据库或供应商 SDK。它只通过
端口读取 `Uint8Array` 和持久化快照，保证可以使用 fake 测试竞态和恢复。

### `scripts/run-annotation-calibration.ts`

server-only CLI 负责：

- 从 `--audio-root`、`--manifest`、`--authorization`、`--output` 读取参数。
- 使用 `dotenv` 加载本机 `.env`，只从环境创建 OpenAI/MiniMax provider。
- 扫描和哈希匹配外部音频；不把路径传给 provider 或写入输出。
- 将每条结果原子写到外部 `--output` JSON。
- 默认退出码：全部完成为 `0`，部分失败/取消为 `1`，输入错误为 `2`。

### Annotation 输入变化

`AnnotationDraftInput.speechSignal` 从必填观察改为
`SpeechSignalObservation | null`。`null` 表示本批次没有可靠本地信号，
不是静音、负面证据或零分。Fake 和 MiniMax provider 必须保留
`audioSent: false`、`writesEvidence: false`、`affectsMastery: false` 和
`affectsConfidence: false`。

## 5. 外部结果格式

结果文件只保存本地审计和人工复核所需字段：

```json
{
  "schemaVersion": "1.0",
  "runId": "calibration-v1-2026-08-22",
  "status": "partial-failure",
  "samples": [
    {
      "sampleId": "audio.02aa19e818232fc7",
      "attemptId": "calibration.audio.02aa19e818232fc7",
      "status": "completed",
      "transcript": "...",
      "transcriptionRequestId": "...",
      "annotationRequestId": "...",
      "draft": {},
      "speechSignal": null
    }
  ]
}
```

结果 schema 禁止 `audioBytes`、绝对路径、API key、供应商原始 payload、
`mastery`、`confidence` 和发音总分字段。转写仅保存在用户指定的外部本地
结果文件，不进入仓库或普通日志。

## 6. 失败、取消与幂等

- manifest、授权记录或哈希匹配失败：不调用供应商，退出 `2`。
- 单条 OpenAI 或 MiniMax 失败：记录稳定错误码，继续处理其他样本。
- 已有 `completed` 样本：默认跳过，不重复计费。
- `--retry-failed` 只重新处理 `failed` 样本，仍使用同一 `attemptId`，并
  在结果中覆盖该样本的最新尝试状态。
- 外部 abort/超时：当前样本进入 `failed` 或 `cancelled`，原子保存后停止
  后续样本；不写负面能力证据。
- 供应商响应只经过现有 Zod schema 转换；错误输出只包含稳定错误码。

## 7. 隐私与供应商边界

- OpenAI 接收短期 MP3；MiniMax 接收转写文本和 `speechSignal: null`，不接收
  音频 bytes、文件名或 MIME 类型。
- API key 只从未提交的本机环境读取，不接受命令行参数，不写日志或结果。
- 临时 `Uint8Array` 在每条样本完成后释放引用；不创建长期媒体资产。
- 结果文件路径由用户指定，脚本不把它加入 Git，也不输出绝对路径。
- 本流程只生成人工复核草稿，不更新学习证据、技能快照或用户画像。

## 8. 测试与验收

必须覆盖：

- manifest 哈希与外部文件匹配，错配时不调用 provider。
- 首次运行按顺序调用 STT 再调用 MiniMax，MiniMax 收到 `speechSignal: null`。
- 已完成样本跳过，失败样本默认跳过且 `--retry-failed` 可重试。
- 单条失败不阻塞其他样本，取消/超时不产生负面证据。
- 结果不含绝对路径、音频 bytes、provider raw response 或 API key。
- annotation fake、MiniMax prompt 和共同契约样本覆盖可空 signal。
- CLI 的 ready、blocked、partial-failure 和 invalid-input 退出码。

验收命令：

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:contracts
pnpm build
```

真实运行只在用户配置本机密钥并明确执行 CLI 后进行；默认测试永远不调用
OpenAI 或 MiniMax。
