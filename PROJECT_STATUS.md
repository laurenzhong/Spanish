# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-28
- 当前里程碑：个人 Alpha 阶段 7.7——功能缺口收敛与发布候选准备
- 总体状态：READ-005、READ-006、UI-009、UI-010、UI-011、ALPHA-032 已完成；阶段 8 尚未启动，等待发布候选门禁
- 协调分支：`main`
- 当前阻塞：发布候选尚未形成；真人视频相关外部 provider 凭据和第三方处理授权仍未配置，继续使用本地诊断，不上传视频

### ALPHA-031：MiniMax M3 生成式角色对话

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 实现 Commit：`8e2c335`
- 范围：为角色对话新增服务端 `CharacterReplyProvider` 与 MiniMax-M3 适配器；将隐私过滤后的角色事实、关系摘要、可读记忆、最近消息和当前用户消息送入生成模型；保留 NDJSON 流、取消/竞态、完整消息持久化和记忆提取；provider 失败时回退 deterministic reply；新增 provider 观测、契约测试与 E2E 防收费配置。
- 修改：`src/modules/providers/conversation/`、`src/modules/conversation/application/stream-reply.ts`、`app/api/v1/conversations/[characterId]/stream/route.ts`、`.env.example`、`playwright.config.ts`、相关测试与架构/测试文档。
- 验证：相关 Vitest 26/26、`pnpm lint`、`pnpm typecheck`、`pnpm build`、对话 Playwright 12/12 通过；全量 Vitest 仍有既有 article-content fixture 与 article-reader `user` 作用域失败；全量 E2E 首次运行受本机 MiniMax key 污染，清空 key 后对话路径通过，剩余失败为既有移动 UI 回归。
- 限制：当前只有 Lucía@1 接入；需要在服务端配置 `MINIMAX_API_KEY` 才会调用真实 MiniMax，未配置或 provider 失败时使用确定性回复；未做真实收费 provider 回归或 iOS 真机验证。
- 下一项：`ALPHA-033` Alpha 功能缺口收敛与发布候选准备。

### ALPHA-032：对话搜索与三角色目录

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：ALPHA-031，已完成
- 实现 Commit：`c5b7106`
- 范围：新增当前用户私有的对话历史搜索；搜索结果支持角色名、消息摘要、消息 ID 和时间，并可深链跳转到目标消息、自动滚动和短暂高亮；对话联系人扩展为 Lucía、Mateo、Inés，使用动态角色路由、角色目录和对应回复上下文；保留既有左侧产品导航和 Lucía 介绍请求流程。
- 修改：`app/(product)/chat/`、`app/api/v1/conversations/`、`src/modules/conversation/`、`tests/e2e/conversation.spec.ts`、`docs/superpowers/specs/2026-08-27-conversation-search-and-character-catalog-design.md`。
- 验证：对话 Playwright `9/9`、对话相关 Vitest `17/17`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过；浏览器已验证历史消息搜索跳转、Mateo/Inés 角色切换及无控制台错误。
- 限制：搜索依赖数据库；未配置 `DATABASE_URL` 时只显示明确的不可用状态，不伪造搜索结果。Mateo/Inés 仍受角色 API 记录可用性约束，真实 provider 质量不在本切片内重新校准。
- 下一项：`ALPHA-033` Alpha 功能缺口收敛与发布候选准备。

### ALPHA-033：Alpha 功能缺口收敛与发布候选准备

