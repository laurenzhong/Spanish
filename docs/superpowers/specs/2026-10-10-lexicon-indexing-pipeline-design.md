# 设计：词句索引管道（LEX-INDEX-001）

- 日期：2026-10-10
- 状态：**全部决策已定；待出实施计划后方可编码**
- 关联：`docs/adr/0008-content-led-learning-and-automated-ingestion.md`、ADR-0004（MiniMax 标注草稿）、ADR-0011（本设计的决策记录）、`docs/tasks/READ-SHELF-001.md`、`docs/references/2026-10-10-language-reactor-saved-items-research.md`

## 0. 已确认的决策（2026-10-10，产品本人）

| # | 决策 | 结论 |
|---|---|---|
| 1 | **谁来确认词句** | **方案 B**：自动抽取 → 双维度审核 → **owner 批准后才进 corpus**。批准前一律停在候选审核库，`lemmaStatus` 保持 `pending` |
| 2 | **抽取范围** | **全量词元 + 短语**（不只高频词） |
| 3 | **配额** | **走现有每日配额**（文章 50 / 媒体 20），不新开独立配额，避免费用失控 |
| 4 | **短语来源** | **只从已审核分段抽取**，不与 `expressions` 混入同一 `phrase_entries` |
| 5 | **批准粒度** | **默认逐条**；低风险类别可按来源批量批准，且必须留审计 |
| 6 | **来源撤下处置** | **保留词元、隐藏上下文** |

对应 ADR：**`0011-lexicon-indexing-gate.md`**（已撰写）。
> 注：仓库现有 ADR 存在**编号重复**（`0002`、`0003`、`0004` 各有两份文件，缺 `0005`）。本文按「下一个空号」规则使用 `0011`，不重排历史编号。

## 1. 问题（已实证）

生产库只读计数：

| 表 | 行数 |
|---|---|
| `corpus_occurrences` | **0** |
| `lexemes` / `lexeme_forms` | **0** / **0** |
| `phrase_entries` | **0** |
| `user_lexical_intents` | **0** |
| 对照：`articles` | 204（已发布 203） |
| 对照：`media_versions`（已发布 + 清权） | 537 |

代码事实：

1. `indexContentVersion()`（`src/modules/lexicon-corpus/application/index-content-version.ts:9`）**零调用方**。
2. `indexLexeme()` / `indexPhrase()`（仓储层）在生产代码中**只出现在自身定义**，唯一调用方是 `tests/`。
3. 内容发布路径（`publish-candidate.ts`、`auto-publish-article.ts` 等）**完全不触及**词句索引。
4. `tests/unit/corpus-indexing.test.ts` 只覆盖纯函数 `buildContext`，**不覆盖** `indexContentVersion`。
5. `expressions` 是**作者编排**的教学表达（`goalId` + `communicativeIntent` + `chunks` + `grammarNotes` + `cefrLevel`），属学习目标内容，**没有任何代码从它生成词元**。

后果（用户可观察）：

| 页面/能力 | 状态 |
|---|---|
| `/read/corpus` 语料检索 | 恒空 |
| `/read/vocabulary?view=lexicon` 正式词元 | 恒空 |
| `/read/phrases` 短语库 | 恒空 |
| `intent`（`已熟悉/想复现/暂不学习`） | **无从标记**：没有 lexeme id 可标 |
| 高频词详情 `context`/`sourceTitle` | **已修但看不见**（`READ-SHELF-001` 的 B3 正是取这张空表） |
| `view=frequency` 高频词 | ✅ 可用（算 `article_segments` / `media_segments`，不经 `corpus_occurrences`） |
| 默认 `study` 视图 | ✅ 可用（`content/glossary/es-zh-common-v1.json` 静态术语表） |

一句话：**内容有 204 篇文章 + 537 个可用媒体版本，但「从内容确认词句」这一步没有实现**，导致整个词句域除了静态词表与实时词频以外全部为空。

这直接违背产品不变量的表述：「从已发布文章、视频或播客中**确认词句**后，会在这里留下上下文」—— 该动作无代码路径。

## 2. 决策点（已定：方案 B）

**谁来「确认」词句？** 即：什么把一个 surface text 变成一个可信的 `lexeme` / `phrase_entry`？

曾评估的三个候选（**保留备查，已选定 B**）：

| 方案 | 谁确认 | 成本 | 覆盖 | 风险 |
|---|---|---|---|---|
| A. 纯人工 | 所有者在内容工作流里逐条确认 | 极高（204 篇 × N 词） | 极低 | 实际不可行，等于不做 |
| **B. 自动抽取 + 候选审核（已选）** | MiniMax 抽取 → 双维度审核 → **owner 批准后才进 corpus** | 中 | 高 | 模型误抽/漏抽；须 fail-closed |
| C. 只索引用已审核内容的高频词 | 复用现有词频上限（600 词头） | 低 | 低（只有词，无短语、无教学元数据） | 覆盖不足以支撑短语库 |

**选定 B 的理由**（与仓库既有规则完全同构，不是新发明）：

