# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-09-12
- 当前里程碑：个人 Alpha 阶段 7.7——Web/PWA 个人学习闭环与场景实战重排
- 总体状态：ALPHA-033 继续进行；当前成果只形成电脑端 Web 临时集成测试基线，不是发布候选。v2 内容、远端数据库导入和自动化回归已完成，但产品本人确认仍有未完成功能及明显的排版、按钮和交互缺陷；必须重新盘点并修复后再讨论发布候选。阶段 8 未启动
- 协调分支：`main`
- 当前门禁：未放行发布候选。`alpha.core@2` 与 `alpha.scenario-practice@2` 已通过审核、校验和数据库导入，只证明内容数据具备测试条件；自动化测试通过和真实登录页面可访问，也不能替代功能完整性、视觉排版、按钮语义及端到端可用性验收。电脑端 Web 密度与操作层级书面规格已由产品本人确认，`UI-012` 至 `UI-017` 的逐任务实施计划已形成；`UI-012` 已在独立分支开始，后续任务依赖前项验收。iPhone Safari/PWA 真机、Flutter 及 6 个 `mobile-chromium` 失败继续延期并如实记录

### 2026-09-11：Web/PWA 个人学习与场景实战重排

- 状态：`done`
- 负责人：Codex / 产品本人
- 目标分支：`fix/login-redirect-after-otp`
- 设计 Commit：`aaa9875`
- 实施计划 Commit：`2a0f41f`
- 范围：产品改为首先服务项目所有者自己的学习；当前只推进响应式 Web/PWA 与 iPhone Safari，暂停 Flutter、原生应用、商店发布和跨端同步；探索页改造成场景与表达库，新增临时人物多轮实战、完整文字复盘、逐条错误标记和当天/1/3/7 天复现设计；长期 AI 角色仍为主要功能，但自然度、Provider、记忆和其他角色进入后续独立设计流。
- 文档：[`Web 优先的个人学习产品与场景实战设计`](docs/superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)、[`Web/PWA 场景学习闭环实施计划`](docs/plans/2026-09-11-web-first-scenario-practice-implementation-plan.md)、[`ADR-0002`](docs/adr/0002-web-pwa-first-personal-alpha.md)，以及 README、AGENTS、架构、认证、内容和测试策略同步。
- 验证：逐节产品、页面、技术方案及书面规格已由产品本人确认；实施计划的本地 Markdown 链接全部可解析，无占位符，`git diff --check` 通过。文档任务未运行代码测试。
- 限制：本条只确认设计与实施计划，尚未交付场景业务代码、数据库或部署；单账号邮箱 allowlist 仍需独立认证任务实现。
- 下一步：`SCN-001` 已在 `codex/scn-001-scenario-foundation` 按测试先行开始实施。

### 2026-09-11：SCN-003 Explore 场景建议与随机选择设计

- 状态：`done`
- 负责人：Codex / 产品本人
- 目标分支：`main`（设计基线；功能实现仍使用 `codex/scn-003-scenario-library`）
- 设计 Commit：`f894d71`
- 范围：为“不知道搜索什么”的状态增加“适合我的 / 探索新场景 / 随机来一个”三个明确入口；三种模式共用经过发布状态、所有权、可用性和难度过滤的候选池，先展示可解释场景卡，再由用户开始或换一个；现有场景不足时才提示确认生成私人场景。
- 边界：默认选择不调用 LLM、不产生学习证据、不使用低置信度转写、技术失败、学习时长、完整私密对话或长期角色记忆；本能力属于 SCN-003 Explore 发现辅助，不改变首页唯一主动作，也不提前实现 SCN-004 的跨任务推荐。
- 文档：[`Explore 场景建议与随机选择设计`](docs/superpowers/specs/2026-09-11-explore-scenario-suggestions-design.md)，并同步上位设计及两份实施计划中的 SCN-003 范围、接口建议与测试验收。
- 验证：六部分产品方案均由产品本人逐节确认；相关 Markdown 链接检查和 `git diff --check` 通过。文档任务未运行代码测试。
- 限制：本条只交付设计与计划更新，未修改页面、API、数据库或 Provider；候选排序质量仍需在 SCN-003 实现后用固定样本和人工体验验证。
- 下一步：产品本人审核本次落库文档；确认后在 `codex/scn-003-scenario-library` 按测试先行实施 SCN-003，不混入 SCN-004。

### SCN-001：场景领域与持久化基础

- 状态：`done`
- 负责人：Codex
- 目标分支：`codex/scn-001-scenario-foundation`
- 实现 Commit：`0af516b`
- 前置依赖：Web/PWA 场景学习闭环设计与实施计划已由产品本人批准
- 范围：状态机、实体、持久化与 RLS、基础 API DTO、场景专用 Provider 端口与路由规则、deterministic fake 和固定契约样本。
- 不包含：页面、真实收费 Provider、学习证据写入、长期角色/会话/关系记忆写入，以及 Flutter 改动。
- 修改：新增纯 TypeScript 场景状态机、0/1/3/7 天复现计划、场景生成/临时人物/评估 Provider 端口与 deterministic fake；新增七张私有表、复盘完整轮次触发器、所有权复合外键、RLS、幂等/CAS repository；补充 v1 DTO、OpenAPI、稳定错误码和固定转换样本。
- 验证：SCN-001 聚焦测试与共享 schema/API 回归 `33/33`；全量 Vitest 单 worker `125 files / 557 tests` 全部通过；`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、`pnpm build`、`git diff --check` 通过；全量 Playwright `112 passed / 14 failed`，失败均位于既有 `product-shell.spec.ts` 与移动文章选区，未涉及本任务文件或新增页面。
- 限制：未在未确认用途的 `DATABASE_URL` 上执行 `pnpm db:migrate`，迁移已通过 PGlite 从基础版本和完整空库序列验证；未实现用户页面、Route Handler、真实 Provider、真实 iPhone Safari 或 Flutter；目前仍不可直接从 UI 使用场景实战。
- 合并：PR [#11](https://github.com/laurenzhong/Spanish/pull/11)，Merge Commit `5b968e4`
- 下一步：`SCN-002` 已在 `codex/scn-002-multi-scenario-vertical` 开始，交付内容驱动的通用工作台以及餐厅沟通、校园办事、租房沟通三个基础场景，并保持长期角色/记忆隔离。

### SCN-002：通用多场景可用纵向闭环

- 状态：`done`
- 负责人：Codex
- 目标分支：`codex/scn-002-multi-scenario-vertical`
- 实现 Commit：`6c41f52`
- 状态同步 Commit：`51f5d5b`
- 合并 Commit：`c1a6e5f`
- 前置依赖：SCN-001，已通过 PR #11 合并（Merge Commit `5b968e4`）
- 范围：实现内容驱动的通用场景详情、文字/语音实战和基础逐条复盘；首批提供餐厅沟通、校园办事、租房沟通三个不同类型的场景，证明临时人物、沟通目标、提示、表达和条件变化均由版本化内容驱动。
- 不包含：SCN-003 的完整场景库搜索/分类/私人生成，SCN-004 的历史与间隔复现，学习证据写入，长期角色/关系记忆，以及 Flutter 改动。
- 修改：新增 `scenario-practice-alpha-v1` 版本化内容包（3 个场景、9 个沟通目标、15 条核心表达及自然变体），通用场景目录 DTO、详情/实战/基础复盘页面、Explore 三个入口、浏览器录音与可编辑转写确认、内容定义的单次条件变化、MiniMax M3 roleplay/evaluation 适配器、NDJSON `meta/delta/condition/done/error` 流、会话/轮次/反馈 API 与账号持久化；临时人物继续与长期角色、联系人和关系记忆隔离。
- 验证：内容校验通过；场景聚焦单元/契约/数据库回归 `6 files / 21 tests`，Route Handler 回归 `4/4`；仓库级 Vitest `130 files / 572 tests`、`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、`pnpm build`、`git diff --check` 全部通过；场景 Playwright 在桌面 Chromium `2/2`、移动 Chromium `2/2` 通过，覆盖 390px 无横向溢出、移动底栏不被主导航遮挡、两轮表达、条件只触发一次和进入复盘。
- 限制：三个内容场景目前均为未发布草稿，仅有 Codex 临时审核，仍需西班牙语母语者与中文教学视角审核后才能在生产环境显示；未使用真实收费 MiniMax 进行回放，运行时需配置 `MINIMAX_API_KEY`；账号持久化还要求 `DATABASE_URL` 且先导入对应内容包，缺少时 UI 会明确退化为本设备断点；未做真实 iPhone Safari、麦克风权限和供应商网络验证；未重跑已知含 14 条其他任务失败的全量 Playwright。
- 下一步：开始 `SCN-003` 场景与表达库；在生产发布这些基础场景前，先完成内容双重人工审核并导入版本化内容包。

### SCN-003：场景与表达库、可解释建议与私人生成

- 状态：`done`
- 负责人：Codex
- 目标分支：`codex/scn-003-scenario-library`
- 前置依赖：SCN-001、SCN-002 已完成并合并；专项设计已由产品本人批准（设计 Commit `f894d71`）
- 范围：完成场景与表达搜索、分类、收藏、多来源私人生成，以及“适合我的 / 探索新场景 / 随机来一个”的可解释选择辅助；保持现有内容包为次级材料。
- 验收：服务端重新校验发布状态、所有权和来源；默认建议不调用 LLM、不产生学习证据；三种策略、换一个去重、无画像/无候选退化、移动端交互及私人生成幂等均有自动化覆盖。
- 不包含：SCN-004 的历史、到期复现和首页唯一下一动作，长期角色/关系记忆，公共内容自动发布，以及 Flutter 改动。
- 已完成切片 1：Explore 增加“适合我的 / 探索新场景 / 随机来一个”、结果预览与“换一个”；新增纯资格/排序/加权随机策略、用户私有学习投影读取、认证 Route、Zod 与 OpenAPI/JSON Schema 契约、请求取消/过期响应保护、空状态与主题回退。实现 Commit：`b2093b6`；分支状态同步 Commit：`faa9c07`；已直接合并到 `main`，Merge Commit：`2fa1e03`。SCN-003 仍为 `in_progress`。
- 已完成切片 2：新增正式表达、本人阅读选区、本人场景复盘和手工输入四类收藏来源及收藏列表/归档接口；新增主题、收藏表达、阅读选区和可信近期错误四类私人场景生成来源、MiniMax M3 Provider 与 deterministic fake、确认后生成、输入指纹幂等和失败不落半成品；本人私人场景可进入详情、实战、复盘、Explore 列表及同一建议候选池，并可安全归档。实现 Commit：`1a42f68`；分支状态同步 Commit：`e787a4a`；已直接合并到 `main`，Merge Commit：`78389b2`。SCN-003 仍为 `in_progress`。
- 已完成切片 3：Dashboard 增加服务端授权的场景/表达资料库 DTO，统一投影公共场景、本人私人场景、正式表达、本人收藏、本人阅读选区和可信近期错误；搜索覆盖标题、沟通目标、角色、表达、西语/中文、CEFR、地区和分类，忽略大小写、标点与西语重音；增加全部、已收藏、最近错误、阅读来源、可立即开始五类筛选、URL 恢复、无结果恢复、多来源进入私人生成和表达收藏。实现 Commit：`c944eec`；分支状态同步 Commit：`d76ea36`；已直接合并到 `main`，Merge Commit：`af7f4fb`。
- 修改：Explore 页面、纯搜索/筛选领域逻辑、授权资料库 application/repository、Dashboard Route 与 v1 OpenAPI/JSON Schema/fixture、私人候选地区投影、响应式样式，以及架构、内容和测试策略文档。
- 验证：`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、契约测试 `10 files / 38 tests`、全量 Vitest `141 files / 611 tests`、`pnpm build` 和 `git diff --check` 通过；Explore Playwright 桌面与移动 `20/20`，同步后的产品壳层 Explore 用例 `4/4` 通过。全量 Playwright 首轮为 `123/138`，其中 4 条为已同步并单独通过的 Explore 旧文案/入口断言；剩余 11 条位于既有聊天好友介绍、移动阅读选区/布局和账号删除，未改动相应产品代码或放宽断言。
- 限制：三个公共场景与 `alpha-core-v1` 正式表达仍未经双重人工审核，生产环境不会显示；私人场景只作为本人可见 `draft`；默认建议仍不调用 LLM，只有本人明确确认生成才调用；未进行真实 MiniMax 收费调用、真实 PostgreSQL/Supabase 联调或 iPhone Safari 真机验证，Flutter 未修改。
- 下一步：进入 `SCN-004`，实现完整历史、逐条复盘、重新说、当天/1/3/7 天间隔复现和首页唯一下一动作接入。

### SCN-004：完整历史、复盘与间隔复现

- 状态：`done`
- 负责人：Codex
- 目标分支：`codex/scn-004-review-repetition`
- 实现 Commit：`1d574b8`
- 分支状态同步 Commit：`f8f7e9f`
- 合并 Commit：`6e65c7f`
- 前置依赖：SCN-001 至 SCN-003 已完成；Web/PWA 场景规格和逐文件计划已由产品本人批准
- 范围：完成账号权威的场景历史、逐轮完整复盘、原句错误与自然替代、“重新说”新尝试、当天/1/3/7 天换条件复现，以及学习页“稳定断点 → 到期复现 → 新任务”的唯一主动作编排。
- 修改：场景完成事务现在冻结会话、为缺失反馈创建中性 pending review，并幂等创建 0/1/3/7 天复现；新增历史、完整复盘、到期列表/详情/完成 application、repository、Route 和响应式页面；重练由服务端验证原 session/turn 所有权且创建新会话，不覆盖原轮次或 review；可信评估先建立真实 `practice_attempts` 再追加 evidence，文字模式仍由既有领域规则过滤口语专属技能，低置信度和技术失败不写负面证据；同步扩展 v1 OpenAPI/JSON Schema。
- 验证：聚焦单元、契约和数据库测试 `10 files / 39 tests` 通过；全量 Vitest `145 files / 625 tests` 通过；`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、`pnpm test:contracts`、`pnpm build`、`git diff --check` 全部通过；场景与学习页 Playwright 在桌面/移动 Chromium `10/10` 通过。
- 限制：没有执行真实收费 MiniMax 调用、真实 Supabase/PostgreSQL 远端联调或 iPhone Safari 真机验证；Playwright 使用无数据库的确定性 device fallback，账号历史/跨设备恢复由 PGlite 事务与 RLS 测试覆盖；本轮未重跑已记录存在 11 条其他任务失败的全量 Playwright；三个公共场景和 `alpha-core-v1` 正式表达仍为 draft，生产环境继续隐藏；Flutter 未修改。
- 下一步：进入 `SCN-005`，实现 Provider 设置/切换并完成 iPhone Safari/PWA 真机收敛和发布门禁；不在本任务提前扩展长期角色、Flutter 或商业功能。