- 状态：`in_progress`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：阶段 7、UI-006 至 UI-011、READ-001 至 READ-005
- 范围：对照产品设计和 Alpha 范围盘点未完成能力与已知缺陷；补齐核心训练、初次诊断、阅读、对话、画像、隐私和 Web/Flutter 跨端闭环；修复阻塞级/高优先级流程、状态机、取消/竞态、数据隔离、证据污染和角色一致性问题；清理全量测试与 fixture 漂移；准备发布候选质量门禁。
- 不包含：阶段 8 连续使用配额、周度复盘或全面主观体验；支付、完整内容后台、实时双向语音、大规模角色网络、任意外部来源抓取和其他 Alpha 延后范围。
- 验收：核心路径可从入口走到完成或可恢复失败；P0/P1 缺陷清零；关键数据和角色安全不变量有自动化回归；`pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:e2e`、`pnpm build` 按发布候选范围通过；Flutter 公共检查通过，并记录 Mac/Xcode 真机验收缺口。
- 当前切片：画像 Web `/me` 视觉与信息层级落地。首屏改为能力摘要、唯一真实继续练习入口（有证据时才显示）、八维状态条、最近证据时间线；雷达图与证据表降为可展开的次级明细；活动热力图默认展示最近 12 周；桌面/移动样式统一暖米白、赤陶与灰绿色编辑式主题，并补充暗色主题映射。实现 Commit：`c1f740c`。随后修复分区入口仅为锚点的问题，新增客户端分段视图：默认只渲染能力与活动，关系隐私/数据与隐私切换时隐藏其他分区，并同步 hash 与浏览器返回；实现 Commit：`6b6f29f`。数据库连接探测成功并执行 `pnpm db:migrate` 应用 15 条迁移；修复画像、活动、关系记忆和保存语音 API 对浏览器 Cookie 会话的回退认证，使真实登录页面可读取数据库空/有数据状态；实现 Commit：`b31a629`。验证：画像/热力图/profile 页面 Vitest 7/7，Profile API 相关 Vitest 6/6，画像 E2E 1/1（桌面）+ 1/1（移动），`pnpm lint`、受影响文件 ESLint 通过；浏览器 Playwright 验证迁移后画像与活动从 503 恢复并无横向溢出。全量 `pnpm exec tsc --noEmit` 仍被其他代理未提交的 `chat-thread.tsx` 缺失格式化函数阻断。限制：当前数据库尚无该登录用户的学习证据，因此显示真实的 0/8 与空活动；本切片未改 Flutter 页面或新增 Dashboard DTO。下一步：补齐真实 profile Dashboard DTO 与 Flutter 同源渲染，再进入发布候选门禁。
- 账户菜单与个人资料可用性修复：退出登录接入 Supabase `signOut` 并跳转 `/login`，UID 复制增加非安全上下文回退；新增可用的 `/help` 帮助与反馈页，以及 `/me#preferences` 偏好设置分区（当前设备即时保存反馈和语音偏好）；个人资料读取失败时提供明确的重试入口，并为请求补充同源凭据和禁缓存。实现 Commit：`9b2846d`、`e406f4c`、`3f1ee29`；验证：账户菜单/个人资料/画像页面 Vitest 6/6、受影响文件 ESLint、`pnpm exec tsc --noEmit` 通过。限制：偏好设置暂存本设备，尚未接入 `user_preferences` 服务端同步；Flutter 账户菜单仍需接入同源退出和偏好 API。下一步：继续发布候选门禁并处理跨端账户设置同步。
- 桌面学习页调研与 F 方案设计交接：完成 Duolingo、Babbel、Busuu、Memrise、ELSA Speak、Echo-Loop、wallabag、Readest、Omnivore、Linear 及当前 `/learn`、`/learn/practice` 的技术与布局调研；确定“任务时间线 + 详情”作为桌面 Web 方向，补充 12 列网格、条件详情 rail、唯一主动作、训练状态替换、错误恢复与可访问性规范。设计 Commit：`e37485c`；文档见 [`docs/superpowers/specs/2026-08-28-learning-page-desktop-web-technical-research.md`](docs/superpowers/specs/2026-08-28-learning-page-desktop-web-technical-research.md) 与 [`docs/superpowers/specs/2026-08-28-learning-page-desktop-web-design.md`](docs/superpowers/specs/2026-08-28-learning-page-desktop-web-design.md)。视觉预览见 `.superpowers/brainstorm/visual-20260828/content/desktop-f-timeline-detail-v1.html`，已修复预览滚动容器并验证可向下滚动；本交接未改业务代码，未运行全量代码检查。产品本人已确认 F 方向，实施计划见 [`docs/plans/2026-08-28-learning-page-desktop-web-implementation-plan.md`](docs/plans/2026-08-28-learning-page-desktop-web-implementation-plan.md)。
- ALPHA-033 切片 A：桌面 `/learn` 任务时间线与条件详情 rail 已实现。实现 Commit：`da5f5ac`；修改 `app/(product)/learn/learn-page-content.tsx`、`app/globals.css`、`tests/unit/learn-page.test.tsx`、`tests/e2e/learn-page.spec.ts`。保留现有 checkpoint/唯一主动作逻辑，修复恢复焦点被查询参数初始化竞态覆盖的问题；无断点不渲染详情 rail，1024px 起详情折叠，深色主题同步令牌。验证：学习页 Vitest 2/2、桌面学习页 Playwright 2/2、受影响文件 ESLint、`tsc --noEmit` 通过；浏览器实测 1280/1440/1024px 无横向溢出。限制：数据不可用 DTO 和 `/learn/practice` 工作台仍在后续切片，未运行全量门禁。下一步：ALPHA-033 切片 B，统一训练工作台宽度与状态容器。
- ALPHA-033 切片 B：`/learn/practice` 已接入桌面任务时间线、统一主列工作台与条件详情 rail；保留原有 TrainingState/TrainingEvent、副作用 generation、checkpoint、口语/文字证据与技术失败恢复语义。实现 Commit：`58d2f0d`，后置证据状态修复 `f44fc59`，滚动回归 `563471b`；修改 `src/modules/training/ui/fake-training-loop.tsx`、`app/globals.css`、`tests/unit/fake-training-loop.test.tsx`、`tests/e2e/training-loop.spec.ts`。验证：FakeTrainingLoop 与学习页 Vitest 7/7、桌面训练 Playwright 6/6（追加 1280px 垂直滚动断言）、受影响文件 ESLint、`tsc --noEmit` 通过；1280px 与窄视口无横向溢出且页面可纵向滚动。限制：未运行全量 `pnpm lint`、`pnpm test --run`、`pnpm test:e2e`、`pnpm build`；下一步：ALPHA-033 切片 C，补齐跨视口与可访问性回归。
- ALPHA-033 切片 C：补齐 `/learn` 与 `/learn/practice` 的无效断点、唯一主 CTA、320–1440px 视口矩阵、时间线当前步骤、详情 rail 可见性、键盘焦点和文字路径证据回归。实现 Commit：`3e79f0a`；修改 `tests/unit/learn-page.test.tsx`、`tests/e2e/learn-page.spec.ts`、`tests/e2e/training-loop.spec.ts`。验证：相关 Vitest 8/8、训练 Playwright 8/8、学习页 Playwright 3/3、受影响文件 ESLint、`tsc --noEmit`、`git diff --check` 通过；各目标视口无横向溢出，键盘可从文字输入到提交操作。限制：全量门禁留待切片 D；下一步：ALPHA-033 切片 D，执行发布候选门禁。
- ALPHA-033 切片 D：已执行发布候选门禁并完成阻塞交接。`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过；全量 Vitest `392 passed / 2 failed / 10 worker errors`，失败为既有 `server-only` 客户端导入、BottomNavigation `useRouter` mock 与并行 worker 内存不足；全量 Playwright `93 passed / 15 failed`，失败集中在既有画像/关系记忆移动端路径、文章句子选择和资源不足，训练与学习相关路径均通过。未改 Flutter，未运行 Flutter 检查。当前发布阻塞：先修复上述既有测试与资源问题，再重新执行全量门禁；下一步：发布候选修复与人工体验复核。
- ALPHA-033 发布候选阻塞修复：为 BottomNavigation 单元测试补齐 `next/navigation` 的 `useRouter` mock；为阅读持久化数据库测试隔离 `server-only` 并将迁移 fixture 补齐至 `0014_parallel_liz_osborn.sql`（包含 `user_generated_articles`）。实现 Commit：`1e765aa`。验证：`tests/unit/bottom-navigation.test.tsx` 与 `tests/database/reading-persistence.test.ts` 合计 7/7；两文件 ESLint、`tsc --noEmit`、`git diff --check` 通过。限制：全量 Playwright 的 15 个既有失败（画像/关系记忆移动端、文章句子选择、资源不足）和并行 Vitest worker 内存问题仍未解决；其他代理未提交改动保持原样。下一步：在稳定 worker 配置和既有 E2E 问题明确归属后重跑全量发布门禁，再由产品本人进行人工体验复核。
- 对话 UI 后置修复：所有消息新增头像和气泡；时间改为消息流中的居中分隔，仅在首条、跨日或间隔超过 5 分钟时显示，点击或键盘激活消息可查看完整时间；流式新消息和乐观发送消息补齐时间戳，保留右侧用户消息与长文本左对齐；移动端消息操作按钮与头像保持独立间距。实现 Commit：`30a140c`、`df135c5`、`e177497`、`7e9308e`。修改 `src/modules/conversation/`、`app/globals.css` 与对话 Playwright 回归；相关 Vitest 20/20、完整对话 Playwright 单 worker 22/22，追加桌面/移动布局与消息操作回归 4/4，`pnpm exec tsc --noEmit` 和受影响文件 ESLint 通过。限制：头像继续使用首字母/本地用户标记，未接入远程头像资源；Flutter 页面尚未同步本次视觉改动。
- 阅读库首屏性能修复：`/read` 公共文章库跳过不需要的用户/数据库读取；登录用户的阅读进度、收藏和私有文章数据按页面需要加载，My Texts 三类查询并行执行并复用同一数据库句柄。实现 Commit：`c633ca9`；修改 `app/(product)/read/page.tsx` 与 `tests/unit/read-page.test.tsx`。验证：阅读相关 Vitest 18/18、首屏数据加载回归 3/3、仓库级 `pnpm lint`、`pnpm exec tsc --noEmit` 通过。限制：全量 `pnpm test --run` 仍受现有 Windows/Vitest 多 worker 内存耗尽阻断；未运行 E2E/build。下一步：继续 ALPHA-033 发布候选门禁。
- 下一项：阶段 8 个人 Alpha 连续使用与人工体验复核，仅在本任务退出条件满足并经产品本人确认后启动。

### READ-006：Generate Story 私有 AI 草稿文章

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 实现 Commit：`fb4e9c0`；兼容 MiniMax M3 reasoning 区块修复：`7f90cec`
- 范围：接入服务端 MiniMax M3 StoryGenerationProvider；新增私有 `user_generated_articles` 及 RLS、幂等生成/读取/删除 API；Web `/read/generate` 表单、My Texts 草稿卡片、私有文章阅读器复用与删除；公共内容 API 排除生成文章，不写入口语证据、画像或角色记忆。
- 修改：`src/modules/providers/story-generation/`、`src/modules/reading/`、`app/api/v1/read/generated-stories/`、`app/(product)/read/generate/`、阅读书架/阅读器、`drizzle/0014_parallel_liz_osborn.sql`、契约 Schema/OpenAPI、相关文档与测试。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、Generate Story 相关 Vitest 20/20、Generate Story Playwright 1/1 通过；全量 `pnpm test --run` 仍受既有 PGlite/Windows worker OOM、article fixture 漂移和 `server-only` 测试隔离失败影响；`pnpm build` 在 Windows 静态生成阶段因 worker OOM（3221226505）退出。
- 限制：需要服务端 `MINIMAX_API_KEY` 和 `DATABASE_URL` 才能生成并持久化；当前不提供公开发布、音频生成、流式写作或外部 URL 抓取。未做 Flutter/iOS 真机验证。
- 下一项：继续 `ALPHA-033` 发布候选门禁，清理全量测试 fixture/worker 稳定性后再进入阶段 8 人工体验。

## 新模型快速接手

进入仓库后按顺序执行：

1. 阅读 `AGENTS.md`，了解不可违反的产品、架构、测试和隐私规则。
2. 阅读本文件，确认任务 ID、状态、分支和下一步。
3. 只阅读当前任务引用的实施计划章节和相关规范，不必一开始加载所有文档。
4. 运行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
5. 确认没有其他模型正在处理同一任务后再修改文件。

如果用户只给出任务 ID，以下表格和对应计划章节就是任务范围。不得自行扩大到后续任务。

## 当前任务

UI-011 已完成；当前下一项为 `ALPHA-033`：Alpha 功能缺口收敛与发布候选准备。

当前任务为 `ALPHA-033`：Alpha 功能缺口收敛与发布候选准备。阶段 8 个人 Alpha 人工体验不是当前开发任务，必须等候选版本门禁通过后再启动。当前只做功能补齐、缺陷修复、跨端闭环和局部/全量质量回归；阶段记录见 [`docs/tasks/STAGE-8-PERSONAL-ALPHA.md`](docs/tasks/STAGE-8-PERSONAL-ALPHA.md)。

### 当前工作边界

上方 UI-009 句子是历史交接记录；当前任务和下一项以本页 `ALPHA-033` 状态及任务表为准。

- UI-001 至 UI-005 已完成，但不代表整个产品已经达到人工体验条件。
- 在 Alpha 功能缺口和已知缺陷收敛前，只验证按钮、状态流转、错误恢复和局部用户路径；不启动阶段 8 的连续使用配额、周度复盘或全面主观体验。
- `ALPHA-033` 完成后，先形成发布候选并通过质量门禁，再由产品本人确认是否进入阶段 8 人工体验。

### 待执行 UI 批次

- `UI-006`：设计系统与产品壳层（done；`cb441ca`）
- `UI-007`：公开首页与登录后学习首页（done；`76dba30`）
- `UI-008`：探索与对话工作区（done；`c498e84`）
- `UI-009`：阅读库与规范化阅读器（done；`4cbc121`；基于现有已发布内容 bundle，READ-005 外部来源能力仍待实现）
- `UI-010`：我的进步与隐私控制（done；`d59a617`；依赖 UI-006）
- `UI-011`：跨视口、可访问性与行为回归（done；依赖 UI-006 至 UI-010）

### 当前 Alpha 收敛任务

- `ALPHA-033`：Alpha 功能缺口收敛与发布候选准备（ready；依赖阶段 7、UI-006 至 UI-011、READ-001 至 READ-005）。
- 阶段 8：个人 Alpha 连续使用与人工体验复核（ready；仅在 `ALPHA-033` 退出条件满足后启动）。

### 后续路线（不进入当前 Alpha）

- 阶段 9：用户好友与 1 对 1 私信。第一版限定为用户名/邀请链接发起申请、双方接受后文字私信，并支持拒绝、删除、拉黑和举报。
- 该路线独立于 AI 角色关系；默认不共享学习画像、证据、关系记忆、录音、转写或完整私密对话。
- 阶段 9 未排期，必须在阶段 8 完成并决定扩大用户规模后，另行建立社交隐私/滥用设计、ADR 和实施任务。

UI-011 后置修复：阅读器 Explain 面板已收敛为词语、词性、基本释义、本句语境义和西语例句；移除原句重复、供应商提示、内部说明和 Explain 内全文朗读控件。实现 Commit：`83c4eb1`；相关 Vitest 14/14、Playwright 2/2、lint、typecheck 通过。

UI-011 后置修复（二）：Explain 支持在正文同一段内拖选多个词语后解析整句；单词与句子请求分别携带 `selectionType`，句子面板只显示所选句子、中文翻译、句子解析和可选参考表达，不重复展示上下文。实现 Commit：`6661703`；修改阅读器、词语解释 API/ MiniMax provider、相关单元测试与 Playwright 测试，并同步架构与测试策略文档。验证：相关 Vitest 16/16、Playwright 3/3、`pnpm lint`、`pnpm typecheck` 通过。限制：当前句子解析依赖服务端 `MINIMAX_API_KEY` 和 MiniMax M3，供应商失败时只提供可重试错误，不写入口语能力证据；全量 Vitest 仍受既有 PGlite fixture/Windows worker 资源问题影响。历史交接曾将阶段 8 列为下一项，当前已改为先执行 `ALPHA-033`。

UI-011 后置修复（三）：修复正文词语按钮阻断原生文本选择的问题。词语改为可选中的行内控件并保留键盘激活；拖选回归使用真实鼠标从段落中间词开始，确认不会退化为首个词解析。实现 Commit：`46ade5e`；相关 Vitest 16/16、Playwright 3/3、`pnpm lint`、`pnpm typecheck` 通过。限制与下一项不变。

UI-011 后置修复（四）：词语本身显示文本选择光标，拖选可直接从词语内容开始；句子选区成立后立即请求 MiniMax 解析，移除“解析所选句子”按钮。实现 Commit：`44e8657`；相关 Vitest 16/16、真实鼠标 Playwright 3/3 和阅读器局部 lint 通过。全量 `pnpm typecheck` 当前被其他代理新增的 `tests/unit/minimax-conversation.test.ts` 类型错误阻断；全量 lint 的既有聊天文件警告同样不属于本次阅读器改动。限制与下一项不变。

UI-011 后置修复（五）：新增已审核的常用西语词典，命中词条时本地立即展示完整义项、用法、搭配、例句和 CEFR，不调用供应商；未命中词语或句子通过 MiniMax M3 流式 NDJSON 返回，前端按 `delta` 增量渲染并在 `done` 时完成 Schema 校验；补充流式 provider、Route 和阅读器测试。实现 Commit：`ee707a7`；修改 `content/glossary/`、阅读器、词语解释 provider/Route、相关测试与架构/测试策略文档。验证：Explain/阅读器相关 Vitest 21/21；真实鼠标 Playwright 3/3；阅读器与 provider 局部 lint、`pnpm typecheck` 通过。限制：流式显示依赖 MiniMax 返回可解析的 JSON 文本增量，最终字段仍需完整 `done`；未配置 key 时未命中词语仍显示可重试错误。历史交接曾将阶段 8 列为下一项，当前已改为先执行 `ALPHA-033`。

UI-011 后置修复（六）：修复阅读辅助侧栏在窄宽度下标签、长词和解释内容被裁切的问题；侧栏内容、标签和操作按钮允许自然换行并禁止横向溢出，不改变侧栏位置。实现 Commit：`78f2fb4`；修改 `app/globals.css` 与阅读器 E2E 回归断言。验证：阅读器 Vitest 8/8、桌面 Playwright 3/3、`pnpm typecheck` 通过；移动 Playwright 2/3，剩余失败为既有句子拖选坐标问题。

UI-011 后置修复（七）：按交互要求保持 Explain、Dictionary、Guide、Words、Settings 标签按钮单行显示，窄宽度下通过标签栏横向滚动避免换行；解释内容继续允许自然换行。实现 Commit：`e8b4a6a`；修改 `app/globals.css` 与阅读器 E2E 断言。验证：阅读器 Vitest 8/8、桌面 Playwright 3/3、`pnpm typecheck` 通过。

每批只完成一个任务 ID；产品本人在批次结束后进行视觉和行为确认，协调者再更新状态页。

### READ-001：文章内容契约与版权字段

- 状态：`done`
- 负责人：Codex
- 实现 Commit：`5fd3250`
- 范围：扩展 Content Bundle 文章 Schema、文章级规范化哈希、来源/版本/段落/资产表族、版权与审核发布门禁、稳定 key 引用校验、事务导入与同版本冲突保护。
- 修改：`src/modules/content/`、`src/shared/db/schema/content.ts`、`drizzle/0011_early_colleen_wing.sql`、契约 Schema/fixture、`content/bundles/alpha-core-v1.json`、文章数据库测试。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、`pnpm content:validate -- content/bundles/alpha-core-v1.json`、`pnpm test --run`（77 文件/330 测试）、`pnpm test:e2e`（70/70）、`pnpm build` 均通过。
- 限制：当前 bundle 已有 5 篇 Sueño 原创、版权清晰并经 `codex-ai-temporary-review` 标注的已发布文章；仍未实现外部来源抓取或口语证据写入。
- 下一项：`READ-002` 阅读导航与文章书架。

### READ-002：阅读导航与文章书架

- 状态：`done`
- 负责人：Codex
- 实现 Commit：`cbc2c6b`
- 范围：新增文章卡片查询 DTO/repository/application、分页/搜索/主题过滤 API、Web `/read` 书架、诚实空状态、Flutter 五项导航与阅读空状态；列表不返回正文，已保存筛选暂不伪造数据。
- 修改：`src/modules/content/`、`app/(product)/read/`、`app/api/v1/content/articles/`、`apps/mobile/lib/features/read/`、共享 Flutter 内容 DTO、OpenAPI/响应 Schema、架构与数据库文档。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm build`、相关 Vitest（5/5）、单 worker 全量 Vitest（78 文件/331 测试）、`pnpm test:e2e` 相关回归（4/4）、`flutter analyze`、`flutter test`（74 测试）通过；默认并行 Vitest 在 Windows 触发已知 OOM。
- 限制：当前内容 bundle 已发布 5 篇原创文章；服务端用户保存写入、高亮/笔记同步和外部来源仍属于后续切片。
- 下一项：`READ-003` 规范化阅读器。

