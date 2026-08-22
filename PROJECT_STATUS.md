# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-22
- 当前里程碑：个人 Alpha 阶段 4——语音输入与供应商接入
- 总体状态：授权音频批处理器已完成；首批 5 条已尝试运行并因当前环境无法连接 OpenAI 转写服务而部分失败
- 协调分支：`main`
- 当前阻塞：`api.openai.com:443` 当前环境 TCP 不可达；结果文件已保存 5 条可重试失败，默认恢复会跳过，不上传教材音频

## 新模型快速接手

进入仓库后按顺序执行：

1. 阅读 `AGENTS.md`，了解不可违反的产品、架构、测试和隐私规则。
2. 阅读本文件，确认任务 ID、状态、分支和下一步。
3. 只阅读当前任务引用的实施计划章节和相关规范，不必一开始加载所有文档。
4. 运行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
5. 确认没有其他模型正在处理同一任务后再修改文件。

如果用户只给出任务 ID，以下表格和对应计划章节就是任务范围。不得自行扩大到后续任务。

## 当前任务

### 待编号：授权音频小批量标注校准

- 状态：`blocked`
- 负责人：Codex
- 目标分支：`main`
- 前置依赖：ALPHA-020，已完成（合并 `a8893a1`）
- 实现 Commit：`0aa6a28`，参数修复 `a5b8bbc`

结果：

- 已实现 OpenAI `gpt-transcribe` → MiniMax-M3 文本标注草稿的 server-only 批处理器。
- 仅处理外部 manifest 允许的 5 条自有 MP3；MiniMax 输入固定为转写文本和 `speechSignal: null`。
- 结果写入外部 `calibration-results-v1.json`，不写数据库、evidence、mastery、confidence，不保存原始音频或供应商原始响应。
- 首次运行 5 条均在 OpenAI 转写阶段返回稳定错误 `provider-unavailable`；MiniMax 未被调用。
- 默认恢复已验证：5 条失败项被跳过，只有 `--retry-failed` 才会再次请求。

阻塞解除条件：

- 当前执行环境能够访问 `api.openai.com:443` 后，再使用同一输出文件运行 `--retry-failed`。
- 在此之前不切换到未批准的音频转写供应商，也不重复请求以规避网络错误。