- `AGENTS.md` 第 8 节：「自动采集只允许所有者配置的白名单来源；每日任务最多把素材推进到候选审核库，**不能自动直接发布**」。词元索引与文章/媒体同构，走同一门禁。
- ADR-0004：模型只产出**草稿**，审核与发布是独立步骤，模型不承担判定职责。
- `AGENTS.md` 第 8 节审核身份规则：当前个人 Alpha 由 DSH 完成 `es-ES` 与 `zh-CN` 双维度审核，身份 `dsh-ai-owner-authorized-review`，**必须标明 AI 身份**。
- B 的核心顾虑（污染「正式词元」语义）由 `lemmaStatus: verified | pending` 天然承载：自动抽取默认 `pending`，批准前不进 corpus；`verified` 只能来自明确审核。

**范围与配额**：全量词元 + 短语；共用现有每日配额（文章 50 / 媒体 20）。

## 3. 建议的最小实现轮廓（供评审，非授权）

分层遵循现有边界（`AGENTS.md` 第 4 节）：

1. **输入**：已发布且版权清晰的文章/媒体版本的分段（`article_segments` / `media_segments` 已有 `sourceText`(es) 与 `translation`(zh)）。
2. **抽取**：新增 `lexicon-corpus` 的 provider 接口 `LexemeCandidateProvider`，MiniMax 适配器按**冻结输入**产出候选（词元/词形/词性/短语/语境），响应经 Zod 转内部类型。
3. **候选落库**：新增候选表（或复用 `reviewStatus` 语义），状态机 `discovered → review_ready → approved → indexed`，与内容候选同构。
4. **审核**：复用现有双维度审核（`content-es-ES` + `teaching-zh-CN`），身份 `dsh-ai-owner-authorized-review`。
5. **索引**：仅对 `approved` 调用既有 `indexContentVersion()`（它已实现幂等 `onConflictDoNothing`、`visibleOccurrence` 可见性、`contextBefore/After`），无需重写。
6. **调度**：纳入现有每日内容流水线，只推进到审核库；**默认不索引**，需显式开关。
7. **删除/撤下**：内容撤下时对应 occurrence 必须不可见（既有谓词已覆盖），但需补一条「已索引词元在来源全部撤下后如何处置」的规则。

## 4. 必须先明确的不变量与限制

1. **词元不等于教学表达**：`lexemes` 是语料事实（lemma + POS + 词频），`expressions` 是教学编排（目标 + 语用 + 语法）。管道**不得**把 `expressions` 的内容伪装成语料事实，也不得反向覆盖它。
2. **`lemmaStatus: verified | pending` 必须诚实**：自动抽取的默认是 `pending`；`verified` 只能来自明确审核。前端已按此区分文案（「已确认词元」/「待确认词形」）。
3. **不因生成者与审核者同为 DSH 而自动获得发布资格**（`AGENTS.md` 第 8 节明文）。
4. **无字幕媒体的 ASR 临时音频**规则仍适用；本管道只消费已发布分段，不新增媒体处理。
5. **成本**：MiniMax 调用须记录 provider、模型版本、延迟、请求 ID、估算成本（`AGENTS.md` 第 7 节）。204 篇文章 + 537 媒体版本全量抽取的成本需先估算并设上限。
6. **性能**：`corpus_occurrences.normalized_text` **无索引**；B3 的查询可能 seq-scan。索引管道上线前应评估加索引（需迁移）。

## 5. 交付物与验收（若批准）

- 新增 ADR：`docs/adr/0011-lexicon-indexing-gate.md`（背景/决定/替代方案/后果）
- 新增任务页：`docs/tasks/LEX-INDEX-001.md`
- 领域单测（候选状态机合法/非法/失败/过期迁移）
- 仓储测试（幂等、事务边界、可见性、RLS）
- provider 契约测试 + fake（禁止默认测试调用真实收费 provider）
- 端到端：一篇已发布文章 → 候选 → 双审核 → 批准 → `corpus_occurrences` 出现记录 → `/read/corpus` 可检索 → `/read/vocabulary?view=lexicon` 可见 → `intent` 可标记

## 6. 已确认的剩余决策（2026-10-10，产品本人）

全部前置问题已定，**无未决项**：

| # | 问题 | 结论 |
|---|---|---|
| 1 | 短语来源是否混入 `expressions` | **不混入**。短语**只从已审核分段抽取**；`expressions` 的已发布条目走其自身页面，不并入 `phrase_entries`。守住「语料事实 vs 教学表达」边界（§4 第 1 条） |
| 2 | 批准粒度 | **默认逐条批准**；允许按来源批量批准**明确低风险类别**（例如仅 `pending` 词形的词元），且批量操作必须留审计记录 |
| 3 | 来源全部撤下后词元的处置 | **保留词元、隐藏上下文**。词元是语言事实而非来源内容；`visibleOccurrence` 已保证不泄露已撤下/未清权来源的原文。若词元的 `meaningZh` 直接引用未清权来源，需单独评估 |

这三条与 §0 的三条共同构成实施计划的输入约束。
