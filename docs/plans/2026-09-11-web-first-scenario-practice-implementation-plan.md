# Web/PWA 场景学习闭环实施计划

- 日期：2026-09-11
- 状态：产品本人已批准；`SCN-001` 实施中
- 上层任务：`ALPHA-033`
- 设计依据：[Web 优先的个人学习产品与场景实战设计](../superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)
- 架构依据：[个人 Alpha Web/PWA 架构边界](../architecture.md) 与 [ADR-0002](../adr/0002-web-pwa-first-personal-alpha.md)
- 活动客户端：Next.js 响应式 Web/PWA；桌面浏览器与 iPhone Safari

## 1. 目标

在不改造长期 AI 角色系统的前提下，把探索页变成可用的场景与表达库，并交付以下日常学习闭环：

> 获取场景句 → 试听与准备 → 临时人物多轮实战 → 条件变化 → 完整对话复盘 → 当天/1/3/7 天换条件复现

最快可用停点是 `SCN-002`：完成后，即使搜索、生成、历史和复现尚未全部扩展，用户也能在桌面或 iPhone Safari 完成一个真实的“餐厅点餐”文字/语音场景并获得基础完整复盘。

## 2. 执行规则

- 一次只领取一个 `SCN-*` 任务 ID；一个分支只处理该任务。
- 每个任务先写失败测试，再实现最小通过路径，最后整理重复代码。
- Route Handler 只负责认证、Zod 校验、application 调用和协议转换。
- `scenario-practice/domain` 不依赖 React、Next.js、Drizzle、Supabase 或供应商 SDK。
- 默认测试只使用 fake Provider，不触发真实收费调用。
- 临时人物不能写入 `characters`、`conversations`、`character_relationships` 或关系记忆。
- 用户完整表达前不显示纠错；自然替代表达可以完成沟通目标。
- 没有 `done` 的流不能持久化为完整临时人物轮次。
- 低置信度转写、打字和技术失败不能污染口语证据。
- 普通录音处理、取消、超时或离开页面后删除并释放资源。
- 每个任务实现提交后，以单独文档提交更新 `PROJECT_STATUS.md`，记录实现 Commit、测试、限制和下一项；只推送本任务明确分支，不顺带推送当前协调分支的大量既有提交。

## 3. 依赖与分支

| 顺序 | 任务 | 建议分支 | 依赖 | 用户可见结果 |
| --- | --- | --- | --- | --- |
| 1 | `SCN-001` 场景领域与持久化基础 | `codex/scn-001-scenario-foundation` | 设计规格批准 | 可测试的状态机、表、契约和 Provider 端口 |
| 2 | `SCN-002` 餐厅点餐纵向闭环 | `codex/scn-002-restaurant-vertical` | SCN-001 | 第一个可日常使用的详情、实战和基础复盘 |
| 3 | `SCN-003` 场景与表达库 | `codex/scn-003-scenario-library` | SCN-001、SCN-002 的 UI 边界 | 搜索、分类、收藏、生成和多来源进入 |
| 4 | `SCN-004` 历史、复盘与间隔复现 | `codex/scn-004-review-repetition` | SCN-002、SCN-003 | 完整复盘、历史和学习页到期任务 |
| 5 | `SCN-005` Provider 与 iPhone 收敛 | `codex/scn-005-provider-pwa-hardening` | SCN-002 至 SCN-004 | Provider 选择/切换与 iPhone Safari 发布门禁 |

协调者在开始 `SCN-001` 前，应先把本设计与计划提交纳入目标基线，并在 `PROJECT_STATUS.md` 将该任务从 `ready` 改为 `in_progress`。不得在当前 `fix/login-redirect-after-otp` 分支上顺手实现五个任务。

## 4. SCN-001：场景领域、数据与 Provider 端口

### 4.1 目标

建立不依赖 UI 和真实供应商的场景实战核心：状态机、实体、持久化、RLS、基础 API DTO、Provider 专用接口、路由选择规则和固定测试样本。