### ALPHA-017：将 Speechace provider 接入训练 application

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-017-pronunciation-application`
- 计划位置：Speechace provider 与回放集之后的 application 编排切片
- 前置依赖：ALPHA-016，已完成（合并 `24f782f`）
- 实现 Commit：`b96ac1a`
- PR：[#8](https://github.com/zjk159357/Spanish/pull/8)
- 合并 Commit：`d4a30a5`

目标：

- 通过 training application 调用内部 `PronunciationProvider`。
- 拒绝打字、过期 generation、空音频和未明确口语复核的请求。
- 将 provider 结果转换为安全的内部发音观察，不泄漏 Speechace DTO。
- 保持 `insufficient`、取消、超时和技术失败为待验证/可恢复结果，不写负面能力证据。

边界：

- 不接入 React/Flutter UI，不调用真实 Speechace API。
- 不写 `evidence_events`，不更新 `mastery` 或 `confidence`。
- 不把供应商分数直接当作语境成功或总能力分数。

### ALPHA-018：零成本语音信号观察与可选标注边界

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-018-zero-cost-speech-observation`
- 计划位置：真实音频校准前的免费默认路径
- 前置依赖：ALPHA-017，已完成（合并 `d4a30a5`）
- 设计 Commit：`70e2fef`
- 实现 Commit：`8d14a9f`
- PR：[#9](https://github.com/zjk159357/Spanish/pull/9)
- 合并 Commit：`4031075`

目标：

- 增加独立于 `PronunciationProvider` 的本地语音信号观察契约与确定性 fake。
- 覆盖短期音频的时长、停顿和有限能量信号，不产生发音分数或能力画像更新。
- 增加只读外部音频回放清单工具，只保存哈希和脱敏元数据，不复制或上传音频。
- 为未来 MiniMax 标注辅助保留显式、可校验、默认关闭的边界；本任务不接入具体模型 API。

边界：

- 不实现离线 ASR、音素级评分、自动母语者标注或训练微调。
- 不接入 React/Flutter UI、数据库迁移或真实供应商调用。
- 不把教材音频提交到仓库，不把本地信号写入 `evidence_events`、`mastery` 或 `confidence`。

验证：

- `pnpm lint`、`pnpm typecheck`、28 个测试文件/143 个单测、19 个契约测试和 `pnpm build` 通过。
- 外部音频清单 dry-run 识别 68 个 MP3，跳过 `.downloading` 文件，不输出绝对路径，不上传或复制音频。
- 未调用 MiniMax、Speechace 或其他真实供应商 API；未提交教材音频、API key、原始响应或长期录音。

### ALPHA-020：校准前置门禁与 dry-run

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-020-calibration-gate`
- 前置依赖：ALPHA-019，已完成（合并 `1b26526`）
- 实现 Commit：`93cdcc5`
- 合并 Commit：`a8893a1`

目标：

- 校验回放清单条目授权、来源许可和第三方处理许可是否同时明确确认。
- 拒绝空清单、重复音频哈希、无效大小、待确认授权和超出小批量上限的输入。
- 提供只读 `audio:calibration:check` dry-run，不读取、复制或上传音频，不调用 MiniMax/Speechace，不写 evidence 或 profile。

验证：

- `pnpm lint`、`pnpm typecheck`、31 个测试文件/163 个测试和 `pnpm build` 通过。
- 缺失授权记录的 CLI dry-run 返回 `authorization-record-missing` 阻塞结果并退出码 1。
- 未提交真实音频、许可原文、API key、供应商响应或长期录音。

### ALPHA-016：建立西班牙语发音评测回放集与人工标注

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-016-pronunciation-replay-set`
- 计划位置：Speechace provider 接入后的质量校准切片
- 前置依赖：ALPHA-015，已完成（合并 `1d503aa`）
- 实现 Commit：`564d209`
- PR：[#7](https://github.com/zjk159357/Spanish/pull/7)
- 合并 Commit：`24f782f`

目标：

- 建立版本化西班牙语发音评测回放样本和 manifest。
- 覆盖清晰语音、自然替代、明显发音问题、停顿、噪声、静音、截断及 `es-ES`/`es-MX`。
- 记录人工标注状态、预期语境结果、允许范围和不应更新的技能。
- 确保样本不包含真实音频、完整私密转写、供应商响应或 API 凭据。

边界：

- 不调用真实 Speechace、Azure 或其他模型 API。
- 不把样本直接接入训练 application、evidence、mastery 或 confidence。
- 人工标注初始状态允许为 `pending`，不能伪造已完成母语者审核。

验证：

- `pnpm lint`、`pnpm typecheck`、118 个单测、19 个契约测试和 `pnpm build` 通过。
- 只提交合成元数据；未提交真实音频，未调用 Speechace、Azure 或其他模型 API。
- 人工标注保持 `pending`，未接入训练 application、evidence、mastery 或 confidence。

### ALPHA-014：建立发音评测 provider 契约与 fake 测试基线

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-014-pronunciation-contract`
- 计划位置：ALPHA-013 决策后的 provider 契约切片
- 前置依赖：ALPHA-013，已完成（合并 `e5db83d`）
- 实现 Commit：`830f930`
- PR：[#5](https://github.com/zjk159357/Spanish/pull/5)
- 合并 Commit：`0b972b3`

目标：

- 定义内部 `PronunciationProvider` 输入、结果和稳定错误码。
- 提供不调用真实供应商的 deterministic fake。
- 覆盖可用结果、不足音频、输入校验、失败和取消语义。

结果：

- 契约位于 `src/modules/providers/pronunciation/`，支持 `es-ES` 和 `es-MX` locale。
- 结果只包含发音、流利度、韵律、完整度指标和安全调用元数据，不包含原始转写正文。
- `quality: "insufficient"` 使用空指标表示待验证，不产生负面分数。
- 架构与测试策略已补充 provider 隔离、隐私和 fake 契约要求。

验证：

- `pnpm lint`、`pnpm typecheck`、99 个单测、15 个契约测试通过。
- 未调用真实 Speechace API，未修改数据库、训练 UI 或 Flutter 客户端。

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
| ALPHA-014 | done | `feat/alpha-014-pronunciation-contract`（已合并） | Codex | 定义 PronunciationProvider 契约、稳定错误码、fake 与契约测试 | ALPHA-013 |
| ALPHA-015 | done | `feat/alpha-015-speechace-adapter`（已合并） | Codex | 接入 Speechace 试用 API 的服务端适配器 | ALPHA-014 |
| ALPHA-016 | done | `feat/alpha-016-pronunciation-replay-set`（已合并） | Codex | 建立西班牙语发音评测回放集与人工标注 | ALPHA-015 |
| ALPHA-017 | done | `feat/alpha-017-pronunciation-application`（已合并） | Codex | 将 Speechace provider 接入训练 application | ALPHA-016 |
| ALPHA-018 | done | `feat/alpha-018-zero-cost-speech-observation`（已合并） | Codex | 零成本语音信号观察与可选标注边界 | ALPHA-017 |
| ALPHA-019 | done | `feat/alpha-019-minimax-annotation-draft`（已合并） | Codex | MiniMax 文本与本地信号摘要标注草稿 provider；不上传音频、不写证据 | ALPHA-018 |
| ALPHA-020 | done | `feat/alpha-020-calibration-gate`（已合并） | Codex | 校准前置许可门禁、只读 dry-run 和阻塞测试 | ALPHA-019 |
| 待编号 | blocked | `main` | Codex | 授权音频小批量标注校准；等待 OpenAI 网络可达后重试 | ALPHA-020 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来三个任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | 待编号 | 重试授权音频小批量标注校准 | `api.openai.com:443` 可达；现有失败结果可用 `--retry-failed` 恢复 |
| 2 | 待编号 | 复核校准结果并决定是否进入有限 provider 抽样 | 小批量人工复核完成，未发现许可或评分污染问题 |
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
| 2026-08-21 | 完成 PronunciationProvider 契约、fake 与契约测试 | PR `#5`，合并 `0b972b3`（功能 `830f930`） | 可以开始 ALPHA-015 Speechace 服务端适配器 |
| 2026-08-22 | 完成 Speechace 服务端适配器、错误边界与隐私测试 | PR `#6`，合并 `1d503aa`（功能 `f60fe9a`） | 可以建立西班牙语发音评测回放集与人工标注 |
| 2026-08-22 | 完成西班牙语发音评测回放集、Schema 与标注契约 | PR `#7`，合并 `24f782f`（功能 `564d209`） | 可以准备真实音频人工校准，并在校准门槛满足后开始 ALPHA-017 |
| 2026-08-22 | 完成 Speechace provider training application 编排与安全错误映射 | PR `#8`，合并 `d4a30a5`（功能 `b96ac1a`） | 可以在用户确认并准备合规音频后进行真实回放与人工标注校准 |
| 2026-08-22 | 完成零成本语音信号观察、外部音频哈希清单与可选标注边界 | PR `#9`，合并 `4031075`（功能 `8d14a9f`） | 可以在获得 MiniMax 接口信息、合规音频和第三方处理许可后进行小批量标注校准 |
| 2026-08-22 | 完成 MiniMax 文本标注草稿 provider 与安全边界 | PR `#10`，合并 `1b26526`（功能 `523432e`） | 可以在获得合规音频和明确第三方处理许可后进行小批量标注校准；原始音频仍不上传 |
| 2026-08-22 | 完成校准前置许可门禁与只读 dry-run | 合并 `a8893a1`（功能 `93cdcc5`） | 可在许可和合规音频满足时运行小批量校准；当前仍默认阻塞 |
| 2026-08-22 | 完成授权音频转写与 MiniMax 标注批处理器，并执行首批 5 条 | `0aa6a28`，参数修复 `a5b8bbc` | 5 条均因 OpenAI 网络不可达失败；恢复与重试边界已验证，等待网络后再运行 `--retry-failed` |

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
