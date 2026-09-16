# 自动内容供应与词句学习重构实施计划

- 日期：2026-09-12
- 状态：已批准规格的实施基线；不是实时任务队列，分支/验收状态见 [PROJECT_STATUS](../../PROJECT_STATUS.md)
- 制定任务：`IA-001`（历史规划上下文）
- 设计依据：[自动内容供应与词句学习重构设计](../superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)
- 架构决策：[ADR-0008](../adr/0008-content-led-learning-and-automated-ingestion.md)
- 活动客户端：Next.js 响应式 Web/PWA；当前以电脑端 Web 为主要验收环境

## 1. 交付目标

本计划把产品从任务式“学习首页”迁移为内容驱动结构：

> 每日白名单增量获取 → 自动清洗/转写/词句抽取 → 所有者审核 → 显式发布 → 视频/播客学习、文章阅读、词句查询与考察 → 四板块能力证据

最终用户路径为：

- 打开“学习”直接选择视频或播客，进入逐句媒体学习器。
- 打开“阅读”选择文章、词汇、短语或跨来源语料，不经过任务式入口。
- 在文字题中验证词汇与短语；不要求口头作答。
- 在场景、长期 AI 角色、语音消息和跟读中分别形成适用证据。
- 在“我的”查看词汇与短语、交流运用、语音表达、跟读表现四个板块。
- 所有者在“我的 → 内容工作流”处理自动发现的候选，自动化不直接发布。

## 2. 执行规则

- 一次只领取一个任务 ID，一个分支只处理该任务。
- 每个实现任务先写失败测试，再写最小实现，最后整理重复代码。
- 开始任何 Next.js 页面或 Route Handler 前，先从当前工作树定位 `node_modules/next/dist/docs/` 并完整阅读相关 App Router、Route Handler、缓存/动态渲染和 metadata 指南；不按旧版 Next.js 经验猜接口。
- `domain` 保持纯 TypeScript；Route Handler 只负责鉴权、Zod 校验、application 调用和协议转换。
- 默认测试只使用 fake、固定 RSS/XML/JSON/字幕样本和本地小型媒体，不访问公网或收费 Provider。
- 公网发现、下载、ASR、发布、撤下和清理必须显式运行并产生脱敏汇总。
- 发现、处理、审核、发布和索引分别建模；任一步失败不得产生半发布内容。
- 所有用户私有表带 `user_id`、RLS、服务端所有权检查和删除策略。
- 观看、阅读、查词、收藏、播放进度和学习时长不写能力证据。
- 每个任务实现提交并推送后，立即用独立文档提交更新 `PROJECT_STATUS.md`；状态同步记录实现 Commit、测试、限制和下一项。
- 2026-09-12 制定计划时原工作树为 `codex/ui-014-reading-density`；该分支名是历史信息。每次重新核对实际分支和 dirty 文件，始终保留用户修改，不覆盖、不清理。

## 3. 任务顺序、分支与停点

| 顺序 | 任务 | 建议分支 | 依赖 | 用户可见停点 |
| --- | --- | --- | --- | --- |
| 0 | `IA-001` 规格、ADR、实施计划与权威文档同步 | `codex/ia-001-content-supply-design` | 已确认产品方案 | 新规则与任务队列一致 |
| 1 | `ACQ-001` 自动采集领域与持久化基础 | `codex/acq-001-content-acquisition-foundation` | IA-001 | 可用 fake 完成每日增量候选链路 |
| 2 | `REVIEW-001` 所有者审核与发布门禁 | `codex/review-001-owner-content-workflow` | ACQ-001 | “我的”可复核候选；真实发布适配器尚未接入时诚实禁用 |
| 3 | `ARTICLE-001` 文章 RSS 与正式 article 接入 | `codex/article-001-automated-article-ingestion` | ACQ-001、REVIEW-001 | 至少一篇文章可从 fake/授权源进入审核并发布 |
| 4 | `MEDIA-001` 统一媒体领域与学习资料库 | `codex/media-001-library-foundation` | ACQ-001、REVIEW-001 | `/learn` 替换为视频/播客资料库，空库也诚实可用 |
| 5 | `VIDEO-001` YouTube 白名单视频纵向闭环 | `codex/video-001-youtube-learning` | MEDIA-001 | 视频发现、官方嵌入、字幕和逐句学习可用 |
| 6 | `PODCAST-001` 播客 RSS 纵向闭环 | `codex/podcast-001-rss-learning` | MEDIA-001 | 节目发现、音频播放、转写片段和恢复可用 |
| 7 | `MEDIA-002` ASR、翻译、成本与媒体可靠性 | `codex/media-002-asr-processing` | VIDEO-001、PODCAST-001 | 合格无字幕媒体可形成审核草稿并安全清理临时音频 |
| 8 | `LEX-001` 词汇、短语与出现索引 | `codex/lex-001-lexicon-corpus-foundation` | ARTICLE-001、MEDIA-001 | 阅读页出现词汇/短语并可跳回上下文 |
| 9 | `LEX-002` 语料查询、文字考察与证据 | `codex/lex-002-corpus-assessment` | LEX-001、MEDIA-002 | KWIC 查询和不需口头回答的词句考察可用 |
| 10 | `PROFILE-001` 四板块能力 | `codex/profile-001-four-capability-profile` | LEX-002；现有对话/语音/场景证据 | “我的”用四板块取代八维主展示 |
| 11 | `OPS-001` 每日生产调度与全链路门禁 | `codex/ops-001-daily-content-pipeline` | ACQ-001 至 PROFILE-001 | 每日自动运行、清理、观测与发布候选链路稳定 |

