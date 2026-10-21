# MEDIA-SERIES-006：白名单采集的待确认系列建议

- 日期：2026-10-16。
- 当前状态：review；media 建议用例、RSS/LR 接线、内部契约与持久化组合验证完成；最终跨切片门禁与全量限制见[整体验收](MEDIA-SERIES-001-006.md)。
- 权威规格：[系列设计](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)、[实施计划第 6 节](../plans/2026-10-15-media-series-implementation-plan.md)、[ADR-0018](../adr/0018-media-series-directory.md)。
- 验证身份：AI 编码代理；本报告仅为工程验证，不提供内容或教学审核资格。

## 1. 最终行为

`media` 的同步 application 用例 `proposeMediaSeriesSuggestion(unknown)` 校验输入后返回带确定性 SHA-256 `suggestionKey` 的 `unconfirmed` 建议，非法或缺结构身份时返回 null。身份仅绑定来源稳定键、媒体稳定键、类型、依据与外部系列 ID；标题或季集提示修订不改变 key。输出没有正式 seriesKey、position、orderMode、确认者或发布状态。

建议支持 podcast_feed、structured_programme、playlist 三种依据；podcast_feed 仅用于播客。feed 默认附 `feed_may_be_mixed`，playlist 默认附 `playlist_may_be_curated`，冲突附 `metadata_conflict`，均保持待确认。未知季/集为 null，0 合法。URL 与审核文本经 media schema 校验：仅公共 HTTPS，拒绝凭据、私网/IP/本地主机与签名/secret 参数；此纯函数不执行 DNS 或网络访问，来源白名单仍由既有 acquisition adapter/runner 校验。

本轮实际接入已有 RSS 和 Language Reactor 播客：RSS 使用真实 feed URL、feed channel title 及结构化 iTunes 季集元数据；重复矛盾标题或非法/矛盾编号记冲突，未知/冲突编号留空。LR 必须同时有合法公开 itunesId 与 feedTitle，以 `itunes:<id>` 建议节目，混合目录只作来源证据，不伪造 RSS。每个候选至多一条建议，缺信息为 `[]`；只含视频 channel/title 时不猜测系列。playlist 是用例支持的输入依据，本轮未新增视频播放列表采集。

adapter 仅把结果放进 `candidate.metadata.mediaSeriesSuggestions`，与 `podcastDraft` 并列；不进入正式 draft/contentHash，不写媒体系列表，也不修改审核记录、字幕、进度或学习证据。沿用既有请求与 host/权利门禁，没有新增来源、抓取权限、外部请求或收费调用。

## 2. 内部契约

新增 `contracts/schemas/v1/media-series-suggestion.schema.json`，并在已有 owner-only `content-workflow-candidate` 的 metadata 声明可选建议数组；旧 metadata、缺字段与其他既有 metadata 键继续兼容。无新公共 API、MediaCard 字段或正式媒体/内容 Schema。

JSON Schema 验证序列化字段、严格额外字段、稳定键、hash、依据/类型、长度、null/0/上限、仅 unconfirmed 及最多两个不重复 warning；URL/审核文本的完整安全语义仍由 media Zod/application 实施。不得把 JSON Schema 的结构校验当作来源或 URL 安全边界。

本代理执行：

- `corepack pnpm exec vitest run tests/contracts/media-series-suggestion-contract.test.ts tests/contracts/content-workflow-contract.test.ts`：**2 文件、7 用例通过**。新四项验证真实 application 各依据输出、JSON/Zod 结构边界、完整序列化字段、旧 metadata 兼容，以及运行时拒绝凭据/私网/编码 secret query/hash。
- `corepack pnpm exec eslint tests/contracts/media-series-suggestion-contract.test.ts`：exit 0。

media 代理已执行新增 `tests/unit/media-series-suggestion.test.ts`：**1 文件、7 用例通过**，覆盖确定性 key、标题不当身份、结构字段缺失、null/0 与非法编号、feed/playlist/冲突告警、公共 URL、拒绝批准/目录字段与零 fetch，以及 URL 规范化超长时返回 null。

## 3. 异步、持久化与发布门禁审核