### SCN-005：Provider 设置、自动切换与 iPhone Safari/PWA 收敛

- 状态：`in_progress`
- 负责人：Codex / 产品本人
- 目标分支：`codex/scn-005-provider-pwa-hardening`
- 设计 Commit：`c2be202`
- 实现 Commit：`7ee64f2`
- 分支状态同步 Commit：`5c1a546`
- 合并 Commit：`b782140`
- 优先级决定（2026-09-12）：产品本人确认暂时以电脑端 Web 为优先；SCN-005 按已通过的电脑端 Web 代码、契约、构建和专项浏览器门禁完成，iPhone Safari/PWA 真机检查延期且不阻塞当前阶段。
- 前置依赖：SCN-001 至 SCN-004 已完成；Provider 路由优先级、一次性切换、观测与真机边界已由产品本人确认
- 范围：按场景生成、临时人物回复、场景评估、转写和发音展示 Provider 配置、健康与用户偏好；为三类场景能力接入 MiniMax/OpenAI 选择和安全的一次性 fallback；收敛 iPhone Safari 录音生命周期、visual viewport、安全区、PWA metadata 和八档响应式视口。
- 修改：新增服务端 Provider registry、健康派生、用户偏好与观测 repository、OpenAI Responses 适配器、状态/偏好 API、v1 OpenAPI/JSON Schema 和“我的 → 偏好设置”面板；流式回复只在首个 delta 前切换，无 `done` 视为失败，取消/非法响应不切换，每次尝试独立记录脱敏结果；录音在页面隐藏、`pagehide`、音轨结束、Pointer Cancel 或快速松手时取消并释放资源，不送转写或产生负面证据；新增 512px any/maskable 图标、180px Apple 图标与真机清单。
- 验证：全量 Vitest `153 files / 652 tests`、Provider 契约 `10 files / 41 tests`、录音/工作台聚焦回归 `2 files / 13 tests`、SCN-005 桌面与移动 Chromium 多视口 Playwright `4/4` 通过；`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、`pnpm build`、`git diff --check` 全部通过。扩大运行 `product-shell.spec.ts` 与 `scenario-practice.spec.ts` 时仍会命中既有 Lucía 联系人/介绍请求失败，未将该结果误记为 SCN-005 通过。
- 限制：没有调用真实收费 MiniMax/OpenAI/SpeechAce，没有在远端 Supabase/PostgreSQL 执行迁移或联调，没有真实 iPhone Safari/PWA 验证；移动兼容代码和 [`场景实战 iPhone Safari / PWA 真机检查清单`](docs/testing/scenario-practice-iphone-safari-checklist.md) 继续保留，但真机结论延期；三个公共场景和正式表达仍为 draft；Flutter 未修改。
- 下一步：继续 `ALPHA-033` 的电脑端 Web 功能缺口、已知缺陷和发布候选门禁收敛；满足退出条件后再由产品本人确认进入阶段 8 的电脑端 Web 个人 Alpha 使用周期。iPhone Safari/PWA 真机验收后续单独排期。

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
- 目标分支：`main`
- 前置依赖：阶段 7、UI-006 至 UI-011、READ-001 至 READ-005
- 范围：对照产品设计和 Alpha 范围盘点未完成能力与已知缺陷；当前优先补齐电脑端 Web 的核心训练、初次诊断、阅读、对话、画像和隐私闭环；修复阻塞级/高优先级流程、状态机、取消/竞态、数据隔离、证据污染和角色一致性问题；清理电脑端 Web 发布候选测试与 fixture 漂移。响应式与 iPhone Safari/PWA 兼容代码继续保留，但真机验收延期；Flutter 继续暂停同步。
- 不包含：阶段 8 连续使用配额、周度复盘或全面主观体验；支付、完整内容后台、实时双向语音、大规模角色网络、任意外部来源抓取和其他 Alpha 延后范围。
- 验收：电脑端 Web 核心路径可从入口走到完成或可恢复失败；P0/P1 缺陷清零；关键数据和角色安全不变量有自动化回归；`pnpm lint`、`pnpm typecheck`、`pnpm test --run`、适用的电脑端 `pnpm test:e2e` 与 `pnpm build` 按发布候选范围通过。iPhone Safari/PWA 真机与 Flutter 检查不再作为当前退出门禁，延期结果必须诚实记录。
- 优先级覆盖说明：下方切片日志中的 Flutter 同源实现或 iPhone 真机“下一步”保留为当时交接记录；自 2026-09-12 起均由电脑端 Web 优先决定取代，不代表当前任务顺序或放行前置。
- 当前切片：画像 Web `/me` 视觉与信息层级落地。首屏改为能力摘要、唯一真实继续练习入口（有证据时才显示）、八维状态条、最近证据时间线；雷达图与证据表降为可展开的次级明细；活动热力图默认展示最近 12 周；桌面/移动样式统一暖米白、赤陶与灰绿色编辑式主题，并补充暗色主题映射。实现 Commit：`c1f740c`。随后修复分区入口仅为锚点的问题，新增客户端分段视图：默认只渲染能力与活动，关系隐私/数据与隐私切换时隐藏其他分区，并同步 hash 与浏览器返回；实现 Commit：`6b6f29f`。数据库连接探测成功并执行 `pnpm db:migrate` 应用 15 条迁移；修复画像、活动、关系记忆和保存语音 API 对浏览器 Cookie 会话的回退认证，使真实登录页面可读取数据库空/有数据状态；实现 Commit：`b31a629`。验证：画像/热力图/profile 页面 Vitest 7/7，Profile API 相关 Vitest 6/6，画像 E2E 1/1（桌面）+ 1/1（移动），`pnpm lint`、受影响文件 ESLint 通过；浏览器 Playwright 验证迁移后画像与活动从 503 恢复并无横向溢出。全量 `pnpm exec tsc --noEmit` 仍被其他代理未提交的 `chat-thread.tsx` 缺失格式化函数阻断。限制：当前数据库尚无该登录用户的学习证据，因此显示真实的 0/8 与空活动；本切片未改 Flutter 页面或新增 Dashboard DTO。下一步：补齐真实 profile Dashboard DTO 与 Flutter 同源渲染，再进入发布候选门禁。
- 账户菜单与个人资料可用性修复：退出登录接入 Supabase `signOut` 并跳转 `/login`，UID 复制增加非安全上下文回退；新增可用的 `/help` 帮助与 `/me#preferences` 偏好设置分区；个人资料读取失败时提供明确的重试入口，并为请求补充同源凭据和禁缓存。排查确认远程数据库尚未应用账户迁移，已通过 `pnpm db:migrate` 应用并验证 `profiles.public_uid/avatar_*` 字段存在、现有账户 UID 已补齐。新增资料保存后的账户菜单/对话头像同步、预设头像颜色和本地图片上传入口；头像选择改为点击“保存资料”后才上传，保存完成后再同步各页面，替换头像时清理旧上传文件；上传时会自动创建缺失的私有 `profile-avatars` bucket。实现 Commit：`9b2846d`、`e406f4c`、`3f1ee29`、`a0b6bfe`、`d75f364`、`b45bd94`、`68b000e`；验证：账户菜单/个人资料/画像/账户更新相关 Vitest 9/9、受影响文件 ESLint、`pnpm exec tsc --noEmit` 通过。限制：照片上传需要配置 Supabase `SUPABASE_SECRET_KEY`（或旧版 `SUPABASE_SERVICE_ROLE_KEY`）；偏好设置暂存本设备，尚未接入 `user_preferences` 服务端同步；Flutter 账户菜单仍需接入同源退出和偏好 API。下一步：配置并验证 Storage 上传，再继续发布候选门禁。
- 头像稳定性与清理补丁：账户菜单头像加载失败时回退到首字母；上传新头像后会清理该用户目录下残留旧对象。实现 Commit：`b93bba2`；验证：账户菜单/资料/上传相关 Vitest 5/5、受影响文件 ESLint、`pnpm exec tsc --noEmit` 通过。
- 账户头像首屏同步：账户菜单改为挂载时读取资料，不再等到点击菜单后才加载，避免左下角长期停留在空头像/默认状态。实现 Commit：`94b3095`；账户菜单 Vitest 3/3、ESLint、TypeScript 检查通过。
- 桌面学习页调研与 F 方案设计交接：完成 Duolingo、Babbel、Busuu、Memrise、ELSA Speak、Echo-Loop、wallabag、Readest、Omnivore、Linear 及当前 `/learn`、`/learn/practice` 的技术与布局调研；确定“任务时间线 + 详情”作为桌面 Web 方向，补充 12 列网格、条件详情 rail、唯一主动作、训练状态替换、错误恢复与可访问性规范。设计 Commit：`e37485c`；文档见 [`docs/superpowers/specs/2026-08-28-learning-page-desktop-web-technical-research.md`](docs/superpowers/specs/2026-08-28-learning-page-desktop-web-technical-research.md) 与 [`docs/superpowers/specs/2026-08-28-learning-page-desktop-web-design.md`](docs/superpowers/specs/2026-08-28-learning-page-desktop-web-design.md)。视觉预览见 `.superpowers/brainstorm/visual-20260828/content/desktop-f-timeline-detail-v1.html`，已修复预览滚动容器并验证可向下滚动；本交接未改业务代码，未运行全量代码检查。产品本人已确认 F 方向，实施计划见 [`docs/plans/2026-08-28-learning-page-desktop-web-implementation-plan.md`](docs/plans/2026-08-28-learning-page-desktop-web-implementation-plan.md)。
- ALPHA-033 切片 A：桌面 `/learn` 任务时间线与条件详情 rail 已实现。实现 Commit：`da5f5ac`；修改 `app/(product)/learn/learn-page-content.tsx`、`app/globals.css`、`tests/unit/learn-page.test.tsx`、`tests/e2e/learn-page.spec.ts`。保留现有 checkpoint/唯一主动作逻辑，修复恢复焦点被查询参数初始化竞态覆盖的问题；无断点不渲染详情 rail，1024px 起详情折叠，深色主题同步令牌。验证：学习页 Vitest 2/2、桌面学习页 Playwright 2/2、受影响文件 ESLint、`tsc --noEmit` 通过；浏览器实测 1280/1440/1024px 无横向溢出。限制：数据不可用 DTO 和 `/learn/practice` 工作台仍在后续切片，未运行全量门禁。下一步：ALPHA-033 切片 B，统一训练工作台宽度与状态容器。
- ALPHA-033 切片 B：`/learn/practice` 已接入桌面任务时间线、统一主列工作台与条件详情 rail；保留原有 TrainingState/TrainingEvent、副作用 generation、checkpoint、口语/文字证据与技术失败恢复语义。实现 Commit：`58d2f0d`，后置证据状态修复 `f44fc59`，滚动回归 `563471b`；修改 `src/modules/training/ui/fake-training-loop.tsx`、`app/globals.css`、`tests/unit/fake-training-loop.test.tsx`、`tests/e2e/training-loop.spec.ts`。验证：FakeTrainingLoop 与学习页 Vitest 7/7、桌面训练 Playwright 6/6（追加 1280px 垂直滚动断言）、受影响文件 ESLint、`tsc --noEmit` 通过；1280px 与窄视口无横向溢出且页面可纵向滚动。限制：未运行全量 `pnpm lint`、`pnpm test --run`、`pnpm test:e2e`、`pnpm build`；下一步：ALPHA-033 切片 C，补齐跨视口与可访问性回归。
- ALPHA-033 切片 C：补齐 `/learn` 与 `/learn/practice` 的无效断点、唯一主 CTA、320–1440px 视口矩阵、时间线当前步骤、详情 rail 可见性、键盘焦点和文字路径证据回归。实现 Commit：`3e79f0a`；修改 `tests/unit/learn-page.test.tsx`、`tests/e2e/learn-page.spec.ts`、`tests/e2e/training-loop.spec.ts`。验证：相关 Vitest 8/8、训练 Playwright 8/8、学习页 Playwright 3/3、受影响文件 ESLint、`tsc --noEmit`、`git diff --check` 通过；各目标视口无横向溢出，键盘可从文字输入到提交操作。限制：全量门禁留待切片 D；下一步：ALPHA-033 切片 D，执行发布候选门禁。
- ALPHA-033 切片 D：已执行发布候选门禁并完成阻塞交接。`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过；全量 Vitest `392 passed / 2 failed / 10 worker errors`，失败为既有 `server-only` 客户端导入、BottomNavigation `useRouter` mock 与并行 worker 内存不足；全量 Playwright `93 passed / 15 failed`，失败集中在既有画像/关系记忆移动端路径、文章句子选择和资源不足，训练与学习相关路径均通过。未改 Flutter，未运行 Flutter 检查。当前发布阻塞：先修复上述既有测试与资源问题，再重新执行全量门禁；下一步：发布候选修复与人工体验复核。
- ALPHA-033 发布候选阻塞修复：为 BottomNavigation 单元测试补齐 `next/navigation` 的 `useRouter` mock；为阅读持久化数据库测试隔离 `server-only` 并将迁移 fixture 补齐至 `0014_parallel_liz_osborn.sql`（包含 `user_generated_articles`）。实现 Commit：`1e765aa`。验证：`tests/unit/bottom-navigation.test.tsx` 与 `tests/database/reading-persistence.test.ts` 合计 7/7；两文件 ESLint、`tsc --noEmit`、`git diff --check` 通过。限制：全量 Playwright 的 15 个既有失败（画像/关系记忆移动端、文章句子选择、资源不足）和并行 Vitest worker 内存问题仍未解决；其他代理未提交改动保持原样。下一步：在稳定 worker 配置和既有 E2E 问题明确归属后重跑全量发布门禁，再由产品本人进行人工体验复核。
- ALPHA-033 全量 Vitest 复跑：上述两个断言失败已消失；`pnpm test --run` 得到 `95/101` 测试文件完成、`407/428` 断言通过，剩余 6 个 worker 因 Windows Node/V8 内存不足异常退出，未出现新的业务断言失败。发布候选仍受并行 worker 资源和既有 E2E 失败阻塞。
- ALPHA-033 单 worker 全量复核：`pnpm test --run --maxWorkers=1` 消除了并行 OOM，完成 `101/102` 测试文件、`427/429` 断言；仅 `tests/unit/conversation-thread.test.tsx` 2 个用例失败，原因是未连接消息数据库时测试仍期待历史消息（属于其他代理对话持久化范围）。文章内容 fixture 漂移已由 `e586b81` 修复并通过。发布候选继续阻塞于该对话测试、既有移动端 E2E 和资源配置。
- 对话 UI 后置修复：所有消息新增头像和气泡；时间改为消息流中的居中分隔，仅在首条、跨日或间隔超过 5 分钟时显示，点击或键盘激活消息可查看完整时间；流式新消息和乐观发送消息补齐时间戳，保留右侧用户消息与长文本左对齐；移动端消息操作按钮与头像保持独立间距。实现 Commit：`30a140c`、`df135c5`、`e177497`、`7e9308e`。修改 `src/modules/conversation/`、`app/globals.css` 与对话 Playwright 回归；相关 Vitest 20/20、完整对话 Playwright 单 worker 22/22，追加桌面/移动布局与消息操作回归 4/4，`pnpm exec tsc --noEmit` 和受影响文件 ESLint 通过。限制：头像继续使用首字母/本地用户标记，未接入远程头像资源；Flutter 页面尚未同步本次视觉改动。
- 好友切换性能修复：动态 `/chat/[characterId]` 路由不再在 RSC 导航阶段同步读取数据库历史，先返回聊天壳层，由会话级缓存/API 立即恢复并后台校准；保留 `/chat/` 首次进入的服务端首屏历史和消息深链接参数。实现 Commit：`3c4725e`；修改 `app/(product)/chat/[characterId]/page.tsx`、`tests/unit/chat-character-page.test.tsx`。验证：动态路由回归 Vitest 1/1、对话线程/路由 Vitest 7/7、对话 Playwright 22/22、受影响文件 ESLint、`tsc --noEmit` 通过；本地未登录 HTTP 采样 `/chat/lucia`、`/chat/mateo`、`/chat/ines` 均约 110–390ms。限制：无缓存的首次好友切换仍需客户端历史 API 完成后显示消息；远程数据库本身的约 0.9 秒查询仍由后台校准承担，不阻塞路由切换。
- 阅读库首屏性能修复：`/read` 公共文章库跳过不需要的用户/数据库读取；登录用户的阅读进度、收藏和私有文章数据按页面需要加载，My Texts 三类查询并行执行并复用同一数据库句柄。实现 Commit：`c633ca9`；修改 `app/(product)/read/page.tsx` 与 `tests/unit/read-page.test.tsx`。验证：阅读相关 Vitest 18/18、首屏数据加载回归 3/3、仓库级 `pnpm lint`、`pnpm exec tsc --noEmit` 通过。限制：全量 `pnpm test --run` 仍受现有 Windows/Vitest 多 worker 内存耗尽阻断；未运行 E2E/build。下一步：继续 ALPHA-033 发布候选门禁。
- ALPHA-033 Lucía 好友申请门禁切片：新增 `GET/POST /api/v1/character-network/lucia-contact`，复用 `character_relationships.status` 表达 pending/active/declined；联系人侧栏只显示真实会话并显示 Lucía 申请入口及马德里文化活动/城市摄影来源。接受在事务内创建 active 关系、会话和唯一 authored opening message，拒绝不创建新会话；读取到历史 active 关系但缺少首条消息时也会幂等补齐；Lucía 聊天流在服务端再次检查 active，未审批返回 `CONTACT_REQUIRED`。实现 Commit：`edb8bba`、`7a3b950`、`48a3da0`。修改 `src/modules/character-network/`、`src/modules/conversation/ui/conversation-contact-rail.tsx`、`app/api/v1/character-network/lucia-contact/route.ts`、`app/api/v1/conversations/[characterId]/stream/route.ts`、相关契约、架构/测试文档与测试。验证：Lucía/好友介绍/对话门禁局部 Vitest 与数据库 24/24；单 worker 全量 Vitest 109 文件、453 断言通过；首条消息数据库回归 8/8；`pnpm typecheck`、受影响文件 ESLint、契约测试 28/28、`git diff --check` 通过。限制：推送调度和 Flutter 联系人 UI 尚未接入；无 `DATABASE_URL` 时联系人状态接口诚实返回 503，聊天测试环境仍保留 deterministic 行为。下一步：补好友申请 E2E，再进行发布候选门禁。
- ALPHA-033 provider A/B 评测基线：新增 provider-neutral 的 Lucía 回放清单 `tests/fixtures/evaluation/lucia-provider-v1/`，固定人物/关系/状态/语义计划/问题预算，要求 M3 与 GPT‑5.6 只比较表达层差异；补充契约测试，防止场景绑定具体 provider。实现 Commit：`e028d55`。验证：回放契约 1/1、TypeScript、受影响文件 ESLint 通过。限制：尚未接入 GPT‑5.6 API adapter，也未运行真实收费 provider；需先确认你的 API 账户可用模型 ID、额度和价格，再执行双 provider 回放。下一步：接入第二个 provider adapter，运行离线/小批量人工 A/B 评测。
- ALPHA-033 第二对话 provider adapter：新增 OpenAI Responses adapter，模型 ID 使用中转 `/v1/models` 实际列出的 `gpt-5.6-sol`；放宽 Responses `output_text` block 的扩展字段校验，复用 `CharacterReplyProvider` DTO 和稳定错误分类，支持超时、取消、限流、鉴权、响应 Schema、request ID 与延迟观测。对话路由只有在 `CONVERSATION_PROVIDER=openai` 且服务端存在 `OPENAI_API_KEY` 时才选择该 adapter，默认线上 provider 未切换；同时移除真实 provider 失败后的 deterministic 角色文本，失败只发送错误事件，不提交完整助手消息或关系记忆。实现 Commit：`2a5f9b3`（adapter）、`94f3c91`（no-fallback 与文档）、本次 Schema/模型修正待提交。验证：OpenAI adapter 契约 9/9、真实中转最小探针成功（响应约 2.8 秒），MiniMax 同一探针成功（约 1.5 秒）；`pnpm typecheck`、受影响文件 ESLint 通过。限制：只完成单条真实探针，尚未运行 15 个场景 A/B；成本字段暂为 `null`，官方文档入口在当前环境返回 403。下一步：运行受控小批量双 provider 回放并人工评分，再决定是否切换默认 provider。
- ALPHA-033 Lucía 双 provider 回放：新增 `pnpm conversation:ab` runner，读取固定 `lucia-provider-v1` 场景，以同一角色/关系上下文顺序调用两个 provider，并将结果保存到本地临时目录；D01 主动消息和 F05 故障注入不伪造普通输入，明确记录为 skipped。实现 Commit：`24dcee0`。真实回放结果：13 个普通场景两边均成功；MiniMax 平均约 1.78 秒（p50 1.53 秒，p95 3.52 秒），OpenAI 平均约 3.17 秒（p50 2.48 秒，p95 4.73 秒），OpenAI 在 D03 出现一次 8.68 秒长尾。初步人工观察：OpenAI 在 B01/B02/B03、C02、E06 的追问控制和自然收束更符合目标；MiniMax 更快，但在 A02/A03/B01/B03/E04/F01 多次超出问题预算，F01 还出现中西语混杂。限制：当前仅一轮、每场一次，尚未形成正式人工七维评分；结果文件未提交。下一步：基于这轮差异调整服务端 reply plan 注入和 provider prompt，再重复同一回放集确认改进是否稳定。
- ALPHA-033 问题压力策略：新增结构化 `questionPolicy`，区分实质性问题上限、低压力回问许可和最大问题压力；情绪支持、身份询问、自然收束默认禁止调查式追问，普通问候/直接问答允许低压力回问。两个 provider 统一收到该指导，并明确禁止在用户未直接询问时主动声明 AI 身份。实现 Commit：`04d578c`。验证：reply-plan、上下文、M3/OpenAI adapter、对话流和回放契约测试 43/43，`pnpm typecheck` 与受影响文件 ESLint 通过。下一步：重复 A/B 回放，重点复核 A02/B01/E01/E04/C02。
- ALPHA-033 问题压力策略复核：扩展 `conversation:ab` 支持 `--cases=`，重跑 A02/B01/E01/E04/C02。OpenAI 的 E01 已不再主动插入 AI 身份，E04 保持明确回应喜欢且尊重慢节奏，B01 无调查式追问；M3 的 A02 低压力回问自然，但 B01 仍出现追问，说明 prompt 指导不能单独保证问题门禁。结果保存在本地临时回放文件，未提交；下一步评估服务端结构化回复门禁/重生成策略。
- ALPHA-033 provider 输出硬门禁：`streamReply` 现在根据 `questionPolicy` 拦截情绪支持场景的调查式追问、超出实质性问题上限的回复，以及非身份询问中主动插入 AI 身份声明；低压力 `¿Y tú qué?` 在允许时保留。相关测试覆盖 A02/B01 和情感身份边界，provider 失败只发错误事件，不提交助手消息；门禁拒绝在观测中记录为 `safety-gate`，最多进行一次更严格重生成，第二次仍越界则失败。实现 Commit：`da9477d`、`081c223` 及本次后置提交。重点回放结果：M3 B01 仍生成调查式问题但会被门禁拦截；OpenAI B01、E01、E04 通过门禁，E04 继续是当前正向范例。下一步：按 provider/关系阶段统计门禁率，再决定是否需要调整重生成提示。
- ALPHA-033 门禁后 A/B 回放：`conversation:ab` runner 已改为通过真实 `streamReply` 执行，统计首次生成、safety-gate 重生成和最终状态，而不是绕过服务端门禁直接调用 provider。重点场景回放显示：M3 的 B01 和 E01 两次均未通过门禁而最终无回复；M3 A02/E04、OpenAI B01/E01/E04 通过，OpenAI E04 仍为正向范例。实现 Commit：`4d3ca10`。验证：runner 类型检查、相关测试 45/45、真实重点回放完成；结果文件仅保存在本地临时目录。下一步：运行完整 15 场景门禁后回放并汇总 provider 拦截率。
- ALPHA-033 完整门禁后 A/B 回放：运行完整 15 场景（普通 13 场景各调用两次，D01/F05 特殊场景跳过）。OpenAI 13/13 普通场景最终通过、0 次 safety-gate；M3 8/13 通过，A03/B01/C04/E06/F01 两次均被门禁拦截而无回复，E01 首次拦截后第二次通过。结果文件保存在本地临时目录；该轮支持 Lucía 默认优先 OpenAI，M3 保留为速度对照，不应直接切换默认。下一步：产品本人确认默认 provider，并单独设计 D01 主动消息 provider 输入契约。
- 探索页桌面 Web 调研与视觉方案：完成 Duolingo、Babbel、Busuu、Memrise、ELSA Speak、Tandem、LingQ、Readlang、Readwise Reader、BBC Learning English、Echo-Loop 及当前 `/explore` 的公开结构观察，并用 UI/UX Pro Max 数据库核对编辑网格、字体、动效和可访问性规则；推荐“目标索引 + 内容网格 + 条件详情 rail”，附带一句话意图输入和移动单列适配约束。修改：`docs/superpowers/specs/2026-08-28-explore-page-desktop-web-technical-research.md`、`docs/superpowers/specs/2026-08-28-explore-page-desktop-web-design.md`、`.superpowers/brainstorm/visual-20260828/content/explore-desktop-directions-v1.html` 及 3 张 PNG 预览；本切片未改业务代码，未运行全量代码检查。限制：示意数据不代表已发布内容；实施计划见 [`docs/plans/2026-08-28-explore-page-desktop-web-implementation-plan.md`](docs/plans/2026-08-28-explore-page-desktop-web-implementation-plan.md)。
- ALPHA-033 Explore 切片 A：新增 Explore Dashboard 领域 DTO、Bundle repository、用户状态端口和 `GET /api/v1/explore/dashboard`；发布/进行中/草稿/不可用状态、技能标签、版本、来源版权与显式用户状态已映射，新增 OpenAPI/JSON Schema/错误码/fixture。实现 Commit：`84c7069`、`73089b2`。验证：Explore/domain/route 与 API contract Vitest `10/10`，受影响文件 ESLint、`tsc --noEmit`、`git diff --check` 通过。限制：当前仅有 bundle 内容源和空用户状态 repository，尚未接入数据库断点/保存状态；下一步：切片 B 接入桌面 `/explore` 页面、筛选和条件详情 rail。
- ALPHA-033 Explore 切片 B：`/explore` 改为服务端读取 Dashboard DTO，并新增桌面优先的意图匹配、目标索引、继续探索条、内容网格和条件详情 rail；卡片状态由 DTO 驱动，草稿/不可用内容可查看说明但不生成训练入口；query `q`/`pack` 支持回访，1024px 以下 rail 回落到内容流。修改：`app/(product)/explore/page.tsx`、`app/(product)/explore/explore-page-content.tsx`、`app/globals.css`、`tests/unit/explore-page.test.tsx`、`tests/e2e/explore-page.spec.ts`。实现 Commit：`00c03c1`、`e6c49b5`。验证：Explore Vitest `3/3`，Explore Playwright（desktop Chromium，单 worker）`3/3`，受影响文件 ESLint、`tsc --noEmit`、`git diff --check` 通过。限制：当前 bundle 仍只有草稿内容包，用户断点/保存状态仍由空 repository 提供；下一步：切片 C 补充真实 published/in_progress fixture、深链/键盘/rail 回归并再评估数据库状态端口。
- ALPHA-033 Explore 切片 C：补充页面状态夹具与回归，覆盖 `in_progress` 继续探索条、`unavailable` 阻断说明、query/pack 深链、键盘 Enter 激活、关闭 rail 后焦点恢复，以及 320–1440px 无横向溢出。详情触发按钮保留引用，关闭后将焦点还给原卡片。修改：`app/(product)/explore/explore-page-content.tsx`、`tests/unit/explore-page.test.tsx`、`tests/e2e/explore-page.spec.ts`。实现 Commit：`8398aa6`。验证：Explore/domain Vitest `7/7`，Explore Playwright（desktop Chromium，单 worker）`4/4`，受影响文件 ESLint、`tsc --noEmit`、`git diff --check` 通过。限制：生产 bundle 当前仍只有草稿内容包，`published/in_progress/unavailable` 页面状态通过 DTO 夹具验证；下一步：将 Explore 结果纳入 ALPHA-033 发布候选门禁，并在数据库用户状态端口接入后补真实回访验证。
- ALPHA-033 Explore 发布候选门禁：修正 `tests/e2e/product-shell.spec.ts` 中仍依赖旧静态“开始交流/表达需要”链接和草稿不可点击断言的问题，改为验证 Dashboard 驱动的探索入口、草稿详情按钮与目标筛选。仓库级 `pnpm lint`、`pnpm typecheck`、单 worker 全量 Vitest（105 文件/442 断言）和 `pnpm build` 通过；全量 Playwright 原始运行 97 通过/19 失败，Explore 相关产品壳层回归修正后单独验证 6/6，剩余失败为既有画像/关系记忆/对话移动端和文章移动拖选路径。实现 Commit：`2b2e70a`。下一步：候选阻塞修复归属确认后重跑全量 E2E，再进行人工视觉复核。
- ALPHA-033 发布候选后置回归：修正产品壳层隐私数据 E2E 对新分段 Profile 页面缺失 hash 深链、以及全局 `role=status` 与 Explore 空状态冲突的问题；关系/数据测试现在显式打开 `#profile-relationships` 或 `#profile-data` 并限定组件内状态。实现 Commit：`452a9da`。验证：Profile 隐私桌面 Chromium 4/4；移动端仍有 2/4 状态消息未出现，待移动布局/组件可见性归属确认。其他未提交对话与角色网络改动保持原样。
- ALPHA-033 Explore 功能缺口收敛：探索页接入版本化 `user_content_pack_states`（迁移 `0019_rainy_robin_chapel.sql`），Dashboard/状态 Route 支持真实收藏、进度 upsert、RLS 用户隔离和稳定 key+版本边界；Web 增加收藏/取消收藏、已保存/可开始/整理中筛选、搜索深链同步、同步失败可恢复提示和内容包进度回写，并将 11 个沟通目标完整传递到目标专属训练与独立 checkpoint。页面同步精简为标题、搜索、沟通目标和内容包四级结构，移除重复眉题、说明性副标题、数量统计和底部弱提示；详情仅在打开后占用 rail，搜索/关闭/收藏使用 SVG 且交互目标不小于 44px。Flutter Explore 在认证配置下读取 Dashboard 并通过现有 token client 写入收藏，未配置 API 时保留本地预览。修改：`src/shared/db/schema/content.ts`、`src/modules/explore/`、`src/modules/content/ui/content-pack-experience.tsx`、`src/modules/training/ui/fake-training-loop.tsx`、`app/(product)/explore/`、`app/(product)/learn/`、`app/api/v1/explore/`、`apps/mobile/lib/`、迁移/契约/测试与数据库文档。实现 Commit：`0c9fd17`；Flutter 错误码契约修复 Commit：`a9057bd`。验证：独立暂存快照 `tsc --noEmit`、全量 ESLint、`drizzle-kit check` 通过，Explore/训练/数据库/契约定向 Vitest 8 文件 `42/42`；工作区前序全量 Vitest `118` 文件/`532` 断言与 Explore Playwright `12/12` 通过；Flutter `analyze` 通过，使用 D 盘临时目录运行 `flutter test`，`76/76` 全部通过。迁移 `0019` 已在用户授权后应用到 Supabase。限制：bundle 中内容包仍是 draft，需完成西语母语/教学审核后才会出现生产可开始入口；未接 Web/移动推送。下一步：在真实登录会话验证收藏/进度跨刷新恢复。
- ALPHA-033 训练发音重播：`/learn/practice` 的发音行改为可访问的播放/停止按钮，复用阅读器已选择的西语音色；开始录音、提交文字、切换表达或卸载页面时会停止旧播放并使过期回调失效，浏览器不支持或播放失败时保留可恢复说明。实现 Commit：`5cf17a5`。验证：训练 Vitest `8/8`、桌面/移动 Playwright `2/2`、受影响文件 ESLint 与 `pnpm typecheck` 通过。限制：依赖浏览器 Speech Synthesis 可用音色，仍不代表真实 iOS 音频验收。下一步：在真实浏览器用已保存音色人工确认播放与录音切换。
- ALPHA-033 限制收敛：Vitest 默认改为单 worker，避免全量并行触发 Windows V8/WASM OOM；会话历史 `hydrate`/`replace-hydrate` 对持久化重复消息按稳定客户端键去重，reply-plan 未注入测试时钟时不再受真实日期推进影响。Playwright 默认端口改为 3101、默认单 worker，并复用稳定的 `.next/e2e` 构建目录，避免与 3100 预览服务冲突及反复污染 `tsconfig.json`。实现 Commit：`116c449`。验证：会话/reply-plan Vitest `48/48`、全量 `pnpm test --run` `118/118` 文件与 `533/533` 断言、桌面/移动 Playwright smoke `2/2`、受影响文件 ESLint 和 `pnpm typecheck` 通过。限制：尚未重跑全量 Playwright；下一步在无残留开发进程时执行发布候选 E2E。
- ALPHA-033 异步状态反馈：对话头部和联系人列表仅在真实流式回复期间显示 `Typing` 三点动效，结束、切换状态或卸载时清理；普通状态恢复角色标签。Typing 视觉对辅助技术隐藏，继续由既有中文“正在回复”状态作为唯一完整播报，并在 `prefers-reduced-motion` 下停止动效；通用 `SurfaceState` 的加载标记改为三点反馈，空态和错误态保持原图标。实现 Commit：`66b61b8`。验证：Typing/联系人/SurfaceState Vitest `12/12`、受影响文件 ESLint 与 `pnpm typecheck` 通过；对话 Playwright `22/24`，仅 2 条消息宽度断言被未纳入本提交的气泡视觉实验影响。限制：Typing 事件只反映当前页面内的活跃生成，不是跨设备在线状态。下一步：在不加载气泡实验的干净快照重跑对话 E2E。
- ALPHA-033 原创消息气泡：角色消息固定使用浅色青蛙气泡，用户可在资料页选择深色狗狗或浅色青蛙样式；偏好通过 `useSyncExternalStore` 保存在当前设备并支持同标签页、跨标签页同步。气泡恢复内容驱动宽度，短消息不再被撑满；装饰图片具有空替代文本、稳定尺寸、可读后备底色和显式首屏加载策略。仅提交狗狗、青蛙、爱心 3 个运行时素材，授权人已确认其为原创且允许商业及闭源项目永久使用、修改和分发，无需署名、无其他贡献者权利；授权记录见 `docs/references/chat-bubble-assets.md`。实现 Commit：`c8a6d19`。验证：相关 Vitest `18/18`、全量 Vitest `119/119` 文件与 `533/533` 断言、对话 Playwright 桌面/移动 `26/26`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 通过；真实渲染检查覆盖 1280px、390px、亮色和暗色主题，Next Image LCP 警告已消失。全量 Playwright `110/126` 通过，16 条失败均位于本切片之外：旧 `product-shell` 的探索/联系人/介绍入口断言、阅读保存位置抖动、移动端句子选择、阅读辅助焦点恢复和移动端账号数据删除状态。限制：偏好尚未服务端同步，Flutter 对话页未同步该视觉；独立预览源码和设计提取中间文件只保留在本机 `design/`，不进入产品路由或提交。下一步：先按模块收敛上述全量 Playwright 阻塞，再由产品本人进行气泡视觉验收和发布候选人工检查。
- ALPHA-033 深色狗狗气泡视觉回归修复：恢复原稿的 compact、third、long 三种透明狗狗帧，按消息长度选择对应素材并固定原始宽高比，不再把同一长帧任意挤压或拉伸；移除填满透明区域的棕色矩形后备层，移动端仅等比缩放，并让小型本地 PNG 直接加载以避免优化转换期间短暂只显示白字。实现 Commit：`5523515`。验证：修复测试先复现单长帧复用；相关 Vitest `19/19`、全量 Vitest `119/119` 文件与 `534/534` 断言、对话 Playwright 桌面/移动 `26/26`、新增气泡回归 `2/2`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 全部通过；另以 1280px 与 390px 真实截图确认三档轮廓、内部比例和透明边缘。限制：本轮未重跑已知存在 16 条无关失败的全量 Playwright；气泡偏好仍未服务端同步，Flutter 尚未接入该视觉。下一步：由产品本人复核恢复后的狗狗气泡，再继续收敛既有全量 Playwright 阻塞。
- 下一项：阶段 8 个人 Alpha 连续使用与人工体验复核，仅在本任务退出条件满足并经产品本人确认后启动。

