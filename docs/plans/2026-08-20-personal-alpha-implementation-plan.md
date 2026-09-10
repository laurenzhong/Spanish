# 西班牙语沉浸式口语平台：个人 Alpha 实施计划

- 日期：2026-08-20
- 依据：[产品设计规范](../superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- 参考：[Echo-Loop 参考评审](../references/echo-loop-review.md)
- 实施对象：Next.js 响应式 Web/PWA，覆盖桌面浏览器与 iPhone Safari
- 技术路线：Next.js、React、TypeScript、Tailwind CSS、Supabase、Drizzle、Zod、Vercel
- 当前客户端依据：[Web 优先的个人学习产品与场景实战设计](../superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md) 与 [ADR-0002](../adr/0002-web-pwa-first-personal-alpha.md)

> 2026-09-11 重排：阶段 1 至 7 中已经完成的 Flutter 记录保留为历史交付，但 Flutter、原生客户端、商店发布和跨端同步不再属于当前个人 Alpha。当前任务和后续实施以 Web/PWA、场景学习闭环和长期 AI 角色质量为优先；详细场景实施计划在新规格完成书面复核后单独生成。

## 1. 实施目标

个人 Alpha 的目标不是一次完成完整商业产品，而是用本人连续 3–4 周的真实使用验证四项核心假设：

1. 围绕交际目标训练，比看课、背句子和机械跟读更容易形成可独立调用的表达。
2. 语境成功、提示依赖和输出方式可以形成可信、可解释的学习画像。
3. Lucía 作为长期好友能让用户主动继续对话，而不是只完成练习任务。
4. 状态自适应的单一主动作、自然停止点和断点续学能同时适应新用户、碎片时间与完整学习。

Alpha 完成时必须能够走通：

> 登录 → 获取场景表达 → 临时人物实战 → 完整复盘 → 到期复现 → Lucía 等长期角色对话 → 再次打开恢复与推荐

这条路径必须在桌面 Web 与 iPhone Safari 使用同一服务端数据走通；iPhone 麦克风、键盘、安全区和 PWA 生命周期通过真实设备补充验收。

## 2. 范围

### 2.1 必须完成

- 简体中文界面，数据结构支持多母语。
- 40–60 条审核后的核心口语表达。
- 8–12 个原创或开放许可的沉浸式内容包，以及首批可持续扩充的西语阅读文章库。
- 八类通用沟通能力与八维技能画像。
- Web 浏览器 TTS/录音、语音转写和基础发音信号。
- 自主开口、打字替代、三级提示、变式迁移和抽样复核。
- 追加式学习证据、技能快照、场景状态和推荐器。
- Lucía 私信、语音优先输入、长期关系记忆和自然反馈入口。
- 两个可被介绍的新角色及用户同意流程。
- Codeforces/GitHub 式有效学习热力图和八维能力图。
- 桌面与 iPhone Safari 响应式 PWA、错误降级、隐私设置、基本可观测性和部署。
- 版本化 API 契约、稳定错误码和 TypeScript 一致性样本。

### 2.2 明确延后

- 支付、订阅和配额商业规则。
- 完整可视化内容后台。
- 实时双向语音通话。
- 大规模角色网络或角色商城。
- Flutter 或原生移动/桌面客户端的功能同步、商店发布和跨端 Dart 工作。
- 独立微服务、复杂消息队列和离线 ASR。
- 未经授权的外刊全文导入、任意网页抓取、RSS/Newsletter 自动订阅和浏览器扩展。

## 3. 工程原则

1. **领域先于页面**：训练、证据、画像、推荐、角色和记忆先定义纯逻辑与接口，页面只组合能力。
2. **单一事实来源**：服务端数据库是学习证据、画像和关系记忆的权威来源。
3. **事件与快照分离**：原始证据只追加，技能状态可以重算。
4. **异步可取消、可幂等**：录音、转写、评分和聊天都必须防止旧回调污染新状态。
5. **技术失败不扣能力分**：低置信度转写、服务失败和权限问题只能降低证据可信度。
6. **自然表达优先**：评估语境成功，不要求复现唯一答案。
7. **先做可解释规则**：Alpha 不使用难以校准的黑箱总分替代业务规则。
8. **纵向切片交付**：每个阶段都要形成可以亲自体验的路径，不连续数周只建设底层。
9. **单一活动客户端**：桌面与 iPhone Safari 共用响应式 Web/PWA；保留版本化 API，为未来恢复其他客户端提供边界。
10. **服务端最终校验**：客户端状态、插件结果和本地缓存不能直接成为能力证据或记忆事实。

## 4. 计划目录结构

阶段 1 脚手架完成后使用以下结构：

```text
app/
  (auth)/
  (product)/
  api/
src/
  modules/
    content/
    training/
    evidence/
    profile/
    recommendation/
    characters/
    memory/
    conversation/
    providers/
  shared/
    auth/
    db/
    validation/
    observability/
    ui/
apps/
  mobile/                 # 已有 Flutter 客户端；当前暂停功能同步
contracts/
  openapi/                # 版本化 API 规范
  fixtures/               # TS/Dart 跨语言一致性样本
drizzle/
content/
  expressions/
  packs/
  characters/
tests/
  fixtures/
  contracts/
  e2e/
docs/
```

详细依赖边界见 [架构边界](../architecture.md)。

## 5. 阶段与依赖

| 阶段 | 结果 | 主要依赖 |
|---|---|---|
| 0 | 文档与仓库约束可执行 | 已批准设计 |
| 1 | 已完成的 Web/PWA 与历史 Flutter 客户端骨架 | 阶段 0 |
| 2 | 数据库、认证、RLS 和内容导入 | 阶段 1 |
| 3 | 可恢复的训练闭环 | 阶段 2 |
| 4 | 语音、评估、证据和画像 | 阶段 3 |
| 5 | 首页推荐、沉浸内容包与阅读文章库 | 阶段 4 |
| 6 | Lucía 对话与长期记忆 | 阶段 2、4 |
| 7 | 新角色、进步展示与 Alpha 功能完整化 | 阶段 5、6 |
| 7.7 | Alpha 功能缺口收敛与发布候选准备 | 阶段 7、UI-006 至 UI-011、READ-001 至 READ-005 |
| 8 | 发布候选版本的 3–4 周个人验证与迭代 | 阶段 7.7 退出条件 |
| 9 | 用户好友与 1 对 1 私信 | 阶段 8 完成并决定扩大用户规模 |

阶段 3 后可以进行开发期的局部核心训练体验；这不等同于阶段 8 的连续真实使用，后者必须等待发布候选门禁。

## 6. 阶段 0：仓库与执行规范

### 任务 0.1：建立项目文档入口

目标文件：

- `README.md`
- `AGENTS.md`
- `docs/architecture.md`
- `docs/content-authoring.md`
- `docs/testing-strategy.md`

验收：

- 新开发者能从 README 找到产品设计、实施计划和本地开发入口。
- AGENTS 明确启动检查、边界、测试、隐私和收尾要求。
- 所有文档链接可以从仓库根目录解析。

### 任务 0.2：确定工作方式

- 默认分支：`main`。
- 功能分支：`feat/<scope>`、修复分支：`fix/<scope>`。
- 包管理器：pnpm。
- Node.js：当前活跃 LTS，使用 `.nvmrc` 或 `.node-version` 固定大版本。
- 提交保持单一目的；代码任务通过 PR 或在个人 Alpha 阶段经明确确认后直接合并。

阶段退出条件：开发约束和计划文档已提交，仓库工作区干净。

## 7. 阶段 1：Web/PWA 与 Flutter 客户端基础骨架

### 任务 1.1：创建 Next.js 工程

计划文件：

- `package.json`
- `pnpm-lock.yaml`
- `next.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`
- `postcss.config.mjs`
- `app/layout.tsx`
- `app/globals.css`

要求：

- App Router、TypeScript 严格模式、Tailwind CSS。
- 默认手机视口设计，同时支持桌面调试。
- 环境变量只通过服务端读取；公开变量必须使用明确前缀。
- 建立 `typecheck`、`lint`、`test`、`test:e2e`、`build` 脚本。

验证：

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

### 任务 1.2：建立 Web 与 Flutter 产品壳层

计划文件：

- `app/(product)/layout.tsx`
- `src/shared/ui/app-shell.tsx`
- `src/shared/ui/bottom-navigation.tsx`
- `app/(product)/learn/page.tsx`
- `app/(product)/explore/page.tsx`
- `app/(product)/chat/page.tsx`
- `app/(product)/me/page.tsx`
- `apps/mobile/pubspec.yaml`
- `apps/mobile/lib/app.dart`
- `apps/mobile/lib/features/learn/learn_page.dart`
- `apps/mobile/lib/features/explore/explore_page.dart`
- `apps/mobile/lib/features/chat/chat_page.dart`
- `apps/mobile/lib/features/profile/profile_page.dart`
- `apps/mobile/test/`

要求：

- 底部五项：学习、阅读、探索、对话、我的。
- 学习首页按状态突出唯一真实主动作：无记录为“开始第一次练习”，有稳定断点为“继续学习”；时长、模式和难度调整不能成为进入前置条件，是否展示可选入口需要通过可用性验证。
- 不增加“背单词”一级导航；短语复习作为阅读、探索和学习中的上下文次级入口，后续只有在使用数据证明其为独立高频任务时才评估 `/review` 子路由。
- Web 与 Flutter 页面都必须有加载、空、失败和离线提示状态。
- 不把课程模式、学习时长和难度选择器做成进入前置流程；如验证出明确价值，再以渐进式、可跳过入口加入。
- 锁定 Flutter/Dart 版本，建立 `flutter analyze` 和 `flutter test` 基线。
- 生成 iOS、Android、Windows、macOS 平台目录，但 Alpha 只验收 Flutter 公共代码和 iOS 路线所需配置。
- 当前没有 Mac；任务完成不代表 iOS 已编译或真机验证。

### 任务 1.3：PWA、Flutter 平台接口与基础可访问性

- 添加 manifest、图标占位资产、主题色和安装能力。
- 对话、录音和继续学习主路径可用键盘操作。
- 所有交互元素有可访问名称，颜色不是唯一状态信号。
- 支持 `prefers-reduced-motion`。
- 建立 Flutter 的 `AudioRecorder`、`TextToSpeech`、`SecureStorage`、`AppLifecycle` 抽象和 fake，不在此任务接真实语音插件。
- 为手机、平板和桌面宽度建立自适应布局断点，不把手机底栏机械放大成桌面界面。

阶段退出条件：手机浏览器可安装；Web 与 Flutter 五项主导航可导航；新用户和断点用户首页状态可区分；Vercel 预览部署成功；Flutter 静态分析和测试通过。iOS 编译、签名和真机音频验收等待 Mac/Xcode 环境。

## 8. 阶段 2：认证、数据库与内容导入

### 任务 2.1：Supabase 与 Drizzle 基础

计划文件：

- `src/shared/db/client.ts`
- `src/shared/db/schema/*`
- `drizzle.config.ts`
- `drizzle/*.sql`
- `.env.example`

首批表：

- 用户：`profiles`、`user_preferences`。
- 内容：`communication_domains`、`learning_goals`、`expressions`、`expression_variants`、`tags`、`expression_tags`、`scenarios`、`scenario_tasks`。
- 内容包：`content_packs`、`content_pack_segments`、`content_pack_activities`、`content_sources`、`content_reviews`。
- 学习：`practice_sessions`、`practice_attempts`、`learning_breakpoints`。
- 证据与画像：`evidence_events`、`user_skill_states`、`user_scene_states`。
- 角色与对话：`characters`、`character_canon_facts`、`character_relationships`、`relationship_memories`、`memory_sharing_permissions`、`conversations`、`messages`。
- 基础设施：`audio_assets`、`provider_calls`、`idempotency_keys`。

要求：

- 所有用户数据表含用户外键、创建时间和更新时间。
- 证据事件只追加；普通应用路径无更新和删除权限。
- 高并发写入表使用必要索引，不为 Alpha 预建无数据支持的复杂索引。
- 迁移只能向前执行；禁止手工修改生产表结构。

### 任务 2.2：认证与 RLS

- 支持邮箱登录；社交登录延后到核心闭环稳定后评估。
- Web 与 Flutter 使用同一 Supabase Auth 项目；Flutter 通过移动端会话获取短期访问令牌并调用版本化服务端 API。
- 未登录用户只能访问公开介绍页，不能读写学习数据。
- 用户只能访问自己的练习、证据、画像、关系和消息。
- 公开内容只暴露 `published` 且审核通过的版本。
- 服务端供应商调用使用单独的受限凭据。
- 移动端不保存服务端密钥，认证令牌使用平台安全存储接口。

测试：

- 用户 A 不能读取用户 B 的证据和对话。
- 客户端不能直接写技能快照。
- 未发布表达不能通过公开查询返回。

### 任务 2.3：内容 Schema 与导入器

计划文件：

- `src/modules/content/schemas/*.ts`
- `src/modules/content/import/import-content.ts`
- `src/modules/content/import/validate-content.ts`
- `contracts/openapi/content-api.yaml`
- `apps/mobile/lib/features/content/data/`
- `content/expressions/*.json`
- `content/packs/*.json`
- `content/characters/lucia.json`

要求：

- Zod 校验必填字段、枚举、标签引用、权值和版权状态。
- Flutter 内容 DTO 从版本化契约生成或通过等价 Schema 校验，不能手写一套逐渐漂移的字段定义。
- 导入过程先完整验证，再在单个事务中写入。
- 内容使用稳定外部 ID 和版本号，可重复执行且不产生重复行。
- 已被学习的内容版本不能静默覆盖；新版本通过显式发布切换。

### 任务 2.4：整理首批内容

- 从现有 554 句话筛选 40–60 条核心表达。
- 优先覆盖：开始交流、建立关系、表达自己、表达需要、回应、维持对话、修复沟通、结束与延续。
- 每条表达配置目标语块、替换槽位、意群、语用限制、地区和权值。
- 完成简体中文翻译与教学说明。
- 标记母语者审核状态；未审核内容只能在开发环境显示。

阶段退出条件：登录与用户隔离通过测试，首批内容可以幂等导入并在探索页读取。

## 9. 阶段 3：核心训练闭环

### 任务 3.1：定义训练领域模型

计划文件：

- `src/modules/training/domain/training-plan.ts`
- `src/modules/training/domain/training-state.ts`
- `src/modules/training/domain/training-event.ts`
- `src/modules/training/domain/training-engine.ts`
- `apps/mobile/lib/features/training/domain/training_state.dart`
- `apps/mobile/lib/features/training/domain/training_event.dart`
- `apps/mobile/lib/features/training/domain/training_engine.dart`
- `contracts/fixtures/training/*.json`

状态至少覆盖：

- `loading-context`
- `presenting-input`
- `awaiting-output`
- `recording`
- `transcribing`
- `evaluating`
- `showing-feedback`
- `transitioning`
- `completed`
- `recoverable-error`

训练事件至少覆盖：

- 内容加载完成。
- 播放完成或失败。
- 开始、停止、取消录音。
- 提交打字输出。
- 请求一级、二级、三级提示。
- 转写和评估返回。
- 进入变式、跳到静默模式、退出和恢复。

要求：

- TypeScript 与 Dart 训练编排器都是纯函数或纯类，不依赖 React/Flutter Widget、数据库、浏览器和供应商 SDK。
- 不合法状态转换明确拒绝并记录诊断信息。
- 所有异步结果携带 `generationId`，过期结果被忽略。
- 任务完成与能力掌握分离；完成一次任务不等于掌握。
- 两种实现读取同一批 JSON 转换样本并产生等价终态和 effect。

### 任务 3.2：训练计划生成器

计划文件：

- `src/modules/training/domain/build-training-plan.ts`
- `src/modules/training/domain/task-policy.ts`
- `contracts/openapi/learning-api.yaml`

规则：

- 新内容：情境输入 → 解析 → 模仿 → 自主输出 → 变式。
- 中等熟练：意图/关键词 → 自主输出 → 变式。
- 高熟练或待验证：陌生变体 → 随机追问。
- 静默环境：听/读/打字替代，但安排后续口语验证。
- 同一目标短期重复时降低重复任务比例。

### 任务 3.3：训练页面

计划文件：

- `app/(product)/learn/session/[sessionId]/page.tsx`
- `src/modules/training/ui/training-session.tsx`
- `src/modules/training/ui/context-card.tsx`
- `src/modules/training/ui/output-composer.tsx`
- `src/modules/training/ui/hint-layer.tsx`
- `src/modules/training/ui/feedback-card.tsx`
- `apps/mobile/lib/features/training/ui/training_session.dart`
- `apps/mobile/lib/features/training/ui/output_composer.dart`
- `apps/mobile/lib/features/training/ui/feedback_card.dart`

要求：

- Web 与 Flutter 页面只显示当前必要信息，不把整个训练计划变成选项卡。
- 默认语音输入，打字入口始终可见但次级。
- 用户说话时不显示纠错或打断提示。
- 完整表达后只突出一个关键问题；详细解析按需展开。
- 每个表达结束后形成安全保存点。

### 任务 3.4：断点续学

- 保存微型目标、任务 ID、变体 ID、提示级别、输出方式和稳定状态。
- 不保存无法安全恢复的瞬时状态，例如正在录音或半个流式回复。
- 恢复时从最近稳定节点继续。
- 内容版本变化时执行兼容检查；无法兼容则从当前微循环起点恢复。

测试重点：

- 三级提示状态转换。
- 语音切换打字不丢目标。
- 旧 generation 的转写结果不覆盖新尝试。
- 刷新页面后从稳定节点恢复。
- 随时退出不产生“课程失败”。

阶段退出条件：Web 与 Flutter 使用同一固定假评估器和内容版本，可以完整完成 3–5 条表达的微循环并恢复进度；提交 DTO 通过同一 API Schema 校验。

## 10. 阶段 4：语音、评估、证据与画像

### 任务 4.1：Web 与 Flutter 语音能力

计划文件：

- `src/modules/providers/speech/browser-recorder.ts`
- `src/modules/providers/tts/browser-tts.ts`
- `src/modules/training/ui/voice-recorder.tsx`
- `apps/mobile/lib/platform/audio/audio_recorder.dart`
- `apps/mobile/lib/platform/tts/text_to_speech.dart`
- `apps/mobile/lib/features/training/ui/voice_recorder.dart`

要求：

- 浏览器 TTS 作为 Alpha 默认朗读，支持语速和西班牙语音色选择。
- Flutter 使用平台 TTS 和录音插件；iOS 音频会话不能可靠覆盖时再增加小型 Swift 桥接。
- 录音开始前检查权限和支持格式。
- 普通录音限制大小和时长，停止后上传。
- 权限拒绝时立即提供打字入口，不循环弹权限请求。
- 客户端不保存长期原始录音。
- Web 与 Flutter 返回相同内部音频元数据和稳定错误码。
- 当前没有 Mac 时先完成 Dart 契约、fake 和非 iOS 宿主测试；iOS 真机录音验收必须保留为明确未完成项。

### 任务 4.2：供应商适配器与契约

计划接口：

- `SpeechToTextProvider.transcribe()`
- `PronunciationProvider.assess()`
- `LanguageModelProvider.generate()`
- `TextToSpeechProvider.synthesize()`
- `PlaceProvider.lookup()`

每个返回值必须是内部统一模型，包含：

- 供应商和模型版本。
- 延迟和请求 ID。
- 置信度与可用维度。
- 可重试/不可重试错误分类。
- 数据保留标记。

在选定供应商前先实现 fake adapter 和契约测试；具体供应商通过记录化评估决定。

### 任务 4.3：语境评估器

计划文件：

- `src/modules/evidence/domain/evaluate-attempt.ts`
- `src/modules/evidence/domain/evaluation-rubric.ts`
- `src/modules/evidence/domain/evaluation-result.ts`

评估分层：

1. 转写是否可信。
2. 是否完成交际任务。
3. 是否独立完成以及使用了哪级提示。
4. 自然度、准确性和可理解度。
5. 适用时评估发音、重音、语流和停顿。

规则：

- 自然替代表达可以完成任务。
- 未使用目标语块但完成任务时，不提高目标语块熟练度。
- 低置信度转写返回“证据不足”，不能返回失败。
- 普通聊天不逐条运行高成本严格发音评分。
- LLM 评估输出必须经过 Zod 校验和规则后处理。

### 任务 4.4：证据事件与幂等写入

计划文件：

- `src/modules/evidence/application/record-evidence.ts`
- `src/modules/evidence/domain/evidence-strength.ts`
- `src/modules/evidence/repositories/evidence-repository.ts`

证据强度：

```text
语境表现 × 独立程度 × 输出方式可靠度 × 任务难度 × 评测可信度
```

要求：

- 每次尝试有稳定 `attemptId`；同一尝试最多生成一组证据事件。
- 保存评估维度、输入方式、提示级别、标签权值和算法版本。
- 重复同句和短时间重复的边际证据降低。
- 技术失败只写诊断事件，不写负面技能证据。

### 任务 4.5：技能快照与场景状态

计划文件：

- `src/modules/profile/domain/update-skill-state.ts`
- `src/modules/profile/application/rebuild-profile.ts`
- `src/modules/profile/domain/scene-status.ts`

要求：

- `mastery` 与 `confidence` 独立。
- 没有练习只降低可信度，不自动降低熟练度。
- 打字证据不能更新发音、语流和真实口头反应。
- 场景达到“可以应对”需要核心任务、加权熟练度、陌生变体和口语覆盖。
- 快照可以从证据事件重算，用于校验算法升级。

阶段退出条件：真实录音可以完成转写和评估；一次训练后证据、画像和解释页一致更新。

## 11. 阶段 5：首页推荐与沉浸内容包

### 任务 5.1：推荐器

计划文件：

- `src/modules/recommendation/domain/next-action.ts`
- `src/modules/recommendation/domain/rank-candidates.ts`
- `src/modules/recommendation/application/get-next-action.ts`

候选优先级综合：

- 当前核心目标缺口。
- 历史薄弱点。
- 可信度不足的待验证技能。
- 是否缺少口语证据。
- 内容新鲜度与重复惩罚。
- 用户当前可用输入方式。
- 最近对话中自然出现的表达需求。

输出始终包含一个首选动作和一句可解释原因：无学习记录时返回“开始第一次练习”，有稳定断点时返回“继续学习”。探索页可以浏览其他内容，但首页不展示候选列表。

### 任务 5.2：初次诊断

- 用户选择一个自认为可以表达的通用沟通场景。
- 系统提供 3–5 个逐步变化的交际任务。
- 后台按语境、独立程度和标签权值建立初始证据。
- 数据不足时明确显示“正在建立画像”，不伪造完整八维分数。

### 任务 5.3：沉浸内容包体验

计划页面：

- 内容包详情。
- 隐藏文本听全文。
- 分段阅读、意群和解析。
- 打字回复或摘要。
- 方便开口后的复述验证。

Web 与 Flutter 使用同一内容包 API 和活动状态协议，分别实现适合浏览器和移动端的页面。

要求：

- 听说读写共享内容 ID 和标签，不创建四套割裂进度。
- 阅读完成不能直接证明口语掌握。
- 内容包中的人物事件可以进入后续 Lucía 对话上下文。

阶段退出条件：首页可以根据真实画像给出唯一下一动作；至少 3 个内容包走通听说读写闭环。

### 任务 5.4：阅读文章库与阅读器（READ-001 至 READ-005）

阅读是独立于探索内容包的第五项一级导航，使用同一内容图谱和服务端权限，但拥有独立的文章版本、阅读进度和用户标注。Alpha 首批先提供可核验来源的原创、公共领域、开放许可或明确授权文章；目标是形成一批可分页、可搜索、可持续扩充的文章，而不是用未实现的 RSS、Newsletter 或任意 URL 导入按钮填充页面。

#### READ-001：文章内容契约与版权字段

- 定义 `article_sources`、文章版本、段落、资产、审核和版权 DTO。
- 扩展内容校验与导入，版权字段不完整、正文未清洗或审核状态不满足发布条件时整批回滚。
- 建立少量原创/授权文章 fixture 和 Web/Flutter 一致性样本。

#### READ-002：阅读导航与文章书架

- 将 Web/Flutter 产品壳层扩展为五项导航。
- 建立 `/read`、主题列表、继续阅读、保存、筛选和真实搜索结果状态。
- 只显示已发布且来源、许可和版本字段完整的文章；分页/游标不能一次返回整库正文。

#### READ-003：规范化阅读器

- 实现文章版本读取、段落定位、阅读进度、TTS、词语辅助、高亮、保存短语和个人笔记。
- 服务端清洗正文和资产 URL；客户端不直接信任原始 HTML。
- 增加键盘、屏幕阅读器、移动端安全区、断网恢复和文章版本迁移验收。

#### READ-004：阅读到口语迁移

- 从文章生成可选摘要、观点、个人迁移和角色对话入口。
- 阅读、词语查询、TTS、打字摘要和完成状态只写阅读活动，不写 `evidence_events`、`mastery` 或 `confidence`。
- 只有用户主动自主口语迁移才通过现有 training application、`attemptId`/`generationId` 和评估链路更新适用能力。

#### READ-005：个人保存和外部来源增量

- 第一阶段只保存用户私有的文章来源、阅读状态、短语、高亮和笔记；只有版权允许且解析成功时才保存规范化正文。
- RSS、Newsletter、浏览器扩展、任意网站导入和大规模外部 feed 管理属于后续子任务，进入前必须更新版权、隐私和数据保留说明。

阶段退出条件：Web 与 Flutter 均可完成“发现文章 → 打开阅读器 → 恢复断点 → 词语辅助/TTS → 保存短语或高亮 → 跳过或主动完成口语迁移”的路径；阅读行为与口语证据严格隔离；用户 A/B 的阅读数据通过 RLS 隔离。

## 12. 阶段 6：Lucía 好友系统

### 任务 6.1：人物圣经

计划文件：

- `content/characters/lucia.json`
- `src/modules/characters/schemas/character-bible.ts`
- `src/modules/characters/domain/canon-checker.ts`

人物圣经包含：

- 固定身份与不可变事实。
- 当前版本和变更历史。
- 性格、语气、主动程度和话题偏好。
- 已知关系网络。
- 可逐步揭示的背景事实。
- 禁止虚构为现实存在的行动和资源。

Lucía 初始事实固定为：24 岁、马德里长大并生活、数字传播与新媒体硕士。母亲为意大利人等新增背景必须作为新版本事实通过冲突检查后发布。

### 任务 6.2：对话消息流

计划文件：

- `app/(product)/chat/[characterId]/page.tsx`
- `src/modules/conversation/ui/chat-thread.tsx`
- `src/modules/conversation/ui/voice-composer.tsx`
- `src/modules/conversation/application/stream-reply.ts`
- `apps/mobile/lib/features/conversation/ui/chat_thread.dart`
- `apps/mobile/lib/features/conversation/ui/voice_composer.dart`
- `apps/mobile/lib/features/conversation/data/conversation_stream.dart`

要求：

- Web 与 Flutter 都提供头像、状态、消息气泡和语音/文字混合，整体接近真实私信体验。
- 默认语音输入，打字可选。
- 服务端流使用 `meta`、`delta`、`done`、`error` 明确协议。
- 用户停止、网络断流、重试和重复提交行为可预测。
- 没有 `done` 的回复不进入长期记忆提取。
- 消息生成使用 generation token，旧流不能覆盖新消息。

任务 6.2 后续 provider 切片（ALPHA-031）：

- 通过服务端 `CharacterReplyProvider` 接入 MiniMax-M3；provider 只接收服务端隐私过滤后的角色与关系上下文。
- 保持现有 NDJSON 流协议、取消、重试、generation 边界、完整 `done` 后持久化和记忆提取。
- MiniMax 未配置或调用失败时回退确定性回复；provider 调用记录稳定状态、模型和延迟，不记录 prompt、原始响应或私密正文。
- 默认测试使用 fake fetch 和清空 MiniMax key 的 E2E 环境，禁止收费调用。

### 任务 6.3：角色回复规划

计划文件：

- `src/modules/conversation/domain/reply-plan.ts`
- `src/modules/conversation/application/build-reply-context.ts`
- `src/modules/conversation/application/generate-character-reply.ts`

先生成结构化回复计划，再生成西班牙语表面文本。计划包括：

- 对用户上一条消息的真实回应。
- 当前情绪和关系阶段。
- 是否追问、分享自身经历、建议地点或自然换话题。
- 是否存在自然的学习机会。
- 是否应该保持简短或主动展开。

教学目标只能影响机会，不能替代对用户情绪和上下文的回应。

### 任务 6.4：关系记忆

计划文件：

- `src/modules/memory/domain/memory-candidate.ts`
- `src/modules/memory/application/extract-memories.ts`
- `src/modules/memory/application/commit-memories.ts`
- `src/modules/memory/domain/memory-conflict.ts`

流程：

1. 完整会话轮结束后提取候选记忆。
2. 分类为角色固定事实、单独关系记忆、可共享用户资料或教学画像。
3. 检查来源、置信度、敏感级别、重复和冲突。
4. 只提交允许自动保存的记忆。
5. 私密信息默认只属于当前关系。

要求：

- 教学画像不能作为角色之间讨论用户的社交资料。
- 新角色获得信息前必须有共享许可。
- 冲突记忆暂停写入，不让模型自行选择一个版本。
- 用户可以查看和删除保存的个人信息。

### 任务 6.5：聊天后的学习反馈

- 聊天页不显示实时分数和目标句型。
- 用户主动打开“今天聊得怎么样”后，显示 1–3 条代表性反馈。
- 普通聊天只在证据可靠时更新场景、语块、策略和迁移。
- 发音严格评分只在用户选择严格纠音或系统抽样验证时运行。

阶段退出条件：Web 与 Flutter 中的 Lucía 都能通过同一服务端协议连续自然对话、记住已透露信息、避免冲突，并在不教学化的情况下产生可信学习证据。

## 13. 阶段 7：角色扩展、进步展示与 Alpha 完整化

### 任务 7.1：好友介绍机制

- 创建一个兴趣好友和一个生活关系角色。
- Lucía 只有在上下文存在真实理由时提出介绍。
- 用户明确同意后才创建关系和联系人。
- 新角色只获得用户授权共享的最小必要资料。
- 每个角色维护独立关系记忆和揭示状态。

### 任务 7.2：八维能力图

- 当前值与四周前值同时展示。
- 数据不足轴显示“数据积累中”。
- 点击轴可以查看定义、证据数量、口语覆盖和代表性尝试。
- 不显示无法解释到证据的精确小数总分。

### 任务 7.3：学习热力图

- 每个小方块代表一天，颜色表示有效学习时长。
- 有效学习时长排除页面空置、后台挂起和长时间无交互。
- 点击某天显示学习场景、独立表达次数和获得能力。
- 热力图不参与技能评分，不以断签惩罚用户。

### 任务 7.4：隐私与数据控制

#### 任务 7.4a：关系记忆控制

- 查看和删除关系记忆；删除时级联撤销相关角色共享授权。
- 只能访问当前用户自己的记忆；能力证据和画像快照不随记忆删除而改写。
- UI 的不可逆删除操作必须二次确认。

#### 任务 7.4b：语音数据控制

- 查看和删除已保存录音与语音转写；列表排除 `ephemeral` 录音。
- 普通录音在评测完成后删除；里程碑录音只有经用户确认才长期保存。
- 删除转写不修改追加式证据或技能快照；隐私日志不记录完整私密对话和原始录音 URL。

#### 任务 7.4c：账号级数据控制

- 提供账号数据查看/删除入口和服务端 `DELETE /api/v1/me/data`，删除或匿名化顺序必须文档化。
- 删除操作要求重新确认身份，具备幂等、所有权校验和明确结果记录。
- 覆盖账号、训练、画像、关系、对话、记忆和音频相关用户数据；不删除共享内容和人物设定。
- 补齐已保存录音对应 Storage 对象的实际清理，以及清理失败的可恢复记录。

### 任务 7.5：稳定性与可观测性

- **7.5a（已完成）**：在 `shared/observability` 定义关联 ID 与脱敏 provider 观测契约；`provider_calls` 保存请求、会话、尝试、对话、generation、延迟、状态、错误类型和估算成本。发音 application 与聊天流接入可选 observer，观测失败不改变业务结果。
- **7.5b（本切片）**：新增 append-only `diagnostic_events`、四类业务故障事件、dedupe 幂等、内部诊断查询和滑动窗口告警聚合；补充隔离数据库备份/恢复演练步骤与 RPO/RTO 记录模板。
- 记录供应商调用延迟、成功率、错误类型和估算成本。
- 为每个学习会话、尝试和聊天轮建立关联 ID。
- 对异常断流、重复证据、记忆冲突和音频清理失败建立告警。
- 添加数据库备份和恢复演练说明。

### 任务 7.6：完整 Web E2E 与 Flutter 集成测试

Playwright 手机视口覆盖：

1. 注册/登录和选择母语。
2. 初次诊断并建立有限画像。
3. 无学习记录时首页显示“开始第一次练习”；有稳定断点时首页显示“继续学习”。
4. 语音输出和打字降级。
5. 三级提示与自然替代表达。
6. 画像和场景状态更新。
7. 内容包听读写与后续口语验证。
8. Lucía 语音/文字聊天。
9. 好友介绍和授权共享。
10. 刷新、断网、服务失败和恢复。

Flutter integration test 使用 fake 服务覆盖同一关键路径；真实 iOS 录音、权限、键盘和生命周期需要 Mac/Xcode 与 iPhone 验收。

阶段退出条件：角色扩展、进步展示、隐私控制和可观测性模块完成；核心 Alpha 路径具备可验证的预览闭环。发布候选质量和连续真实使用留给阶段 7.7 与阶段 8。

## 13.1：Web UI 设计落地批次（UI-006 至 UI-011）

本组任务承接已确认的 Web UI 方案、W2 网站纯字标和五项导航图标。进入实现后仍遵循“一次只完成一个任务 ID”；每批完成后先跑受影响的局部检查，更新 `PROJECT_STATUS.md`，再开始下一批。手机 App 独立图标不属于本组任务。

### UI-006：设计系统与产品壳层

- **负责人**：Codex；产品本人进行视觉验收。
- **前置依赖**：W2 字标、五项导航语义、编辑式线性图标已确认。
- **范围**：语义颜色、字体、间距、圆角和动效令牌；W2 Logo 在公开首页/桌面侧栏/移动顶部栏的使用；桌面左侧栏、移动底部导航、公开首页顶部导航；头像入口的布局与基础菜单容器；跳过链接、安全区和主题入口。
- **不包含**：手机 App 图标、角色头像重绘、业务数据读取、支付和新的导航项。
- **验收**：五项导航在桌面/移动端可见且当前态一致；所有图标使用统一 SVG 线性规范；Logo 不承担功能按钮；键盘焦点、44px 命中区、深浅色对比度通过检查。

### UI-007：公开首页与登录后学习首页

- **负责人**：Codex；产品本人确认首屏信息层级和文案。
- **前置依赖**：UI-006；推荐器和现有训练断点接口保持不变。
- **范围**：公开首页的 Hero、三类使用场景、工作方式、真实产品片段、隐私/可信度、FAQ 和轻量页脚；登录后 `/learn` 的状态自适应主任务、三个次级入口、文章/关系预览和真实进步摘要。
- **不包含**：新增评分规则、虚构进度、先选时长/模式/内容类型的前置表单。
- **验收**：无记录用户只看到“开始第一次练习”；断点用户进入稳定位置并显示真实进度；没有硬编码 `1 / 4`、空热力图或最近能力；每页只有一个视觉同权主 CTA；所有辅助卡片都有真实路由或明确空状态。

### UI-008：探索与对话工作区

- **负责人**：Codex；产品本人进行角色关系和视觉语气验收。
- **前置依赖**：UI-006；沿用现有内容包、消息流和角色权限 application。
- **范围**：探索页的沟通目标/内容包分组、未发布状态、内容卡片；对话联系人、Lucía 置顶关系、好友介绍请求、消息流和语音/文字 composer 的统一视觉状态。
- **不包含**：开放社交网络、实时双向通话、新角色商城、改变消息协议或记忆权限。
- **验收**：内容整理中不是假按钮；发送、停止、断流、重试和 `done` 状态可观察；自然聊天不显示实时分数；好友介绍接受/拒绝结果明确且遵守共享授权。

### UI-009：阅读库与规范化阅读器

- **负责人**：Codex；产品本人确认文章密度、阅读节奏和辅助工具位置。
- **前置依赖**：READ-001 至 READ-005 的内容/版权契约；UI-006。
- **范围**：`/read` 书架、继续阅读、主题/筛选、真实搜索结果、文章卡片、文章阅读器、阅读进度、TTS、词语辅助、高亮、保存短语、个人笔记和可选口语迁移入口。
- **不包含**：未经授权复制全文、任意 URL/RSS/Newsletter 导入、把阅读或打字直接写入口语证据。
- **验收**：只展示已发布且版权字段完整的文章；刷新和断网可恢复断点；文章版本迁移不静默覆盖标注；跳过口语迁移不显示失败、不产生能力证据。

### UI-010：我的进步与隐私控制

- **负责人**：Codex；产品本人确认数据解释和删除语气。
- **前置依赖**：UI-006；沿用 profile、memory、media 和 account data application。
- **范围**：能力总览、八维图、证据详情、有效活动热力图、关系记忆、保存语音/转写、数据导出/删除、头像菜单到完整“我的”页面的入口关系。
- **不包含**：重新定义 mastery/confidence、修改追加式证据、删除共享内容或改变 RLS。
- **验收**：数据不足显示解释性空状态；掌握度、可信度、口语覆盖和时长不混淆；删除操作二次确认、结果明确、失败可重试；只读取当前用户数据。

### UI-011：跨视口、可访问性与行为回归

- **负责人**：Codex；产品本人进行预览/人工路径复核。
- **前置依赖**：UI-006 至 UI-010 全部完成。
- **范围**：320/375/414/768/1024/1440px 视口检查、键盘和屏幕阅读器语义、深浅色主题、`prefers-reduced-motion`、加载/空/错误/恢复状态、所有 visible action 的 Playwright/RTL 回归。
- **不包含**：用快照替代行为断言、真实收费供应商、iOS 真机编译或 App 图标验收。
- **验收**：没有横向滚动、遮挡或假按钮；主流程和失败恢复可完成；关键 E2E、`pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:e2e` 和 `pnpm build` 按受影响范围通过。

### 批次顺序与停点

推荐顺序为 **UI-006 → UI-007 → UI-008 → UI-009 → UI-010 → UI-011**。每个批次结束后暂停，由产品本人确认视觉和行为，再领取下一任务；若发现跨模块依赖，先记录阻塞，不把后续任务顺手并入当前批次。

## 14. 阶段 7.7：Alpha 功能缺口收敛与发布候选准备

阶段 8 不在当前开发阶段启动。先完成以下发布候选准备任务，并逐项建立独立任务记录：

### 任务 7.7a：功能缺口盘点与任务拆分

- 对照产品设计、Alpha 范围和当前实现逐项盘点，不以页面可访问或局部测试通过替代功能完成。
- 把缺失功能、已知 bug、跨端语义差异和不诚实空状态拆成独立任务 ID，明确依赖、验收和回归测试。
- 优先处理核心训练、初次诊断、阅读、对话、画像和隐私数据路径；不提前引入 Alpha 延后范围。

### 任务 7.7b：核心路径与跨端闭环

- 补齐响应式 Web/PWA 的核心用户路径，包括初次诊断、断点恢复、训练反馈、阅读状态、场景实战、角色对话和数据控制。
- 服务端继续作为证据、画像、关系记忆和权限的权威来源；客户端缓存只能作为离线恢复手段。
- 对未完成的 provider、数据库/RLS 和内容发布依赖提供明确的可恢复错误，不伪造成功状态。

### 任务 7.7c：缺陷收敛与质量门禁

- 修复阻塞级和高优先级流程、状态机、取消/竞态、数据隔离、证据污染和角色一致性问题。
- 清理既有回归失败和测试 fixture 漂移；并行资源不足时使用单 worker 定位，但发布候选仍需完成全量门禁。
- 更新受影响的单元、集成、Playwright 和数据库/RLS 测试，不用快照替代行为断言。

### 任务 7.7d：发布候选验收准备

- 形成可部署的候选版本，完成 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:e2e` 和 `pnpm build`。
- 使用真实 iPhone Safari 补做麦克风、键盘、安全区、音频生命周期和 PWA 主屏关键路径。
- 确认真实 provider、数据库/RLS、内容版权、隐私日志和数据删除策略的验收条件；没有凭据或授权时保持明确阻塞，不上传真实音频或视频。

### 阶段 7.7 退出条件

- 已批准的 Alpha 功能没有未记录的缺口，核心路径可以从入口走到完成或可恢复失败。
- P0/P1 缺陷清零；关键数据隔离、证据、记忆和角色安全不变量有自动化回归。
- 全量质量门禁通过，或每个未通过项都有明确的发布阻断记录和负责人。
- 产品本人确认版本达到“可以开始连续真实使用”的候选状态。

### 2026-09-11 当前优先切片：场景学习闭环

当前先把探索页改造成可用的场景与表达库，并交付“获取表达 → 临时人物实战 → 完整复盘 → 间隔复现”的 Web/PWA 闭环。建议任务为：

1. `SCN-001`：领域状态机、数据迁移、API 契约、Provider Router 和 fake。
2. `SCN-002`：餐厅点餐的文字/语音纵向闭环。
3. `SCN-003`：探索场景库、搜索、分类、生成及阅读/收藏/错误来源。
4. `SCN-004`：完整复盘、历史、当天/1/3/7 天复现和学习页推荐。
5. `SCN-005`：Provider 设置、切换、iPhone Safari/PWA 真机收敛和发布门禁。

任务的逐文件步骤、测试命令和提交边界在书面规格复核后写入独立实施计划。长期 AI 角色仍是主要功能，但回复自然度、Provider、记忆和其他角色作为后续独立设计流，不混入上述场景任务。

## 15. 阶段 8：个人 Alpha 验证

### 15.1 使用周期

- 连续体验 3–4 周。
- 至少 12 次核心训练。
- 至少 8 次 Lucía 或其他角色聊天。
- 同时覆盖碎片时间和完整学习。
- 至少两次在不方便发声时使用静默模式，并在之后完成口语复核。

### 15.2 每次使用后的轻量记录

只记录对迭代有用的信息：

- 今天是否愿意继续聊或继续练。
- 哪个步骤显得死板或多余。
- 哪条反馈不可信，以及原因。
- 哪个现实表达后来真正说出来了。
- 是否清楚知道当前问题和下一步。
- 是否出现人物冲突、教学腔或不真实的地点信息。

### 15.3 周度复盘

- 对比代表性任务的开口反应时间。
- 抽样复测已经标记“可以应对”的能力。
- 检查八维画像是否与主观感受和录音证据一致。
- 检查推荐是否过度重复、难度跳跃或忽略口语覆盖。
- 检查与 Lucía 的聊天是否形成共同经历，而不是重复寒暄。

### 15.4 Alpha 退出标准

进入封闭 Beta 前必须满足：

- 至少两项能力提升可通过再次测试复核。
- 技术失败没有产生错误扣分。
- 关键能力状态可以追溯到代表性证据。
- Lucía 没有严重人物事实冲突或隐私泄漏。
- 用户在没有打卡惩罚的情况下仍主动打开产品。
- 主要阻塞和高频不自然体验已有明确修复方案。

## 16. 阶段 9（后续路线）：用户好友与 1 对 1 私信

本阶段位于阶段 8 个人 Alpha 验证之后，不属于当前 Alpha，也不进入 `ALPHA-033`。只有阶段 8 结束并决定继续扩大用户规模后，才建立独立设计和实施任务。

### 目标与第一版范围

- 用户可以通过用户名或邀请链接向另一位用户发送好友申请。
- 对方明确接受后建立好友关系，并开放双方 1 对 1 文字私信。
- 支持拒绝申请、删除好友、拉黑和举报；不做公开动态、群聊、随机匹配、语音社交或开放社交广场。
- 不通过邮箱搜索暴露用户是否注册；发现和邀请入口必须有隐私可控的限流策略。

### 数据与隐私边界

- 用户好友关系、AI 角色关系、学习画像和训练证据分开存储，不能复用角色关系记忆表表达用户关系。
- 默认不向其他用户共享掌握度、可信度、证据、关系记忆、录音、转写或完整学习对话。
- 好友消息只在双方关系成立且通过服务端所有权/RLS 检查后可读写；删除、拉黑和账号删除必须有明确的级联或匿名化策略。
- 所有好友申请、关系变更和消息发送都必须幂等，并记录可脱敏的安全审计事件。

### 后续任务拆分

1. 关系模型、申请状态机、好友权限和隐私设置。
2. 用户发现、邀请链接、申请/接受/拒绝/删除/拉黑/举报流程。
3. 1 对 1 文字消息、未读状态、撤回/删除和离线恢复。
4. 内容举报、滥用防护、限流、封禁、消息保留和账号删除策略。
5. Web/Flutter API 契约、RLS、幂等、竞态、跨端和关键路径测试。

### 阶段退出条件

- 双方同意前不能互发私信或读取对方私有资料。
- 用户无法通过好友功能读取或推断另一用户的学习证据、画像和 AI 关系记忆。
- 删除、拉黑、举报、撤回和账号删除路径可恢复、可审计且有自动化测试。
- 通过独立的隐私/滥用评审和跨端发布门禁后，才扩大到更多用户。

## 17. 质量门禁

### 每个代码任务

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
```

只运行与改动相关的测试可以用于开发过程，但合并阶段必须覆盖受影响模块。

涉及 Flutter 客户端的任务同时运行：

```powershell
flutter analyze
flutter test
```

在 Windows 上通过以上命令不能替代 iOS 编译、签名和真机测试。

### 跨模块或发版候选

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:e2e
pnpm build
```

数据库变更还必须执行：

- 迁移从空库完整运行。
- 迁移从上一版本升级。
- RLS 隔离测试。
- 内容导入幂等测试。

## 18. 风险与控制

| 风险 | 控制方式 |
|---|---|
| 语音转写误差导致错误反馈 | 置信度门槛、重说请求、技术失败不扣分、固定音频契约集 |
| LLM 把自然替代表达判错 | 语境任务 rubric、结构化输出、规则后处理、人工回放集 |
| 画像看似精确但证据不足 | mastery/confidence 分离、口语覆盖、代表性证据、数据不足状态 |
| AI 好友出现教学腔 | 回复计划先回应关系和情绪，教学机会为次级；角色质量评测 |
| 人物或记忆冲突 | 版本化人物圣经、揭示状态、候选记忆冲突检查 |
| 真实地点信息幻觉 | 地点适配器、来源字段、无法验证则只给一般建议 |
| 音频和私密对话泄漏 | 短期签名 URL、最小日志、自动删除、RLS、用户删除入口 |
| Alpha 规模膨胀 | 每阶段退出条件；延后清单不得因“顺手”进入当前任务 |
| Web 与 Flutter 语义漂移 | 版本化 API Schema、共同 JSON fixtures、服务端最终校验 |
| 没有 Mac 导致 iOS 问题延迟发现 | 明确 iOS 未验证状态；尽早准备 Mac/Xcode 或云端构建，音频阶段前完成真机条件 |
| 参考项目许可证污染 | 默认只参考原则；实际复用前记录作者授权、文件范围、其他贡献者权利和发布义务 |

## 19. 首批可执行任务顺序

开发开始时按以下顺序领取任务，每次只执行一个可验证切片：

1. 创建 Next.js/PWA 脚手架和质量脚本。已完成。
2. 创建 Flutter 客户端，并在 Web 与 Flutter 同步建立五项产品壳层和“继续学习”静态首页。
3. 建立版本化 API Schema、稳定错误码和首批跨语言 JSON fixtures。
4. 配置 Supabase、Drizzle 和第一版迁移。
5. 实现邮箱认证、Flutter 移动会话和 RLS 隔离测试。
6. 定义内容 Zod Schema、Dart DTO 生成/校验和幂等导入器。
7. 导入 8–12 条最小核心表达用于开发。
8. 实现 TypeScript/Dart 训练编排器及共同样本测试。
9. 用 fake 评估器在 Web 与 Flutter 接通第一个 3–5 条表达微循环。
10. 添加断点保存和恢复。
11. 接入浏览器与 Flutter TTS、录音和打字降级。
12. 选择并接入首个 STT 供应商适配器。
13. 写入第一条真实证据并更新技能快照。
14. 按 READ-001 至 READ-005 建立文章内容契约、阅读书架、规范化阅读器和可选口语迁移；先使用可核验版权来源，不实现任意网页导入。
15. 完成 `ALPHA-033`（阶段 7.7）功能缺口收敛、跨端闭环、缺陷修复和发布候选门禁。
16. 阶段 8：仅在发布候选门禁通过且产品本人确认后，开始 3–4 周个人 Alpha 连续使用与人工复核。
17. 阶段 9：在阶段 8 完成并决定扩大用户规模后，另行设计和实施用户好友与 1 对 1 私信。

完成第 13 项后进行第一次产品体验复盘，再决定语音评测供应商和后续优先级。进入 iOS 录音验收前必须准备 Mac/Xcode 或可持续的云端 macOS 构建与真机调试方案。