### 4.2 先写测试

新增：

- `tests/unit/scenario-practice-engine.test.ts`
- `tests/unit/scenario-repetition-schedule.test.ts`
- `tests/unit/scenario-provider-router.test.ts`
- `tests/database/scenario-practice-persistence.test.ts`
- `tests/database/scenario-practice-rls.test.ts`
- `tests/contracts/scenario-practice-contract.test.ts`
- `contracts/fixtures/scenario-practice/v1/manifest.json`
- `contracts/fixtures/scenario-practice/v1/scenario-transitions.json`

必须先覆盖：

1. 等待表达、录音、转写、确认、提交、人物回复、暂停、错误、完成和复盘状态转换。
2. 非法事件不改变状态；旧 `generationId` 返回 stale；旧 `expectedRevision` 返回冲突。
3. 三级提示只能增加，不能通过恢复或重试降低。
4. 没有 `done` 的人物回复不进入 completed turn。
5. 当天、1、3、7 天计划使用注入时钟计算，重复完成请求保持幂等。
6. 两个 fake Provider 的首选、未配置、一次 fallback、取消和“已经产生 delta 后禁止切换”。
7. 用户 A 不能读取或修改用户 B 的收藏表达、私人场景、会话、轮次、复盘、复现或 Provider 偏好。
8. 删除账号级 profile 后私人场景数据级联删除，`provider_calls` 按现有策略去标识化。

### 4.3 领域与 application

新增目录：

```text
src/modules/scenario-practice/
  domain/
    scenario-practice-state.ts
    scenario-practice-event.ts
    scenario-practice-engine.ts
    scenario-model.ts
    repetition-schedule.ts
    index.ts
  application/
    create-session.ts
    restore-session.ts
    submit-turn.ts
    complete-session.ts
    index.ts
  repositories/
    scenario-practice-repository.ts
    drizzle-scenario-practice-repository.ts
    index.ts
  schemas/
    scenario-practice.ts
    index.ts
  index.ts
```

状态机 effect 只描述意图，例如 `persistCheckpoint`、`startRecording`、`requestTranscription`、`persistUserTurn`、`requestRoleplayReply`、`requestEvaluation`、`finalizeSession`。浏览器适配器或 application 执行 effect 后再送回事件。

`submit-turn` 必须先幂等保存用户完整文字轮次，再允许人物 Provider 调用。`complete-session` 只冻结会话；本任务不写学习证据，也不实现页面。

### 4.4 数据库

新增：

- `src/shared/db/schema/scenario-practice.ts`
- 修改 `src/shared/db/schema/index.ts`
- 通过 `pnpm db:generate` 生成下一条版本化迁移及 snapshot

表：

- `user_saved_expressions`
- `personal_scenarios`
- `scenario_session_states`
- `scenario_turns`
- `scenario_turn_reviews`
- `scenario_repetition_items`
- `user_provider_preferences`

最低约束：

- 每张用户私有表都有 `user_id` 和索引。
- `(user_id, client_attempt_id)`、轮次位置、复现幂等键和能力 Provider 偏好建立唯一约束。
- `scenario_turns.status` 明确区分 pending、completed、stopped、failed。
- `scenario_session_states.revision` 为正数并通过 compare-and-swap 更新。
- 复盘只关联用户 completed turn。
- Provider 偏好只保存内部 capability/provider key，不保存密钥。
- RLS 默认拒绝，浏览器不能直接写证据、画像、关系记忆或 `provider_calls`。

先用隔离数据库验证空库迁移和上一版本升级；没有有效 `DATABASE_URL` 时只运行 schema/drift 检查并诚实记录未执行项。

### 4.5 Provider 端口与路由

新增：

```text
src/modules/providers/scenario-generation/
src/modules/providers/scenario-roleplay/
src/modules/providers/scenario-evaluation/
src/modules/providers/routing/scenario-provider-router.ts
```