### READ-003：规范化阅读器

- 状态：`done`
- 负责人：Codex
- 实现 Commit：`f71eca5`、`fc00253`、`4f41fe3`（随后置文档提交 `c45bafd`）
- 范围：文章版本 detail 投影与公开 API、Web 规范化阅读器、段落定位与阅读进度、版本哈希迁移提示、浏览器 TTS/段落辅助/词语辅助、高亮/保存短语/个人笔记、本地离线恢复；Flutter `ArticleReaderPage`、SecureStorage 进度缓存和 TTS 入口。
- 修改：`src/modules/content/`、`app/(product)/read/article/`、`app/api/v1/content/articles/[articleId]/`、`apps/mobile/lib/features/read/`、契约 Schema/OpenAPI、`app/globals.css`、架构与数据库文档、阅读器单测。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm build`、阅读器 Vitest（2/2）、内容契约 Vitest（3/3）、相关书架/壳层 Vitest（1/1）、`pnpm test:e2e`（72/72）、`flutter analyze`、`flutter test`（74 测试）通过；Chrome + Playwright 375px 视觉回归通过。
- 限制：bundle 现有 5 篇原创文章已发布；Web localStorage 与 Flutter SecureStorage 只是 Alpha 恢复缓存，服务端 `user_reading_progress`、高亮、短语和笔记表/RLS 尚未接入；未实现 READ-004 口语迁移或 READ-005 外部来源导入。
- 下一项：`READ-004` 阅读到口语迁移。

### READ-004：阅读到口语迁移

- 状态：`done`
- 负责人：Codex
- 实现 Commit：`209f5fb`
- 范围：新增四种文章迁移任务 DTO（摘要、观点、个人迁移、角色对话）；Web 阅读器迁移卡片支持选择、草稿保存、跳过和显式口语复核；口语复核 URL 按文章版本和迁移类型加载上下文并复用现有训练状态机；Flutter 阅读器与训练 fake 提供同等入口和上下文；打字草稿、跳过和阅读完成不创建口语证据。
- 修改：`src/modules/content/domain/article-transfer.ts`、`app/(product)/read/article/[articleId]/article-reader.tsx`、`app/(product)/learn/practice/page.tsx`、`src/modules/training/ui/fake-training-loop.tsx`、`apps/mobile/lib/features/read/read_page.dart`、`apps/mobile/lib/features/training/fakes/fake_training_loop.dart`、内容 DTO、迁移单测与 E2E、架构/测试文档。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm build`、迁移/阅读器/训练 Vitest（9/9）、`pnpm exec playwright test tests/e2e/article-transfer.spec.ts --project=desktop-chromium`（1/1）、`flutter analyze`、`flutter test`（76 测试）通过；Chrome 390px 视觉验收无横向溢出、迁移入口和练习上下文可见、控制台无错误；完整 Web E2E 为 73/74。
- 限制：`pnpm test --run` 在 Windows 并行/全量运行仍受已知资源和既有 `article-content` fixture 失败影响（bundle 已包含 5 篇文章）；完整 E2E 唯一失败为既有移动端“撤销授权”按钮视口定位，与 READ-004 无关；本任务未接入服务端阅读私有表/RLS，也未实现 READ-005 外部来源导入；Flutter 未进行 iOS 真机或 Xcode 构建验证。
- 下一项：`READ-005` 个人保存和外部来源增量。

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
| UI-005 | `a1766d5`、`8f680ee` | 好友介绍、共享授权和 Flutter/Web 局部功能验收 |

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
- 阶段 8 人工体验暂不启动；先完成剩余 UI/功能切片，准备 Mac/Xcode 后再补跑 Flutter integration 和 iOS 真机关键路径。

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
- 训练闭环可继续做模块级局部回归；阶段 8 人工体验仍暂缓，待所有 UI 与功能切片完成后再开始。

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
- UI-005 已完成；下一步继续拆分并实现剩余 UI/功能闭环，阶段 8 人工体验暂缓。

