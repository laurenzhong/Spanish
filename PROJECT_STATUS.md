# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-25
- 当前里程碑：个人 Alpha 阶段 7——角色扩展、进步展示与隐私控制
- 总体状态：阶段 8 个人 Alpha 验证可恢复；UI-004 已完成，等待 UI-005 后再开始全面人工体验
- 协调分支：`main`
- 当前阻塞：未配置针对真人视频的外部 provider 凭据和第三方处理授权；继续使用本地诊断，不上传视频

## 新模型快速接手

进入仓库后按顺序执行：

1. 阅读 `AGENTS.md`，了解不可违反的产品、架构、测试和隐私规则。
2. 阅读本文件，确认任务 ID、状态、分支和下一步。
3. 只阅读当前任务引用的实施计划章节和相关规范，不必一开始加载所有文档。
4. 运行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
5. 确认没有其他模型正在处理同一任务后再修改文件。

如果用户只给出任务 ID，以下表格和对应计划章节就是任务范围。不得自行扩大到后续任务。

## 当前任务

当前任务为 UI-005：好友介绍、共享授权和 Flutter/Web 全模块验收；阶段 8 全面人工体验继续等待 UI-001 至 UI-005 功能门槛完成。阶段记录见 [`docs/tasks/STAGE-8-PERSONAL-ALPHA.md`](docs/tasks/STAGE-8-PERSONAL-ALPHA.md)。

### 阶段 7 已完成切片

| 切片 | 实现 Commit | 结果 |
|---|---|---|
| 7.1 / ALPHA-030 | `f35ebcb` | 好友介绍与角色网络 |
| 7.2 | `42195e4` | 八维能力图历史对比与代表性证据 |
| 7.3 | `2d2ab4d` | 有效学习活动与热力图数据 |
| 7.4a | `0363368` | 关系记忆查看、删除与共享授权级联 |
| 7.4b | `014c2ac` | 已保存录音与语音转写控制 |
| 7.4c | `c539cc9` | 账号数据汇总、删除、去标识化与 Storage 清理任务 |
| 7.5a | `91c3639` | 关联 ID、供应商调用状态/延迟/成本观测与脱敏记录 |
| 7.5b | `75d74df` | 诊断事件、滑动窗口告警聚合与备份恢复演练说明 |
| 7.6 | `88b2113` | 手机视口 Web E2E 与 Flutter fake integration test 关键路径 |
| 阶段 8 阻塞修复 | `4648972` | 训练提示、自然替代表达与真实变式闭环（Web/Flutter） |
| UI-001 | `8ab9cc6` | 认证回跳、四栏导航和学习入口功能闭环 |

7.4c 限制：实际 Storage 删除需要配置服务端 `SUPABASE_SERVICE_ROLE_KEY`；未配置或供应商失败时，私有数据库数据仍完成删除，清理任务保留为失败/可重试状态。该服务端密钥不能进入客户端或日志。

### 7.5a：关联 ID 与供应商调用观测

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：7.4c，已完成
- 计划位置：实施计划任务 7.5
- 实现 Commit：`91c3639`

结果：

- 新增 `shared/observability` 关联 ID 和脱敏 provider 观测契约；支持 `requestId`、`sessionId`、`attemptId`、`conversationId`、`generationId`。
- 新增 `provider_calls` repository；记录 provider、模型、状态、错误类型、延迟、估算成本和供应商请求 ID，观测写入失败不改变业务结果。
- 发音评估 application 和 Lucía 聊天流接入观测；聊天响应返回 `x-request-id`，无效请求 ID 由服务端生成。
- 数据库迁移 `0008`/`0009` 增加关联字段和 request/attempt 查询索引；记录不保存原始音频、完整对话、令牌或签名 URL。

修改文件：

- `src/shared/observability/`
- `src/modules/providers/repositories/`
- `src/modules/training/application/assess-pronunciation.ts`
- `app/api/v1/conversations/[characterId]/stream/route.ts`
- `src/shared/db/schema/infrastructure.ts`
- `drizzle/0008_broad_chronomancer.sql`、`drizzle/0009_oval_namora.sql`
- `docs/architecture.md`、`docs/database.md`、`docs/testing-strategy.md`、实施计划

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm db:check` 通过。
- 全量 Vitest：72 个文件、308 个测试通过。
- `pnpm build` 通过。
- `pnpm test:e2e`：48/48 通过。

限制与下一步：

- 当前聊天仍使用 deterministic fake；真实供应商接入沿用同一 observer 边界，真实成本只有 provider 返回估算值时才可记录。
- 7.5a 只提供结构化记录和查询索引，尚未实现告警规则、诊断查询界面、数据库备份或恢复演练。
### 7.5b：诊断告警与备份恢复演练

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：7.5a，已完成
- 计划位置：实施计划任务 7.5
- 实现 Commit：`75d74df`

结果：

- 新增 append-only `diagnostic_events` 表、CHECK 约束、dedupe 唯一键和 RLS；客户端角色无任何读写权限。
- 接入异常断流、重复证据、记忆冲突和 Storage 清理失败事件；事件 metadata 只允许短标量值，写入失败不改变原业务结果。
- 新增内部 `GET /api/v1/internal/diagnostics`，使用 `DIAGNOSTICS_INTERNAL_TOKEN` 鉴权，支持类型/级别/状态/时间窗口/数量过滤，并返回脱敏事件和聚合告警。
- 新增按事件类型和错误类型的滑动窗口聚合规则；偶发事件为 warning，达到阈值后为 alert，不发送外部通知。
- 新增 `docs/operations/backup-restore-drill.md`，记录 RPO/RTO、隔离恢复、迁移/RLS/关键路径验收、Storage 限制和演练模板。

修改文件：

- `src/modules/observability/`
- `src/shared/observability/`
- `app/api/v1/internal/diagnostics/`
- `drizzle/0010_watery_ogun.sql`
- `docs/operations/backup-restore-drill.md`
- 证据、记忆、账号删除和聊天流 application 接入

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm db:check` 通过。
- 全量 Vitest：74 个文件、312 个测试通过。
- `pnpm build` 通过。
- `pnpm test:e2e`：48/48 通过。

