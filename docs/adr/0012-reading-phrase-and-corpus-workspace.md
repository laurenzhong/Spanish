# ADR-0012：阅读区短语与语料工作区分工及查询语义

- Status: accepted（产品本人于 2026-10-12 确认）
- Date: 2026-10-12
- 关联：ADR-0008（内容驱动学习与自动采集）、ADR-0011（词句索引审核门禁）
- 设计文档：`docs/superpowers/specs/2026-10-12-reading-phrase-and-corpus-page-design.md`
- 实施计划：`docs/plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md`

## Context

阅读规格已经规定 `/read` 同时承载文章、词汇、短语、语料和文字考察，但现有两个页面承担的任务边界还不够明确：

1. `/read/phrases` 已经能展示表达、释义、语用、变体、复习意图和懒加载例句，但卡片缺少首屏代表例句与清晰的来源范围。
2. `/read/corpus` 已经能返回 KWIC、来源和位置，但查询只在客户端保存，界面没有使用 `entryKind/entryId/sourceKind`，也没有匹配模式。
3. 当前多词查询把 token 分开作为 `ILIKE` 条件，表示“同一记录中都出现”，不表示连续短语或原始顺序。用户看到“搜索词或短语”时会合理预期连续表达。
4. 浏览、收藏和个人意图不能被误读为能力证据；文字考察必须拥有独立入口和服务端提交门禁。

## Decision

### 1. 保留两个独立页面

`/read/phrases` 是表达库，负责单个表达的解释、变体、语用和个人复习组织；`/read/corpus` 是语料浏览器，负责查询、比较真实用例和来源定位。两页共用阅读子导航和设计令牌，通过 `entryKind/entryId`、查询 URL 与来源锚点互相深链。

不合并为一个左右分栏工作台。这样可以让短语页保持卡片浏览密度，让语料页保持查询和长上下文的阅读密度，也能沿用当前模块边界和路由。

### 2. 短语首屏展示一条代表例句

`PhraseItem` 提供一条经过可见性过滤的 `representativeOccurrence`，其余例句继续通过有界的懒加载查询获取。没有真实来源时显示空状态，不能生成或拼接例句。

短语 DTO 同时提供不暴露拥有者 ID 的 `scope`（`public` 或 `private`）。服务端依据条目所有权投影该字段，客户端只负责显示“公开/私有”范围标签。

### 3. 多词查询显式区分匹配模式

`corpusQuerySchema` 增加 `match`：

- `phrase`：连续 token、保留顺序、按西语 token 边界匹配；默认值。
- `all`：同一可见内容片段内包含所有查询 token，顺序可以不同。

查询 URL 必须携带 `q`、`match`、来源筛选和页码，使返回、刷新和复制链接可恢复。服务端负责可见性、版本和分页校验，客户端不能自行过滤或放宽结果。

### 4. 语料结果保留来源与实体引用

客户端结果投影使用 `sourceKind`、`entryKind`、`entryId`、`ContentDocumentRef` 和 `SourcePosition`。文章结果跳到段落，媒体结果跳到毫秒和片段。只有存在正式实体引用时才显示“查看词条/短语条目”。

### 5. 能力证据严格隔离

短语浏览、语料查询、例句展开、来源跳转、收藏和复习意图都不写 `evidence_events`、`mastery` 或 `confidence`。文字考察独立提交，只有服务端确认的幂等答题结果更新适用的词汇与短语技能。

## Consequences

### 正面影响

- 页面任务与用户意图对应，短语理解和语料比较不会互相抢占主层级。
- 代表例句让短语卡在首屏就具备使用语境，同时通过懒加载控制页面体积。
- URL 查询状态支持深链、返回和跨页恢复。
- `phrase`/`all` 让“搜索短语”的产品承诺与后端行为一致，并能为以后加入短语模式留下边界。

### 成本与限制

- 需要新增连续 token 匹配的 domain 函数和数据库查询路径，并补充重音、标点、词序、边界和重叠短语测试。
- `representativeOccurrence` 会增加短语列表 DTO，但只返回一条例句和来源，不返回完整正文或全部字幕。
- 地区、日期、说话者只有在来源投影提供可靠字段时才显示；缺少字段时不渲染空筛选。
- 第一版媒体结果仍跳到媒体学习器，不在语料列表中内嵌播放器。

## Alternatives considered

1. **一个统一的词句工作台**：检索、卡片和语料同时出现。它能减少跳转，但首屏信息密度高，移动端难以保持清晰，也会把两个不同的分页、加载和权限模型耦合起来。
2. **只保留当前 token AND 查询**：实现成本低，但无法兑现用户对连续短语的预期，容易把词序分散的句子当作短语例句。作为 `match=all` 保留，不作为默认模式。
3. **短语页只在点击后显示例句**：首屏轻，但用户需要额外操作才能判断表达是否真实可用。产品已选择默认展示一条代表例句。

## References

- `docs/superpowers/specs/2026-10-12-reading-phrase-and-corpus-page-design.md`
- `docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md` §7
- `docs/adr/0011-lexicon-indexing-gate.md`
- `src/modules/lexicon-corpus/domain/kwic.ts`
- `src/modules/lexicon-corpus/schemas/lexicon.ts`