### UI-005：好友介绍、共享授权和 Flutter/Web 全模块验收

- 状态：`done`
- 负责人：产品本人 / Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：UI-004，已完成
- 实现 Commit：`a1766d5`
- 测试 Commit：`8f680ee`

结果：

- Web 好友介绍和共享授权面板补齐加载、失败和“重试”状态；重试会重新获取当前介绍或授权列表。
- Flutter 新增本地 fake 好友网络状态：可选分享非私密记忆、接受/拒绝介绍、查看授权并按目标角色撤销；默认不共享，拒绝或不选记忆不会产生授权。
- Chat/Profile 共享同一个客户端演示状态，面板明确提示这不直接修改服务端关系授权，未改服务端 API、数据库、RLS 或评分逻辑。

修改文件：

- `src/modules/character-network/ui/introduction-inbox.tsx`
- `src/modules/character-network/ui/shared-memory-permissions.tsx`
- `apps/mobile/lib/features/character_network/fake_character_network.dart`
- `apps/mobile/lib/features/character_network/character_network_panels.dart`
- `apps/mobile/lib/features/chat/chat_page.dart`
- `apps/mobile/lib/features/profile/profile_page.dart`
- `apps/mobile/lib/shared/widgets/product_shell.dart`
- `tests/unit/character-network-privacy.test.tsx`
- `tests/e2e/product-shell.spec.ts`
- `apps/mobile/test/features/character_network/character_network_test.dart`