限制与下一步：

- 当前告警只提供内部查询和聚合，不发送 Slack、邮件或 PagerDuty 通知。
- 备份恢复文档是可执行演练流程，本次未连接或恢复真实生产数据库；Storage 对象仍需单独备份策略。
- 下一项为 7.6：完整 Web E2E 与 Flutter 集成测试。

### 7.6：完整 Web E2E 与 Flutter 集成测试

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：7.5b，已完成
- 计划位置：实施计划任务 7.6
- 实现 Commit：`88b2113`

结果：

- 新增 `tests/e2e/alpha-flow.spec.ts`，在手机视口覆盖继续学习、三级提示、自然替代表达、打字降级、画像数据不足、内容包听读写到口语复核、Lucía 断流重试和角色消息去重。
- 新增 `apps/mobile/integration_test/alpha_flow_test.dart`，使用内存 OTP 会话、`FakeSecureStorage`、麦克风拒绝 fake 和可控 Lucía 流覆盖认证、训练降级、三层提示、反馈和不完整流重试。
- Flutter 增加 `integration_test` SDK 开发依赖；没有修改服务端评分、证据、记忆或权限逻辑。

修改文件：

- `tests/e2e/alpha-flow.spec.ts`
- `apps/mobile/integration_test/alpha_flow_test.dart`
- `apps/mobile/pubspec.yaml`、`apps/mobile/pubspec.lock`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm exec vitest run --pool=threads --maxWorkers=1`：74 个文件、313 个测试通过。
- `pnpm test:e2e`：56/56 通过（桌面与手机项目）。
- `pnpm build` 通过。
- `cd apps/mobile; flutter analyze` 通过。
- `cd apps/mobile; flutter test`：60 个公共 Dart/Widget 测试通过。

限制与下一步：

- `flutter test integration_test/alpha_flow_test.dart` 在当前 Windows 环境未能启动：Flutter 需要 Developer Mode 创建插件 symlink；测试文件已通过 `flutter analyze`，但不能据此宣称 Flutter integration 或 iOS 编译通过。
- 没有 Mac/Xcode，因此真实 iOS 录音权限、键盘、安全区、生命周期和真机集成仍待阶段 8 的设备验收。
- Playwright 使用空数据库和确定性 fake；它验证客户端状态、降级和恢复契约，不替代真实 Supabase/RLS 生产验收。当前仓库仍没有独立初次诊断页面，Web 测试以现有继续学习与有限画像空状态为边界。
- 下一项为阶段 8：个人 Alpha 使用周期与人工体验复核；准备 Mac/Xcode 后补跑 Flutter integration 和 iOS 真机关键路径。

### 阶段 8：训练闭环阻塞修复

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：7.6，已完成
- 实现 Commit：`4648972`

结果：

- fake evaluator 按交际目的识别自然替代表达，并将 `.variant.N` 归一化到基础任务。
- Web 与 Flutter 的“练习变式”会加载内容包中的真实新表达，并显示“变式情境”。
- 提示 1/2/3 展示渐进提示内容，状态机继续记录提示级别。
- Web/Flutter 单元、Widget 和手机视口 E2E 覆盖上述闭环。

验证：

- `pnpm lint`、`pnpm typecheck` 通过。
- 全量 Vitest：74 个文件、315 个测试通过。
- `pnpm build` 通过。
- 训练 E2E 手机视口：5/5 通过；完整 E2E：56/58 通过，另 2 条为既有内容包进度文案和关系记忆删除提示失败，与本修复无关。
- `flutter analyze`、`flutter test` 通过（63 个测试）。

限制与下一步：

- 当前仍使用确定性 fake evaluator，不代表真实供应商评估质量。
- 没有 Mac/Xcode，Flutter integration 和 iOS 真机录音仍未验收。
- 阶段 8 可重新开始人工体验；先记录首轮修复后的训练、静默模式和聊天体验。

### UI-001：认证、导航和学习入口功能闭环

- 状态：`done`
- 负责人：Codex
- 实现 Commit：`8ab9cc6`

结果：

- 登录页读取 Next.js 16 `searchParams`，OTP 和测试账号密码登录成功后返回原始站内目标。
- 非法、外部、登录页自身的 `next` 参数统一回退到 `/learn`，避免开放重定向。
- 四栏导航与学习入口现有行为保持不变，并补充登录交接回归覆盖。

验证：

- Web 单元：认证回跳、站内目标校验和表单行为 14/14 通过。
- Flutter 认证/导航 Widget 测试 7/7 通过。
- Web 手机视口认证回跳和四栏导航 E2E 3/3 通过。
- `pnpm lint`、`pnpm typecheck` 通过。

限制与下一步：

- Flutter 当前没有 Web 式深链登录回跳；本切片不改变其单一产品入口。
- 下一项 `UI-002`：探索内容包的播放、展开、完成、断点和口语复核闭环。

### UI-002：探索内容包功能闭环

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：UI-001，已完成
- 实现 Commit：`429c225`

结果：

- Flutter 探索页新增“咖啡馆内容包”入口，支持播放全文、TTS 失败降级、展开西语/中文、输入回复、口语复核和换情境迁移。
- 内容包进度、两个草稿和完成步骤通过安全存储恢复；存储不可用或数据损坏时保留可用的内存流程。
- 口语复核沿用用户断点存储；内容包本身不写入 `evidence_events`、`mastery` 或 `confidence`。
- 修复输入后按钮不刷新、迁移步骤无完成动作、嵌套 `setState` 和朗读异步释放边界。

修改文件：

- `apps/mobile/lib/features/content/fakes/fake_content_pack.dart`
- `apps/mobile/lib/features/explore/explore_page.dart`
- `apps/mobile/lib/shared/widgets/product_shell.dart`
- `apps/mobile/test/features/content/fake_content_pack_test.dart`
- `apps/mobile/test/app_navigation_test.dart`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过（先执行 `pnpm build` 生成 Next.js 类型后复跑）。
- `pnpm build` 通过。
- `pnpm exec vitest run tests/unit/content-pack.test.tsx --pool=threads --maxWorkers=1`：5/5 通过。
- 内容包与 Alpha 手机视口 E2E：6/6 通过。
- `flutter analyze` 通过。
- `flutter test`：68 个公共 Dart/Widget 测试通过。

限制与下一步：

- Flutter 端仍使用本地 fake 内容和确定性 fake TTS，不代表真实内容 provider 或 iOS 音频能力已验收。
- 当前环境没有 Mac/Xcode，未执行 iOS 编译、签名或真机验证。
- 下一项 `UI-003`：Lucía 对话发送、停止、断流和重试闭环。

### UI-003：Lucía 对话发送、停止、断流和重试闭环

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：UI-002，已完成
- 实现 Commit：`e0b7b0c`

结果：

- Web 对话状态机在首个角色 `meta` 事件之前发生 HTTP/流错误或取消时，仍保留最近一条用户消息作为重试目标。
- Flutter 对话停止回复时保存当前用户文本，首包失败、断流和停止后都可以点击“重新发送”，且不会重复添加用户消息。
- 保持 generation/取消边界，旧流回调不能污染重试后的新一轮回复；未完成回复继续明确提示不产生学习评分。

修改文件：

- `src/modules/conversation/domain/conversation-state.ts`
- `apps/mobile/lib/features/conversation/ui/chat_thread.dart`
- `tests/unit/conversation.test.ts`
- `tests/e2e/conversation.spec.ts`
- `apps/mobile/test/features/conversation/conversation_stream_test.dart`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过（先执行 `pnpm build` 生成 Next.js 类型后复跑）。
- `pnpm build` 通过。
- Web 对话单测：12/12 通过。
- Web 对话移动端 E2E：6/6 通过。
- `flutter analyze` 通过。
- `flutter test`：69 个公共 Dart/Widget 测试通过。

限制与下一步：

- 对话回复仍使用确定性 fake，不代表真实 provider 生成质量或网络环境验收。
- 当前环境没有 Mac/Xcode，未执行 iOS 编译、签名或真机验证。
- 下一项 `UI-004`：画像、热力图和隐私数据控制闭环。

### UI-004：画像、热力图和隐私数据控制闭环

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：UI-003，已完成
- 实现 Commit：`8857364`

结果：

- Flutter 画像页支持八维能力选择、当前维度状态和“数据不足/待验证”语义；不使用伪造分数，也不把学习时长写入能力评分。
- Flutter 新增本地确定性 fake 热力图，支持选择日期并查看有效学习分钟数和场景；新增关系记忆、保存录音和账号数据删除确认，确认后只移除当前设备演示资料并明确不修改服务端能力证据。
- Web 画像失败恢复测试覆盖请求失败后点击“重试”并成功恢复；现有 Web 画像、热力图和隐私 API 闭环保持不变。

修改文件：

- `apps/mobile/lib/features/profile/profile_page.dart`
- `apps/mobile/test/features/profile/profile_page_test.dart`
- `tests/unit/profile-overview-panel.test.tsx`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- 全量 Vitest：75 个文件、322 个测试通过。
- `pnpm test:e2e`：桌面与手机共 64/64 通过。
- `flutter analyze` 通过。
- `flutter test`：71 个公共 Dart/Widget 测试通过。
- 画像相关 Web 单测：4/4 通过；画像/隐私 Web 手机视口 E2E：15/15 通过。

限制与下一步：

- Flutter 当前使用本地 fake 画像、热力图和删除流程，仅用于验证客户端按钮与状态逻辑；真实服务端画像、删除 API、数据库/RLS 未在本切片重复实现。
- 当前环境没有 Mac/Xcode，未执行 Flutter iOS 编译、签名、真机录音或 integration test 验收；公共 Flutter 测试通过不代表 iOS 已验证。
- 下一项 `UI-005`：好友介绍、共享授权和 Flutter/Web 全模块验收。

### ALPHA-029：角色回复规划

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：ALPHA-028，已完成
- 计划位置：实施计划任务 6.3
- 实现 Commit：`b1ea5a9`

范围：

- 先生成结构化回复计划，再生成西班牙语表面文本。
- 回复计划覆盖真实回应、情绪、关系阶段、追问/分享/换话题、自然学习机会和回复长度。
- 记忆上下文只读取当前角色可读的关系记忆；教学机会不能替代对用户内容的回应。
- 保留现有 NDJSON `meta`、`delta`、`done`、`error` 协议，以及取消、重试和 generation 边界。

验收：

- 纯 TypeScript domain/application 可独立确定性测试。
- AI 身份询问、情绪表达、自然追问和角色边界有固定回放断言。
- 私密关系记忆不会从其他角色上下文进入回复；无 `done` 的流不触发后续记忆提取。

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm exec vitest run --maxWorkers=1`：54 个文件、259 个测试通过。
- `pnpm build` 通过。