- ALPHA-033 D01 主动消息 Slice B（App 内第一阶段）：新增 Lucía 主动消息资格领域规则（关系 active、暂停、每日/每周上限、12 小时冷却、未回应抑制）、provider-neutral 主动上下文和文本硬门禁；新增 `proactive_message_candidates` 表、`messages.source_type`、原子候选/消息持久化 repository，以及 `POST /api/v1/conversations/lucia/proactive` 手动触发入口。当前只生成并写入 App 内会话历史，不接 Web Push/APNs/FCM；provider 失败或门禁失败不发送、不 fallback；客户端不能自行触发关系里程碑来源。报备型日常分享是默认形式，`familiar` 以上且 `waking` 状态允许单句 `Te echo de menos.`，并通过 provider 输入和硬门禁固定该边界。实现 Commit：`8d22014`、`e76df98`；验证：主动消息领域/application Vitest 4/4、PGlite 持久化 1/1、provider 相关回归通过，`pnpm typecheck`、`pnpm db:check` 和受影响文件 ESLint 通过。下一步：在聊天 UI 增加主动消息到达后的轻量刷新/未读呈现，并进行 Lucía 连续人工体验。
- ALPHA-033 D01 聊天 UI Slice C（App 内轻量同步）：聊天页在首次历史加载后，于窗口重新获得焦点、页面从后台恢复可见和 45 秒低频轮询时刷新历史；复用历史请求去重，刷新通过 hydrate 保留乐观发送和进行中的流式回复，并以最近服务器快照清理已删除的旧消息。仅当新增完整消息同时满足角色消息且 `sourceType=proactive` 时，在用户上滑阅读期间显示“有一条新消息”轻量提示；回到底部或点击提示后清除，不强制打断阅读，也不把普通回复误报为主动消息。实现 Commit：`2dad344`、`a18bd65`、`79fa976`、`a562b40`；修改 `src/modules/conversation/ui/chat-thread.tsx`、`app/globals.css`、`tests/unit/conversation-thread.test.tsx`；验证：对话线程 Vitest 9/9（含历史校准、乐观消息竞态和流式消息去重）、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`git diff --check` 通过。限制：仍为 App 内历史同步，不接 Web Push/APNs/FCM；轮询仅在聊天页挂载且页面可见时运行。下一步：进行 Lucía 主动消息连续人工体验，并根据真实到达节奏调整提示文案/位置。
- ALPHA-033 D01 开发测试时钟：主动消息接口新增仅非生产环境接受的 `testNow`，限制在未来 8 天内，用于在不修改正式频率规则、不删除真实历史的情况下推进资格计算并验证真实消息写入与聊天刷新；生产环境拒绝该字段。实现 Commit：`bb18e80`；修改 `app/api/v1/conversations/lucia/proactive/route.ts`；验证：受影响文件 ESLint、`pnpm typecheck`、`git diff --check` 通过。限制：测试时钟仍会写入当前开发数据库一条真实会话消息，只能在本地/开发环境使用；不接推送服务。下一步：使用 `testNow` 生成一条测试主动消息并完成浏览器端刷新验证。
- ALPHA-033 D01 主动消息语气校准：服务端主动消息硬门禁拒绝 `dejarte una sonrisa pequeña` 与独立使用的 `Solo quería saludarte`，OpenAI/MiniMax provider 共享提示改为优先使用 `sacarte una sonrisa`、`alegrarte un poquito el día` 等惯用表达；同步更新 Lucía 语气设计示例。实现 Commit：`f746cb3`、`b7562e0`；验证：主动消息与聊天线程 Vitest 14/14、受影响文件 ESLint、`pnpm typecheck`、`git diff --check` 通过。限制：仍需通过同一回放集和连续人工体验观察拒绝后的重生成质量。
- ALPHA-033 好友栏 P0 交互：联系人 rail 新增桌面右键/操作按钮与移动长按等价菜单，支持置顶/取消置顶、标记已读/未读、静音/开启通知和打开好友对话；Lucía 保留默认置顶但可取消，未读和静音仅为当前页面状态，不改变学习画像、关系记忆或角色事实。实现 Commit：`ff15273`；修改 `src/modules/conversation/ui/conversation-contact-rail.tsx`、`app/globals.css`、`tests/unit/conversation-contact-rail.test.tsx`。验证：好友栏 Vitest 4/4、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`git diff --check` 通过；对话/产品壳层 Playwright 运行受现有数据库不可用与消息流失败路径影响（19/26 通过），未新增服务端偏好同步。限制：置顶/静音/未读尚未跨刷新或跨客户端持久化；自由拖动排序留待后续 P1。下一步：新增用户级 conversation preferences API/迁移，再实现“管理好友顺序”拖放模式。
- ALPHA-033 好友栏偏好同步：新增 `conversation_preferences` 表、用户所有权 RLS、会话列表 `isPinned/isMuted` 字段与 `PATCH /api/v1/conversations/preferences`；好友栏在置顶/静音操作时乐观更新并回写服务端，列表刷新后恢复用户偏好。实现 Commit：`0227eab`；迁移 `drizzle/0017_sudden_betty_brant.sql` 已通过 `pnpm db:migrate` 应用。验证：对话好友栏/列表/偏好路由/Schema Vitest 11/11、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`pnpm db:check`、`git diff --check` 通过。限制：未读标记仍为当前页面状态；自由拖动排序和 `sort_rank` 留待 P1。下一步：实现“管理好友顺序”拖放及键盘上移/下移，并补跨刷新未读语义。
- 偏好失败与所有权修复：偏好更新失败时回滚乐观状态并显示可恢复提示；服务端更新偏好前确认该角色属于当前用户已有会话。实现 Commit：`a8076de`；验证：好友栏/偏好路由 Vitest 6/6、受影响文件 ESLint、`pnpm exec tsc --noEmit` 通过。
- ALPHA-033 好友栏 P1 排序：新增 `sort_rank` 字段和批量顺序保存，好友栏增加“管理好友顺序”模式，支持桌面拖放、键盘上移/下移和移动端同一排序模式；排序限制在置顶/未置顶分组内，不改变置顶语义。实现 Commit：`eb0e956`；迁移 `drizzle/0018_dusty_sue_storm.sql` 已通过 `pnpm db:migrate` 应用。验证：好友栏/偏好路由/Schema Vitest 11/11、`pnpm db:check`、`pnpm exec tsc --noEmit`、受影响文件 ESLint、`git diff --check` 通过。限制：未读标记仍未持久化；尚未补充 Playwright 的拖放和真实触摸长按回归。下一步：补跨刷新未读语义和桌面/移动排序 E2E。
- ALPHA-033 好友栏交互修正：移除好友行右侧三个点，普通状态保持干净；排序模式改为整行直接拖动，继续提供键盘上移/下移；右键菜单增加基于实际菜单尺寸的视口边界校正，避免滚动容器中定位偏移。实现 Commit：`d89faf2`；验证：好友栏 Vitest 5/5、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`git diff --check` 通过。限制：尚未补充浏览器端真实拖动和触摸长按回归。
- 好友栏直接拖动微调：好友行现在无需进入管理模式即可按住拖动，管理模式仍提供键盘上移/下移替代；移除右侧操作按钮后保持列表视觉简洁。实现 Commit：`7a39188`；验证：好友栏 Vitest 5/5、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`git diff --check` 通过。
- 好友栏拖动与菜单定位修复：改用 Pointer Events 处理整行鼠标拖动，避免链接元素拦截原生 draggable；右键/长按菜单改为联系人 rail 内部坐标，并依据实际尺寸和滚动位置校正边界。实现 Commit：`357dc65`；验证：好友栏 Vitest 5/5、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`git diff --check` 通过。限制：浏览器端真实拖动/触摸长按仍需补充 E2E。
- 好友栏交互可用性修复：拖动落点改用 ref 读取并补 Pointer Event 回归，整行拖动禁用链接原生拖拽；移除管理模式点状手柄，菜单置顶/静音/未读及顺序操作显示明确成功或边界反馈。实现 Commit：`07b5fea`；验证：联系人栏 Vitest 6/6、受影响文件 ESLint、`pnpm exec tsc --noEmit`、`git diff --check` 通过；仓库级 `pnpm lint` 通过。全量 `pnpm test --run` 首次因 Windows worker WebAssembly/ArrayBuffer 内存不足失败，单 worker 复跑未能在资源受限环境完成；不影响联系人栏局部回归。
- 好友菜单点击事件修复：将外部关闭监听从 `pointerdown` 改为排除菜单内部目标的 `click`，确保置顶、静音、未读和管理顺序按钮先执行自身动作；真实浏览器验证置顶/静音状态和整行拖动排序均生效。实现 Commit：`42e4b3d`；验证：联系人栏 Vitest 6/6、受影响文件 ESLint、`pnpm exec tsc --noEmit` 通过。限制：尚未补充 Playwright 自动化菜单点击/拖动用例。
- ALPHA-033 对话连续性上下文第一阶段：完整消息档案继续作为权威事实；普通聊天读取较宽历史窗口并在服务端按字符预算裁剪近期消息；新增确定性的已回答/开放话题投影和 provider-neutral 上下文字段；普通 Lucía 聊天现在注入真实关系阶段与西语关系摘要；不同 provider 共享滚动摘要/话题字段和“避免机械重复”表达约束。设计文档：`docs/superpowers/specs/2026-08-29-conversation-context-continuity-design.md`。实现 Commit：`0dae4d2`（设计 Commit：`774e19a`）。验证：对话相关 Vitest `50/50`，单 worker 全量 Vitest `115/115`、`487/487`，`pnpm exec tsc --noEmit`、受影响文件 ESLint、`git diff --check` 通过。限制：滚动摘要尚未持久化，开放话题暂由历史窗口确定性计算，尚未接入选择性检索或 Flutter 端；下一步为连续人工体验和重复话题回放，再决定摘要持久化切片。
- ALPHA-033 对话同日连续性修复：上下文消息保留 `sentAt`，默认按 `Europe/Madrid` 计算 `currentLocalDate`/`sameLocalDay`；同日已回答话题带入 provider，生成结果与上一次答案高度重复时服务端最多重生成一次，并补充同日午饭问题回归。实现 Commit：`2c3e2ad`。验证：对话相关 Vitest `52/52`；受影响文件 ESLint、`git diff --check` 通过。全量 TypeScript 仍被其他代理未提交的 `conversation-contact-rail.tsx` 偏好对象类型错误阻断。限制：时间连续性目前只覆盖消息时间和确定性重复检测，滚动摘要仍未持久化；下一步进行真实 provider 回放和人工验证。
- ALPHA-033 Lucía 角色自述连续性修复：从已完成角色消息中提取短期 `characterClaims`（先覆盖饮食、饮品和精力状态），带入 provider；同日具体日常事实发生无解释冲突时，服务端最多要求一次自然说明变化的重生成，避免“之前说土豆泥、现在直接变成米饭”。实现 Commit：`caf66ad`。验证：对话/上下文/provider 相关 Vitest `54/54`，受影响文件 ESLint、`git diff --check` 通过。限制：角色自述目前为有限关键词投影，尚未持久化为独立状态表，也不覆盖所有语义矛盾；下一步用真实回放集扩展自述与关系连续性案例。
- ALPHA-033 角色自述变化说明收紧：同日具体日常事实发生变化时，单独的“Al final…”不再视为足够解释，必须出现“之前说过/改变主意/原本想”等明确连接后才允许通过门禁。实现 Commit：`61cc1c9`。验证：对话/上下文/provider 相关 Vitest `54/54`，受影响文件 ESLint、`git diff --check` 通过。
- ALPHA-033 可重复日常自述：`characterClaims` 增加 `claimKind` 与 `repeatableOnLaterDays`，明确饮食/饮品等日常观察跨本地日可自然重复；同日冲突仍需解释，新增跨日重复回放。实现 Commit：`6e97921`。验证：对话/上下文/provider 相关 Vitest `53/53`，受影响文件 ESLint、`git diff --check` 通过。全量 TypeScript 仍被其他代理未提交的好友栏类型错误阻断。限制：计划/精力自述目前仅为有限关键词投影，尚未持久化独立状态表。
- ALPHA-033 计划与承诺连续性：新增 provider-neutral `openCommitments` 投影，提取用户和 Lucía 明确的短期计划/承诺并标注拥有者、时间提示与未完成状态；provider 被要求低压力使用，不得每轮追问，计划可跨日自然变化。实现 Commit：`240da99`。验证：对话/上下文/provider 相关 Vitest `54/54`，受影响文件 ESLint、`git diff --check` 通过。全量 TypeScript 仍被其他代理未提交的好友栏类型错误阻断。限制：承诺尚未独立持久化，完成/取消判定和更丰富语义留待后续切片。
- ALPHA-033 普通日常计划承接：`openCommitments` 现在也识别“今天下午去港口拍照”这类用户计划；用户说“已经回来了/结束了”时，provider 会优先关联具体计划，而不是只给泛化回问。实现 Commit：`521045a`。验证：对话/上下文/provider 相关 Vitest `55/55`，受影响文件 ESLint、`git diff --check` 通过。全量 TypeScript 仍被其他代理未提交的好友栏类型错误阻断。限制：当前仍为关键词投影，计划完成/取消和更广泛的语义关联留待后续切片。
- ALPHA-033 计划生命周期时间线修复：普通用户计划新增 `open`/`returned` 状态；当前消息出现“Ya he vuelto./Ya terminé.” 等明确返回信号时，仅推进最近一条普通用户计划。计划按消息时间/序号保持独立实例，避免旧计划与同句新计划合并。`returned` 计划注入 provider 后禁止活动前的祝愿语，安全门禁会拦截“Espero que ... te haya sentado bien”一类错误时态，并最多重生成一次；确定性 fake 同样会从活动结束视角承接。实现 Commit：`436b041`、`b506b17`。验证：对话/上下文 Vitest `41/41`，provider 契约 Vitest `17/17`，受影响文件 ESLint 通过；`pnpm exec tsc --noEmit` 仍被其他代理未提交的 `conversation-contact-rail.tsx` 偏好对象类型错误阻断。限制：当前仍是关键词识别，只推进最近普通计划，不含取消/延期的独立状态快照。下一步：真实 provider 回放“旧港口计划 → 已回来 → 新港口计划”，确认历史实例不会串线。
- ALPHA-033 地点经历与私聊语气门禁：地点经历问题不再允许 provider 用“como personaje de IA...”打断语境；在不虚构现实行动的前提下，优先自然回答“我没去过那里”并延伸一个具体兴趣点。补充私聊标点约束，避免简单回复使用冒号引导说明或书面化分号；安全门禁新增该类主动身份声明回归。实现 Commit：`0e255a3`。验证：对话/上下文/provider Vitest `59/59`，受影响文件 ESLint 与 `pnpm exec tsc --noEmit` 通过。限制：地点经历仍依赖关键词和 provider 表达，复杂地点语义留待回放集扩展。下一步：人工验证“你去过港口吗？”、“你也要再去一次吗？”两条分支的自然度。
- ALPHA-033 计划结果与剧情地点表达：计划生命周期扩展为 `open`、`returned`、`completed`、`cancelled`、`deferred`、`unconfirmed`；明确结果只推进最近未完成计划，时间经过只能标记 `unconfirmed`，不推断事情已发生。provider 收到各状态语义并禁止把 `unconfirmed` 当成完成；地点问题允许使用已建立的剧情经历或“听说过”的间接信息，不再强制用 AI 身份解释，同时保留现实资源/线下安排的未验证边界。实现 Commit：`a22b8d0`。验证：对话/上下文/provider Vitest `63/63`，受影响文件 ESLint 与 `pnpm exec tsc --noEmit` 通过。限制：状态识别仍是关键词投影，计划快照尚未独立持久化；剧情地点经历尚未补充到 Lucía 的完整人物事实库。下一步：人工回放无汇报计划和地点经历分支，确认不会增加追问压力或产生互相矛盾的经历。
- ALPHA-033 纯问候语气门禁：纯问候开场不再允许 provider 无依据地添加“Espero que estés teniendo una noche tranquila”或“Ojalá...”一类祝愿；先回应问候，再轻量延续或自然收束。补充西语私聊问候回归，并保持情绪表达场景不受影响。实现 Commit：`3b935c2`。验证：对话/provider Vitest `45/45`、受影响代码 ESLint 与 `pnpm typecheck` 通过。限制：问候识别覆盖常见短句，复杂混合问候仍交由 provider 判断。下一步：人工验证不同关系阶段下的晚间问候热情度。
- 好友拖动边界反馈：跨置顶/普通分组拖动时显示明确提示，避免因保护置顶语义而看似无响应；好友行默认显示可拖动光标。实现 Commit：`e22a60a`；验证：联系人栏 Vitest 6/6、受影响文件 ESLint 通过。当前仓库类型检查仍被其他代理对话 provider 改动中的既有错误阻断。
- 好友排序入口收敛：移除“管理好友顺序”按钮、管理模式、上下箭头和菜单入口；整行拖动成为唯一排序方式，跨置顶/普通分组时自动同步拖动好友的置顶状态，确保位置变化可见。实现 Commit：`cd7169f`；验证：联系人栏 Vitest 6/6、真实浏览器跨分组拖动后顺序改变、受影响文件 ESLint 通过。限制：全量类型检查仍受其他代理对话 provider 未提交改动中的既有错误阻断。
- 好友切换回归修复：拖动后的点击抑制标记改为按好友 key 隔离，避免拖动一行后误拦截其他好友的聊天切换；真实浏览器验证拖动后点击 Inés 可进入 `/chat/ines`。实现 Commit：`c778fc2`；验证：联系人栏 Vitest 6/6、受影响文件 ESLint 通过。限制：全量类型检查仍受其他代理未提交的对话 provider 改动阻断。
- 好友普通点击兼容修复：仅在鼠标移动超过拖动阈值后调用 Pointer Capture，普通 `pointerdown` 不再抢占链接目标；真实浏览器验证直接点击 Inés 可进入 `/chat/ines`。实现 Commit：`5c01c41`；验证：联系人栏 Vitest 6/6、受影响文件 ESLint、`git diff --check` 通过。限制：全量类型检查仍受其他代理未提交的对话 provider 改动阻断。
- 好友顺序缓存一致性修复：顺序/置顶保存成功后同步更新联系人列表缓存，避免切换聊天或组件重新挂载时旧缓存覆盖已保存顺序；新增卸载后重新渲染回归断言。实现 Commit：`c4896ed`；验证：联系人栏 Vitest 6/6、仓库级 `pnpm lint`、`pnpm exec tsc --noEmit`、`git diff --check` 通过。
- 好友消息操作菜单：好友消息支持右键与双击打开独立菜单，仅提供复制、翻译、引用回复；翻译改用独立的纯翻译 provider/API，只返回中文译文并在气泡下展开；翻译完成后菜单项变为“取消翻译”，点击立即收起译文并关闭选项栏；自己的消息菜单保持复制、引用、转发、撤回、删除。自己的消息菜单现按气泡边缘对齐并通过 portal 挂载到 document.body，避免右键落点造成偏移或被聊天布局裁切；补充 portal 后主题变量回退并固定不透明菜单背景，避免菜单显示为空白或透出底层消息。实现 Commit：`a08ee0a`、`5d9e40a`、`d697765`、`d1be3cc`、`2fde075`、`2c23de9`、`acbb18f`、`5cc51d6`、`eff1493`、`843d8b6`；修改 `src/modules/conversation/ui/chat-thread.tsx`、`src/modules/providers/translation/`、`app/api/v1/conversations/translation/route.ts`、`app/globals.css`、对话单测与 Playwright 回归。验证：对话线程 Vitest 单 worker 13/13、受影响文件 ESLint、`tsc --noEmit`、`git diff --check` 通过；新增 Playwright 用例已更新但本轮因本机多 WebServer 进程未在超时内完成。限制：翻译依赖服务端 MiniMax provider 与登录会话，未配置 provider 时显示可重试错误；未同步 Flutter 消息操作 UI。下一步：发布候选门禁稳定后补 Flutter 对话操作和跨端一致性回归。
- 聊天输入框语言标记：为 `VoiceComposer` 的文本输入框增加 `lang="es"`，让浏览器拼写检查使用西班牙语词典，避免中文词典误标西语单词。实现 Commit：`efd3eaf`；验证：VoiceComposer Vitest 2/2、受影响文件 ESLint、`tsc --noEmit` 通过。限制：最终是否显示波浪线仍取决于用户浏览器是否安装西语词典。
- 验证码登录回跳修复：OTP 验证成功后在站内跳转同时调用 `router.refresh()`，使 Next.js 服务端组件和认证门禁重新读取刚写入的 Supabase 会话，避免从匿名 `/login?next=...` 进入产品页时复用未登录缓存再次跳回登录。实现 Commit：`c5fa2bf`；验证：认证相关 Vitest 20/20、`pnpm lint`、`pnpm typecheck`、`git diff --check` 通过。限制：当前网络对 Supabase Auth 的 HTTPS 请求仍返回 `ECONNRESET`，服务端无法访问认证服务时需先恢复网络。
- 认证服务暂时不可达的回跳循环修复：Proxy 标记 Auth 检查失败时，产品布局显示可恢复的“暂时无法验证登录”状态并保留目标路径；真正匿名请求仍重定向到 `/login`。实现 Commit：`e63123f`；验证：认证与布局相关 Vitest 21/21、`pnpm lint`、`pnpm typecheck`、`git diff --check` 通过。
- 匿名/故障边界修正：只有检测到 Supabase 会话 Cookie 时才显示认证故障状态，避免认证服务不可达时匿名用户停在产品页。实现 Commit：`bc15bd6`；验证：认证与布局相关 Vitest 22/22、`pnpm lint`、`pnpm typecheck`、`git diff --check` 通过；针对性 Playwright 因已有 3100 端口开发服务器占用未执行。
- 失效会话不再伪装成认证服务故障：Proxy 将 401/无效 JWT 按匿名会话重定向到登录，仅网络/超时/5xx 保留可重试恢复页；抽出共享错误分类并新增 Proxy 回归测试。实现 Commit：`de1e260`；验证：认证/布局/Proxy Vitest 11/11、受影响文件 ESLint、`pnpm typecheck` 通过。限制：真实 Supabase 网络故障仍需检查开发服务器外网访问与运行时日志。
- 认证恢复页补充本地会话清理：临时故障持续或旧 Cookie 无法验证时，可在不请求 Auth 服务的情况下清除当前浏览器会话并回到 OTP 登录；恢复操作使用 Supabase `scope: local`，不撤销其他设备会话。实现 Commit：`de1e260`；验证：认证/布局/Proxy Vitest 11/11、受影响文件 ESLint、`pnpm typecheck` 通过。限制：网络故障期间重新获取 OTP 仍需 Auth 服务恢复。
- ALPHA-033 电脑端 Web 发布候选门禁修复：将项目直接依赖的 Sharp 从 `0.34.3` 对齐到 Next.js 16.3.1 要求的 `0.35.3`，消除 Windows 开发服务器同时加载两套原生 DLL 后崩溃的问题；好友申请 E2E 按已确认的“列表默认空、先审批 Lucía、审批后创建联系人”规则更新，并让审批成功后的联系人栏立即重新读取服务端会话，不需要刷新页面。实现 Commit：`1c4764f`；修改 `package.json`、`pnpm-lock.yaml`、`src/modules/character-network/ui/introduction-inbox.tsx`、`src/modules/conversation/ui/conversation-contact-rail.tsx` 和 `tests/e2e/product-shell.spec.ts`。验证：回归测试先复现审批后联系人不刷新的失败；联系人/隐私定向 Vitest `14/14`、产品壳层桌面 Playwright `21/21`、全量 Vitest `153/153` 文件与 `652/652` 断言、全量桌面 Chromium Playwright `71/71`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 全部通过。限制：Playwright 使用 `AUTH_E2E_ENABLED`、空数据库连接和禁用收费 Provider 的确定性环境，未替代真实登录、远端数据库或收费 Provider 验证；公共场景与正式表达仍待双重人工审核；iPhone Safari/PWA 真机与 Flutter 按当前优先级未执行。下一步：使用真实登录账号完成 Explore 收藏/进度跨刷新与电脑端核心路径人工复核，并推进正式内容审核。
- ALPHA-033 真实账号复核与 Explore 收藏一致性修复：真实 Supabase OTP 登录、远端 PostgreSQL 和桌面 Chrome 复核发现旧 `explore-saved-packs:v1` 会在 hydration 阶段覆盖服务端收藏事实，造成 React 状态与服务端 HTML 不一致；首次渲染现只使用服务端 DTO，本地存储只保留账号同步失败的 `v2` 待同步覆盖，成功同步后清除，旧缓存自动废弃。实现 Commit：`3ca682f`；修改 `app/(product)/explore/explore-page-content.tsx`、`tests/unit/explore-page.test.tsx`、`tests/e2e/explore-page.spec.ts`。真实账号验证：Explore 三种建议入口可见；内容包收藏跨两次刷新保持并恢复验证前状态；Lucía `active` 状态与联系人栏一致；`/learn`、`/read`、`/chat`、`/me` 均正常渲染；未发送消息、未审批好友、未删除数据。验证：Explore Vitest `19/19`、全量 Vitest `153/153` 文件与 `655/655` 断言、`pnpm lint`、`pnpm typecheck`、`pnpm build`、定向桌面 Playwright `1/1` 通过；首次桌面全量 Playwright 的既有关系记忆删除提示出现一次偶发超时，隔离重跑 `1/1`，随后全量复跑 `72/72` 通过。限制：真实复核未调用收费对话、转写或评分 Provider；`/api/v1/providers/status` 在当前本地配置返回 503，是本轮唯一控制台资源错误；正式内容仍为 draft 并待西语母语与中文教学双重审核；iPhone Safari/PWA 真机与 Flutter 未执行。下一步：推进正式内容双重人工审核，满足 ALPHA-033 最后一项发布门禁后再由产品本人确认是否进入阶段 8。
- ALPHA-033 正式内容审核准备：新增 `docs/reviews/ALPHA-033-content-review-pack.md`，为 `alpha.core@1` 与 `alpha.scenario-practice@1` 的 26 条表达和 3 个基础场景提供逐项西语母语/中文教学 `approve`、`revise`、`reject` 结论栏、审核者引用与签字模板；记录正文、中文、变体、语域/地区、语法、发音、语用、场景角色/开场/条件变化/任务及安全边界，并将拼写、自然度、性别适配和教学提示风险明确标为“AI 预审”。实现 Commit：`214aadb`。验证：两个 bundle 的 `pnpm content:validate` 均通过；审核包源覆盖检查确认 26 条表达及 3 个场景的稳定 ID、版本、正文/变体、开场、条件变化和任务引用均匹配；`git diff --check` 通过。限制：未取得任何真人审核结论，未修改 bundle 状态或 review 记录，未导入或发布内容；`alpha.core@1` 的文章不在本次审核范围；iPhone Safari/PWA 真机仍因网站仅本地运行而延期。下一步：将审核包交给西语母语者和中文教学审核者，收到可追踪反馈后按版本化规则修订并依次推进 `language-reviewed`、`pedagogy-reviewed` 和 `published`，重新校验并事务导入后才能关闭 ALPHA-033。
- ALPHA-033 所有者授权 AI 审核设计：产品所有者确认产品仅供本人使用的阶段不再等待外部审核者，正式内容由 Codex 独立完成西语语言与中文教学两个审核维度；新增 `docs/superpowers/specs/2026-09-12-owner-authorized-ai-content-review-design.md`，选择复用既有状态机并以 `codex-ai-owner-authorized-review` 诚实记录 AI 身份和所有者授权，禁止描述为真人签字；未来开始面向其他用户前必须新增 ADR 重新决定外部复核门槛。设计 Commit：`c889fbb`。本次实施范围仍限定为 26 条表达和 3 个基础场景，文章、词典、角色和私人生成内容不混入。验证：规格已完成占位符、内部一致性、范围和歧义自检，`git diff --check` 通过。限制：书面规格仍待产品所有者确认，尚未更新治理 ADR/规则、修改内容、写入正式审核记录或发布。下一步：确认书面规格后制定实施计划并执行正式 AI 审核。
- ALPHA-033 所有者授权 AI 审核修正版与实施计划：真实代码盘点确认内容状态为 `draft/review/approved/published/archived`，审核维度由 `content_reviews.locale` 表达；产品所有者确认修正版，将生产支撑所需的 9 个领域、20 个目标和 1 个内容包纳入审核，同时继续排除旧场景、文章、词典与角色。设计修正 Commit：`8d77999`；实施计划 Commit：`95ab5de`。计划采用失败测试、双 locale 发布校验、不可变内容下的状态单向推进、v2 bundle、正式 AI 审核报告、运行时切换、事务导入和完整发布门禁。限制：尚未开始生产代码和内容修改，当前内容仍不可发布。下一步：执行计划切片 1，用失败测试锁定审核与状态推进规则。
- ALPHA-033 AI 审核门禁与状态推进基础设施：已发布 expression/scenario 现在必须同时具有 `es-ES` 与 `zh-CN` approved review；已发布表达必须引用已发布目标/领域且所有变体已发布，已发布场景必须引用已发布目标和表达。内容导入器在其他字段及子项完全一致时允许 domain、goal、expression/variant、scenario、content pack 状态单向推进，禁止降级、归档后恢复和借状态推进改写不可变内容；状态更新与 bundle claim 保持同一事务并覆盖回滚测试。实现 Commit：`05d439b`。验证：审核门禁/共享契约 Vitest `9/9`、数据库导入 Vitest `9/9`、`pnpm typecheck`、受影响文件 ESLint、全部现有 bundle 的 `content:validate`、`git diff --check` 通过。共享 fixture 的 Flutter 合同测试在加载阶段超过 90 秒且未开始断言，已终止；未修改 Dart 代码。限制：v2 正式内容和治理文档尚未完成，现有 v1 仍为草稿。下一步：同步 ADR/治理规则，再完成正式 AI 内容审核与 v2 bundle。
- ALPHA-033 个人阶段内容治理同步：新增 ADR-0007，明确项目所有者 2026-09-12 授权 Codex 在仅本人使用阶段独立完成 `es-ES` 语言与 `zh-CN` 教学审核；同步 `AGENTS.md`、内容规范、架构、Web 优先设计、内容 README 和实施计划，保留生成与审核分离、版本/版权/隐私/评分不变量，并要求产品面向其他真实用户前新增 ADR 重审外部复核门槛。实现 Commit：`b9c36ff`。验证：当前权威文档中的真人审核阻塞已替换为诚实的 AI 审核身份与双维度规则，`git diff --check` 通过。限制：历史交接中的旧要求保留当时事实；v2 内容尚未生成或发布。下一步：完成 26 条表达、3 个场景及支撑元数据的正式审核报告和版本化内容。
- ALPHA-033 所有者授权正式内容与运行时切换：完成 26 条表达、3 个基础场景、9 个领域、20 个目标和 1 个内容包的逐项 AI 审核与报告；新增 `alpha.core@2`、`alpha.scenario-practice@2`，修订内容使用新实体版本，未修改实体通过事务规则单向推进状态，正式表达/场景均带 `es-ES` 与 `zh-CN` approved review；Explore、训练、内容包和场景目录切到 v2，文章继续读取 v1。新断点写 v2、旧 v1 断点仍可恢复；旧版本收藏以原版本显示，不静默改绑。实现 Commit：`a5286b0`。验证：全部 5 个 bundle 校验通过；相关单元 `9 files / 42 tests`、内容导入数据库 `10/10`、目标桌面 Playwright `16/16`、产品壳层发布断言 `1/1`、`pnpm lint`、`pnpm typecheck`、`git diff --check` 通过。一次参数转发错误启动的全量 Playwright 在修正旧发布状态断言前被终止，期间另见既有移动文章句子拖选偶发失败，未计为全量通过。限制：RAE 页面受 Cloudflare 验证阻挡且 Google 搜索超时，未声称完成外部权威网页核验；v2 尚未导入远端数据库，完整 Vitest/Playwright/build 与真实登录桌面复核仍待执行；iPhone Safari/PWA 真机和 Flutter 未执行。下一步：只读确认目标数据库与 v1 引用后事务导入两个 v2 bundle，再重跑完整发布候选门禁。