验证：

- `pnpm lint`、`pnpm build`、`pnpm typecheck` 通过（typecheck 在 build 生成 `.next/e2e` 类型后复跑）。
- 全量 Vitest：76 个文件、328 个测试通过。
- `pnpm test:e2e`：桌面与手机共 66/66 通过；画像/好友相关手机 E2E 17/17 通过。
- 好友隐私 Web 单测：4/4 通过。
- `flutter analyze` 通过；`flutter test`：74 个公共 Dart/Widget 测试通过；好友网络专项测试 3/3 通过。

限制与下一步：

- Flutter 好友网络使用本地 fake，仅验证按钮和状态逻辑，不代表服务端真实关系授权、撤销或跨设备同步已验收。
- 当前环境没有 Mac/Xcode，未执行 iOS 编译、签名、真机、音频权限或 Flutter integration test 验收；公共 Flutter 测试通过不代表 iOS 已验证。
- 下一步继续拆分并实现剩余 UI/功能闭环；阶段 8 人工体验必须等全部功能落地后再开始。

### UI-006：设计系统与产品壳层

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：W2 网站纯字标、五项导航语义和编辑式线性图标，已完成
- 实现 Commit：`cb441ca`

结果：

- 产品壳层扩展为学习、阅读、探索、对话、我的五项导航；桌面侧栏按“开始/发现/账户”分组，移动端使用五项固定底栏。
- 新增 W2 斜体刊头字标在公开首页、桌面侧栏和移动顶部栏的使用；字标作为品牌/首页链接，不承担功能按钮。
- 新增头像入口与基础账户菜单；主题切换移入账户菜单，公开首页保留紧凑主题入口。
- 建立语义间距、圆角、字体和动效令牌，统一焦点环、44px 命中区、安全区、减弱动效和页面级横向溢出保护。

修改文件：

