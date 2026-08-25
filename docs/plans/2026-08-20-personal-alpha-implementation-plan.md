# 西班牙语沉浸式口语平台：个人 Alpha 实施计划

- 日期：2026-08-20
- 依据：[产品设计规范](../superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- 参考：[Echo-Loop 参考评审](../references/echo-loop-review.md)
- 实施对象：Next.js 完整 Web/PWA + Flutter iOS 客户端同步 Alpha
- 技术路线：Next.js、React、TypeScript、Flutter、Dart、Tailwind CSS、Supabase、Drizzle、Zod、Vercel
- 多平台依据：[Web 与 Flutter 多平台架构设计](../superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md)

## 1. 实施目标

个人 Alpha 的目标不是一次完成完整商业产品，而是用本人连续 3–4 周的真实使用验证四项核心假设：

1. 围绕交际目标训练，比看课、背句子和机械跟读更容易形成可独立调用的表达。
2. 语境成功、提示依赖和输出方式可以形成可信、可解释的学习画像。
3. Lucía 作为长期好友能让用户主动继续对话，而不是只完成练习任务。
4. “继续学习”单入口、自然停止点和断点续学能同时适应碎片时间与完整学习。

Alpha 完成时必须能够走通：

> 登录 → 初次诊断 → 继续学习 → 听/说或静默训练 → 反馈 → 画像更新 → Lucía 对话 → 关系记忆 → 再次打开恢复与推荐

这条路径必须在 Next.js Web 和 Flutter 客户端使用同一服务端数据走通；iOS 平台专属录音与生命周期验收在 Mac/Xcode 条件具备后补充为发布门禁。

## 2. 范围

### 2.1 必须完成

- 简体中文界面，数据结构支持多母语。
- 40–60 条审核后的核心口语表达。
- 8–12 个原创或开放许可的沉浸式内容包。
- 八类通用沟通能力与八维技能画像。
- Web 浏览器 TTS/录音与 Flutter 平台语音接口、录音上传、语音转写和基础发音信号。
- 自主开口、打字替代、三级提示、变式迁移和抽样复核。
- 追加式学习证据、技能快照、场景状态和推荐器。
- Lucía 私信、语音优先输入、长期关系记忆和自然反馈入口。
- 两个可被介绍的新角色及用户同意流程。
- Codeforces/GitHub 式有效学习热力图和八维能力图。
- 手机端 PWA 与 Flutter iOS 客户端、错误降级、隐私设置、基本可观测性和部署。
- 版本化 API 契约与 TypeScript/Dart 共同读取的一致性样本。

### 2.2 明确延后

- 支付、订阅和配额商业规则。
- 完整可视化内容后台。
- 实时双向语音通话。
- 大规模角色网络或角色商城。
- Android、Windows、macOS 的商店发布与完整平台打磨。
- 用 SwiftUI/UIKit 重写 Flutter 主要页面。
- 独立微服务、复杂消息队列和离线 ASR。
- 未经授权的外刊全文导入。

## 3. 工程原则

1. **领域先于页面**：训练、证据、画像、推荐、角色和记忆先定义纯逻辑与接口，页面只组合能力。
2. **单一事实来源**：服务端数据库是学习证据、画像和关系记忆的权威来源。
3. **事件与快照分离**：原始证据只追加，技能状态可以重算。
4. **异步可取消、可幂等**：录音、转写、评分和聊天都必须防止旧回调污染新状态。
5. **技术失败不扣能力分**：低置信度转写、服务失败和权限问题只能降低证据可信度。
6. **自然表达优先**：评估语境成功，不要求复现唯一答案。
7. **先做可解释规则**：Alpha 不使用难以校准的黑箱总分替代业务规则。
8. **纵向切片交付**：每个阶段都要形成可以亲自体验的路径，不连续数周只建设底层。
9. **跨端共享语义而非 UI**：Web 与 Flutter 共享 API、内容和一致性样本，页面分别实现。
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
  mobile/                 # Flutter 客户端；iOS Alpha，未来四平台共用
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
| 1 | 可部署的 Web/PWA 与 Flutter 客户端骨架 | 阶段 0 |
| 2 | 数据库、认证、RLS 和内容导入 | 阶段 1 |
| 3 | 可恢复的训练闭环 | 阶段 2 |
| 4 | 语音、评估、证据和画像 | 阶段 3 |
| 5 | 首页推荐与沉浸内容包 | 阶段 4 |
| 6 | Lucía 对话与长期记忆 | 阶段 2、4 |
| 7 | 新角色、进步展示与完整 Alpha | 阶段 5、6 |
| 8 | 3–4 周个人验证与迭代 | 阶段 7 |

阶段 3 后已经可以开始每日体验核心训练；不必等待 AI 好友完成。

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

- 底部四栏：学习、探索、对话、我的。
- 学习首页只有一个主动作“继续学习”。
- Web 与 Flutter 页面都必须有加载、空、失败和离线提示状态。
- 不提前加入课程模式、学习时长和难度选择器。
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

阶段退出条件：手机浏览器可安装；Web 与 Flutter 四个主页面可导航；Vercel 预览部署成功；Flutter 静态分析和测试通过。iOS 编译、签名和真机音频验收等待 Mac/Xcode 环境。

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

输出始终包含一个首选动作和一句可解释原因。探索页可以浏览其他内容，但首页不展示候选列表。

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
- 记录供应商调用延迟、成功率、错误类型和估算成本。
- 为每个学习会话、尝试和聊天轮建立关联 ID。
- 对异常断流、重复证据、记忆冲突和音频清理失败建立告警。
- 添加数据库备份和恢复演练说明。

### 任务 7.6：完整 Web E2E 与 Flutter 集成测试

Playwright 手机视口覆盖：

1. 注册/登录和选择母语。
2. 初次诊断并建立有限画像。
3. 首页继续学习。
4. 语音输出和打字降级。
5. 三级提示与自然替代表达。
6. 画像和场景状态更新。
7. 内容包听读写与后续口语验证。
8. Lucía 语音/文字聊天。
9. 好友介绍和授权共享。
10. 刷新、断网、服务失败和恢复。

Flutter integration test 使用 fake 服务覆盖同一关键路径；真实 iOS 录音、权限、键盘和生命周期需要 Mac/Xcode 与 iPhone 验收。

阶段退出条件：完整 Alpha 路径在预览和生产环境均通过；没有已知的数据隔离或证据污染问题。

## 14. 阶段 8：个人 Alpha 验证

### 14.1 使用周期

- 连续体验 3–4 周。
- 至少 12 次核心训练。
- 至少 8 次 Lucía 或其他角色聊天。
- 同时覆盖碎片时间和完整学习。
- 至少两次在不方便发声时使用静默模式，并在之后完成口语复核。

### 14.2 每次使用后的轻量记录

只记录对迭代有用的信息：

- 今天是否愿意继续聊或继续练。
- 哪个步骤显得死板或多余。
- 哪条反馈不可信，以及原因。
- 哪个现实表达后来真正说出来了。
- 是否清楚知道当前问题和下一步。
- 是否出现人物冲突、教学腔或不真实的地点信息。

### 14.3 周度复盘

- 对比代表性任务的开口反应时间。
- 抽样复测已经标记“可以应对”的能力。
- 检查八维画像是否与主观感受和录音证据一致。
- 检查推荐是否过度重复、难度跳跃或忽略口语覆盖。
- 检查与 Lucía 的聊天是否形成共同经历，而不是重复寒暄。

### 14.4 Alpha 退出标准

进入封闭 Beta 前必须满足：

- 至少两项能力提升可通过再次测试复核。
- 技术失败没有产生错误扣分。
- 关键能力状态可以追溯到代表性证据。
- Lucía 没有严重人物事实冲突或隐私泄漏。
- 用户在没有打卡惩罚的情况下仍主动打开产品。
- 主要阻塞和高频不自然体验已有明确修复方案。

## 15. 质量门禁

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

## 16. 风险与控制

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

## 17. 首批可执行任务顺序

开发开始时按以下顺序领取任务，每次只执行一个可验证切片：

1. 创建 Next.js/PWA 脚手架和质量脚本。已完成。
2. 创建 Flutter 客户端，并在 Web 与 Flutter 同步建立四栏产品壳层和“继续学习”静态首页。
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

完成第 13 项后进行第一次产品体验复盘，再决定语音评测供应商和后续优先级。进入 iOS 录音验收前必须准备 Mac/Xcode 或可持续的云端 macOS 构建与真机调试方案。