- ALPHA-033 v2 数据库发布与自动门禁：目标为 `DIRECT_DATABASE_URL` 指向的 Supabase PostgreSQL；只读盘点确认历史草稿保留，正式收藏、学习断点和证据引用均为 0。`pnpm db:migrate` 成功应用 `0020_volatile_eternity.sql`，迁移登记从 20 条增至 21 条；`alpha-core-v2.json` 与 `scenario-practice-alpha-v2.json` 首次事务导入成功，重复导入均返回 `unchanged`。导入后只读核验得到 9 个 published domain、20 个 published goal、26 个 published expression、3 个 published scenario 和 1 个 published content pack；表达双 locale approved review 各 26 条、场景双 locale 各 3 条，支撑元数据审核记录完整。自动门禁：全量 Vitest `155 files / 671 tests`、电脑端 Chromium Playwright `72/72`、目标发布路径 `16/16`、产品壳层发布断言 `1/1`、`pnpm lint`、`pnpm typecheck`、`pnpm db:check`、`pnpm build` 和 `git diff --check` 通过。全量 Playwright 为 `138/144`，6 个失败全部位于延期的 `mobile-chromium`（文章句子拖选 1、Lucía 移动联系人/介绍 4、移动账号删除完成态 1），不作为本轮电脑端门禁通过。内容与运行时 Commit：`a5286b0`；发布记录 Commit：`8610666`。限制：桌面自动化运行时因本机工具资产路径缺失且浏览器控制接口不支持当前 Codex `apikey` 认证，无法读取用户现有 Edge 登录会话；未调用收费 Provider、未发送消息、未删除数据。下一步：完成真实登录桌面浏览器的 v2 只读复核后关闭 ALPHA-033，并由产品本人确认是否启动阶段 8。
- ALPHA-033 真实登录桌面验收与关闭：产品本人在已登录 Edge 打开本地 `/explore`，确认 v2 发布页面正常；该结果完成最后一项人工门禁。ALPHA-033 状态改为 `done`，阶段 8 尚未自动启动，等待产品本人另行确认。已知延期项继续为 iPhone Safari/PWA 真机、Flutter 同步及全量 Playwright 中 6 个 `mobile-chromium` 失败；本次人工确认未改变这些限制。
- ALPHA-033 发布候选结论撤销：产品本人澄清“正常”仅表示当前本地页面可访问，不代表发布候选验收；当前仍有其他功能未完成，并存在明显排版和按钮缺陷。此前将 ALPHA-033 关闭属于验收口径误判，现恢复为 `in_progress`，当前版本仅作为临时测试基线。下一步先进行覆盖电脑端 Web 核心页面、可见操作、错误/空状态与真实数据路径的缺口盘点，再按任务切片逐项设计、确认和修复；阶段 8 不启动。
- ALPHA-033 电脑端 Web 密度与操作层级规划：完成 1440×900 浅色/深色只读审计，确认 Explore 49 个、阅读页 61 个、“我的”页 115 个可操作元素，以及建议/筛选按钮过大、深色数量胶囊撞色、逐条整行收藏、实战输入裁切与整栏结束按钮等共性问题。产品本人逐节确认并批准“一屏一个明确决策”、按钮/字号分级、Explore 上下搜索与三项建议结构、场景详情/实战、学习、阅读、对话、“我的”和可收缩侧边栏书面规格。设计：[`电脑端 Web 界面密度与操作层级收敛设计`](docs/superpowers/specs/2026-09-12-desktop-web-interface-density-and-action-hierarchy-design.md)，设计 Commit：`ddf38f4`；实施：[`电脑端 Web 界面密度与操作层级收敛实施计划`](docs/plans/2026-09-12-desktop-web-interface-density-and-action-hierarchy-implementation-plan.md)，计划 Commit：`7eb1cd3`。文档自检确认无未决占位、新增本地链接均可解析、`git diff --check` 通过；本切片未修改产品代码，因此未运行代码测试。`UI-012` 已具备领取条件，`UI-013` 至 `UI-017` 按顺序依赖前项，均未开始。

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