- `app/globals.css`
- `app/page.tsx`
- `src/shared/ui/app-shell.tsx`
- `src/shared/ui/bottom-navigation.tsx`
- `src/shared/ui/account-menu.tsx`
- `src/shared/ui/theme-toggle.tsx`
- `tests/unit/bottom-navigation.test.tsx`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm exec vitest run --pool=threads --maxWorkers=1`：75 个文件、324 个测试通过。
- `pnpm build` 通过。
- `pnpm exec playwright test tests/e2e/product-shell.spec.ts --workers=1`：桌面与手机共 32/32 通过。
- 浏览器检查覆盖公开首页、1280px 桌面侧栏、375px 手机顶部栏/底栏、账户菜单、主题切换和无横向溢出。

限制与下一步：

- `/read` 导航目标已接入壳层，但阅读书架与阅读器仍由 UI-009 实现；本切片不读取业务数据。
- 账户菜单当前提供“我的进步与隐私”和主题切换，退出登录流程不在 UI-006 范围内。
- 任务前已存在的 `tests/e2e/product-shell.spec.ts` 用户改动保留在工作树，未并入本次 Commit。
- 下一项为 UI-008：探索与对话工作区。

### UI-007：公开首页与登录后学习首页

- 状态：`done`
- 负责人：Codex；产品本人完成首屏对照
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：UI-006，已完成
- 实现 Commit：`76dba30`

结果：

- 公开首页按概念稿补齐深青 Hero、三类使用场景、工作方式、产品片段、隐私/可信度、FAQ 和轻量页脚；主 CTA 保持“开始第一次练习”。
- 登录后 `/learn` 读取现有训练断点存储；无断点时显示唯一“开始第一次练习”与明确空进度状态，有断点时从内容包派生当前表达和 `n / total`，恢复“继续学习”。
- 学习页增加阅读库空状态、Lucía 对话和沟通目标三个支持模块；未创建 `/read` 业务页面，避免提前进入 UI-009 范围。
- 保留 URL `focus` 方向选择，不增加时长、模式或内容类型前置表单，不写入评分或画像数据。

修改文件：

- `app/page.tsx`
- `app/(product)/learn/page.tsx`
- `app/(product)/learn/learn-page-content.tsx`
- `app/globals.css`
- `tests/unit/learn-page.test.tsx`
- `tests/unit/public-home.test.tsx`
- `tests/e2e/alpha-flow.spec.ts`
- `tests/e2e/product-shell.spec.ts`

验证：

- `pnpm lint`、`pnpm typecheck` 通过。
- 全量 Vitest（单线程）：76 个文件、326 个测试通过。
- UI-007 相关 E2E：`tests/e2e/alpha-flow.spec.ts` 8/8 通过；包含 product-shell 的组合运行 39/40，通过项覆盖 UI-007 路径，剩余 1 条为既有移动端关系记忆删除用例偶发失败。
- 完整 `pnpm test:e2e` 未在最终修改后重跑；首次并行运行的失败包含旧首页文案断言和既有环境偶发项，已通过更新断言与局部重跑确认本任务路径。
- `pnpm build` 通过。
- Chrome 视觉对照覆盖公开首页首屏、无断点学习页和合法断点恢复态；概念稿路径为 `http://localhost:4173/page-mockups-v1.html`。

限制与下一步：

- `/read` 仍等待 UI-009；学习页当前以明确空状态呈现阅读入口，不伪造文章或进步数据。
- 推荐器尚无面向 Web 的独立读取接口，本任务沿用现有 URL 方向和训练断点边界；接入真实推荐数据需后续任务明确 API 契约。
- 下一项为 UI-008：探索与对话工作区。

### UI-008：探索与对话工作区

- 状态：`done`
- 负责人：Codex；产品本人完成桌面/移动视觉复核
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：UI-006，已完成
- 实现 Commit：`c498e84`

结果：

- `/explore` 将沟通目标与沉浸内容包分组展示，补充五个沟通方向和真实内容包卡片；草稿内容明确显示“内容整理中”，不渲染为按钮或可点击入口。
- `/chat` 增加联系人列和 Lucía 置顶关系，保留自然交流说明、练习入口、最近话题空状态和好友介绍授权流程；移动端联系人列变为可横向浏览的顶部联系人条。
- `/chat/lucia` 沿用既有 NDJSON 流、generation、停止、断流和重试边界；线程状态明确显示可发送、正在回复、回复完成、已停止和可重试失败。
- 语音/文字 composer 统一呈现空闲、录音和流式回复状态，录音不可用时继续安全降级到文字，不伪造转写或学习评分。

修改文件：

- `app/(product)/explore/page.tsx`
- `app/(product)/chat/page.tsx`
- `app/globals.css`
- `src/modules/conversation/ui/chat-thread.tsx`
- `src/modules/conversation/ui/voice-composer.tsx`
- `tests/e2e/product-shell.spec.ts`
- `PROJECT_STATUS.md`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- 受影响单测：对话与好友介绍权限 5/5 通过；隔离复跑学习页/热力图 3/3 通过。
- `pnpm test:e2e --project=desktop-chromium tests/e2e/product-shell.spec.ts`：18/18 通过。
- 全量 Vitest 首次并行运行受 Windows Node worker 内存和既有并行时序影响，报告 72/76 文件通过；失败的学习页与热力图测试在单线程隔离复跑 3/3 通过。
- 使用本地 Chromium 截图核对 `/explore`、`/chat`、`/chat/lucia` 的 1440px 与 375px 布局；Chrome 扩展无可接管的已登录标签，因此未改动用户浏览器状态。

限制与下一步：

- 内容包列表当前沿用已存在的单个草稿内容包，真实发布和更多内容卡片仍由内容审核/后续内容任务负责。
- 聊天继续使用 deterministic fake，消息持久化和真实语音转写不在 UI-008 范围内。
- 下一项为 UI-009：阅读库与规范化阅读器（已完成；下一项为 READ-005）。

### UI-009：阅读库与规范化阅读器 UI

- 状态：`done`
- 负责人：Codex；产品本人完成桌面/移动视觉与行为复核
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：READ-001 至 READ-004；READ-005 外部来源增量不在本次实现范围
- 实现 Commit：`4cbc121`；标题/统计微调：`e132088`；阅读器控件精简：`0989f88`

结果：

- `/read` 从卡片网格改为高密度文章列表，保留搜索、主题、已保存路由和排序入口；读取浏览器本地阅读状态后显示真实“继续阅读”断点。
- 文章阅读器重做为正文主列 + 固定辅助栏的信息架构；支持词语点击解释、段落辅助、已保存短语、高亮、阅读设置、浏览器 TTS、个人笔记、版本提示和离线状态。
- 移动端辅助栏改为抽屉和遮罩，正文与底部导航在 390px 视口无横向溢出；阅读迁移入口继续复用 READ-004 的显式口语复核边界。
- 修复文章行箭头入口的重复可访问名称，避免标题链接与操作链接造成严格定位冲突。
- 移除书架结果区重复的 `Reading library` / `Public Texts` 标题，将当前篇数移到来源标签栏右侧；移动端统计独占一行，避免挤压来源入口。
- 移除书架右上角“回到今天”，文章行箭头改为可用的 My Texts 五角星保存/取消保存；阅读器移除无效保存、阅读设置、段落计数、顶部标题、进度条、CEFR/时长/地区元信息和阅读辅助栏，正文改为单栏展示。

修改文件：