限制与下一步：

- 当前仍使用 deterministic fake，没有真实 LLM/provider；回复规划接口已为后续 provider 保留替换边界。
- ALPHA-030 已在 `f35ebcb` 完成；好友介绍和角色联系人流程已进入阶段 7 完成切片记录。
- 7.4c 已在 `c539cc9` 完成；7.5a 已在 `91c3639` 完成；7.5b 已在 `75d74df` 完成，当前下一项为 7.6。

### ALPHA-028：关系记忆与共享权限

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：ALPHA-027，已完成
- 计划位置：实施计划任务 6.4
- 实现 Commit：`8a4b836`
- 后续修复 Commit：`316a50a`

结果：

- 新增纯 TypeScript 记忆候选提取、重复/冲突分类和事务提交用例。
- 只从完整 `done` 对话轮提取用户第一人称事实；候选默认 `private`。
- 新增关系记忆仓库、显式共享许可、撤销、删除和当前角色可读投影。
- 对话流只在助手消息持久化完成后触发记忆提取；提取失败不会把已完成回复标为失败。

修改文件：

- `src/modules/memory/`
- `app/api/v1/conversations/[characterId]/stream/route.ts`
- `src/shared/db/schema/characters.ts`
- `drizzle/0004_calm_iron_monger.sql`
- `tests/unit/memory.test.ts`
- `tests/unit/conversation-route-persistence.test.ts`
- `tests/database/memory-persistence.test.ts`
- `docs/database.md`

