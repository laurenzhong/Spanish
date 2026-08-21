# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-21
- 当前里程碑：个人 Alpha 阶段 4——语音输入与供应商接入
- 总体状态：ALPHA-014 ready，建立发音评测 provider 契约与 fake 测试基线
- 协调分支：`main`
- 当前阻塞：无

## 新模型快速接手

进入仓库后按顺序执行：

1. 阅读 `AGENTS.md`，了解不可违反的产品、架构、测试和隐私规则。
2. 阅读本文件，确认任务 ID、状态、分支和下一步。
3. 只阅读当前任务引用的实施计划章节和相关规范，不必一开始加载所有文档。
4. 运行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
5. 确认没有其他模型正在处理同一任务后再修改文件。

如果用户只给出任务 ID，以下表格和对应计划章节就是任务范围。不得自行扩大到后续任务。

## 当前任务

### ALPHA-013：第一次产品体验复盘并决定语音评测供应商

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-013-provider-review`
- 计划位置：阶段 4 完成后的产品体验复盘
- 前置依赖：ALPHA-012，已完成（合并 `ffea486`）
- 实现 Commit：`a79b23b`
- PR：[#4](https://github.com/zjk159357/Spanish/pull/4)
- 合并 Commit：`e5db83d`

目标：

- 复盘当前 Web 训练微循环和移动视口体验。
- 比较 Speechace、Azure Speech Pronunciation Assessment 和 OpenAI STT + LLM。
- 决定后续发音评测供应商和接入边界。

结果：

- 推荐 Speechace 作为个人 Alpha 的西班牙语发音与流利度评测试点。
- 保留 Azure Speech 作为工程和成本备选，继续使用 OpenAI STT 做通用转写。
- 发音评测只用于抽样自主口语和明确口语复核，不用于打字、普通聊天或每轮默认调用。
- 低置信度、静音、技术失败和无效响应不得产生负面能力证据。
- 决策文档见 `docs/adr/0003-pronunciation-evaluation-provider.md`。

验证：

- `pnpm lint`、`pnpm typecheck`、91 个单测、7 个契约测试通过。
- 训练桌面和移动 E2E 6/6 通过。
- 未调用真实供应商 API。

### ALPHA-012：写入第一条真实证据并更新技能快照

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-012-real-evidence`
- 计划位置：实施计划任务 4.3–4.5
- 前置依赖：ALPHA-011，已完成（合并 `b1da744`）
- 实现 Commit：`bf51ffe`
- PR：[#3](https://github.com/zjk159357/Spanish/pull/3)
- 合并 Commit：`ffea486`

目标：

- 将训练评估转换为有界、可解释的证据事件。
- 在一个事务中幂等追加证据并重算用户技能快照。
- 保持低置信度、技术失败和打字口语隔离规则。

验收条件：

- 可信语音尝试可以写入 `evidence_events` 并更新 `user_skill_states`。
- 重复提交不增加证据数量，快照可以从历史事件重算。
- 低置信度、空转写和技术失败不产生负面能力证据。
- 打字证据不更新口语专属技能，原始转写正文不写入证据引用。

边界：

- 不接入训练 UI、Route Handler 或真实 OpenAI 调用。
- 不实现发音评估、推荐算法或完整画像展示。
- 不改变数据库 schema，不保存原始转写正文或长期录音。

## 活跃分支任务

| 任务 ID | 状态 | 分支 | 负责人/模型 | 范围 | 依赖 |
|---|---|---|---|---|---|
| ALPHA-011 | done | `feat/alpha-011-openai-stt`（已合并） | Codex | OpenAI 文件转写 provider、fake 与契约测试 | ALPHA-010 |
| ALPHA-012 | done | `feat/alpha-012-real-evidence`（已合并） | Codex | 证据评估、幂等写入与技能快照重算 | ALPHA-011 |
| ALPHA-013 | done | `feat/alpha-013-provider-review`（已合并） | Codex | 第一次产品体验复盘并决定后续语音评测供应商 | ALPHA-012 |
| ALPHA-014 | ready | — | 未分配 | 定义 PronunciationProvider 契约、稳定错误码、fake 与契约测试 | ALPHA-013 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来三个任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | ALPHA-014 | 定义 PronunciationProvider 契约、稳定错误码、fake 与契约测试 | ALPHA-013 完成 |
| 2 | 待编号 | 接入 Speechace 试用 API 的服务端适配器 | ALPHA-014 完成 |
| 3 | 待编号 | — | — |

完整任务顺序以实施计划的“首批可执行任务顺序”为准。本文件只展示最近任务，不复制全部 backlog。

## 分支任务交接规则

- 每个分支只负责一个任务 ID；不要把多个后续任务顺手放进同一分支。
- 同一任务只能有一个 `in_progress` 分支。
- 协调者在 `main` 上分配任务、负责人和目标分支后，再交给其他模型。
- 分支模型不得重新排列全局任务队列，也不得修改其他模型的任务状态。
- 分支模型完成后应提供：修改文件、测试结果、Commit、已知限制和建议下一步。
- 合并者在合并后更新本文件：把任务标为 `done`、记录 Commit，并提升下一任务。
- 如果任务跨越多个会话或需要大量上下文，可新增 `docs/tasks/<TASK-ID>.md`；简单任务不要额外建日志。
- 发现范围或架构需要变化时，将任务标为 `blocked` 并记录原因，等待用户决定，不能自行扩大范围。

## 当前关键决定

- 目标用户：学过语法和词汇但无法自然开口的 A2–B1 学习者。
- 首发形态：Next.js 完整 Web/PWA + Flutter iOS 同步个人 Alpha。
- 后续客户端：Flutter 同一代码线扩展 Android、Windows、macOS。
- 技术路线：Next.js/React/TypeScript Web，Flutter/Dart 客户端，Supabase、Drizzle、Zod、Vercel 远程模块化单体。
- 架构：单仓库、两条客户端代码线、版本化 API 和共同 JSON fixtures；不在 Alpha 提前拆微服务。
- iOS 不采用 Capacitor WebView；必要平台能力使用少量 Swift 桥接。
- 当前有 iPhone、无 Mac；iOS 编译、签名和真机音频验收尚不具备本地条件。
- 首页：只有一个主要入口“继续学习”。
- 听说是强核心；读写用于静默环境并需要后续口语验证。
- AI 社交世界首个主要好友：Lucía Martín，固定生活在马德里。
- Echo-Loop 当前只作为流程、Flutter 边界和可靠性参考；未来源码复用必须先记录作者授权范围、其他贡献者权利和许可义务。

权威细节见：

- `docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`
- `docs/superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md`
- `docs/adr/0001-nextjs-web-flutter-clients.md`
- `docs/plans/2026-08-20-personal-alpha-implementation-plan.md`
- `docs/architecture.md`
- `docs/content-authoring.md`
- `docs/testing-strategy.md`

## 最近完成

| 日期 | 结果 | Commit | 下一步影响 |
|---|---|---|---|
| 2026-08-20 | 完成并批准七节产品设计 | `6564952` | 可以编写个人 Alpha 实施文档 |
| 2026-08-20 | 完成实施计划、AGENTS、架构、内容、测试和 Echo-Loop 评审 | `494f270` | 可以开始 ALPHA-001 |
| 2026-08-20 | 完成 Next.js/PWA 脚手架、测试基线和响应式验证页 | `dba8bfb` | 可以开始 ALPHA-002 |
| 2026-08-20 | 完成 Web 与 Flutter 四栏产品壳层、平台 fake 和跨端测试基线 | `8420974` | 可以开始 ALPHA-002B |
| 2026-08-20 | 完成版本化 API 契约、稳定错误码和 TypeScript/Dart 共同 fixtures | `8342334` | 可以开始 ALPHA-003 |
| 2026-08-20 | 完成 31 张首批表、Drizzle Schema、空库迁移测试和数据库文档 | `b3b32e0` | 可以开始 ALPHA-004 |
| 2026-08-20 | 完成 Web/Flutter 邮箱 OTP、可靠 Token Gate、服务端鉴权和 RLS 隔离 | `d3171bb` | 可以开始 ALPHA-005 |
| 2026-08-21 | 完成版本化内容 Schema、跨端 DTO、严格校验与幂等事务导入 | `bb6979f` | 可以开始 ALPHA-006 |
| 2026-08-21 | 完成 11 条最小核心表达、草稿场景任务与内容包验证 | `13a6bb1` | 可以开始 ALPHA-007 |
| 2026-08-21 | 完成 TypeScript/Dart 训练编排器与共同状态转换测试 | `9b5eb27` | 可以开始 ALPHA-008 |
| 2026-08-21 | 完成 Web/Flutter fake 训练微循环与 Web 端到端验证 | `7d80a99` | 可以开始 ALPHA-009 |
| 2026-08-21 | 完成 Web/Flutter 训练断点保存与恢复并合并 | `1ef0268`（功能 `49b30d9`） | 可以开始 ALPHA-010 |
| 2026-08-21 | 完成浏览器与 Flutter TTS、录音和打字降级 | PR `#1`，合并 `98b1104`（功能 `469fc8d`，修复 `47150d7`） | 可以开始首个 STT 供应商适配器 |
| 2026-08-21 | 完成第一次产品体验复盘并决定发音评测供应商 | PR `#4`，合并 `e5db83d`（决策 `a79b23b`） | 可以开始 ALPHA-014 provider 契约与 fake 测试 |

最近完成只保留约 10–15 项。更早历史通过 `git log` 和实施计划查询。

## 更新模板

开始任务时更新：

```text
任务：ALPHA-XXX
状态：in_progress
分支：feat/alpha-xxx-description
负责人/模型：名称
开始日期：YYYY-MM-DD
```

完成并合并后更新：

```text
状态：done
Commit：abcdef0
验证：执行的检查及结果
下一任务：ALPHA-YYY
```
