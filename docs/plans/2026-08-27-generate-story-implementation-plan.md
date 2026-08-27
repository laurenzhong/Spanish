# Generate Story 私有文章实现计划

## 范围

实现已确认的 READ-006：Web 用户通过 `/read/generate` 调用 MiniMax M3 生成西语 AI draft，服务端私有保存，自动进入 `My Texts` 并复用现有文章阅读器。公共文章内容、口语证据、画像、角色记忆和 Flutter 视觉页面不在本切片内。

## 任务 1：Provider 与契约

修改/新增：

- `src/modules/providers/story-generation/story-generation.ts`
- `src/modules/providers/story-generation/minimax-story-generation.ts`
- `src/modules/providers/story-generation/server.ts`
- `src/modules/providers/story-generation/index.ts`
- `tests/unit/minimax-story-generation.test.ts`
- `tests/contracts/story-generation-provider-contract.test.ts`
- `.env.example`

实现 `StoryGenerationProvider`、输入/输出 Zod Schema、MiniMax M3 Anthropic-compatible 请求、固定 system prompt、30 秒 timeout、AbortSignal、稳定错误映射和 provider 观测字段。适配器只返回内部 DTO，不泄露原始响应；缺 key 时返回 `provider-auth-failed`。

验收：正确 JSON、Markdown 包装拒绝、缺字段、超长正文、401/429/5xx、timeout、取消和请求 ID 均有测试；不使用真实收费 key。

## 任务 2：内容清洗与生成文章领域

修改/新增：

- `src/modules/reading/domain/generated-story.ts`
- `src/modules/reading/application/generated-story-application.ts`
- `src/modules/reading/application/index.ts`
- `src/modules/content/domain/article.ts`
- 相关领域单测

实现生成输入 Schema、关键词规范化、纯文本清洗、段落拆分、8,000 字符上限、稳定文章 ID 和 `origin: generated` 投影。生成 DTO 与公共 `ArticleCardProjection`/`ArticleReaderProjection` 保持兼容，公共文章响应继续省略 `origin` 或使用 `public`。

验收：领域层不依赖 Next.js/Drizzle/provider SDK；HTML/script、控制字符、空段落和边界长度测试通过；生成内容永不调用 evidence/profile/memory。

## 任务 3：数据库迁移与私有 repository

修改/新增：

- `src/shared/db/schema/reading.ts`
- `src/shared/db/schema/common.ts`（仅在需要新增受限枚举时）
- `src/shared/db/schema/index.ts`
- `drizzle/0014_*.sql`
- `src/modules/reading/repositories/generated-article-repository.ts`
- `src/modules/reading/repositories/drizzle-generated-article-repository.ts`
- `src/modules/privacy/repositories/drizzle-privacy-repository.ts`
- 数据库/RLS 测试和 fixture

新增 `user_generated_articles`，以 `user_id`、`article_version_id`、请求参数、provider 元数据、幂等键、哈希和 `ready` 状态为核心字段。生成事务创建内部 `article_sources`、`articles`、`article_versions`、`article_segments` 和所有权行；私有 repository 必须按用户 join 过滤。

新增 RLS：用户只能 select/insert/delete 自己的生成记录；内部载体不能通过公共内容 API 暴露。账号删除事务清理生成记录和内部载体。重复 `Idempotency-Key` 返回原文章，参数不一致返回冲突。

验收：从空库迁移、用户 A/B 隔离、非本人读取/删除、级联清理、幂等插入和阅读状态外键测试通过；不得改动用户现有未提交迁移。

## 任务 4：API Route Handlers

修改/新增：

- `app/api/v1/read/generated-stories/route.ts`
- `app/api/v1/read/generated-stories/[id]/route.ts`
- `src/shared/contracts/v1/api-contract.ts`
- `contracts/openapi/v1/openapi.json`
- 生成文章 API Schema/fixtures

实现 `POST/GET/DELETE`：Route 只负责会话、请求体、幂等键、application 调用和稳定错误响应；`GET` 只返回当前用户卡片列表，`GET/:id` 返回完整 reader DTO，`DELETE/:id` 验证拥有者并清理相关内容。使用 `RESOURCE_NOT_FOUND`、`CONFLICT`、`RATE_LIMITED`、`PROVIDER_TIMEOUT`、`PROVIDER_UNAVAILABLE` 等已有错误码。

更新文章私有读取路径：公共 `/api/v1/content/articles` 不包含生成文章；My Texts 的服务端查询合并公共收藏和私有生成卡片，文章 detail 能按生成 ID 加载。

验收：未登录、无数据库、无 key、错误 JSON、重复 key、provider 失败和非本人 ID 的响应契约通过；OpenAPI 与 JSON Schema fixture 一致。

## 任务 5：Web Generate 页面与 My Texts

修改/新增：

- `app/(product)/read/generate/page.tsx`
- `app/(product)/read/generate/generate-story-form.tsx`
- `app/(product)/read/read-shelf.tsx`
- `app/(product)/read/page.tsx`
- `app/(product)/read/article/[articleId]/page.tsx`
- `app/(product)/read/article/[articleId]/article-reader.tsx`
- `app/globals.css`
- `tests/unit/generate-story-form.test.tsx`
- `tests/unit/article-library.test.tsx`
- `tests/e2e/generate-story.spec.ts`

将书架占位 toast 改为链接到 `/read/generate`。按 B 方案实现独立单列页面：主题、CEFR、长度、体裁、关键词，受控表单、AbortController、loading/取消/错误/成功状态和私有草稿说明。成功后按服务端返回 ID 导航阅读器；失败保留表单值并支持重试。

My Texts 合并生成卡片并显示 `AI draft`；删除调用生成文章 DELETE API，成功后移除卡片和清除 `reading-reader:v1:{stableKey}` 本地缓存。阅读器复用正文/词语/TTS，新增来源标记，不添加口语评分。

视觉验收沿用已确认 B 方案：纸面背景、细边框、深色正文、绿色主 CTA、陶土色小标题、44px 命中区；320/375/414/768/1024/1440px 无横向溢出或布局跳动。

## 任务 6：隐私、删除与回归文档

修改：

- `docs/architecture.md`
- `docs/database.md`
- `docs/privacy.md`（若存在；否则更新对应隐私章节）
- `docs/testing-strategy.md`
- `PROJECT_STATUS.md`

记录 provider 数据保留、生成文章私有边界、账号删除顺序、公共 API 排除规则、错误语义和新增测试结果。完成后在状态页记录 READ-006 commit、修改范围、测试、限制和下一项。

## 验证顺序

1. `pnpm lint`
2. `pnpm typecheck`
3. 相关 Vitest/provider/数据库测试
4. `pnpm test --run`（必要时单 worker 复跑，记录既有失败）
5. `pnpm test:e2e -- tests/e2e/generate-story.spec.ts`
6. `pnpm test:e2e`
7. `pnpm build`

本切片不把 Flutter 公共测试或 Windows 环境结果表述为 iOS 编译/真机验证。真实 MiniMax key 不进入默认测试；E2E 使用 fake provider 或无 key 的诚实错误路径。

## 停点与限制

- 不实现公共发布/人工审核工作流、音频生成、流式写作、用户上传和外部 URL 抓取。
- 如果现有内容载体外键或迁移约束证明不能安全承载私有文章，停止扩张并记录阻塞，不静默改用公共表暴露内容。
- 只有任务 1–5 及其测试完成后才同步状态页；不顺手修改其他代理负责的功能。