> 后置语气调整实现 Commit：`2865dca`（报备型主动消息默认；`waking` 状态允许单句 `Te echo de menos.`）。
> 开发预览实现 Commit：`e24b97b`（`preview: true` 只调用 provider 和安全门禁，不落库、不消耗主动消息额度）。
> `waking` 文案自然度修正 Commit：`0f50941`（优先具体起床/咖啡/早餐报备，避免把无关意象硬拼在一句话里）。

## 新模型快速接手

进入仓库后按顺序执行：

1. 阅读 `AGENTS.md`，了解不可违反的产品、架构、测试和隐私规则。
2. 阅读本文件，确认任务 ID、状态、分支和下一步。
3. 只阅读当前任务引用的实施计划章节和相关规范，不必一开始加载所有文档。
4. 运行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
5. 确认没有其他模型正在处理同一任务后再修改文件。

如果用户只给出任务 ID，以下表格和对应计划章节就是任务范围。不得自行扩大到后续任务。

## 当前任务

UI-011 已完成；当前上位任务为 `ALPHA-033`，下一项可执行子任务为 `UI-012`。

当前任务为 `ALPHA-033`：电脑端 Web 的 Alpha 功能缺口收敛与发布候选准备。阶段 8 个人 Alpha 人工体验不是当前开发任务，必须等电脑端候选版本门禁通过后再启动。当前只做电脑端 Web 功能补齐、缺陷修复和局部/全量质量回归；响应式与 iPhone Safari/PWA 兼容保留但真机验收延期，Flutter 不恢复同步。阶段记录见 [`docs/tasks/STAGE-8-PERSONAL-ALPHA.md`](docs/tasks/STAGE-8-PERSONAL-ALPHA.md)。

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
- `UI-012`：Explore、场景详情、场景实战与复盘密度收敛（in_progress；负责人 Codex；分支 `codex/ui-012-explore-scenario-density`；开始日期 2026-09-12）
- `UI-013`：学习首页与训练工作台密度收敛（blocked；依赖 UI-012）
- `UI-014`：阅读书架与文章阅读器密度收敛（blocked；依赖 UI-013）
- `UI-015`：对话页面密度收敛（blocked；依赖 UI-014）
- `UI-016`：“我的”、设置与隐私密度收敛（blocked；依赖 UI-015）
- `UI-017`：公共壳层、可收缩侧边栏与全站一致性复核（blocked；依赖 UI-012 至 UI-016）