验证：

- 关系记忆领域、对话持久化和数据库共享权限测试通过。
- 迁移保持版本化；客户端不能直接写关系记忆或共享权限。

限制与下一步：

- 当前没有 LLM/provider；回复仍由 deterministic fake 生成。
- Lucía 人物仍为 `draft`，生产发布继续受审核门禁约束。
- 下一项为 ALPHA-029：角色回复规划。

以下为前序任务记录：ALPHA-027 对话消息流及消息持久化基础；前置任务 ALPHA-026 已完成。

### ALPHA-027：对话消息流

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：ALPHA-026，已完成
- 计划位置：实施计划任务 6.2
- 实现 Commit：`ecdfd03`
- 后续修复 Commit：`cf68679`, `018048d`
- 持久化补充 Commit：本次提交（以当前分支最新 commit 为准）

结果：

- 新增纯 TypeScript `conversation` domain/application：版本化 NDJSON `meta`、`delta`、`done`、`error` 协议、任意 chunk 解析、确定性 fake Lucía 回复和 generation 状态机。
- 新增鉴权 Route Handler `/api/v1/conversations/[characterId]/stream`，仅允许 `lucia@1`；消息持久化只在服务端通过 repository 完成，不调用网络、LLM/provider。
- Web 新增 `/chat/lucia` 消息线程；用户消息先出现，只有收到 `done` 才标记角色消息完成；停止、断流、stale generation 和重试可预测。
- Flutter 新增同协议解析器、fake 流、消息线程和语音 composer；无 STT 时只降级到打字，不伪造转写、不上传或保存录音。
- `/chat` 保留原有“先练一句”入口，并新增“打开对话”进入 Lucía 线程。
- Web composer 支持 `Enter` 发送、`Shift+Enter` 换行，避免只能点击发送按钮。