- `app/(product)/read/read-shelf.tsx`
- `app/(product)/read/article/[articleId]/article-reader.tsx`
- `app/globals.css`

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- 阅读库/阅读器 Vitest：4/4 通过；`tests/e2e/product-shell.spec.ts -g "published reading"`：桌面/移动 2/2 通过；`tests/e2e/article-transfer.spec.ts`：桌面/移动 2/2 通过。
- 标题/统计微调回归：`pnpm lint`、`pnpm typecheck`、阅读库/阅读器 Vitest 4/4、阅读库 E2E 桌面/移动 2/2 通过；390px 截图无横向溢出。
- 控件精简回归：`pnpm lint`、`pnpm typecheck`、阅读库/阅读器 Vitest 5/5、阅读库 E2E 桌面/移动 2/2 通过；保存/取消保存请求和 390px 单栏阅读器均已验证。
- 浏览器视觉复核：默认桌面视口、390px 移动视口；词语辅助、保存短语、设置、笔记、移动抽屉和阅读到口语入口均已验证。

限制：

- 全量 Vitest 当前仍有既有 `tests/database/article-content.test.ts` 两条失败：测试断言仍按单文章 fixture 编写，而 bundle 已包含 5 篇文章；发布版权断言也与当前 Schema 行为不一致。本次未扩大范围修改既有内容契约测试。
- 阅读进度、短语、高亮和笔记仍是浏览器 localStorage Alpha 缓存，服务端私有表/RLS 和外部来源导入留给 READ-005。
- 本次未进行 Flutter/iOS 编译或真机验证。

下一项：`READ-005` 个人保存和外部来源增量。

### READ-005：个人保存和外部来源增量

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 前置依赖：READ-001 至 READ-004，已完成
- 实现 Commit：`f4e1037`

结果：

- 新增 `0012` 迁移和四张用户私有阅读表：进度/笔记、文章收藏、短语/高亮、外部来源元数据；所有表通过 `profiles` 级联删除并启用 `user_id = auth.uid()` RLS。
- 新增 `reading` application/repository 与 `/api/v1/read/articles/:articleId/state`、`/read/saved`、`/read/sources` 接口；内容哈希不一致返回 `409 CONFLICT`，保存写入幂等，外部 URL 只规范化和去重，不执行抓取。
- Web 阅读器服务端同步优先，未登录、离线或数据库不可用时保留 localStorage；书架已保存筛选读取服务端 ID，阅读行为不写 `evidence_events`、`mastery` 或 `confidence`。
- OpenAPI/JSON Schema、架构/数据库/测试文档同步更新；路由、RLS、幂等、版本冲突和账号删除级联均有测试。
- 后置内容种子：新增 `content/bundles/readlang-public-v1.json`，导入项目所有者确认拥有再发布授权的 100 篇西语文章；Public Texts 默认 bundle 已合并该文章源，并保留每篇原始 URL、归属、授权证据和审核记录。

验证：

- `pnpm lint`、`pnpm typecheck`、`pnpm db:check` 通过。
- READ-005 专项 Vitest：4 个文件、15 个测试通过；单 worker 阅读器/账号删除测试通过。
- `pnpm build` 通过；构建产物包含三条新的阅读 API 路由。
- 授权文章 bundle：`pnpm content:validate -- content/bundles/readlang-public-v1.json` 通过；数据库导入返回 `imported`，重复导入返回 `unchanged`。
- 全量 `pnpm test --run` 在 Windows 并行 worker 发生 OOM；单 worker 复跑后仅剩既有 `tests/database/article-content.test.ts` 两条 fixture 断言失败（bundle 已有 5 篇文章且版权断言过期）。
- 本次未进行 Flutter/iOS 编译或真机验证；完整 E2E 受并行 WebServer OOM 影响未完成。

限制与下一步：