每个能力目录包含内部输入/输出 DTO、统一错误、接口和 deterministic fake。Provider 输入不得接受未经 application 过滤的数据库行。

路由器输入为 capability、用户偏好和已配置 Provider 注册表；输出为本次确定的 Provider 或稳定错误。SCN-001 只实现 fake 注册表和规则，不接真实厂商。

### 4.6 契约与错误码

修改：

- `contracts/registry/v1/error-codes.json`
- `contracts/openapi/v1/openapi.json`
- `src/shared/contracts/v1/api-contract.ts`

先增加核心 DTO 与稳定错误码：

- `SCENARIO_SESSION_NOT_FOUND`
- `SCENARIO_SESSION_CONFLICT`
- `SCENARIO_TURN_CONFLICT`
- `SCENARIO_REPLY_INCOMPLETE`
- `SCENARIO_REVIEW_PENDING`
- `PROVIDER_NOT_CONFIGURED`

错误响应继续使用现有 `apiVersion/error/requestId/retryable` 结构。输入和响应 Schema 禁止额外字段，避免客户端伪造评估、证据或角色记忆字段。

### 4.7 验证与提交

运行：

```powershell
pnpm exec vitest run tests/unit/scenario-practice-engine.test.ts tests/unit/scenario-repetition-schedule.test.ts tests/unit/scenario-provider-router.test.ts
pnpm exec vitest run tests/contracts/scenario-practice-contract.test.ts
pnpm exec vitest run tests/database/scenario-practice-persistence.test.ts tests/database/scenario-practice-rls.test.ts
pnpm db:check
pnpm lint
pnpm typecheck
git diff --check
```

建议实现提交：`feat: add scenario practice foundation`

完成标准：领域、迁移、RLS、契约和 fake 全部可独立测试；没有页面、真实 Provider 调用或长期角色数据写入。

## 5. SCN-002：餐厅点餐可用纵向闭环

### 5.1 目标

交付第一个可实际学习的场景：选择“点餐与饮食限制”的表达，在临时服务员 Marina 的多轮对话中处理点单、过敏与缺货，结束后看到完整文字对话和基础逐条反馈。

### 5.2 内容

新增独立版本化内容源：

- `content/bundles/scenario-practice-alpha-v1.json`
- 对应内容校验测试

内容至少包含：

- 点主菜、询问配料/过敏原、接受替代三个沟通目标。
- `Quería pedir...`、`¿Lleva...?`、`Soy alérgico/a a...`、`¿Qué me recomienda?`、`Entonces, tomaré eso.` 等表达及自然变体。
- 三级提示、可替换槽位、语气说明和“菜品售完”条件变化。
- 原创/许可、版本和 `codex-ai-temporary-review` 标记；不能假称母语者审核。

先运行内容校验，再考虑导入；校验失败不得部分写入。

### 5.3 真实 Provider 适配器

在 SCN-001 端口下新增 MiniMax 场景适配器：

- `src/modules/providers/scenario-roleplay/minimax-scenario-roleplay.ts`
- `src/modules/providers/scenario-evaluation/minimax-scenario-evaluation.ts`
- 对应 `server.ts` 导出

Roleplay 输入只含场景快照、临时人物、已完成轮次、当前目标和条件变化，不含长期角色记忆。Evaluation 返回结构化沟通成功、错误 spans、原因、自然替代表达和置信度；它不直接写证据。

Provider 未配置或失败时显示可恢复错误，不使用生产 deterministic fake 冒充成功。异常断流不保存半条人物回复。

### 5.4 API 与 application 编排

新增 application：

- `get-scenario-detail.ts`
- `stream-scenario-reply.ts`
- `evaluate-scenario-turn.ts`
- `get-session-review.ts`

新增 Route Handlers：