修改文件：

- `src/modules/conversation/`
- `app/api/v1/conversations/[characterId]/stream/route.ts`
- `app/(product)/chat/[characterId]/page.tsx`
- `app/(product)/chat/page.tsx`
- `src/modules/conversation/ui/`
- `apps/mobile/lib/features/conversation/`
- `apps/mobile/lib/features/chat/chat_page.dart`
- `tests/unit/conversation.test.ts`
- `apps/mobile/test/features/conversation/conversation_stream_test.dart`
- `tests/e2e/conversation.spec.ts`
- `docs/superpowers/specs/2026-08-24-conversation-message-stream-design.md`
- `app/globals.css`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm test --run tests/unit`：37 个文件、190 个测试通过。
- `pnpm test:contracts`：5 个文件、27 个测试通过。
- `pnpm build` 通过，动态对话页和 Route Handler 已纳入构建。
- `flutter analyze` 通过；`flutter test`：58 个测试通过。
- `pnpm test --run` 全量 235 个测试中 232 个通过；3 个既有 PGlite/数据库测试因本机初始化超过 10 秒超时，不涉及 conversation 改动。
- 新增 Playwright 未执行：3000 端口已有用户开发服务，Playwright 配置要求独占该端口；未停止或修改该服务。
- 浏览器实际验证：`Enter`/`Shift+Enter` 路径通过；消息显示“已送达”，回复文本完整，控制台无错误。

限制与下一步：

- 回复仍是本地 fake，不代表最终生成质量。Web 已通过历史 GET 在刷新/重开后恢复 completed 消息；助手半截、失败或取消回复不入库。
- Flutter 已加入历史读取客户端抽象和 HTTP 历史实现，但当前生产流式 transport 仍是后续切片；现有 Flutter 聊天默认继续使用 deterministic fake。
- 当前开发服务未配置 `DATABASE_URL` 时，聊天页会明确提示消息未保存；配置可用 PostgreSQL 后，Web 才能在切换页面/刷新后恢复消息。
- 2026-08-24 已配置 Supabase PostgreSQL；Drizzle `0000`–`0003` 迁移已应用，`conversations_user_character_uidx` 已在远程数据库存在。当前远程 `characters`、`conversations`、`messages` 为空，真实 Lucía 写入需先导入角色/内容并使用已有用户 profile 验证。
- 语音入口只验证录音能力和文字降级，真实 STT/语音消息留给后续 provider 任务。
- 后续 ALPHA-028 已完成关系记忆与共享权限；当前执行 ALPHA-029 角色回复规划。

### ALPHA-027 后置数据库准备切片

状态：`done`

结果：

- 新增独立人物导入 application/repository 与 `pnpm character:import` 脚本，按人物圣经校验并幂等写入 `characters` 与 `character_canon_facts`。
- 新增 `pnpm auth:repair-profiles` 脚本，只为现有 `auth.users` 补建缺失的 `profiles` 和 `user_preferences`，不修改认证信息、关系记忆或能力数据。
- 已执行远程 Supabase 初始化：`profiles=1`、`user_preferences=1`、`characters=1`、`character_canon_facts=4`；Lucía `lucia@1` 保持 `draft`。
- `pnpm character:import` 连续执行结果为 `imported`、`unchanged`，证明同版本导入幂等；不同内容会拒绝覆盖。

修改文件：

- `src/modules/characters/application/import-character-bible.ts`
- `src/modules/characters/repositories/character-repository.ts`
- `src/modules/characters/repositories/drizzle-character-repository.ts`
- `src/modules/characters/repositories/index.ts`
- `src/modules/characters/index.ts`
- `scripts/import-character.ts`
- `scripts/ensure-auth-profiles.ts`
- `tests/unit/character-import.test.ts`
- `package.json`

验证：

- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `pnpm test --run tests/unit/character-import.test.ts`：3 个测试通过。
- `pnpm test --run tests/database`：5 个文件、20 个测试通过。
- `pnpm test --run --maxWorkers=1`：50 个文件、244 个测试通过；默认并发运行曾触发 Windows Node worker 内存耗尽，已用单 worker 完成全量验证。

限制与下一步：

- Lucía 仍是 `draft`，未绕过审核门禁；生产聊天不可因本切片自动开放 draft 角色。
- 关系记忆与共享权限已在 ALPHA-028 完成；当前进入 ALPHA-029。

### ALPHA-026：Lucía 人物圣经

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`（功能提交保持独立）
- 前置依赖：ALPHA-025，已完成
- 计划位置：实施计划任务 6.1

实现 Commit：`c46bea8`

结果：

