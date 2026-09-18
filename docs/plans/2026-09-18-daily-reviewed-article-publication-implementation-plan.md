# 每日 50 篇合规文章双审与策略化发布实施计划

- 日期：2026-09-18
- 状态：已批准设计，实施中；生产仍保持 `disabled`
- 任务：`OPS-003`
- 目标分支：`codex/ops-003-article-publication-design`
- 决策入口：[ADR-0010](../adr/0010-reviewed-article-auto-publication.md)

## 1. 交付目标

在现有 `content-acquisition`、文章发布器和 GitHub Actions 基础上建立文章专用的每日流水线：全局最多发现 50 个新候选，依次完成有界正文抽取、去重、权利/语言初筛、`es-ES` 与 `zh-CN` 独立 AI 审核、结构校验、显式发布事务、词句索引和脱敏报告。

在 ADR-0010 被接受、来源策略和生产配置获批前，只能实现和验证 fake、dry-run 与 review-only，不能开启生产 `auto-publish`。

## 2. 当前基线与差距

- `.github/workflows/content-acquisition-daily.yml` 每日 UTC 03:17 只运行 `discover --all-enabled`。
- `--limit 50` 作用于每个来源；多个来源可能超过 50，也不保证只处理文章。
- CLI 已有 `discover/process/cleanup/report`，但 workflow 未串联这些步骤。
- `prepareArticleCandidateForReview` 能把合规文章推进到 `review_ready`。
- `assertCandidatePublishable` 已校验 revision、content hash、rights status 和三个审核维度。
- `publishCandidate` 只适合交互式所有者调用；无人值守 runner 需要独立策略化发布入口。
- 文章正文抽取目前以 `article/main/p` 为主，对模板噪音和复杂页面的恢复能力有限。

## 3. 实施切片

### OPS-003A：全局文章配额与调度计划

新增纯领域/应用层计划器，输入已启用来源、日期、全局配额和来源配额，输出稳定排序的文章来源计划。要求：

- 只选择 `article-rss`、`article-feed`、`rightsStatus=verified` 且策略允许的来源；
- 全部来源共享 50 个候选预算；
- 以实际新插入候选消耗配额，重复项不占新候选数；
- 分页发现时在配额耗尽后停止，不继续预取；
- 同一自然日和 policy version 使用稳定 run key，重复调度可恢复而不重复插入。

建议文件：

```text
src/modules/content-acquisition/domain/article-publication-policy.ts
src/modules/content-acquisition/application/plan-daily-article-run.ts
src/modules/content-acquisition/application/run-daily-article-discovery.ts
tests/unit/daily-article-quota.test.ts
tests/unit/daily-article-scheduler.test.ts
```

### OPS-003B：正文抽取和候选质量

在现有 host、大小、重定向和 content-type 限制之后增加正文抽取策略：

- 首选现有明确的 `<article>`/`<main>` 结构；
- 对允许的复杂页面使用 `@mozilla/readability` 作为候选抽取器；
- 抽取结果仍经过段落数量、正文长度、标题/URL 身份、语言和内容哈希校验；
- Readability 失败时保持候选失败或使用经过验证的现有提取结果，不回退到整个页面文本；
- fixture 覆盖导航噪音、广告、重复段落、恶意 HTML、超大正文和正文为空。

`@mozilla/readability` 为 Apache-2.0；引入前记录依赖版本和运行时 DOM 适配成本。Python `trafilatura` 只作为质量对照，不在第一版增加 Python 生产边界。

### OPS-003C：独立 AI 审核执行器

新增 article review port 和两个分离的 review job：

```text
content-es-ES
teaching-zh-CN
```

每个 job 必须：

- 读取相同的冻结 candidate revision/hash；
- 使用独立 attempt/generation ID；
- 输出严格 Schema：`approved | changes_requested | rejected`、notes、检查项和模型版本；
- 不允许 Provider 直接写数据库或发布；
- Provider 失败、超时、Schema 错误或低置信度只产生可重试失败，不默认通过；
- 记录 `codex-ai-owner-authorized-review`，不伪造真人身份；
- 结构审核由确定性校验器独立完成，不能由一段模型自由文本代替。

默认测试只使用 fake provider。真实 Provider 调用必须由独立生产开关启用并计入预算。

建议文件：

```text
src/modules/content-acquisition/providers/article-review.ts
src/modules/content-acquisition/application/review-article-candidate.ts
src/modules/content-acquisition/application/run-article-review-batch.ts
tests/contracts/article-review-provider-contract.test.ts
tests/unit/article-review-pipeline.test.ts
```

### OPS-003D：策略化显式发布

新增非 Route Handler 的服务端应用用例，例如 `publishReviewedArticleByPolicy`。它必须：