```text
app/api/v1/scenarios/[scenarioId]/route.ts
app/api/v1/scenario-practice/sessions/route.ts
app/api/v1/scenario-practice/sessions/[sessionId]/route.ts
app/api/v1/scenario-practice/sessions/[sessionId]/turns/route.ts
app/api/v1/scenario-practice/sessions/[sessionId]/turns/[turnId]/respond/route.ts
app/api/v1/scenario-practice/sessions/[sessionId]/turns/[turnId]/evaluate/route.ts
app/api/v1/scenario-practice/sessions/[sessionId]/complete/route.ts
app/api/v1/scenario-practice/sessions/[sessionId]/review/route.ts
```

新增相应请求/响应/流帧 JSON Schema，并注册到 OpenAPI。流至少包含 `meta`、`delta`、可选 `condition`、`done` 或稳定 `error`。

编排顺序：

1. 创建会话时冻结内容版本和临时人物快照。
2. 文字或确认后的转写以 `attemptId` 幂等保存为用户 completed turn。
3. 回复流只有收到 `done` 且通过范围门禁后，才原子保存人物 completed turn。
4. 评估独立执行，不阻塞下一轮；关闭页面时保持 pending，结束实战时同步补试一次。
5. 结束请求冻结对话；如果仍无法评估，复盘明确显示待补充，不写负面证据。

### 5.5 Web 与 iPhone 页面

新增：

```text
app/(product)/explore/scenarios/[scenarioId]/page.tsx
app/(product)/explore/scenarios/[scenarioId]/practice/page.tsx
app/(product)/explore/scenarios/[scenarioId]/review/page.tsx
src/modules/scenario-practice/ui/scenario-detail.tsx
src/modules/scenario-practice/ui/scenario-practice-workbench.tsx
src/modules/scenario-practice/ui/scenario-basic-review.tsx
```

修改：

- `app/(product)/explore/page.tsx`
- `app/(product)/explore/explore-page-content.tsx`
- `app/globals.css`

Explore 先增加一个真实可进入的餐厅场景入口。详情页支持试听、表达选择和开始实战；实战页支持临时人物、多轮对话、三级提示、条件变化、暂停和恢复；基础复盘保存完整文字对话并把反馈放在原句下面。

iPhone 底栏固定为“表达｜按住说话｜键盘”，键盘位于右侧。触控区不少于 44px，保留 `env(safe-area-inset-bottom)`，键盘弹出时不允许整个页面横向或垂直跳出可恢复区域。

语音复用现有 `browser-recorder.ts` 与 `/api/v1/transcriptions`：录音在内存中处理，转写可编辑确认后才提交。TTS 不可用只影响试听；麦克风拒绝立即切换文字。

### 5.6 测试

新增：

- `tests/contracts/scenario-roleplay-provider-contract.test.ts`
- `tests/contracts/scenario-evaluation-provider-contract.test.ts`
- `tests/unit/scenario-routes.test.ts`
- `tests/unit/scenario-practice-workbench.test.tsx`
- `tests/e2e/scenario-practice.spec.ts`

重点断言：

- 用户说话和转写确认期间不出现纠错。
- 自然替代表达可以完成目标；错误说明明确“是否影响理解”。
- 条件变化只触发一次，不能由 Provider 随意改变目标完成状态。
- 中止/断流保留用户原句，重试不复制轮次。
- 刷新恢复到上一个稳定断点，不重放录音或旧请求。
- 390px 和桌面视口无横向溢出，底栏不遮挡最后消息。

运行相关 Vitest、两类 Provider 契约、场景 Playwright、内容校验、lint、typecheck 和 `git diff --check`。如涉及迁移联调，再运行数据库测试和 `pnpm db:check`。

建议实现提交：`feat: add restaurant scenario practice`

## 6. SCN-003：场景与表达库、搜索和生成

### 6.1 目标

把 `/explore` 从内容包列表升级为日常可用的场景与表达库，支持搜索、分类、收藏，以及从主题、阅读、收藏表达和最近错误生成私人场景。

### 6.2 收藏表达

新增 application、repository API 和 Route Handlers：

