# 个人 Alpha Web/PWA 架构边界

- 状态：实施基线
- 适用范围：个人 Alpha
- 详细产品要求：[设计规范](superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- 当前客户端设计：[Web 优先的个人学习产品与场景实战设计](superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)
- 决策记录：[ADR-0002](adr/0002-web-pwa-first-personal-alpha.md)
- 历史多平台设计：[Web 与 Flutter 多平台架构设计](superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md) 与 [ADR-0001](adr/0001-nextjs-web-flutter-clients.md)

## 1. 架构目标

个人 Alpha 使用单仓库、一条活动的 Next.js 响应式 Web/PWA 客户端代码线和一个远程 Next.js/TypeScript 模块化单体。桌面浏览器与 iPhone Safari 共用 React 页面和服务端能力。已有 Flutter/Dart 代码保留但暂停同步。目标是在不提前拆微服务的前提下，让训练、场景实战、评分、画像、推荐、角色、记忆、平台能力和供应商集成保持清晰边界，可以独立测试和替换。

架构优先保证：

- 训练流程可恢复、可测试。
- 学习证据可审计、画像可重算。
- AI 与语音供应商可替换。
- 角色记忆不会越权共享。
- 技术故障不会污染能力评分。
- 桌面与 iPhone Safari 使用同一服务端 API、内容版本和业务语义。
- 版本化 API 与稳定错误码继续保留，为未来恢复其他客户端留出边界。
- iPhone Safari 的麦克风、键盘、安全区和 PWA 生命周期必须真实验证。

## 2. 运行时视图

```text
Next.js 响应式 Web / PWA
  ├─ 桌面 React 页面与组件
  ├─ iPhone Safari / 主屏 PWA
  ├─ 浏览器 TTS、录音、权限
  └─ Web 平台适配器
             │ HTTPS / NDJSON
             ▼
                       ▼
远程 Next.js 模块化单体
  ├─ Route Handlers：鉴权、校验、协议转换
  ├─ Application：用例编排与事务边界
  ├─ Domain：纯服务端业务规则
  ├─ Repository：数据库访问接口与实现
  └─ Provider Gateways：STT、发音、LLM、TTS、地点
            │
            ├─ Supabase PostgreSQL / Auth / Storage
            └─ 外部 AI、语音与地点供应商
```

## 3. 目录与职责

```text
app/
  (auth)/                 # 登录与账号页面
  (product)/              # 学习、阅读、探索、对话、我的
  api/                    # 薄 Route Handlers
src/
  modules/
    content/              # 内容图谱、导入、发布与文章查询
    explore/              # 场景/表达发现、搜索与轻量选择策略
    scenario-practice/    # 私人场景、临时人物、实战、复盘与复现
    training/             # 训练计划、状态机、断点
    evidence/             # 评估结果、证据强度、事件写入
    profile/              # 技能快照、场景状态、进步解释
    recommendation/       # 唯一下一动作
    characters/           # 人物圣经与固定事实
    memory/               # 关系记忆、权限、冲突检查
    conversation/         # 对话、回复规划、消息流
    providers/            # 外部供应商适配器
  shared/
    auth/                 # 服务端身份解析
    db/                   # Drizzle 客户端与共享事务工具
    validation/           # 通用 Zod 工具
    observability/        # 日志、追踪、调用成本
    ui/                   # 无业务含义的基础组件
apps/
  mobile/                 # 已有 Flutter 客户端；当前暂停功能同步
contracts/
  openapi/                # 版本化 API 规范
  fixtures/               # TS/Dart 共同读取的一致性样本
content/                  # 版本化内容源
drizzle/                  # 数据库迁移
tests/
  fixtures/               # 固定音频、文本、角色和证据样本
  contracts/              # 供应商与协议契约测试
  e2e/                    # Playwright
```

现有 Next.js 根工程暂不整体搬入 `apps/web`。只有独立部署或工具链冲突证明迁移有价值时，才另写 ADR。

## 4. 分层规则

每个业务模块可以包含：

```text
domain/          # 纯 TypeScript 规则，不访问 IO
application/     # 用例编排、权限、事务和端口调用
repositories/    # 数据访问接口及实现
schemas/         # 外部输入和持久化边界校验
ui/              # 模块专用 React 组件
```

活动客户端只使用 TypeScript/React。已有 Flutter 代码不得直接导入服务端 TypeScript；未来如恢复多客户端，仍通过版本化契约和 fixtures 对齐，而不是复制数据库行类型。

依赖方向：

```text
UI / Route Handler → Application → Domain
                         │
                         ├→ Repository interface → DB implementation
                         └→ Provider interface   → Vendor adapter
```

硬性规则：

- 服务端 `domain` 不导入 React、Next.js、Drizzle、Supabase SDK 或供应商 SDK。
- Route Handler 不直接实现评分、推荐或记忆规则。
- React 组件不直接写数据库。
- 浏览器客户端不直接写证据、画像或关系记忆。
- 模块不能直接更新其他模块拥有的表；必须调用对方 application 接口。
- `shared` 不能反向依赖任何业务模块。
- 跨模块共享的数据使用小型显式 DTO，不导出内部数据库行作为公共 API。

## 5. 模块所有权

| 模块 | 拥有的规则 | 主要数据 |
|---|---|---|
| content | 内容版本、审核、图谱和发布 | expressions、tags、scenarios、content_packs |
| reading | 阅读断点、用户标注、保存和外部来源元数据 | user_reading_progress、user_article_saves、user_article_highlights、user_saved_article_sources |
| explore | 场景与表达搜索、来源筛选、资格过滤和可解释的场景选择 | 默认不拥有持久表，通过只读端口读取场景目录和用户投影 |
| scenario-practice | 私人表达收藏、私人场景、临时人物轮次、条件变化、复盘和复现 | user_saved_expressions、personal_scenarios、scenario_session_states、scenario_turns、scenario_turn_reviews、scenario_repetition_items |
| training | 当前训练计划、状态机和断点 | practice_sessions、practice_attempts、learning_breakpoints |
| evidence | 尝试评估和证据强度 | evidence_events |
| profile | 技能快照、场景状态和解释 | user_skill_states、user_scene_states |
| recommendation | 候选排序与下一动作 | 默认不拥有持久表，读取其他模块投影 |
| characters | 人物圣经、固定事实和揭示策略 | characters、character_canon_facts |
| memory | 关系记忆、共享权限和冲突 | relationships、memories、permissions |
| conversation | 会话、消息和回复生命周期 | conversations、messages |
| providers | 供应商适配、用户能力偏好和统一错误 | provider_calls、user_provider_preferences、audio_assets |

## 6. 关键领域边界

### 6.0a 场景实战与长期角色隔离

`scenario-practice` 负责从主题、阅读、收藏表达或最近错误创建私人场景，并编排临时人物多轮实战、完整文字复盘和当天/1/3/7 天复现。它可以引用 `content` 的场景、任务和表达版本，复用 `training` 的尝试、录音和稳定断点能力，并把到期复现投影给 `recommendation`。

临时人物只保存本次会话的人物快照，不创建 `characters`、`conversations` 或关系记忆，也不读取长期角色的关系阶段和私密记忆。只有用户完整表达可以进入评估；自然替代表达可以完成沟通任务。Provider 输出必须经过 Schema 和服务端规则后才能形成证据，技术失败、低置信度转写和打字不得污染口语能力。

详细数据、API、Provider 路由和状态机见 [Web 优先的个人学习产品与场景实战设计](superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)。

### 6.0b Explore 场景选择与首页推荐隔离

`explore` 通过 `POST /api/v1/explore/scenario-suggestions` 提供“适合我的 / 探索新场景 / 随机来一个”。Route Handler 认证并校验请求，application 从公开场景目录和当前用户的只读学习投影组装上下文，纯 TypeScript 策略先过滤发布状态、所有权、可用性、当前稳定断点和难度，再选择一个场景并返回最多两个结构化理由。用户投影不可用时退化为基础建议，不能伪造个性化依据；选择接口只读、不产生证据，也不调用场景生成 Provider。

该策略只解决用户进入 Explore 后“不知道搜什么”的发现问题。首页稳定断点、到期复现和跨任务唯一下一动作仍只归 `recommendation`。接口不返回候选池、内部权重、原始错误句或完整私人来源，响应使用 `private, no-store`。详细交互、隐私和测试边界见 [Explore 场景建议与随机选择设计](superpowers/specs/2026-09-11-explore-scenario-suggestions-design.md)。

`GET /api/v1/explore/dashboard` 的 `library` DTO 合并可开始的公共/本人私人场景、版本化正式表达、本人收藏、本人阅读选区和可信近期错误。服务端 repository 负责发布门禁、所有权和来源去重；任一私人来源读取失败时保守退化为公共目录，并明确返回 `privateState=unavailable`。浏览器只在这份授权 DTO 上执行纯搜索和筛选，不直接查询数据库，也不能扩大可见范围。搜索使用 NFKD 归一化，忽略大小写、标点、西语重音和重复空格，多词按 AND 匹配；`q` 与 `filter` 写入 URL，以便刷新、前进后退和深链恢复。搜索、筛选和收藏都不产生学习证据。

### 6.0c 收藏表达与私人场景生成

`scenario-practice` 通过 `GET/POST /api/v1/expressions/saved` 和归档接口拥有私人表达收藏。客户端只能提交版本化正式表达引用、本人阅读选区 ID、本人场景复盘 ID，或明确标记的手工文本；application 重新解析来源并以 `clientSaveId` 幂等保存，收藏行为不写学习证据。正式公共表达在生产环境仍必须为 `published`，开发环境的草稿预览不会改变公开发布状态。

`POST /api/v1/scenarios/generate` 只在用户确认后调用 `ScenarioGenerationProvider`。输入为主题或当前用户拥有的单个来源 ID；repository 最小化投影文本，application 以请求内容指纹校验 `Idempotency-Key`，再验证 Provider 返回的临时人物、开场、沟通目标、条件变化和表达 Schema，并确认选中的来源表达没有被丢弃。成功结果完整写入 `personal_scenarios` 后才返回，失败不保存半成品。私人场景以 `personal.<uuid>` 作为 Web/API 稳定引用，只能由拥有者读取、归档、开始实战或进入 Explore 建议候选；它保持私人 draft，不进入公共内容 API，也不创建长期角色或关系记忆。

### 6.0 阅读状态与外部来源

`reading` 模块拥有用户阅读私有数据，Route Handler 只负责会话验证、Zod 输入校验和协议转换，application 调用 `ReadingRepository` 完成事务写入。文章正文仍由 `content` 模块的已发布版本提供；阅读表只引用 `article_versions.id` 和内容哈希，不复制公共正文。

词语解释通过 `WordExplanationProvider` 走服务端 provider 边界。`POST /api/v1/read/word-explanation` 接受选中的词语或句子、当前段落上下文、文章语言和 `selectionType`（`word`/`sentence`）；服务端优先从 `content/glossary/es-zh-common-v1.json` 命中已审核的常用词条，未命中时使用 `MINIMAX_API_KEY` 调用 MiniMax M3。MiniMax 请求使用 `stream: true`，Route 以 `application/x-ndjson` 发送 `delta`、最终经完整 Schema 校验的 `done`，浏览器可逐步显示字段；不支持流式 provider 时保留一次性 JSON fallback。浏览器不会接触供应商密钥，阅读器只渲染固定解释字段；句子选择通过拖选正文后立即触发，不在 Explain 面板重复展示上下文。解释结果是临时阅读辅助，不写入 `evidence_events`、`mastery`、`confidence` 或角色记忆；超时、限流、取消、断流和供应商失败只返回稳定错误，正文阅读与本地 glossary fallback 不受影响。

角色对话通过 `CharacterReplyProvider` 走同一服务端 provider 边界。`POST /api/v1/conversations/:characterId/stream` 只把服务端隐私过滤后的角色事实、关系摘要、可读记忆、最近消息和当前用户消息交给所选 provider；内部输入 DTO、输出 DTO、错误码和观测字段不随供应商变化。默认仍使用已配置的 MiniMax adapter；只有显式设置 `CONVERSATION_PROVIDER=openai` 且存在服务端 `OPENAI_API_KEY` 时才启用 OpenAI Responses adapter，模型由 `OPENAI_CONVERSATION_MODEL` 指定。模型只返回自然语言消息，应用层继续负责 NDJSON `meta/delta/done`、generation 竞态、取消、完整消息持久化和记忆提取。超时、限流、鉴权、响应损坏或网络失败使用统一错误分类并写入脱敏观测，只发送失败事件，不生成 fallback 角色文本，也不提交完整助手消息或关系记忆；安全门禁拒绝时最多进行一次更严格的 provider 重生成，第二次仍越界则发送失败事件。只有完全没有配置真实 provider 的本地/测试环境才使用确定性回复。供应商不会写入证据、画像或关系记忆，日志不保存 prompt、原始响应或私密正文。

对话工作区通过 `GET /api/v1/conversations` 返回当前用户实际拥有的会话摘要（角色、最后一条已完成消息和时间），不再用角色目录冒充历史。无会话、数据库未配置和请求失败分别呈现为空状态或可重试状态；未读数没有可靠数据来源时不展示。语音消息使用 `POST /api/v1/transcriptions` 一次性转写为可编辑草稿，音频仅在 provider 请求生命周期内使用并以 `ephemeral` 策略处理，确认发送后仍复用文字对话流，不产生学习证据。

Lucía 的好友申请通过 `GET/POST /api/v1/character-network/lucia-contact` 管理，不新增关系表：没有当前用户关系记录时返回 `pending` 及固定的初识来源（马德里文化活动、城市摄影）；接受在同一事务内将 `character_relationships.status` 设为 `active`、幂等创建会话并写入唯一的 authored opening message，拒绝记录为 `declined` 且不创建新会话。好友侧栏只显示真实存在的会话，并以申请状态显示红点/入口。`POST /api/v1/conversations/lucia/stream` 在读取历史、写入用户消息或调用 provider 前再次检查该关系必须为 `active`，否则返回稳定错误 `CONTACT_REQUIRED`；其他角色维持现有流程。

Lucía 的主动消息暂限 App 内可见，入口为 `POST /api/v1/conversations/lucia/proactive`。服务端先按关系 active 状态、暂停开关、每日/每周上限、12 小时冷却和未回应消息判断资格，再以 `(user_id, dedupe_key)` 创建候选；provider 只收到 `inputKind=proactive`、主动消息来源、关系摘要、情绪上限、日常状态和零问题预算，不能决定发送资格或关系升级。报备型日常分享是默认形式；关系达到 `familiar` 且日常状态为 `waking` 时，允许单句 `Te echo de menos.` 这类低压力想念表达。通过 `isProactiveMessageSafe` 后，候选与 `messages.source_type=proactive` 在同一事务内完成；provider 失败、取消或门禁失败只标记候选失败，不写入半条用户可见消息，也不使用真实运行时 fallback。候选和消息都按用户所有权隔离，后续 Web Push/APNs/FCM 不属于本切片。
开发环境可传 `preview: true` 进行不落库的声音检查；预览仍调用真实 provider 并执行同一安全门禁，但不创建候选、不消耗每日额度，生产环境忽略该字段。

已发送用户消息的上下文操作通过 `DELETE/PATCH /api/v1/conversations/:characterId/messages/:messageId` 进入 conversation repository，并再次执行用户所有权、角色和消息状态校验。删除只移除用户历史；撤回将消息置为 `withdrawn`，历史正文不再进入搜索或角色回复上下文，并删除其来源关系记忆。流式回复完成时还会重新检查用户消息状态，防止回复期间撤回的消息产生介绍候选或记忆；撤回不会生成学习证据。

- `user_reading_progress` 保存版本化断点、完成状态和个人笔记；`user_article_saves` 保存文章收藏；`user_article_highlights` 保存短语/高亮文本及段落位置。
- `/api/v1/read/articles/:articleId/state` 使用内容哈希做乐观版本检查。哈希过期返回 `409 CONFLICT`，客户端保留本地状态并提示重新定位，不静默覆盖标注。
- `/api/v1/read/saved` 和 `/api/v1/read/sources` 只返回当前用户的明确 DTO。外部来源接口目前只保存规范化 URL、标题、作者、许可和版权状态等元数据，绝不抓取 URL 或保存未经验证的全文。
- 阅读、TTS、词语查询、笔记和保存操作不会写入 `evidence_events`、`mastery` 或 `confidence`；只有显式口语迁移才进入 training/evidence 链路。

Generate Story 通过 `StoryGenerationProvider` 在服务端调用 MiniMax M3。`POST /api/v1/read/generated-stories` 要求当前会话和 `Idempotency-Key`，输入经 Zod 校验后生成私有 AI draft；文章正文写入内部 `article_*` 版本载体，并由 `user_generated_articles` 按用户所有权关联。`GET/DELETE /api/v1/read/generated-stories/:articleId` 只返回或删除当前用户的记录，公共内容列表与公开内容 API 永不包含这些文章。生成文章可以复用阅读器的版本哈希、断点、标注和 TTS，但这些操作仍不会写入口语证据、画像或角色记忆。供应商请求只记录模型、延迟、请求 ID 等脱敏元数据，不保存 prompt 或原始响应。

### 6.1 训练完成不等于能力掌握

`training` 只回答“用户当前正在做什么、流程走到哪里”。`evidence` 判断本次尝试提供了什么证据，`profile` 决定技能状态如何变化。

禁止在训练页面完成回调中直接把场景标记为掌握。

### 6.1.1 训练断点的稳定边界

训练断点只保存可安全重建的稳定状态：`awaiting-output`、`showing-feedback`、`completed` 和 `recoverable-error`。播放、录音、转写、评估以及其他带活动副作用的状态不落盘；如果这些状态触发保存 effect，客户端保留上一个稳定断点。恢复只注入状态，不重放旧的播放、录音、转写或评估 effect。

断点包含内容包 key/版本、表达和目标 key、输出方式、提示级别、generation、转写和反馈快照；不包含证据、画像、API 密钥或原始录音。Web 断点按用户 ID 隔离在浏览器本地存储，Flutter 通过平台安全存储抽象隔离。Schema 或内容包版本不兼容、数据损坏时清除断点并从当前微循环起点开始。

### 6.2 证据事件与技能快照

`evidence_events` 是追加式事实，至少保存：

- `attempt_id`
- `skill_key`
- `observed_value`
- `evidence_strength`
- `output_mode`
- `prompt_level`
- `tag_weight`
- `evaluation_confidence`
- `algorithm_version`
- `occurred_at`

`user_skill_states` 是派生快照，至少保存：

- `mastery`
- `confidence`
- `oral_coverage`
- `evidence_count`
- `last_verified_at`
- `revision`
- `algorithm_version`

每次证据写入和快照更新在同一事务中完成。定期重算用于验证快照没有漂移。

### 6.3 内容版本

- 内容源使用稳定 `external_id`。
- 每次教学含义变化增加版本。
- 已产生学习证据的版本不可原地重写。
- 训练尝试保存实际内容版本。
- 推荐器只使用已发布、适合当前母语且审核通过的内容。
- Content Bundle 在写库前完成结构与跨引用校验，随后在单个数据库事务中导入。
- bundle 稳定 ID＋版本＋规范化哈希决定幂等性；同版本不同哈希必须报告冲突。
- 导入器不会自动审批或发布，也不会覆盖已存在的版本化实体。

### 6.4 人物固定事实与关系记忆

人物圣经是全局角色事实，关系记忆是某个用户与角色的共同历史，两者不可混写。

必须区分：

- 事实存在于人物设定。
- 事实已经向当前用户透露。
- 用户告诉当前角色的信息。
- 用户允许分享给其他角色的信息。
- 只供教学推荐使用的画像。

## 7. 训练状态机

训练引擎接受当前状态和领域事件，返回新状态与待执行 effect：

```ts
type TrainingTransition = {
  state: TrainingState;
  effects: TrainingEffect[];
};
```

effect 只描述意图，例如：

- `playPrompt`
- `startRecording`
- `requestTranscription`
- `requestEvaluation`
- `persistBreakpoint`
- `recordEvidence`

Web 或 Flutter 平台层执行 effect 后，再将结果作为事件送回各自客户端编排器。两端通过共同 JSON fixtures 验证相同状态语义；所有影响证据和画像的结果仍由服务端重新校验。

每个异步 effect 携带：

- `sessionId`
- `attemptId`
- `generationId`
- `effectId`

只有仍属于当前 generation 的结果可以改变状态。

## 8. API 设计

Route Handler 的职责只有：

1. 解析登录用户。
2. 使用 Zod 校验输入。
3. 调用一个 application 用例。
4. 把领域结果转换为 HTTP/流式协议。
5. 记录相关 ID、延迟和结构化错误。

7.5a 的供应商观测由 `shared/observability` 定义纯 TypeScript DTO 和关联 ID（`requestId`、`sessionId`、`attemptId`、`conversationId`、`generationId`）。provider application 通过可选 `ProviderCallObserver` 写入 `provider_calls`；观测写入失败只能被吞并，不能改变学习、聊天或评分结果。聊天流响应回传 `x-request-id`，无效或缺失的客户端 ID 由服务端生成。

7.5b 的业务故障写入独立的 append-only `diagnostic_events`：只允许四类固定事件（异常断流、重复证据、记忆冲突、Storage 清理失败），通过 `dedupe_key` 幂等。事件 metadata 只能是短字符串、数字、布尔值或 null；内部查询端点 `/api/v1/internal/diagnostics` 需要 `DIAGNOSTICS_INTERNAL_TOKEN`，响应不包含用户 ID、正文、音频路径或令牌。聚合规则按事件类型和错误类型的滑动窗口产生 warning/alert，不发送外部通知。

对 Web 与 Flutter 开放的 Alpha API 使用显式版本前缀，例如 `/api/v1/`。推荐端点：

- `POST /api/v1/diagnostics`
- `GET /api/v1/internal/diagnostics`（服务端诊断查询，不对普通客户端开放）
- `GET /api/v1/learning/next-action`
- `POST /api/v1/practice/sessions`
- `POST /api/v1/practice/attempts`
- `POST /api/v1/practice/attempts/:id/audio-upload`
- `POST /api/v1/practice/attempts/:id/evaluate`
- `POST /api/v1/practice/sessions/:sessionId/activity`
- `GET /api/v1/profile`
  - `GET /api/v1/content/packs/:id`
  - `GET /api/v1/content/articles`
  - `GET /api/v1/content/articles/:articleId`
- `GET /api/v1/conversations`
- `POST /api/v1/conversations/:id/messages`
- `GET /api/v1/conversations/:id/stream`
- `POST /api/v1/relationships/:id/share-permission`
- `DELETE /api/v1/me/data`

`GET /api/v1/profile` 返回固定八个能力维度的当前掌握度、可信度、口语覆盖和证据计数；当历史证据足够时还返回四周前掌握度，并提供最多三条只含日期、输入方式、场景标签和提示级别的脱敏代表性尝试。响应不得包含原始答案、转写正文或音频引用。

画像、活动、关系记忆和保存语音资料的 Web 同源请求在缺少 Bearer token 时，会在请求携带会话 Cookie 的前提下回退到服务端会话校验；无 Cookie 的跨端请求仍必须提供 Bearer token。这样浏览器登录态与 Flutter/API 调用保持相同的所有权检查。

READ-003 的文章 detail 端点只接受稳定 `stableKey@version`，并在服务端按发布状态、版权状态投影纯文本段落；不会执行客户端传入的 HTML，也不会返回未发布版本。Web 阅读器和 Flutter `ArticleReaderPage` 以文章版本和内容哈希作为本地阅读状态边界，保存位置、短语、高亮和笔记时不写入 `evidence_events`、`mastery` 或 `confidence`。版本哈希变化只提示重新定位，旧版本标注不被静默覆盖；TTS/词语辅助失败不阻塞正文。READ-004 的四种迁移方向（摘要、观点、个人迁移、角色对话）只在用户主动进入口语复核时构造 `ArticleTransferTask` 并带文章版本进入现有训练页；阅读页的跳过、完成和打字草稿不会创建训练尝试或口语证据。

7.4a 的关系记忆控制通过 `GET /api/v1/profile/memories` 和 `DELETE /api/v1/profile/memories?memoryId=...` 提供。列表只返回当前用户拥有的记忆，删除由服务端所有权检查执行，并依赖外键级联清理相关角色共享授权；能力证据和画像不会随之删除。

7.4b 的语音数据控制通过 `GET /api/v1/profile/media` 和带 `kind`/`id` 的 `DELETE` 提供。列表排除 `ephemeral` 录音且不暴露 storage 路径；删除保存录音写入 `audio_assets.deleted_at`，删除 speech 转写清空对应练习尝试的 `response_text`，不删除追加式证据或技能快照。

7.4c 的账号级数据控制通过 `DELETE /api/v1/me/data` 提供。请求必须来自已验证会话、携带 `Idempotency-Key` 和 `DELETE_MY_DATA` 明确确认；服务端事务先删除用户证据，再删除用户 profile 触发其余私有数据级联，同时将 `provider_calls.user_id` 置空并清理 metadata。音频 Storage 路径先登记到无用户外键的 `privacy_cleanup_tasks`，提交后由内部 deleter 清理；供应商未配置或清理失败时保留可重试任务，不阻止私有数据库数据删除。

Lucía 的个人 Alpha 清理通过 `DELETE /api/v1/me/characters/lucia/data` 提供。请求必须来自已验证会话、携带 `Idempotency-Key` 和 `RESET_LUCIA_DATA` 明确确认；事务只删除当前用户与 Lucía 关联的会话、消息、关系记忆、指向 Lucía 的共享权限和关系快照。人物设定、好友介绍申请、学习证据、画像、音频、其他角色数据和公共内容不受影响。该操作可重复执行并返回删除计数；当前模型尚无独立 `relationship_events` 表，未来新增关系事件表时必须纳入同一事务和删除顺序。

账户身份通过独立 `account` 模块维护。`GET/PATCH /api/v1/me` 只返回显示名、不可变 `publicUid`、目标语言和头像最小 DTO；照片头像通过 `POST/DELETE /api/v1/me/avatar` 进入服务端校验与私有 Storage。`profiles.id` 不进入客户端 DTO，UID 查找能力预留给阶段 9 的 `/api/v1/friends/*`，不支持邮箱搜索或公开目录。账号删除事务会把 UID 写入 `reserved_public_uids` 后再删除 profile，保证 UID 不回收。

练习活动接口只接受客户端实例 ID、单调序号和 `active`/`inactive`/`ended` 生命周期事件。服务端写入接收时间并以 `(session_id, client_instance_id, sequence)` 幂等；热力图仅消费相邻活动心跳形成的有效秒数，超过 45 秒的间隔、后台/失焦区间和未完成尾部不计入学习时长。

API 错误使用稳定代码，不让前端解析供应商原始错误文本。

### 8.1 认证与会话边界

- 普通用户通过邮箱六位 OTP 登录；邮箱密码只作为预建测试账号的隐藏备用入口。
- Web 使用 Supabase SSR Cookie。`proxy.ts` 只做会话刷新和乐观路由保护，产品布局和 Route Handler 仍在服务端调用 `auth.getUser()` 做权威验证。
- Flutter 使用同一 Supabase Auth 项目，并把持久会话交给系统安全存储，不使用普通偏好存储保存刷新会话。
- Flutter 的 Token Gate 在令牌到期前 60 秒刷新；并发请求共享一次刷新，身份代际变化会使旧刷新结果作废。
- 401 默认不自动重放。只有调用者显式允许的安全请求可以重试一次；POST 还必须提供稳定幂等键。
- 客户端解析令牌或本地“已登录”状态只用于体验优化，不能替代服务端身份验证或 PostgreSQL RLS。
- 未登录用户只可访问介绍页和登录流程；私人产品页面必须经过服务端保护。

实现和环境配置见 `docs/authentication.md`。

## 9. 流式消息协议

聊天使用 NDJSON 或等价的可逐帧解析协议：

```json
{"meta":{"messageId":"...","generationId":"..."}}
{"delta":"Hola"}
{"delta":", ¿qué tal?"}
{"done":true}
```

错误帧：

```json
{"error":{"code":"PROVIDER_TIMEOUT","retryable":true}}
```

规则：

- 没有 `done` 的自然断流是失败。
- 用户主动停止可以保存已展示文本，但消息状态为 `stopped`。
- 只有 `completed` 消息参与记忆提取和完整学习评估。
- 重试创建新的 generation，不覆盖旧消息记录。

## 10. 幂等与并发

- 尝试提交以 `attemptId` 幂等。
- 证据事件以 `(attempt_id, skill_key, algorithm_version)` 唯一。
- 供应商调用保存外部请求 ID，重试前先查询已有终态。
- 技能快照使用 `revision` 乐观锁。
- 记忆候选提交使用稳定候选 ID，防止流重连重复写入。
- 旧 generation 结果可以被记录为诊断，但不能更新当前 UI 或能力状态。

## 11. 数据库与 RLS

- PostgreSQL Schema、连接和迁移的当前实现约定见 `docs/database.md`。
- Drizzle Schema 按 `users`、`content`、`training`、`evidence`、`characters` 和 `infrastructure` 分组；业务模块不得直接写其他模块拥有的表。
- 数据库结构只通过 `drizzle/` 中的版本化向前迁移改变，迁移生成后必须通过空库执行和漂移检查。
- 所有用户私有表都包含 `user_id`。
- RLS 默认拒绝，按最小操作开放。
- Web 和 Flutter 客户端都不能直接写 `evidence_events`、`user_skill_states`、`relationship_memories` 和 `provider_calls`。
- 内容公开查询只返回已发布版本。
- 管理或导入能力使用服务端专用角色，不暴露到浏览器。
- 删除账号时按明确顺序删除或匿名化用户数据，并记录不可逆操作结果。

## 12. 音频生命周期

1. 客户端请求短期签名上传信息。
2. 客户端上传受限类型和大小的录音。
3. 服务端确认所有权后调用转写或发音服务。
4. 生成评估和必要的派生数据。
5. 普通录音删除；只保留转写、指标和证据。
6. 用户明确保存的里程碑录音移动到长期区域。

任何日志都不能包含长期有效的签名 URL。

### 12.1 客户端平台能力

Web 与 Flutter 上层功能只依赖内部端口：

- `AudioRecorder`
- `AudioPlayer`
- `TextToSpeech`
- `SecureStorage`
- `Notifications`
- `AppLifecycle`
- `Connectivity`

Web 使用浏览器适配器。Flutter 优先使用成熟插件；插件不能可靠满足 AVAudioSession、通知、文件生命周期或商店能力时，再增加单一职责的 Swift/Kotlin/Windows 桥接。平台原始异常必须转换为稳定内部错误。

训练 Alpha 的 Web 适配器位于 `src/modules/providers/speech/browser-recorder.ts` 和 `src/modules/providers/tts/browser-tts.ts`。录音适配器只在内存中返回当前尝试的音频 Blob 与 `mimeType`/`sizeBytes` 元数据，不创建长期媒体资产。麦克风权限拒绝、格式不支持、录音失败和 TTS 不可用分别映射为稳定能力错误；麦克风启动失败直接把当前输出方式切换为文字，不产生能力证据。

Flutter 的 `AudioRecorder` 和 `TextToSpeech` 端口继续位于 `apps/mobile/lib/core/platform/`，训练 fake 通过依赖注入验证成功、权限失败和资源释放路径。未安装平台插件或能力不可用时必须返回同一类稳定错误，并降级到文字输入。

当前没有 Mac/Xcode，因此 Flutter 公共代码、Dart 测试和 Windows/Web 宿主验证不能被表述为 iOS 已验证。iOS 录音、签名、TestFlight 和真机验收必须在可持续使用的 Mac 环境中完成。

## 13. 供应商抽象

业务代码只能依赖内部接口。适配器负责：

- 请求格式和认证。
- 超时、重试和取消。
- 供应商错误映射。
- 响应格式转换。
- 调用成本与延迟记录。
- 数据保留策略标记。

供应商选择不应改变 evidence、profile、training 或 conversation 的公共接口。

发音评测使用独立的 `PronunciationProvider`，不把 STT 转写或 LLM 文本判断当作发音证据。内部契约只接受短期音频、`es-ES`/`es-MX` locale、可选参考文本和 `attemptId`/`generationId`，返回可校验的发音、流利度、韵律指标及安全调用元数据，不返回原始转写正文，也不直接写入 evidence 或 profile。`quality: "insufficient"`、低置信度、静音和技术失败只能进入待验证或可恢复路径，不能产生负面能力证据。默认测试使用 fake；真实供应商调用必须单独触发。

训练 application 通过 `assessPronunciationAttempt` 编排发音调用：它负责检查 spoken output、抽样/明确复核资格和当前 `generationId`，再调用内部 `PronunciationProvider`。application 只返回 observation-only、pending-verification、recoverable-error 或 stale 结果，不把供应商分数当作语境成功、`mastery` 或 `confidence`，也不在该边界直接写入 `evidence_events`。后续 evidence application 只有在独立校准门槛和服务端规则满足后，才能消费有限的发音观察。

默认训练还可以调用独立的 `SpeechSignalAnalyzer`，只提取音频时长、有限能量启发式的语音占比和停顿信号。它与 `PronunciationProvider` 不共用评分 DTO，不产生发音分数、语境成功、`mastery` 或 `confidence`；分析失败、静音、过短音频和取消只能进入待验证或可恢复路径。外部教材音频回放工具只读文件并输出哈希和脱敏元数据，默认 dry-run，不复制、上传或把绝对路径写入清单。MiniMax 等多模态模型未来只能作为显式关闭的标注辅助，必须通过独立 Schema 和人工复核，不能直接写入学习证据。

任何小批量回放标注在调用供应商前都必须通过校准前置门禁。门禁同时要求回放清单条目授权已确认、来源许可已确认、第三方处理许可已确认、样本哈希唯一且批量不超过上限；缺少许可记录时只返回结构化阻塞原因。门禁是只读 dry-run，不读取或复制音频内容，也不写入证据、画像或供应商调用记录。

## 14. 可观测性

结构化日志至少包含：

- `requestId`
- `userIdHash`
- `sessionId`
- `attemptId`
- `conversationId`
- `generationId`
- `provider`
- `latencyMs`
- `resultCode`

禁止记录：

- 原始录音内容。
- 完整私密对话正文。
- API 密钥和访问令牌。
- 长期有效的存储地址。

关键指标：

- 训练完成和恢复成功率。
- STT 低置信度率。
- 评估结构校验失败率。
- 重复证据拦截次数。
- 聊天首 token 和完整响应延迟。
- 无 `done` 异常断流率。
- 记忆冲突和越权共享拦截次数。
- 每次有效训练和聊天的供应商成本。
- 对话 provider 安全门禁拦截率（按 provider、关系阶段和回复意图统计），用于判断是否需要调整 prompt 或增加受控重生成；门禁结果只记录稳定错误分类，不保存被拒绝的完整文本。

7.5a 已落地 `provider_calls` 的 `request_id`、`session_id`、`attempt_id`、`conversation_id`、`generation_id` 和 `error_type` 字段，并为 request/attempt 建立诊断查询索引。记录只保存结构化供应商元数据，不保存音频、完整对话或供应商响应正文。

## 15. 暂不拆分的边界

Alpha 不创建：

- 独立评分服务。
- 独立聊天服务。
- 消息队列集群。
- 单独推荐数据库。
- 多仓库前后端。
- Capacitor iOS 主客户端。
- 为 Flutter 页面建立等价 SwiftUI/UIKit 页面树。

只有出现可测量的性能、发布隔离或团队所有权问题时，才通过 ADR 评估拆分。

## 16. 架构决策记录

影响以下内容的变更必须新增 ADR：

- 技术栈或部署平台。
- 模块所有权和公共接口。
- 证据算法或画像语义。
- 数据保留和隐私边界。
- 角色记忆共享规则。
- 供应商数据处理方式。
- Alpha 延后范围的提前引入。

ADR 存放于 `docs/adr/`，格式为 `NNNN-short-title.md`。