- 新增版本化 `content/characters/lucia.json`，初始为 `lucia@1`、`draft`。
- 固定 v1 核心身份：24 岁、在马德里长大并生活、数字传播与新媒体硕士。
- 定义性格、语气、主动程度、话题偏好、人物关系、可揭示事实和现实世界边界。
- 新增纯 TypeScript `characters` 模块 Schema 与 canon checker。
- 支持未发布且未揭示草稿的原地编辑；已发布或已揭示事实的语义变化要求新版本和变更原因。
- 核心身份变化允许版本升级，但已揭示身份冲突会被阻止；敏感事实不能静默扩大揭示范围。
- 未实现聊天、关系记忆、数据库迁移、provider 或人物 UI。

修改文件：

- `content/characters/lucia.json`
- `src/modules/characters/`
- `tests/unit/character-bible.test.ts`

验证：

- 全量 Vitest：45 个测试文件、227 个测试通过。
- `pnpm content:validate -- content/bundles/alpha-core-v1.json` 通过。
- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。

限制与下一步：

- Lucía v1 仍为 `draft`，未经语言、教学和角色一致性审核不得生产发布。
- 用户级事实揭示状态留给关系/对话任务，不写回全局人物圣经。
- 下一项为 ALPHA-027：对话消息流。

### ALPHA-025：沉浸内容包体验

- 状态：`done`
- 负责人：Codex
- 目标分支：`codex/alpha-025-immersive-content`
- 前置依赖：ALPHA-024，已完成
- 计划位置：实施计划任务 5.3

范围：

- 内容包详情、隐藏文本听全文、分段阅读、意群/解析、打字回复和后续口语复核入口。
- 听说读写共享内容 ID 与标签；阅读/打字不直接证明口语掌握。
- Web 与 Flutter 使用同一内容语义，当前先完成 Web 纵向切片和可复用服务端纯逻辑。
- 不新增支付、后台、实时双向语音、离线 ASR 或独立内容服务。

实现 Commit：`9c45d86`

结果：

- 新增原创 `immersive.first-cafe-conversation@1` draft 内容包，包含全文听力、分段阅读、打字回复、口语复核和迁移步骤。
- 新增 content pack domain/application/repository 投影；生产环境拒绝 draft 内容包，开发/测试环境可显式读取。
- 新增 `/explore/packs/[packKey]` Web 体验：浏览器 TTS、文本展开、打字草稿、版本化 localStorage 断点、TTS 失败降级和 `/learn/practice` 口语入口。
- 阅读和打字只保存本地 UI 进度，不写 `evidence_events`、`mastery` 或 `confidence`。

修改文件：

- `content/bundles/alpha-core-v1.json`
- `src/modules/content/`
- `app/(product)/explore/packs/[packKey]/page.tsx`
- `app/globals.css`
- `tests/unit/content-pack.test.tsx`
- `tests/e2e/content-pack.spec.ts`

验证：

- 全量 Vitest：44 个测试文件、218 个测试通过。
- `pnpm content:validate -- content/bundles/alpha-core-v1.json` 通过。
- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过，动态内容包路由已纳入 Next 构建。
- 相关 Browser 路由验证受已有 3000 端口开发服务的登录环境限制，未替换或修改 auth 逻辑；新增 Playwright 覆盖已写入但未在该服务上执行。

限制与下一步：

- 首个内容包保持 `draft`，完成西班牙母语和教学审核后才能发布。
- 当前只完成 Web 纵向切片；Flutter 内容包页面、数据库进度和服务端证据写入不在本任务范围。
- 下一项为 ALPHA-026：Lucía 人物圣经。

### ALPHA-024：初次诊断

- 状态：`done`
- 负责人：Codex
- 目标分支：`codex/alpha-024-initial-diagnostic`
- 前置依赖：ALPHA-023，已完成
- 实现 Commit：`33ef064`
- 计划位置：实施计划任务 5.2

范围：

- 用户选择一个自认为可以表达的通用沟通场景。
- 系统提供 3–5 个逐步变化的交际任务。
- 按语境、独立程度和标签权值建立初始证据；数据不足时显示“正在建立画像”。
- 不伪造完整八维分数，不接入外部 provider。

结果：

- 新增 diagnostic domain/application，确定性生成 3–5 个连续任务并推进诊断进度。
- 语音默认，打字作为静默降级；证据统一委托现有 `recordEvidence`。
- 增加 `diagnostic.first-conversation` 五任务内容场景，复用现有表达、提示和迁移字段。
- 低置信度、技术失败、越序任务和旧 generation 不推进诊断或污染能力证据。

修改文件：

- `src/modules/diagnostic/`
- `tests/unit/diagnostic-plan.test.ts`
- `tests/unit/diagnostic-progress.test.ts`
- `tests/unit/initial-diagnostic.test.ts`
- `content/bundles/alpha-core-v1.json`
- `docs/superpowers/specs/2026-08-23-initial-diagnostic-design.md`

验证：