- 外部来源当前只保存元数据，不抓取正文；RSS、Newsletter、浏览器扩展、任意网站导入和版权解析需单独任务与政策更新。
- READ-005 后置修复（`3ddb9fd`）：My Texts 在服务端按用户保存 ID 过滤后再分页，书架可读取服务端阅读断点；初次离线时网络恢复会重新尝试阅读状态同步。相关阅读单测 14/14、`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。
- 已知限制：未配置数据库时仍使用浏览器本地保存列表回退；Flutter 阅读页仍是本地进度缓存，尚未接入同一组服务端阅读状态 API。
- 下一项：`UI-010` 我的进步与隐私控制。

### UI-010：我的进步与隐私控制

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 实现 Commit：`d59a617`

结果：

- `/me` 重组为能力与活动、关系隐私、数据与隐私三个可定位分区，增加稳定锚点导航。
- 保留掌握度、可信度、口语覆盖和有效学习时长的独立语义；数据不足仍不绘制虚假能力轮廓。
- 关系记忆、已保存语音和账号数据概览的加载失败均提供明确错误和重试入口；删除操作继续使用现有确认、幂等和失败反馈。
- 新增页面信息架构测试，并补充关系记忆加载失败恢复测试。

验证：

- UI-010 相关 Vitest：6 个文件、9 个测试通过。
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。

限制与下一步：

- 本次未改变 profile、memory、media 或 account data application；全量 Web E2E 和跨视口/屏幕阅读器回归留给 UI-011。
- 当前没有 Mac/Xcode，未进行 Flutter iOS 编译或真机验证。
- 下一项：`ALPHA-033` Alpha 功能缺口收敛与发布候选准备。

### UI-011：跨视口、可访问性与行为回归

- 状态：`done`
- 负责人：Codex
- 目标分支：`fix/login-redirect-after-otp`
- 实现 Commit：`7a54b85`

结果：

- 阅读器恢复低强调个人笔记、四种口语迁移方向、草稿保存/跳过/口语复核和当前段落/全文朗读；阅读、打字和跳过仍不会写入口语证据。
- 移动阅读辅助抽屉使用 `dialog`/`aria-modal` 语义，支持 Escape 关闭、打开后焦点移入、Tab 循环和关闭后焦点恢复；服务端/本地阅读状态继续支持离线恢复与版本冲突提示。
- 更新过时的“迁移/辅助必须不存在”断言，新增 320/375/414/768/1024/1440px 的 `/read`、文章阅读器和 `/me` 无横向溢出回归。

验证：

- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- UI-011 相关 Vitest：7/7 通过；单 worker 全量 Vitest：365/367 通过，剩余 2 条为既有 `tests/database/article-content.test.ts` fixture 断言失败。
- UI-011、阅读迁移和产品壳层 Playwright：24/24 通过（desktop Chromium，含视口矩阵和移动抽屉焦点回归）。
- `pnpm build` 通过。

限制与下一步：

- 全量 Vitest 的 2 条 `article-content` 失败来自现有 bundle 文章计数与版权 fixture 断言过期，不是 UI-011 改动；默认并行全量测试仍可能触发 Windows 资源限制。
- 当前没有 Mac/Xcode，未进行 Flutter iOS 编译、签名或真机验证。
- 下一步：先执行 `ALPHA-033`，完成剩余功能、缺陷修复和发布候选门禁；阶段 8 仅在候选版本通过后启动。不在本任务中实现外部来源抓取、RSS、Newsletter 或 Flutter 服务端阅读同步。

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
| ALPHA-031 | done | `fix/login-redirect-after-otp` | Codex | MiniMax M3 生成式角色对话 | ALPHA-030 |
| ALPHA-032 | done | `fix/login-redirect-after-otp` | Codex | 对话搜索与三角色目录 | ALPHA-031 |
| UI-001 | done | `fix/login-redirect-after-otp` | Codex | 认证回跳、四栏导航和学习入口功能闭环 | 阶段 8 |
| UI-002 | done | `fix/login-redirect-after-otp` | Codex | 探索内容包功能闭环 | UI-001 |
| UI-003 | done | `fix/login-redirect-after-otp` | Codex | Lucía 对话发送、停止、断流和重试闭环 | UI-002 |
| UI-004 | done | `fix/login-redirect-after-otp` | 产品本人 / Codex | 画像、热力图和隐私数据控制闭环 | UI-003 |
| UI-005 | done | `fix/login-redirect-after-otp` | 产品本人 / Codex | 好友介绍、共享授权和 Flutter/Web 局部功能验收 | UI-004 |
| READ-001 | done | `fix/login-redirect-after-otp` | Codex | 文章内容契约、版权字段、文章表族与幂等导入 | ALPHA-006 |
| ALPHA-033 | ready | 待分配 | 待协调分配 | Alpha 功能缺口收敛与发布候选准备 | 阶段 7、UI-006 至 UI-011、READ-001 至 READ-005 |
| 阶段 8 | ready | 待启动 | 产品本人 / Codex | 发布候选版本的个人 Alpha 使用周期与人工体验复核 | ALPHA-033 退出条件 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | ALPHA-033 | Alpha 功能缺口收敛与发布候选准备 | 阶段 7、UI-006 至 UI-011、READ-001 至 READ-005 |
| 2 | 阶段 8 | 个人 Alpha 使用周期与人工体验复核 | ALPHA-033 退出条件与产品本人确认 |

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
- 当前产品壳层设计为五项导航：学习、阅读、探索、对话、我的；历史 UI-001 的四栏实现记录代表当时基线，阅读扩展待后续 UI/READ 切片实施。
- 首页按学习状态提供唯一真实主动作：无学习记录时为“开始第一次练习”，有稳定断点时为“继续学习”；时长、模式和内容调整不作为进入前置条件，是否提供可选入口由可用性验证决定。
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
| 2026-08-25 | 完成 UI-005 好友介绍、共享授权和 Flutter/Web 局部功能验收 | `a1766d5`、`8f680ee` | Web 介绍/授权失败可重试；Flutter fake 支持接受、拒绝、可选共享和撤销；继续剩余 UI/功能切片，人工体验暂缓 |
| 2026-08-26 | 完成 UI-008 探索与对话工作区 | `c498e84` | 探索目标/草稿内容包、联系人与 Lucía 置顶关系、线程状态和 composer 状态完成；下一项 UI-009 |
| 2026-08-26 | 完成 UI-009 阅读库与规范化阅读器 UI | `4cbc121` | 书架列表、真实阅读断点、桌面辅助栏、移动抽屉和 READ-004 迁移入口完成；下一项 READ-005 |
| 2026-08-26 | 微调 UI-009 阅读库标题与篇数位置 | `e132088` | 移除重复结果区标题，统计移至来源标签栏并补齐桌面/移动回归；下一项 UI-010 |
| 2026-08-26 | 精简 UI-009 阅读器控件与书架保存入口 | `0989f88` | 书架五角星保存/取消保存可用；阅读器移除无效按钮、进度和辅助栏；下一项 UI-010 |
| 2026-08-26 | 完成 READ-005 个人保存和外部来源增量 | `f4e1037` | 阅读私有表/RLS、服务端状态同步、收藏/标注/笔记和外部来源元数据接口完成；下一项 UI-010 |
| 2026-08-27 | 恢复 UI-009 Readlang 风格阅读工作台 | `c07bec1` | 文章正文词语级交互、Explain/Guide/Words/Settings 右侧辅助栏、移动抽屉、阅读设置与全文/分段 TTS；局部测试、lint、typecheck、build 通过；全量单测受并行 PGlite 超时和既有 ReadShelf Router 测试限制 |
| 2026-08-27 | 精简文章阅读器界面 | `0ac5180` | 移除顶部阅读进度、来源/查看原文、正文工具条、底部个人笔记、口语迁移和完成提示，仅保留正文与右侧辅助栏；局部测试、lint、typecheck、build 通过 |
| 2026-08-27 | 对齐 Readlang 阅读工作台顶部与侧栏 | `009f05d` | 顶部改为返回文章库、居中标题和操作区；移除 R 方标；侧栏增加 Dictionary 并保留 Explain/Guide/Words/Settings；阅读器单测、lint、typecheck、build 通过 |
| 2026-08-27 | 修正阅读器双板块布局 | `6585e83` | 正文与侧栏改为并列双列面板；侧栏固定 425px、取消卡片阴影并与 Readlang 的 tabs 面板边界对齐；移动端继续使用抽屉；阅读器单测、lint、typecheck、build 通过 |
| 2026-08-27 | 对齐双板块顶部起始位置 | `e3702ea` | 桌面端侧栏从顶部栏同一水平线开始，正文列与侧栏不再重叠；验证 1280px 桌面无横向溢出，移动端抽屉无横向溢出 |
| 2026-08-27 | 完成 UI-010 我的进步与隐私控制 | `d59a617` | `/me` 分组导航、能力/活动/关系/数据隐私层级和加载失败重试完成；下一项 UI-011 |
| 2026-08-27 | 完成 UI-011 跨视口、可访问性与行为回归 | `7a54b85` | 阅读器迁移/笔记恢复、移动抽屉焦点和 6 档视口回归完成；下一步改为 ALPHA-033 功能收敛与发布候选准备 |
| 2026-08-27 | 完成 ALPHA-032 对话搜索与三角色目录 | `c5b7106` | 当前用户私有历史搜索、消息深链高亮、Lucía/Mateo/Inés 动态角色页完成；下一步产品本人确认角色内容与搜索体验 |

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