只读审核确认 adapter 在既有异步步骤后显式检查 abort：即使 fake fetch 忽略 signal，也不能在取消后产出候选建议。建议生成本身同步，不创建额外 generation；持久化继续由原 source revision/cursor 事务和 candidate revision/generation CAS 保护。

原 `commitDiscoveryPage` 在一笔事务中写候选与来源 cursor，source revision 过期时整体回滚；候选状态/metadata 更新同时检查 revision 与 generation。完全重复的候选跳过写入，不重复新增建议，也不会给历史候选自动回填新提示。发现范围限于已登记 adapter 与来源；不存在后台自动确认系列。

正式确认仍需所有者调用既有 media 目录用例，提供证据、幂等键和 expectedRevision；跨系列移动校验双方 revision，并保留追加审计。候选是否有建议不影响既有 `assertCandidatePublishable` 的 review_ready、verified rights、当前 revision/hash 与内容/教学/结构三维审核要求。媒体 publisher 继续从独立 draft 校验 hash、资产及审核，不把建议视作发布资格。

storage 最终 adapter 专项与既有 adapter 回归 **3 文件、20 用例通过**，专项 lint 与全树 tsc 通过；新增 `tests/unit/media-series-adapter-suggestions.test.ts` 验证实际 RSS/LR 接线、请求数量不增加、hash 不变、重复 key、缺字段/冲突、视频频道不猜测，以及在目录、enclosure、artwork 等阶段取消后不返回候选，即使 fake fetch 忽略 signal。

主任务新增 `tests/database/media-series-suggestions-acquisition.test.ts`，真实 PGlite **1 文件、3 用例通过**（`.tmp-media-series-006-persistence.log`）。本代理只读复核确认测试创建完整合法 podcast draft/hash：建议存入独立 metadata、重复发现不改原行/revision/审核，source revision 过期时候选建议和 cursor 一起回滚；candidate 的旧 generation metadata 更新拒绝，review_ready 且有建议也仍因缺当前内容审核而拒绝发布。每条路径检查 `media_series`、memberships、changes、media_items、media_versions、evidence_events 均无新增。

原采集 pipeline baseline 另跑 **4 文件、20 用例通过**（`.tmp-media-series-006-pipeline-baseline.log`），与上述专项分开记录。最后 index 导出与 DB 专项落地后，主任务 root 专项 lint、全树 typecheck 均确认 exit 0（`.tmp-media-series-006-root-lint.log`、`.tmp-media-series-006-typecheck.log`）。整项全量门禁仍由主任务单独登记，不能把分次聚焦通过称作全仓全绿。

## 4. 文件范围与人工复验

- media：`domain/media-series-suggestion.ts`、`schemas/media-series-suggestion.ts`、`application/propose-media-series-suggestion.ts` 及对应 index 导出。
- acquisition：`normalizers/media-series-suggestion.ts`、RSS/LR 既有 adapter；建议只写 metadata。
- 契约：新增建议 JSON Schema、内部 candidate metadata 引用、独立四项契约测试。
- 验证：media 建议单元、adapter 专项和 acquisition 数据库专项；文档同步 architecture、content-authoring、testing-strategy 及内容供应 runbook。

在现有所有者候选详情的结构化数据中检查 `metadata.mediaSeriesSuggestions`：有信息时显示 unconfirmed、来源和 warning；缺信息时为空；正式目录不会自动出现归属。比较同一媒体仅季集提示变化的两次发现，draft/contentHash 应不变；完全重复候选沿用原 metadata。需要确认时按运行手册进入现有所有者目录写入流程，不能把候选建议直接设为 confirmed。

## 5. 限制与下一步

本轮使用 fake adapter/provider 与本地测试，不运行真实采集、收费调用或生产写入。无数据库迁移、公开入口或新建议管理 UI；已有所有者结构化候选预览可读建议。旧候选不自动回填；视频频道不等于系列，playlist 支持不代表已抓取播放列表。全仓 lint/Vitest/E2E、生产 build、真实白名单来源与 iPhone Safari 不由聚焦结果替代。共享树 Commit 与最终门禁由主任务登记；001–006 的整体验收应整理各切片证据，真实媒体自然结束与手机真机仍需独立验证。