- 全量 Vitest：43 个测试文件、210 个测试通过。
- 合约测试：5 个文件、27 个测试通过。
- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm content:validate -- content/bundles/alpha-core-v1.json` 通过。
- `pnpm build` 通过。
- `pnpm test:e2e`：22/24 通过；2 个匿名登录重定向断言失败（期望 `/login?next=%2Flearn`，实际 `/login`），属于当前工作区 auth/UI 改动，不涉及诊断模块。

限制与下一步：

- 初次诊断场景当前保持 `draft`，需完成西班牙母语和教学审核后才能发布到生产。
- 未接入 Route Handler、首页/Flutter UI、数据库迁移或外部 provider。
- 下一项为 ALPHA-025：沉浸内容包体验。

### ALPHA-023（前序任务记录）：首页唯一下一动作推荐器

- 状态：`done`
- 负责人：Codex
- 目标分支：`main`
- 前置依赖：ALPHA-022，已完成
- 实现 Commit：`33ef064`

结果：

- 新增确定性的 recommendation domain/application，仅返回一个首页首选动作。
- 按核心目标缺口、口语覆盖不足、可信度缺口、历史薄弱点、近期对话需求、新鲜度和重复惩罚排序。
- 不支持当前输入方式的候选被过滤；画像数据不足或没有可用候选时返回安全默认动作。
- 不调用网络、数据库、Whisper、Speechace 或 MiniMax，不修改评分、画像或证据。

修改文件：

- `src/modules/recommendation/`
- `tests/unit/recommendation.test.ts`

验证：

- 新增测试 6 个通过；全量测试 40 个文件、196 个测试通过。
- `pnpm lint` 通过。
- `pnpm typecheck` 通过。

### ALPHA-021（前序任务记录）：真人视频语音校准与本地诊断汇总

- 状态：`done`
- 负责人：Codex
- 目标分支：`main`
- 前置依赖：ALPHA-020，已完成（合并 `a8893a1`）
- 实现 Commit：待提交

结果：

- 已使用用户提供的 5 段真人朗读视频和对应确认文本完成本地 `faster-whisper-small` 转写。
- 已生成 5 份词级转录差异报告、5 份 `diagnostic-only` 语音观察报告和一份汇总报告。
- 汇总平均转录匹配率为 `0.835`，范围为 `0.823–0.848`；这些结果只表示 ASR 差异，不表示发音评分。
- 所有结果均写在外部桌面文件，不写数据库、evidence、mastery 或 confidence，不上传或保存原始视频。

验证：

- 汇总脚本 ESLint 通过；相关 2 个测试文件共 16 个测试通过；汇总 JSON 结构校验通过。
- 全仓库 `pnpm lint` 和 `pnpm typecheck` 仍受现有 `tests/unit/profile-overview-panel.test.tsx:128` 错误阻塞。

输出：

- `C:\Users\master\Desktop\local-pronunciation-calibration-summary-v1.json`

下一步：

- ALPHA-022 已完成决策：暂缓外部 provider 抽样，保留本地诊断结果作为校准数据。

### ALPHA-022：复核校准结果并决定是否进入有限 provider 抽样

- 状态：`done`
- 负责人：Codex
- 目标分支：`main`
- 前置依赖：ALPHA-021，已完成
- 实现 Commit：待提交

决策：

- 暂不调用 Speechace、MiniMax 或其他外部 provider。
- 五段视频的本地 Whisper 平均匹配率为 `0.835`，但转录差异只能标记 ASR 不确定性，不能作为发音错误标签。
- 五段报告均为 `diagnostic-only`，没有发音评分、`mastery`、`confidence` 或 `evidence` 更新。
- 继续保留本地转录、词级差异和语音信号观察，供后续本地校准和产品设计使用。

暂缓原因：

- 当前没有针对这五段视频的第三方处理授权记录。
- 当前没有可用的外部 provider 凭据。
- 本批样本没有独立的母语者发音标签，无法用它们验证 provider 的评分准确性。

验证：

- 已确认五份诊断报告均为 `diagnostic-only` 且汇总 JSON 结构有效。
- 已运行 provider、校准门禁、转录比较和 pronunciation application 相关测试；不调用真实供应商。

下一步：

- 进入 ALPHA-023 产品功能实现；外部 provider 抽样仍暂缓。

### ALPHA-017：将 Speechace provider 接入训练 application

- 状态：`done`
- 负责人：Codex
- 目标分支：`feat/alpha-017-pronunciation-application`
- 计划位置：Speechace provider 与回放集之后的 application 编排切片
- 前置依赖：ALPHA-016，已完成（合并 `24f782f`）
- 实现 Commit：`b96ac1a`
- PR：[#8](https://github.com/laurenzhong/Spanish/pull/8)
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
- PR：[#9](https://github.com/laurenzhong/Spanish/pull/9)
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
- PR：[#7](https://github.com/laurenzhong/Spanish/pull/7)
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
- PR：[#5](https://github.com/laurenzhong/Spanish/pull/5)
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
- PR：[#4](https://github.com/laurenzhong/Spanish/pull/4)
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
- PR：[#3](https://github.com/laurenzhong/Spanish/pull/3)
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
| ALPHA-021 | done | `main` | Codex | 真人视频语音校准与本地诊断汇总 | ALPHA-020 |
| ALPHA-022 | done | `main` | Codex | 复核校准结果并决定是否进入有限 provider 抽样；决定暂缓外部调用 | ALPHA-021 |
| ALPHA-023 | done | `main` | Codex | 首页唯一下一动作推荐器 | ALPHA-022 |
| ALPHA-024 | done | `codex/alpha-024-initial-diagnostic` | Codex | 初次诊断：3–5 个渐进交际任务与初始证据 | ALPHA-023 |
| ALPHA-025 | done | `codex/alpha-025-immersive-content` | Codex | 沉浸内容包体验 | ALPHA-024 |
| ALPHA-026 | done | `fix/login-redirect-after-otp` | Codex | Lucía 人物圣经 | ALPHA-025 |
| ALPHA-027 | done | `fix/login-redirect-after-otp` | Codex | 对话消息流 | ALPHA-026 |
| ALPHA-028 | done | `fix/login-redirect-after-otp` | Codex | 关系记忆与共享权限 | ALPHA-027 |
| ALPHA-029 | done | `fix/login-redirect-after-otp` | Codex | 角色回复规划 | ALPHA-028 |
| ALPHA-030 | done | `fix/login-redirect-after-otp` | Codex | 好友介绍与角色网络 | ALPHA-029 |
| UI-001 | done | `fix/login-redirect-after-otp` | Codex | 认证回跳、四栏导航和学习入口功能闭环 | 阶段 8 |
| UI-002 | done | `fix/login-redirect-after-otp` | Codex | 探索内容包功能闭环 | UI-001 |
| UI-003 | done | `fix/login-redirect-after-otp` | Codex | Lucía 对话发送、停止、断流和重试闭环 | UI-002 |
| UI-004 | done | `fix/login-redirect-after-otp` | 产品本人 / Codex | 画像、热力图和隐私数据控制闭环 | UI-003 |
| UI-005 | ready | `fix/login-redirect-after-otp` | 产品本人 / Codex | 好友介绍、共享授权和 Flutter/Web 全模块验收 | UI-004 |
| 阶段 8 | in_progress | `fix/login-redirect-after-otp` | 产品本人 / Codex | 个人 Alpha 使用周期与人工体验复核；等待 UI-001 至 UI-005 功能门槛完成 | 7.6 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | UI-005 | 好友介绍、共享授权和 Flutter/Web 全模块验收 | UI-004 |
| 2 | 阶段 8 | 个人 Alpha 使用周期与人工体验复核 | UI-005 |

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
| 2026-08-22 | 完成授权音频转写与 MiniMax 标注批处理器，并执行首批 5 条 | `0aa6a28`，参数修复 `a5b8bbc` | 代理恢复后 5 条仍因 OpenAI 音频转写端点 429 限流失败；恢复与重试边界已验证 |
| 2026-08-22 | 完成一次性本地 Whisper 转写工具与 MiniMax 文本标注入口 | `15745bd` | 本地 `faster-whisper-small` 转写 5/5；MiniMax key 401，等待有效凭据；本地快照已验证幂等恢复 |
| 2026-08-22 | 使用本地转写生成 `manual-codex` 人工复核草稿 | 待提交 | 5/5 完成；结果在外部 `calibration-results-manual-v1.json`，不写能力证据 |
| 2026-08-22 | 生成 5 条音频人工复核工作表并完成哈希/大小核对 | 待提交 | 外部 `calibration-review-sheet-v1.json`，等待人耳回听确认 |
| 2026-08-23 | 完成 ALPHA-021 真人视频语音校准与本地诊断汇总 | 待提交 | 5/5 视频完成；外部汇总文件已校验，不写能力证据 |
| 2026-08-23 | 完成 ALPHA-023 首页唯一下一动作推荐器 | `33ef064` | 推荐排序与安全回退完成；不接入 UI 或 provider |
| 2026-08-23 | 完成 ALPHA-024 初次诊断 | `33ef064` | 5 任务诊断计划、证据委托和内容校验完成；等待内容审核后发布 |
| 2026-08-24 | 完成 ALPHA-027 对话消息流 | `ecdfd03` | Web/Flutter NDJSON fake 对话、取消、断流和重试完成；下一步处理关系记忆权限 |
| 2026-08-24 | 修复聊天历史不可用时静默丢失 | 待提交 | 显示数据库不可用状态、合并历史 hydration 与当前消息；配置 `DATABASE_URL` 后可恢复持久化 |
| 2026-08-25 | 完成 UI-002 探索内容包功能闭环 | `429c225` | Flutter/Web 内容包按钮、进度、草稿恢复、TTS 降级和口语复核可用；下一项 UI-003 |
| 2026-08-25 | 完成 UI-003 Lucía 对话恢复闭环 | `e0b7b0c` | 首包失败、停止、断流后可重试且不重复用户消息；下一项 UI-004 |
| 2026-08-25 | 完成 UI-004 画像、热力图和隐私数据控制闭环 | `8857364` | Flutter 画像选择、热力图日期、隐私删除确认与 Web 画像重试可用；下一项 UI-005 |

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