每个任务完成后暂停并由产品本人验收。未通过当前停点时不领取下一任务。

## 4. IA-001：文档基线与队列重排

### 4.1 修改文件

- `docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md`
- `docs/adr/0008-content-led-learning-and-automated-ingestion.md`
- `docs/plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md`
- `AGENTS.md`
- `README.md`
- `PROJECT_STATUS.md`
- `docs/architecture.md`
- `docs/content-authoring.md`
- `docs/testing-strategy.md`
- `docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`
- `docs/superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md`
- `docs/plans/2026-08-20-personal-alpha-implementation-plan.md`

### 4.2 要求

1. 把 ADR 状态改为 `Accepted`，上位规格标为书面批准。
2. 用新的学习页不变量替换“开始第一次练习/继续学习”要求。
3. 把五项导航、手机头像、四板块能力、内容保留和自动发布边界同步到权威文档。
4. 在 `PROJECT_STATUS.md` 登记 IA-001 完成、`ACQ-001` 为下一项 `ready`，并阻塞与新信息架构冲突的 UI-014 至 UI-017 和旧 ALPHA-033 退出门禁。
5. 明确旧设计是历史背景，已有训练、证据和内容数据不物理删除。

### 4.3 验证与提交

```powershell
rg -n "开始第一次练习|继续学习|唯一主动作|八维" AGENTS.md README.md PROJECT_STATUS.md docs
git diff --check
```

检查所有新增 Markdown 本地链接可解析，无 `TBD`、`TODO` 或相互矛盾状态。文档任务不运行代码测试。

建议提交：

- `docs: add content supply implementation plan`
- `docs: sync content-led learning roadmap`

## 5. ACQ-001：自动采集领域与持久化基础

### 5.1 目标与边界

建立来源、运行、候选、处理步骤、权利和预算的纯领域与数据库基础，用 deterministic fake 证明每日增量、去重、失败恢复和 30/7 天保留策略。不访问公网、不接真实 ASR、不创建用户页面，也不发布正式文章或媒体。

### 5.2 先写测试

新增：

- `tests/unit/content-acquisition-state.test.ts`
- `tests/unit/content-acquisition-dedup.test.ts`
- `tests/unit/content-acquisition-budget.test.ts`
- `tests/unit/content-acquisition-retention.test.ts`
- `tests/unit/content-acquisition-run.test.ts`
- `tests/database/content-acquisition-persistence.test.ts`
- `tests/database/content-acquisition-rls.test.ts`
- `tests/contracts/content-source-adapter-contract.test.ts`
- `tests/fixtures/content-acquisition/v1/manifest.json`
- `tests/fixtures/content-acquisition/v1/fake-source-page.json`

先覆盖：

1. `discovered → screened → acquiring → processing → review_ready` 合法路径和所有非法跳转。
2. `failed` 可按新 generation 重试，旧 generation/revision 不能覆盖新结果。
3. 来源平台 ID、规范化 URL 和 SHA-256 三层去重；同键不同内容返回冲突。
4. 游标只在本批承诺写入完成后推进；中途失败不会漏掉条目。
5. 权利状态不明不得获取大型资产；受限/撤销来源不能处理或发布。
6. ASR 日/月预算、单候选大小和时长门禁可确定性测试。
7. 未发布草稿 30 天、拒绝大型产物 7 天和临时资产立即清理的计划生成。
8. 普通数据库角色不能写来源、候选、审核或运行；服务端 repository 可以按最小权限写入。

### 5.3 领域与 application

新增：

```text
src/modules/content-acquisition/
  domain/
    acquisition-state.ts
    source-policy.ts
    candidate-identity.ts
    budget-policy.ts
    retention-policy.ts
    index.ts
  application/
    register-source.ts
    run-acquisition-source.ts
    process-candidate.ts
    retry-processing-step.ts
    plan-candidate-cleanup.ts
    index.ts
  adapters/
    content-source-adapter.ts
    fake-content-source-adapter.ts
    index.ts
  repositories/
    content-acquisition-repository.ts
    drizzle-content-acquisition-repository.ts
    index.ts
  schemas/
    content-acquisition.ts
    index.ts
  index.ts
```