```text
src/modules/scenario-practice/application/list-saved-expressions.ts
src/modules/scenario-practice/application/save-expression.ts
src/modules/scenario-practice/application/delete-saved-expression.ts
app/api/v1/expressions/saved/route.ts
app/api/v1/expressions/saved/[savedExpressionId]/route.ts
```

保存来源使用服务端可验证引用：正式 expression key/version、当前用户 reading highlight ID、当前用户 scenario review ID 或手工输入。阅读选区、错误原句和翻译只返回给拥有者。收藏行为不产生学习证据。

### 6.3 私人场景生成

新增：

- `src/modules/providers/scenario-generation/minimax-scenario-generation.ts`
- `src/modules/scenario-practice/application/generate-personal-scenario.ts`
- `app/api/v1/scenarios/route.ts`
- `app/api/v1/scenarios/generate/route.ts`
- 生成请求、列表、详情响应 Schema 与 OpenAPI 路径

输入只接受主题文本或用户拥有的来源 ID，不接受客户端伪造的全文/错误评分作为权威来源。application 读取并最小化来源内容，调用 Provider，验证沟通目标、表达、提示、条件变化和临时人物 Schema，再以幂等事务写入 `personal_scenarios`。

同一 `Idempotency-Key` 加同一规范化输入返回同一结果；同键不同输入返回 409。无效 Provider 输出不保存半个场景。生成内容保持私人 draft，可立即学习，但不进入公共内容 API。

### 6.4 Explore 页面

调整：

- `src/modules/explore/domain/explore-dashboard.ts`
- `src/modules/explore/application/get-explore-dashboard.ts`
- Explore repositories 与 `/api/v1/explore/dashboard`
- `app/(product)/explore/page.tsx`
- `app/(product)/explore/explore-page-content.tsx`
- `app/globals.css`

Dashboard DTO 增加场景卡、表达卡、来源和生成入口；现有内容包保留为次级学习材料，不与场景卡混成无法理解的一组。搜索覆盖标题、沟通目的、表达、CEFR、地区和分类；筛选包括全部、已收藏、最近错误、阅读来源和可立即开始。

桌面保持单主列与必要详情区，不使用不等高双栏制造右下角空白。iPhone 使用单列、固定主动作和可关闭的表达详情；移除宣传式大标题与重复提示。

### 6.5 测试与提交

新增或更新：

- `tests/unit/saved-expression-routes.test.ts`
- `tests/unit/generate-personal-scenario.test.ts`
- `tests/contracts/scenario-generation-provider-contract.test.ts`
- `tests/database/scenario-source-ownership.test.ts`
- `tests/unit/explore-dashboard.test.ts`
- `tests/unit/explore-page.test.tsx`
- `tests/e2e/explore-page.spec.ts`

断言搜索/分类、收藏幂等、跨用户来源拒绝、生成失败不落库、私人场景不出现在公共内容 API、从四类来源进入场景以及移动端焦点恢复。

运行相关单元/契约/数据库/Playwright 测试、`pnpm lint`、`pnpm typecheck`、`pnpm db:check` 和 `git diff --check`。

建议实现提交：`feat: turn explore into a scenario library`

## 7. SCN-004：完整复盘、历史与间隔复现

### 7.1 目标

把基础复盘升级为完整学习闭环：完整文字历史、逐条错误、自然替代、重新说、到期复现和学习页唯一下一动作。

### 7.2 Application 与 API

新增：

- `list-scenario-history.ts`
- `build-scenario-review.ts`
- `retry-reviewed-turn.ts`
- `schedule-scenario-repetitions.ts`
- `list-due-scenario-repetitions.ts`
- `complete-scenario-repetition.ts`

扩展 Route Handlers：

- `GET /api/v1/scenario-practice/sessions`：分页历史，只返回当前用户。
- `GET .../:sessionId/review`：完整对话、逐条 review 和复现摘要。
- `POST .../:sessionId/turns/:turnId/evaluate`：幂等补齐 pending review。
- `GET /api/v1/scenario-practice/due`：到期列表。
- 完成/重练请求继续使用幂等键和 revision。