### 当前 Alpha 收敛任务

- `ALPHA-033`：电脑端 Web Alpha 功能缺口收敛与发布候选准备（in_progress；协调分支 `main`）。
- 阶段 8：电脑端 Web 个人 Alpha 连续使用与人工体验复核（blocked；仅在 `ALPHA-033` 退出条件满足且产品本人确认后启动）。

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
| ALPHA-033 | in_progress | `main` | Codex | Alpha 功能缺口收敛与发布候选准备 | 阶段 7、UI-006 至 UI-011、READ-001 至 READ-005 |
| SCN-001 | done | `codex/scn-001-scenario-foundation` | Codex | 场景状态机、数据/RLS、契约和 fake Provider 基础 | Web/PWA 场景规格与实施计划批准 |
| SCN-002 | done | `codex/scn-002-multi-scenario-vertical` | Codex | 通用工作台与餐厅、校园、租房三个基础场景 | SCN-001 |
| SCN-003 | done | `codex/scn-003-scenario-library` | Codex | 场景与表达库、可解释建议与私人生成 | SCN-001、SCN-002 |
| SCN-004 | done | `codex/scn-004-review-repetition` | Codex | 完整历史、逐轮复盘、重新说和当天/1/3/7 天复现 | SCN-002、SCN-003 |
| SCN-005 | done | `codex/scn-005-provider-pwa-hardening` | Codex / 产品本人 | Provider 设置、切换与电脑端 Web 发布门禁；iPhone 真机延期 | SCN-001 至 SCN-004 |
| UI-012 | in_progress | `codex/ui-012-explore-scenario-density` | Codex | Explore、场景详情、实战与复盘密度收敛 | 书面规格已批准，实施计划已形成 |
| UI-013 | blocked | `codex/ui-013-learning-workbench-density` | 待领取 | 学习首页与训练工作台密度收敛 | UI-012 |
| UI-014 | blocked | `codex/ui-014-reading-density` | 待领取 | 阅读书架与文章阅读器密度收敛 | UI-013 |
| UI-015 | blocked | `codex/ui-015-conversation-density` | 待领取 | 对话页面密度收敛 | UI-014 |
| UI-016 | blocked | `codex/ui-016-profile-density` | 待领取 | “我的”、设置与隐私密度收敛 | UI-015 |
| UI-017 | blocked | `codex/ui-017-collapsible-shell` | 待领取 | 公共壳层、可收缩侧边栏与全站一致性 | UI-012 至 UI-016 |
| 阶段 8 | blocked | 待启动 | 产品本人 / Codex | 电脑端 Web 发布候选的个人 Alpha 使用周期与人工体验复核 | ALPHA-033 退出条件与产品本人确认 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | UI-012 | Explore、场景详情、实战与复盘密度收敛 | 已开始；完成后等待产品本人确认 |
| 2 | UI-013 | 学习首页与训练工作台密度收敛 | UI-012 完成并确认 |
| 3 | UI-014 | 阅读书架与文章阅读器密度收敛 | UI-013 完成并确认 |
| 4 | UI-015 | 对话页面密度收敛 | UI-014 完成并确认 |
| 5 | UI-016 | “我的”、设置与隐私密度收敛 | UI-015 完成并确认 |
| 6 | UI-017 | 公共壳层、可收缩侧边栏与全站一致性复核 | UI-012 至 UI-016 完成并确认 |
| 7 | ALPHA-033 | 复核剩余功能缺口与发布候选门禁 | UI-017 全量门禁与真实登录复核完成 |
| 8 | 阶段 8 | 电脑端 Web 个人 Alpha 使用周期与人工体验复核 | ALPHA-033 退出条件与产品本人确认 |

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
| 2026-08-28 | 完成 Lucía 角色级数据清理操作（ALPHA-033 后续切片） | `746de57`、`e33a618` | 新增受保护的 `DELETE /api/v1/me/characters/lucia/data`；事务只删除 Lucía 会话、消息、关系记忆、指向 Lucía 的共享授权和关系快照，保留人物设定、好友申请、学习数据与其他角色；聚焦数据库/路由测试 6/6（含重复调用幂等断言）、契约测试 28/28、TypeScript 与受影响文件 ESLint 通过；全量 Vitest 因本机进程 OOM 未完成；当前环境无 `DATABASE_URL`，未执行真实数据删除；下一步：在已配置数据库的测试/开发环境执行一次清理并核对删除计数，再进入好友申请门禁切片 |

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