所有时间、ID、哈希和预算时钟可注入。application 使用 `runId`、`jobId`、`generationId` 和 revision；不把数据库行或第三方原始响应暴露为公共 DTO。

### 5.4 数据库与迁移

新增 `src/shared/db/schema/content-acquisition.ts`，修改 `src/shared/db/schema/index.ts`，使用 `pnpm db:generate` 生成下一条版本化迁移和 snapshot。

表：

- `acquisition_sources`
- `acquisition_runs`
- `content_candidates`
- `candidate_artifacts`
- `candidate_processing_attempts`
- `candidate_reviews`

关键约束：来源适配器/外部 ID 唯一；候选规范化 URL 与来源身份唯一；处理 attempt 的 job/generation 唯一；状态、权利、保留期限和预算值有 CHECK；候选产物必须属于同一候选。正式内容表不依赖候选生命周期，清理候选不能级联删除已发布内容。

### 5.5 CLI 与合同

新增 `scripts/acquire-content.ts` 和 package script：

```json
"content:acquire": "tsx scripts/acquire-content.ts"
```

CLI 第一版只支持 `--source <stableKey>`、`--dry-run`、`--limit` 和注入 fake；没有显式 source 时失败关闭。输出只含计数、内部 run ID、步骤状态和估算成本。

修改：

- `contracts/registry/v1/error-codes.json`
- `contracts/openapi/v1/openapi.json`
- `src/shared/contracts/v1/api-contract.ts`

增加 `CONTENT_SOURCE_NOT_FOUND`、`CONTENT_SOURCE_DISABLED`、`CONTENT_ACQUISITION_CONFLICT`、`CONTENT_RIGHTS_REQUIRED`、`CONTENT_BUDGET_EXHAUSTED` 和 `CONTENT_PROCESSING_FAILED`。

### 5.6 验证

```powershell
pnpm exec vitest run tests/unit/content-acquisition-*.test.ts
pnpm exec vitest run tests/contracts/content-source-adapter-contract.test.ts
pnpm exec vitest run tests/database/content-acquisition-persistence.test.ts tests/database/content-acquisition-rls.test.ts
pnpm db:check
pnpm lint
pnpm typecheck
git diff --check
```

建议提交：`feat: add content acquisition foundation`

## 6. REVIEW-001：所有者审核与发布门禁

### 6.1 目标与边界

提供仅所有者可见的候选列表、详情、修订、双维度审核、发布请求和撤下编排。类型专用正式 publisher 尚未接入时返回 `CONTENT_PUBLISHER_NOT_AVAILABLE`，不能用 fake 在真实运行时冒充发布成功。

### 6.2 先写测试

新增：

- `tests/unit/content-workflow-owner-access.test.ts`
- `tests/unit/content-review-gate.test.ts`
- `tests/unit/content-workflow-routes.test.ts`
- `tests/unit/content-workflow-page.test.tsx`
- `tests/database/content-review-transaction.test.ts`
- `tests/e2e/content-workflow.spec.ts`

覆盖：未登录、已登录非所有者、缺少 allowlist 和伪造客户端角色均拒绝；`es-ES` 与 `zh-CN` 必须独立批准；同版本生成者不能自动成为审核通过；发布再次校验权利、哈希、revision 和结构；请求修改/拒绝/重试不丢备注；发布事务失败不产生半版本。

### 6.3 实现

新增：

```text
src/shared/auth/content-workflow-owner.ts
src/modules/content-acquisition/application/
  list-candidates.ts
  get-candidate-review.ts
  submit-candidate-review.ts
  request-candidate-reprocessing.ts
  publish-candidate.ts
  archive-published-candidate.ts
src/modules/content-acquisition/publishers/
  candidate-publisher.ts
  candidate-publisher-registry.ts
src/modules/content-acquisition/ui/
  content-workflow-dashboard.tsx
  candidate-review-workbench.tsx
app/(product)/me/content-workflow/page.tsx
app/(product)/me/content-workflow/[candidateId]/page.tsx
app/api/v1/internal/content-workflow/sources/route.ts
app/api/v1/internal/content-workflow/runs/route.ts
app/api/v1/internal/content-workflow/runs/[runId]/route.ts
app/api/v1/internal/content-workflow/candidates/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/reprocess/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/reviews/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/publish/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/archive/route.ts
```

所有者授权使用服务端配置的用户 UUID allowlist，例如 `CONTENT_WORKFLOW_OWNER_USER_IDS`；不在普通日志记录邮箱或 UUID，只记录内部 hash。页面入口只有授权用户可见，但每个 Route 和 application 仍独立校验。

候选 publisher 是 application 端口。测试注册 deterministic publisher；真实运行没有对应 kind 的 publisher 时按钮显示原因并保持禁用/可恢复状态。

