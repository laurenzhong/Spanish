# ALPHA-024 初次诊断设计

- 日期：2026-08-23
- 状态：已获用户确认并实现
- 任务：ALPHA-024

## 背景

个人 Alpha 需要在用户开始长期训练前，用一个真实沟通场景建立第一批可解释证据。实施计划要求用户选择一个自认为可以表达的通用场景，完成 3–5 个逐步变化的交际任务，再根据语境成功、独立程度和标签权值建立初始画像。

当前仓库已经有：

- `training` 状态机，负责任务输入、录音、转写、提示、失败恢复和 generation 隔离。
- `evidence` application，负责评估输入、证据幂等追加和技能快照重算。
- `profile` domain，负责 `mastery`、`confidence`、口语覆盖和数据不足状态。

ALPHA-024 不重新实现这些规则，而是增加诊断计划和进度边界，并提供一个真实的 5 任务初次诊断场景内容源。

## 决定

采用“复用现有训练与证据链”的方案：

1. 新增纯 TypeScript 的 diagnostic domain/application 模块。
2. 诊断计划只接受已审核可用的场景投影，不访问网络、provider 或客户端状态。
3. 任务按稳定 `position` 生成，数量必须为 3–5，不能重复、跳号或临时复制。
4. 语音是默认输入；录音权限拒绝或不方便发声时允许切换打字。
5. 打字结果沿用现有 evidence 过滤规则，不更新发音、语流和其他口语专属技能。
6. 证据写入统一委托 `recordEvidence`，不直接写 `evidence_events` 或 `user_skill_states`。
7. 不新增诊断数据库表、Route Handler、首页 UI、Flutter 页面或外部 provider 接入。

## 模块与接口

### Domain

`src/modules/diagnostic/domain/diagnostic-plan.ts`

- 定义诊断场景和任务的最小投影 DTO。
- 校验场景内容版本、任务位置和任务数量。
- 以稳定输入生成确定性的 3–5 任务计划。
- 拒绝未发布、任务不足、任务过多、重复位置和非连续位置。

`src/modules/diagnostic/domain/diagnostic-progress.ts`

- 表示当前任务位置、已完成数量、默认输入方式和稳定恢复状态。
- 提供推进、越序拒绝和完成判断。
- 将证据不足表达为明确的 `data-insufficient`/“正在建立画像”语义，不计算八维能力分数。

### Application

`src/modules/diagnostic/application/start-initial-diagnostic.ts`

- 接收已发布场景投影。
- 返回诊断计划和初始进度。
- 不访问数据库，不调用 provider，不把客户端画像当作事实。

`src/modules/diagnostic/application/complete-diagnostic-task.ts`

- 校验任务属于当前诊断计划且完成顺序合法。
- 接收现有 attempt evaluation 输入。
- 委托 `recordEvidence` 完成证据追加、幂等检查和技能快照重算。
- 只返回诊断进度与 evidence application 结果，不自行修改画像事实。

`src/modules/diagnostic/index.ts`

- 只导出诊断公共 DTO、领域函数和 application 用例。

## 内容

在 `content/bundles/alpha-core-v1.json` 中增加一个版本化初次诊断场景，使用现有已定义表达，形成 5 个连续任务：

1. `start.como-va-todo`：轻松开启交流。
2. `relationship.como-se-llama`：询问姓名。
3. `relationship.me-gusta-viajar`：分享兴趣。
4. `maintain.que-le-gusta-hacer`：追问对方兴趣。
5. `end.sigamos-en-contacto`：表达继续联系。

每个任务保留 `goalKey`、`targetExpressionKeys`、三级提示和 transfer 信息。内容先通过 Zod Schema、跨引用、位置和重复检查，再按 `draft → language-reviewed → pedagogy-reviewed → published` 流程处理。未完成审核的版本只能用于测试，不能进入生产推荐或诊断。

## 数据流

```text
已审核场景投影
  → startInitialDiagnostic
  → diagnostic progress
  → training transition（语音默认 / 打字降级）
  → recordEvidence
  → evidence events + profile snapshot
  → diagnostic progress / data-insufficient
```

语音评估的低置信度、静音、取消、技术失败和旧 generation 结果只能进入 ignored 或 recoverable 路径。没有有效证据时不降低能力，也不伪造完成状态。

## 错误与恢复

- 未发布场景或非法任务序列：整个计划拒绝，不返回部分任务。
- 任务越序或重复提交：返回稳定领域错误，不改变进度。
- 录音权限拒绝：训练层切换打字入口，不重复弹权限。
- 打字提交：保留语境/准确性等合资格证据，排除发音和语流技能。
- 评估失败、低置信度或旧 generation：不更新诊断进度、证据或画像，并保留可恢复断点。
- 完成 3–5 个任务后：如果画像证据仍不足，明确返回“正在建立画像”，不生成完整八维分数。

## 测试

新增：

- `tests/unit/diagnostic-plan.test.ts`
  - 合法 3–5 任务、稳定排序、内容版本和非法场景拒绝。
- `tests/unit/diagnostic-progress.test.ts`
  - 初始状态、顺序推进、越序/重复拒绝、输入方式和数据不足状态。
- `tests/unit/initial-diagnostic.test.ts`
  - application 委托 evidence、打字口语隔离、幂等、低置信度、技术失败和过期 generation。

内容变更运行 content validation；诊断领域运行相关 Vitest。全量 lint、typecheck 和全量测试按任务完成门禁执行，并记录现有工作区阻塞。

## 范围外

- 首页或探索页 UI 接入。
- Web/Flutter Route Handler 和 API 契约。
- 新数据库表或迁移。
- 外部 Speechace、MiniMax、Whisper 或其他 provider。
- 支付、后台、实时双向语音、离线 ASR。