- 拒绝非 article；
- 重新读取 source、candidate、reviews 和 policy；
- 使用 CAS 校验 revision/hash；
- 要求当前版本三个审核维度全部 approved；
- 使用 `article-auto-publication:<policy-version>` actor；
- 写入带 run ID/policy version 的 `owner-release` 审计；
- 复用 `AcquiredArticlePublisher` 的不可变版本和失败归档语义；
- 发布成功后调用词句索引，索引失败进入可重试状态，不能伪造索引完成；
- 同一 candidate revision/hash 重跑返回既有 publication，不创建重复版本。

现有交互式 `publishCandidate(ownerUserId, ...)` 保留给工作台，不能让自动任务传入一个所有者 ID 冒充点击。

### OPS-003E：CLI、workflow 与运行报告

扩展 CLI：

```powershell
pnpm content:pipeline -- article-daily --mode discover-only --daily-limit 50
pnpm content:pipeline -- article-daily --mode review-only --daily-limit 50
pnpm content:pipeline -- article-daily --mode auto-publish --daily-limit 50
```

workflow 要求：

- 使用单一文章日运行命令，而不是每来源分别传入 50；
- concurrency 覆盖同一环境和自然日；
- `workflow_dispatch` 默认 `discover-only`；
- schedule 的模式从受保护配置读取，缺失时 fail closed；
- 运行结束总是生成脱敏 summary；
- cleanup/report 使用独立可重试步骤；
- 真实 secrets 只存在于 `content-production` Environment；PR 测试只用 fake。

建议配置：

```text
CONTENT_ARTICLE_DAILY_MODE=disabled
CONTENT_ARTICLE_DAILY_LIMIT=50
CONTENT_ARTICLE_SOURCE_LIMIT=10
CONTENT_ARTICLE_PUBLICATION_POLICY_VERSION=
CONTENT_ARTICLE_AUTO_PUBLISH_KILL_SWITCH=true
CONTENT_ARTICLE_REVIEW_PROVIDER=minimax
CONTENT_ARTICLE_REVIEW_MODEL=MiniMax-M3
```

所有默认值都应阻止自动发布。实际来源 allowlist 保存在数据库版本化 policy，不塞进环境变量。

### OPS-003F：受控启用和撤下演练

顺序执行：

1. fake 全链路 50 个输入，验证全局配额、重复、失败隔离和报告。
2. 一个真实白名单来源 `discover-only --daily-limit 1`。
3. 一个候选 `review-only`，人工核对两个 review 和结构结果。
4. 在临时/测试目标显式发布并重跑，验证幂等和索引。
5. 演练按 run ID 撤下，确认阅读公开投影和语料索引不可见、审计保留。
6. 连续 7 天 review-only 后生成通过/阻断统计。
7. 用户接受 ADR 并开启受保护配置后，生产先以每日 1 篇启动，再逐步提升到 10、25、50。

## 4. 开源工具选择

| 工具 | 用途 | 决定 |
| --- | --- | --- |
| [Mozilla Readability](https://github.com/mozilla/readability) | 合规页面的正文候选抽取 | 推荐在 OPS-003B 做 fixture 评测后引入 |
| [p-queue](https://github.com/sindresorhus/p-queue) | 有界并发与速率控制 | CLI 并发达到需求时再引入；简单串行优先 |
| [act](https://github.com/nektos/act) | 本地演练 GitHub Actions | 开发工具，可选；不能替代真实 Environment 验证 |
| [promptfoo](https://github.com/promptfoo/promptfoo) | AI 审核提示与拒绝条件评测 | 推荐用于离线 eval，不进入运行时依赖 |
| [RSSHub](https://github.com/DIYgod/RSSHub) | 补充 RSS 路由 | 不采用：AGPL-3.0 且不能替代来源授权 |
| Trigger.dev / Inngest / Temporal | 持久工作流 | 当前不采用，避免新增服务边界 |

## 5. 测试与门禁

至少覆盖：

- 全局 50 与单来源配额；零来源、少于 50、重复、分页和中断恢复；
- 白名单、rights policy、host、重定向、正文身份和许可变更；
- 两个审核 job 的独立 attempt、stale revision、changes requested 和 Provider 失败；
- 自动 actor 不冒充所有者；生产模式缺少 policy/version/kill switch 时拒绝；
- 发布 CAS、事务失败归档、重跑幂等、索引失败恢复和批量撤下；
- 日志不包含 URL 查询凭据、正文、密钥和 Provider 原始响应；
- workflow schedule、手动 dry-run、concurrency、protected environment 和 summary。

候选实现完成后运行：

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

真实来源、收费 Provider、生产数据库、发布和撤下只按 OPS-003F 的受控步骤执行，不能为了通过测试擅自运行。

## 6. 批准后的执行边界

ADR-0010 的分阶段决定已由产品本人确认。`https://readlang.com/es/links` 页面列出的 Readlang `/library/` 文章 URL 已登记为个人 Alpha 的授权 allowlist，策略快照见 `content/source-policies/readlang-links-v1.json`。审核 provider 默认使用已配置的 MiniMax M3；fake 只允许在显式开发开关下使用。生产仍从 `disabled` 开始，完成 7 天 `review-only` 观察和人工抽查后，才可在受保护 Environment 中逐级开启发布。