结束实战的事务必须冻结会话、创建缺失 review 的 pending 状态并建立复现计划。重新说创建新 attempt 和 review，不覆盖原始轮次或历史错误。

### 7.3 证据与推荐

修改：

- `src/modules/evidence/application/record-evidence.ts`
- 必要的 scenario-practice → evidence 小型 DTO
- `src/modules/recommendation/application/get-next-action.ts`
- `src/modules/recommendation/domain/next-action.ts`
- 学习页 DTO 与 `app/(product)/learn/learn-page-content.tsx`

只有服务端确认的 completed user turn、可用评估和允许的 modality 才能产生证据。打字不更新发音、语流或真实口头反应；低置信度和技术失败不写负面事件。复现结果使用新的 attempt/evidence，不修改历史事件。

推荐器把到期复现与现有候选一起排序，但首页仍只显示一个真实主动作。有稳定断点时遵循既有“继续学习”优先规则；无可恢复断点时才根据到期和新任务排序。

### 7.4 页面

新增或完善：

- `src/modules/scenario-practice/ui/scenario-review.tsx`
- `src/modules/scenario-practice/ui/scenario-history.tsx`
- `src/modules/scenario-practice/ui/due-repetition.tsx`
- 对应 `/explore` 历史入口和复现 route
- `app/globals.css`

复盘顺序固定为：沟通结果 → 完整对话 → 原句错误标记 → 自然替代表达 → 重新说 → 下次复现。提供“全部/只看标记”；不把复盘拆成脱离语境的总分仪表盘。

### 7.5 测试与提交

新增或更新：

- `tests/unit/scenario-review.test.tsx`
- `tests/unit/scenario-repetition-application.test.ts`
- `tests/unit/recommendation.test.ts`
- `tests/database/scenario-review-transaction.test.ts`
- `tests/e2e/scenario-practice.spec.ts`
- `tests/e2e/learn-page.spec.ts`

断言完整文字顺序、错误 span、自然替代、重新说不覆盖原轮次、1/3/7 天时钟、刷新/跨设备恢复、首页唯一动作以及证据不变量。

运行相关测试、`pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm db:check` 和 `git diff --check`。跨模块合并前补跑场景与学习页 Playwright。

建议实现提交：`feat: add scenario review and repetition`

## 8. SCN-005：Provider 设置、切换与 iPhone Safari/PWA 收敛

### 8.1 目标

让用户可以看见每项能力的 Provider 状态、选择可用 Provider，并在失败时安全切换；同时完成桌面与 iPhone Safari 的发布候选检查。

### 8.2 Provider registry 与真实备用适配器

新增或完善：

- `src/modules/providers/routing/provider-registry.ts`
- `src/modules/providers/routing/provider-health.ts`
- `src/modules/providers/repositories/user-provider-preference-repository.ts`
- Drizzle 实现
- OpenAI 的 scenario generation/roleplay/evaluation adapters，作为已配置时的真实备用选择

健康状态由“是否配置 + 最近脱敏调用结果”计算，不通过频繁收费探针保持绿色。状态只有 configured、healthy、degraded、unavailable；客户端不能写健康状态。

自动切换规则：

- 非流式生成/评估在没有终态结果时最多切换一次。
- 流式回复尚未产生 delta 时可以切换一次。
- 已产生 delta 后失败只显示重试/手动切换，不静默拼接第二个 Provider。
- 每次尝试分别记录 request/generation/provider/model/latency/result/cost，不记录 prompt、正文或音频。

### 8.3 API 与设置页

新增：

```text
app/api/v1/providers/status/route.ts
app/api/v1/me/provider-preferences/route.ts
src/modules/providers/ui/provider-settings-panel.tsx
```

修改 `app/(product)/me/page.tsx` 和必要的 preferences 组合组件。页面按场景生成、临时人物回复、场景评估、转写和发音分别显示当前选择、状态、最近成功/失败时间、备用选项和恢复动作。不能返回密钥、完整厂商错误或请求正文。