### 6.4 合同与验证

增加候选列表、详情、审核、发布结果 JSON Schema 与 OpenAPI；错误码增加 `CONTENT_WORKFLOW_FORBIDDEN`、`CONTENT_REVIEW_INCOMPLETE`、`CONTENT_PUBLISHER_NOT_AVAILABLE` 和 `CONTENT_PUBLICATION_CONFLICT`。

```powershell
pnpm exec vitest run tests/unit/content-workflow-*.test.ts tests/unit/content-review-gate.test.ts
pnpm exec vitest run tests/database/content-review-transaction.test.ts
pnpm exec playwright test tests/e2e/content-workflow.spec.ts --project=desktop-chromium --workers=1
pnpm test:contracts
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

建议提交：`feat: add owner content review workflow`

## 7. ARTICLE-001：文章自动采集接入

### 7.1 目标与边界

用文章 RSS 和一个有明确来源策略的专用适配器，把候选转换为现有 article 草稿并接入 REVIEW-001 publisher。禁止付费墙、来源不明全文和客户端 HTML 执行；不改文章阅读证据边界。

### 7.2 测试先行

新增：

- `tests/contracts/article-feed-adapter-contract.test.ts`
- `tests/unit/article-feed-normalization.test.ts`
- `tests/unit/article-candidate-publisher.test.ts`
- `tests/database/article-acquisition-publish.test.ts`
- `tests/e2e/article-acquisition.spec.ts`
- `tests/fixtures/content-acquisition/article-feed/*.xml`
- `tests/fixtures/content-acquisition/article-pages/*.html`

覆盖 ETag/Last-Modified、分页/游标、重复 GUID/URL、恶意 HTML、异常编码、正文缺失、许可不全、同版本不同哈希、发布事务和撤下后公开查询不可见。

### 7.3 实现

新增：

```text
src/modules/content-acquisition/adapters/rss/article-rss-adapter.ts
src/modules/content-acquisition/adapters/articles/article-source-adapter.ts
src/modules/content-acquisition/normalizers/article-candidate.ts
src/modules/content/publishers/acquired-article-publisher.ts
```

如仓库没有可靠 XML 解析器，本任务引入并锁定最小维护良好的 XML 解析依赖；不得用正则解析 RSS。正文清洗只保留纯文本段落和允许字段。`acquired-article-publisher` 调用 content/article application/repository，不由 acquisition 直接写 article 表。

修改现有 article Schema/导入应用，使候选发布保存来源、作者、URL、许可、署名、抓取日期、内容哈希、两个审核记录和变更原因。发布后的 UI 继续复用 `/read/article/[articleId]`。

### 7.4 验证

运行聚焦单元/契约/数据库/E2E、`pnpm content:validate`（涉及 bundle 时）、`pnpm db:check`、lint、typecheck、build 和 `git diff --check`。默认只使用本地 fixture；真实来源接入需单独显式运行并记录来源与结果。

建议提交：`feat: ingest reviewed article feeds`

## 8. MEDIA-001：统一媒体领域与学习资料库

### 8.1 目标与边界

建立视频/播客共享媒体模型、DTO、列表、播放投影和用户进度；把 `/learn` 替换为直接内容资料库。当前不接真实来源、不执行 ASR；空库显示诚实状态。旧训练 route 和数据先保留但从主导航移除。

### 8.2 测试先行

新增：

- `tests/unit/media-domain.test.ts`
- `tests/unit/media-progress.test.ts`
- `tests/unit/media-routes.test.ts`
- `tests/unit/media-library.test.tsx`
- `tests/database/media-persistence.test.ts`
- `tests/database/media-rls.test.ts`
- `tests/contracts/media-contract.test.ts`
- `tests/e2e/media-library.spec.ts`

更新：

- `tests/unit/learn-page.test.tsx`
- `tests/e2e/learn-page.spec.ts`
- `tests/e2e/product-shell.spec.ts`

首先断言 `/learn` 不出现旧 Hero、开始/继续 CTA、练习时间线和顶部头像；直接显示 `全部/视频/播客`、搜索、筛选、媒体卡或真实空状态。覆盖内容撤下、播放信息过期、进度 revision 冲突和跨用户隔离。

### 8.3 领域与数据库

新增：

```text
src/modules/media/
  domain/media.ts
  domain/source-position.ts
  domain/media-progress.ts
  application/list-media.ts
  application/get-media.ts
  application/get-media-playback.ts
  application/save-media-progress.ts
  repositories/media-repository.ts
  repositories/drizzle-media-repository.ts
  schemas/media.ts
  ui/media-library.tsx
  ui/media-card.tsx
  index.ts
src/shared/db/schema/media.ts
```

表：`media_items`、`media_versions`、`media_assets`、`media_segments`、`user_media_progress`。正式媒体版本不可变；资产 URL 不以长期地址进入客户端；进度按用户＋版本唯一并使用 revision/CAS。

### 8.4 页面与 API

替换：

- `app/(product)/learn/page.tsx`
- `app/(product)/learn/learn-page-content.tsx`

新增：

```text
app/(product)/learn/media/[stableKey]/page.tsx
app/api/v1/media/route.ts
app/api/v1/media/[stableKey]/route.ts
app/api/v1/media/[stableKey]/playback/route.ts
app/api/v1/media/[stableKey]/progress/route.ts
```

列表按 cursor 分页，完整字幕只在详情/播放接口中有界返回。移动壳层从 `src/shared/ui/app-shell.tsx` 移除 `AccountMenu` 常驻头像；桌面侧栏底部账户菜单保持。

`/learn/practice`、旧 recommendation 和 checkpoint 代码不在本任务删除；先移除用户可见主入口，并为仍被文章/场景引用的旧 route 增加兼容测试。

### 8.5 验证

运行媒体单元/合同/数据库、学习页和壳层 Playwright，覆盖 320–1440px；再运行 lint、typecheck、`pnpm test --run`、`pnpm db:check`、build 和 `git diff --check`。

建议提交：`feat: replace learning home with media library`

## 9. VIDEO-001：YouTube 白名单视频纵向闭环

### 9.1 目标与边界

接入至少一个白名单频道的官方 RSS/Data API 增量发现，使用 YouTube 官方嵌入播放。只读取平台允许取得的元数据和字幕；不下载 YouTube 音视频，不调用非公开下载接口。没有合法字幕/音频来源时允许发布“仅播放、无逐句辅助”的内容，或留在候选库。

### 9.2 测试先行

新增：

- `tests/contracts/youtube-source-adapter-contract.test.ts`
- `tests/unit/youtube-candidate-policy.test.ts`
- `tests/unit/media-segment-timeline.test.ts`
- `tests/unit/video-learning-workbench.test.tsx`
- `tests/e2e/video-learning.spec.ts`
- `tests/fixtures/content-acquisition/youtube/*.xml`
- `tests/fixtures/content-acquisition/youtube/*.json`
- `tests/fixtures/media/captions/*.vtt`

覆盖频道游标、删除/私密视频、重复视频 ID、区域失效、嵌入被禁、字幕缺失、VTT 时间边界、字幕模式、逐句跳转、A/S/D/Q、自动暂停、旧 generation 和移动抽屉焦点。

### 9.3 实现

新增：

```text
src/modules/content-acquisition/adapters/youtube/youtube-channel-adapter.ts
src/modules/content-acquisition/adapters/youtube/youtube-policy.ts
src/modules/media/publishers/acquired-video-publisher.ts
src/modules/media/domain/segment-timeline.ts
src/modules/media/ui/media-learning-workbench.tsx
src/modules/media/ui/video-player-adapter.tsx
src/modules/media/ui/segment-transcript.tsx
src/modules/media/ui/lexical-drawer.tsx
```

播放器通过小型内部端口暴露 play/pause/seek/currentTime/ready/error，不让 YouTube SDK 对象扩散到 domain。字幕 parser 把允许取得的 VTT/结构化字幕转换为内部 segment DTO；任何自动字幕都标记来源和审核状态。

### 9.4 验证

默认测试完全拦截网络并使用 fake player。首次真实运行只抓元数据和允许字段，输出候选报告；所有者审核后才发布。运行聚焦测试、媒体回归、Playwright、lint、typecheck、build 和 `git diff --check`。

建议提交：`feat: add reviewed youtube video learning`

## 10. PODCAST-001：播客 RSS 纵向闭环

### 10.1 目标与边界

接入至少一个白名单播客 RSS，发现节目和 episode，保存来源元数据并在权利门禁允许时使用 enclosure 播放/临时处理。第一版不做完整播客平台、自动订阅推荐或无限历史回填。

### 10.2 测试先行

新增：

- `tests/contracts/podcast-rss-adapter-contract.test.ts`
- `tests/unit/podcast-candidate-policy.test.ts`
- `tests/unit/podcast-audio-player.test.tsx`
- `tests/e2e/podcast-learning.spec.ts`
- `tests/fixtures/content-acquisition/podcast/*.xml`

覆盖 GUID/URL 去重、重发 episode、enclosure 类型/大小/重定向限制、失效音频、节目下架、无 transcript、有 transcript、播放恢复和字幕/词句抽屉。

### 10.3 实现

新增：

```text
src/modules/content-acquisition/adapters/rss/podcast-rss-adapter.ts
src/modules/content-acquisition/adapters/podcast/podcast-policy.ts
src/modules/media/publishers/acquired-podcast-publisher.ts
src/modules/media/ui/audio-player-adapter.tsx
```

共享 ARTICLE-001 引入的 XML 解析边界。enclosure 请求限制允许主机、HTTPS、重定向、Content-Type、Content-Length 和流式读取上限；不把完整 URL 或音频写入普通日志。播放器继续复用 media workbench、segment、快捷键、进度和错误状态。

### 10.4 验证

使用本地音频 fixture 和 fake fetch 完成全部默认测试。真实 RSS 只在显式运行中访问；未取得处理权时只保存允许的元数据/播放链接，不下载或 ASR。

建议提交：`feat: add reviewed podcast learning`

## 11. MEDIA-002：ASR、翻译、成本与可靠性

### 11.1 目标与边界

为通过门禁且无可用字幕的媒体生成 ASR/翻译草稿，完成切句、低置信度标记、临时音频清理、成本硬限制和来源撤下恢复。草稿不自动发布。

### 11.2 测试先行

新增：

- `tests/unit/media-processing-orchestrator.test.ts`
- `tests/unit/media-asr-eligibility.test.ts`
- `tests/unit/media-segmentation.test.ts`
- `tests/unit/media-cleanup.test.ts`
- `tests/contracts/media-transcription-provider-contract.test.ts`
- `tests/contracts/media-translation-provider-contract.test.ts`
- `tests/database/media-processing-transaction.test.ts`
- `tests/e2e/media-processing-review.spec.ts`

覆盖人工字幕优先、自动字幕次之、ASR 最后；同音频哈希不重复收费；预算耗尽不调用 Provider；取消/超时/失败均删除临时音频；无 `done` 流失败；低置信度片段阻塞审核；翻译失败保留西语；撤下后目录和语料索引不可见。

### 11.3 实现

新增：

```text
src/modules/content-acquisition/application/process-media-candidate.ts
src/modules/content-acquisition/application/cleanup-candidate-artifacts.ts
src/modules/content-acquisition/processors/media-transcription-processor.ts
src/modules/content-acquisition/processors/media-translation-processor.ts
src/modules/content-acquisition/processors/media-segmentation.ts
src/modules/providers/media-transcription/
src/modules/providers/media-translation/
```

复用现有 STT/translation 供应商基础设施和观测方式，但使用独立 acquisition DTO 与数据保留策略，避免把用户练习音频和第三方媒体混为同一业务尝试。媒体长度超过 provider 单次限制时先在 application 层分块并保存块边界；块级失败不得拼成伪完整转写。

清理使用可重试工作记录；“删除请求已登记”不能伪装成已删除。成功、失败、取消和超时均在 finally/补偿路径登记并验证清理。

### 11.4 验证

默认只使用假音频与 fake Provider。显式真实回放限定单个已授权候选和硬预算，记录 provider、模型、请求 ID、延迟、成本和清理结果，不提交音频或原始响应。

建议提交：`feat: process media transcripts safely`

## 12. LEX-001：词汇、短语与出现索引

### 12.1 目标与边界

建立跨文章和媒体的词元/词形、短语、出现位置与个人复习意图；在 `/read` 增加 `文章/词汇/短语/语料` 子导航。当前只实现词汇/短语浏览和上下文跳转，不写能力证据。

### 12.2 测试先行

新增：

- `tests/unit/spanish-tokenization.test.ts`
- `tests/unit/lexeme-normalization.test.ts`
- `tests/unit/phrase-matching.test.ts`
- `tests/unit/corpus-indexing.test.ts`
- `tests/unit/lexicon-routes.test.ts`
- `tests/unit/lexicon-pages.test.tsx`
- `tests/database/lexicon-persistence.test.ts`
- `tests/database/lexicon-rls.test.ts`
- `tests/contracts/lexicon-contract.test.ts`
- `tests/e2e/lexicon-library.spec.ts`

覆盖西语重音、标点、缩写、clitic/变形的安全边界、同形异义、不确定 lemma、短语重叠、版本冻结、撤下来源、私人来源所有权和 intent 幂等。

### 12.3 领域与数据库

新增：

```text
src/modules/lexicon-corpus/
  domain/content-reference.ts
  domain/spanish-token.ts
  domain/lexeme.ts
  domain/phrase.ts
  domain/corpus-occurrence.ts
  application/index-content-version.ts
  application/list-vocabulary.ts
  application/list-phrases.ts
  application/set-lexical-intent.ts
  repositories/lexicon-corpus-repository.ts
  repositories/drizzle-lexicon-corpus-repository.ts
  schemas/lexicon.ts
  ui/read-section-navigation.tsx
  ui/vocabulary-library.tsx
  ui/phrase-library.tsx
  index.ts
src/shared/db/schema/lexicon-corpus.ts
```

表：`lexemes`、`lexeme_forms`、`phrase_entries`、`phrase_variants`、`corpus_occurrences`、`user_lexical_intents`。

第一版只把人工/词典/provider 明确给出的 lemma 标为 verified；无法可靠归一的词形以 surface 记录并标记 `lemmaStatus=pending`，不能猜 lemma 后合并两个不同词。正式短语继续执行内容审核，用户保存短语保持私人。

### 12.4 页面与 API

新增：

```text
app/(product)/read/vocabulary/page.tsx
app/(product)/read/phrases/page.tsx
app/(product)/read/corpus/page.tsx
app/api/v1/lexicon/vocabulary/route.ts
app/api/v1/lexicon/phrases/route.ts
app/api/v1/lexicon/intents/[entryId]/route.ts
```

修改阅读一级页和文章/媒体词句入口，共用 `ContentDocumentRef` 与 `SourcePosition`。`familiar/revisit/ignore` 只写个人意图，不写 evidence/profile。

### 12.5 验证

运行全部 lexicon 单元、合同、数据库、阅读/媒体 E2E 回归、lint、typecheck、`pnpm db:check`、build 和 `git diff --check`。

建议提交：`feat: add contextual vocabulary and phrases`

## 13. LEX-002：语料查询、文字考察与词句证据

### 13.1 目标与边界

完成 KWIC 查询、来源过滤、准确位置跳转和不要求口头回答的词句考察。只有服务端确认的答题提交可以形成“词汇与短语”证据。

### 13.2 测试先行

新增：

- `tests/unit/corpus-search.test.ts`
- `tests/unit/lexical-assessment.test.ts`
- `tests/unit/lexical-assessment-evidence.test.ts`
- `tests/unit/corpus-routes.test.ts`
- `tests/unit/lexical-assessment-routes.test.ts`
- `tests/database/lexical-assessment-persistence.test.ts`
- `tests/contracts/corpus-assessment-contract.test.ts`
- `tests/e2e/corpus-assessment.spec.ts`

覆盖表面词/verified lemma/完整短语、大小写/标点/重音、AND 多词、分页上限、撤下和跨用户泄漏；选择、判断、填空、少量完整输入；自然等价答案；题目版本冻结；重复提交不重复证据；浏览/收藏/跳过不写证据。

### 13.3 实现

新增：

```text
src/modules/lexicon-corpus/domain/kwic.ts
src/modules/lexicon-corpus/domain/lexical-assessment.ts
src/modules/lexicon-corpus/application/search-corpus.ts
src/modules/lexicon-corpus/application/get-assessment.ts
src/modules/lexicon-corpus/application/submit-assessment-attempt.ts
src/modules/lexicon-corpus/ui/corpus-search.tsx
src/modules/lexicon-corpus/ui/lexical-assessment.tsx
app/api/v1/corpus/search/route.ts
app/api/v1/lexicon/assessments/[assessmentId]/route.ts
app/api/v1/lexicon/assessments/[assessmentId]/attempts/route.ts
```

数据库增加 `lexical_assessment_items`、`lexical_assessment_attempts`。assessment application 创建/验证 `practice_attempts` 或明确的通用 attempt 引用，再调用 evidence application；客户端不能提交 outcomeScore、skillKey 或 confidence。

建议 skill key 使用版本化前缀：`lexical.recognition.*`、`lexical.context.*`、`lexical.collocation.*`、`lexical.retrieval.written.*`。完整输入只是文字主动提取，不映射发音/语流/口头反应。

### 13.4 验证

运行 corpus/assessment 单元、合同、数据库、E2E、evidence/profile 回归、lint、typecheck、db:check、build 和 `git diff --check`。

建议提交：`feat: add corpus search and lexical assessment`

## 14. PROFILE-001：四板块能力画像

### 14.1 目标与边界

以四个能力板块取代八维雷达图的产品主展示，保留底层事件和历史审计。没有可靠映射的数据保持“数据积累中”。

### 14.2 测试先行

新增：

- `tests/unit/four-capability-profile.test.ts`
- `tests/unit/profile-evidence-routing.test.ts`
- `tests/unit/profile-history-migration.test.ts`
- `tests/unit/profile-four-capability-route.test.ts`
- `tests/unit/profile-four-capability-panel.test.tsx`
- `tests/e2e/profile-four-capabilities.spec.ts`

更新现有 profile/evidence 测试，覆盖：文字考察只进入词句；文字场景/聊天只进入交流；可信语音可分别进入交流和语音；跟读只进入跟读；同 attempt 不同 skill 去重；低置信度、技术失败和打字不污染语音；历史八维不强制均匀映射。

### 14.3 实现

新增或替换：

```text
src/modules/profile/domain/capability-groups.ts
src/modules/profile/domain/four-capability-overview.ts
src/modules/profile/application/get-four-capability-overview.ts
src/modules/profile/ui/four-capability-panel.tsx
```

修改：

- `src/modules/profile/repositories/profile-repository.ts`
- `src/modules/profile/repositories/drizzle-profile-repository.ts`
- `app/api/v1/profile/route.ts`
- `app/(product)/me/page.tsx`
- `contracts/schemas/v1/profile-overview-response.schema.json`（新增版本化结构或新文件）
- `contracts/openapi/v1/openapi.json`

不要原地改变旧响应含义。优先新增显式 `capabilityGroups`，保留一段迁移期的旧 axes 审计字段或旧端点；页面只消费新结构。历史映射表必须逐 skill prefix 明确，无法匹配的 evidence 只计审计总量。

### 14.4 验证

运行 profile/evidence 单元、Route、合同和 E2E；再运行全量 Vitest、lint、typecheck、build。检查学习时长未进入任何能力计算。

建议提交：`feat: replace profile with four capability groups`

## 15. OPS-001：每日生产调度与全链路门禁

### 15.1 目标与边界

把已验证模块接入每日定时 CI runner，建立来源、预算、失败、清理、撤下和运行手册。只有此任务才启用真实白名单和生产级 schedule；仍不自动发布。

### 15.2 测试先行

新增：

- `tests/unit/content-acquisition-scheduler.test.ts`
- `tests/unit/content-cleanup-runner.test.ts`
- `tests/unit/content-pipeline-observability.test.ts`
- `tests/e2e/content-pipeline-smoke.spec.ts`
- `.github/workflows/content-acquisition-daily.yml`
- `docs/operations/content-acquisition-runbook.md`

测试 workflow 输入、并发互斥、手动触发、dry-run、失败退出码、预算耗尽、重复调度、清理失败可重试和日志脱敏。CI 测试 job 只用 fake；真实 source job 必须通过 protected secrets/environment 显式启用。

### 15.3 运行实现

扩展 `scripts/acquire-content.ts` 支持：

- `discover`
- `process`
- `cleanup`
- `report`
- 单来源/全启用来源、有界 limit 和 dry-run

workflow 使用 concurrency group 防止同一环境重叠运行，以 UTC 表达固定日程并在文档注明 Asia/Shanghai 对应时间。密钥使用 CI secret；输出不包含数据库 URL、API key、完整媒体 URL、正文或字幕。

观测至少记录 run/source/step、数量、状态、稳定错误、耗时和估算成本；连续失败、清理失败、预算异常和来源大面积失效进入现有 diagnostic event 或新的最小事件类型。是否外发通知由用户另行决定，不默认发送邮件或第三方消息。

### 15.4 首次受控运行

按顺序执行：

1. dry-run：一个 YouTube 频道、一个播客 RSS、一个文章 RSS，只发现元数据。
2. 核对去重、来源、权利策略、速率和成本汇总。
3. 非发布处理：每类最多一个候选，确认临时资产清理。
4. 所有者在工作流中完成双维度审核。
5. 每类显式发布一个内容并验证目录、播放/阅读、词句索引和撤下。
6. 重跑相同范围，确认无重复候选、版本、证据或费用。

任何一步失败立即停在可恢复状态，不扩大候选数量。

### 15.5 最终门禁

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

另做真实登录桌面人工验收；iPhone Safari/PWA 真机仍按当前项目决定记录为延期，不能用 Playwright WebKit 冒充完成。

建议提交：`ops: schedule reviewed content acquisition`

## 16. 任务级验收与回滚原则

- 数据迁移只向前；功能回滚通过关闭来源、隐藏新入口、撤下内容或切回旧读模型完成，不执行破坏性 reset。
- `/learn` 切换前保留旧 route 和历史数据；确认无依赖后另建退役任务，不在 MEDIA-001 删除训练模块。
- 发布内容使用不可变版本；纠错或来源变化创建新版本或撤下，不能原地覆盖历史证据引用。
- 新索引可重建；原始事实是已审核 article/media 版本和 append-only evidence，不把搜索索引当权威。
- 每个任务失败时应能停在前一稳定版本，且不需要手工修改生产数据库恢复。

## 17. 用户验证清单

每个用户可见任务交付后，由产品本人确认：

- 页面是否打开即进入内容或明确操作，没有任务式欢迎、重复说明和假按钮。
- 视频/播客/文章是否真实可用，来源、地区、字幕和失败状态是否诚实。
- 查词、短语、语料和文字考察是否保留上下文且不打断主要内容。
- 手机是否只通过底部“我的”进入账户，没有顶部重复头像。
- 四板块能力解释是否符合主观学习感受，且能追溯到代表性证据。
- 内容工作流是否能清楚判断为什么候选被接受、修改、拒绝、发布或撤下。

## 18. 停点与历史起点

2026-09-12 的初始停点是在 IA-001 合并后只开放 ACQ-001；该起点不是当前指令。实际任务、已有分支、集成状态和验收限制只在 [PROJECT_STATUS](../../PROJECT_STATUS.md) 维护。上表保留设计依赖，不把已经在其他分支/main 完成的任务重新领取。任何切片仍不得顺手扩展到未授权页面、迁移、公网采集或收费 ASR。