### 8.4 iPhone Safari/PWA

验证并按实际问题修改：

- `app/globals.css`
- PWA manifest/metadata 与产品布局中的安全区处理
- 场景详情、实战、复盘和 Provider 设置组件
- 浏览器录音生命周期适配器

检查 320、375、390、414、768、1024、1280 和 1440px；重点是真实 iPhone Safari 的输入法弹出、visual viewport、底部安全区、长按录音、来电/后台中断、返回恢复、主屏 PWA 和横向溢出。

将人工结果记录到 `docs/testing/scenario-practice-iphone-safari-checklist.md`，每个失败必须有复现设备/iOS/Safari/PWA 模式和后续任务 ID，不能用 Playwright WebKit 冒充真机通过。

### 8.5 测试与发布门禁

新增或更新：

- `tests/unit/provider-status-route.test.ts`
- `tests/unit/provider-preferences-route.test.ts`
- `tests/unit/provider-settings-panel.test.tsx`
- 三类场景 Provider 的 MiniMax/OpenAI 契约测试
- `tests/e2e/scenario-practice.spec.ts`
- `tests/e2e/profile-page.spec.ts` 或现有“我的”页面回归文件
- 多视口可访问性与无溢出回归

最终运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:contracts
pnpm db:check
pnpm test:e2e
pnpm build
git diff --check
```

真实 Provider 回归单独、限次执行，记录模型、时间、延迟和费用；默认门禁仍使用 fake。未配置备用 Provider 时显示明确状态，不伪造自动切换成功。

建议实现提交：`feat: harden scenario providers and iphone pwa`

## 9. 跨任务验收矩阵

| 能力 | SCN-001 | SCN-002 | SCN-003 | SCN-004 | SCN-005 |
| --- | --- | --- | --- | --- | --- |
| 状态机、revision、幂等 | 完成 | 接入 UI/API | 保持 | 跨设备回归 | 发布门禁 |
| 餐厅点餐 | 基础模型 | 可完整使用 | 出现在场景库 | 历史与复现 | iPhone 真机 |
| 搜索、分类、收藏、生成 | 数据边界 | 最小入口 | 完成 | 历史联动 | Provider 状态 |
| 完整文字复盘 | 数据表 | 基础版本 | 来源复用 | 完成 | 真机回归 |
| 1/3/7 天复现 | 纯规则 | 不展示 | 不展示 | 完成 | 发布门禁 |
| Provider 切换 | fake 规则 | MiniMax 单路径 | 生成 Provider | 评估补试 | 多 Provider 与设置页 |
| 长期角色/记忆隔离 | 自动测试 | 自动测试 | 自动测试 | 自动测试 | 全量回归 |

## 10. 明确不在本计划内

- 长期 AI 角色自然度、人物圣经、关系记忆和其他角色重做。
- 单账号邮箱 allowlist；它需要独立认证任务和部署配置验收。
- Flutter、原生 iOS/Android、商店发布和跨端 Dart 同步。
- 实时双向语音、后台录音、离线 ASR 和录音媒体库。
- 支付、订阅、公共内容市场或开放角色创建。
- 未经授权的第三方全文公开发布。

## 11. 每个任务的完成交接

每个 `SCN-*` 最终说明必须包含：

- 完成的任务 ID 和实现 Commit。
- 修改文件与迁移/契约版本。
- 运行的测试及结果。
- 未运行的全量检查及原因。
- 用户从哪个页面、用什么步骤验证。
- 已知限制、真实 Provider/数据库/真机条件和下一项建议。
- `PROJECT_STATUS.md` 后置提交及远端分支状态。

只有 `SCN-005` 的全量门禁和真实 iPhone Safari 检查完成后，才能把整个场景学习闭环标记为发布候选；`SCN-002` 完成后即可作为个人学习的早期可用停点。
