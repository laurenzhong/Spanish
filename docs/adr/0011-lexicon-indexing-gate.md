# ADR-0011: Lexicon Indexing Gate — Automatic Extraction, Owner-Gated Corpus Publication

- Status: accepted（产品本人于 2026-10-10 确认方案 B）
- Date: 2026-10-10
- 关联：ADR-0004（MiniMax 标注草稿）、ADR-0007（owner-authorized AI content review）、ADR-0008（内容驱动学习与自动采集）、ADR-0010（已审核文章自动发布）
- 设计文档：`docs/superpowers/specs/2026-10-10-lexicon-indexing-pipeline-design.md`
- 编号说明：仓库现有 ADR 存在编号重复（`0002`、`0003`、`0004` 各两份，缺 `0005`）。本文取下一个空号 `0011`，不重排历史编号。

## Context

词句语料模块（`lexicon-corpus`）的索引管道从未接线。生产库只读计数：

| 表 | 行数 |
|---|---|
| `corpus_occurrences` | 0 |
| `lexemes` / `lexeme_forms` | 0 / 0 |
| `phrase_entries` | 0 |
| `user_lexical_intents` | 0 |
| 对照 `articles` | 204（已发布 203） |
| 对照 `media_versions`（已发布+清权） | 537 |

即：**内容充足，但「从内容确认词句」这一步没有代码路径**。代码事实：

1. `indexContentVersion()`（`src/modules/lexicon-corpus/application/index-content-version.ts:9`）零调用方；
2. `indexLexeme()` / `indexPhrase()` 在生产代码中只出现在自身定义，唯一调用方是 `tests/`；
3. 内容发布路径（`publish-candidate.ts`、`auto-publish-article.ts` 等）完全不触及词句索引；
4. `tests/unit/corpus-indexing.test.ts` 只覆盖纯函数 `buildContext`，不覆盖 `indexContentVersion`。

后果：`/read/corpus`、`/read/vocabulary?view=lexicon`、`/read/phrases` 恒空；学习状态 `familiar/revisit/ignore` **无从标记**（没有 lexeme id 可标）；`READ-SHELF-001` 刚修好的高频词上下文（B3）在生产不可见，因为它读的正是这张空表。可用能力仅剩 `view=frequency`（实时聚合 `article_segments`/`media_segments`）与默认 `study`（静态术语表）。

这违背产品不变量的表述：「从已发布文章、视频或播客中**确认词句**后，会在这里留下上下文」。

## Decision

**采用「自动抽取 + 双维度审核 + owner 批准后才进 corpus」，且自动环节只推进到候选审核库。**

1. **输入**：仅已发布且版权清晰的文章/媒体版本的分段（`article_segments` / `media_segments` 已有 `sourceText`(es) 与 `translation`(zh)）。
2. **抽取**：`lexicon-corpus` 定义内部 provider 接口（形如 `LexemeCandidateProvider`），MiniMax 适配器按**冻结输入**产出候选（词元/词形/词性/短语/语境），响应经 Zod 转为内部类型。
3. **候选落库**：候选带状态机 `discovered → review_ready → approved → indexed`，与内容候选同构。
4. **审核**：复用现有双维度审核（`content-es-ES` + `teaching-zh-CN`），审核身份 `dsh-ai-owner-authorized-review`，**必须标明 AI 身份**，不得描述为真人、母语者或教学专家签字。
5. **索引**：仅对 `approved` 调用既有 `indexContentVersion()`。该函数已实现幂等（`onConflictDoNothing`）、可见性（`visibleOccurrence`：文档已发布、媒体版权清晰、`owner_user_id is null`）与 `contextBefore/After`，**不需要重写**。
6. **配额与调度**：纳入现有每日内容流水线，**共用现有配额**（文章 50 / 媒体 20），不新开独立配额。
7. **默认关闭**：索引默认不启用，需显式开关；缺少 provider 凭据时 fail-closed，不得把候选或审核通过计为已索引。

## Consequences

### 必须守住的不变量

1. **词元 ≠ 教学表达**。`lexemes` 是语料事实（lemma + POS + 词频），`expressions` 是教学编排（`goalId` + `communicativeIntent` + `chunks` + `grammarNotes` + `cefrLevel`）。管道不得把 `expressions` 的内容伪装成语料事实，也不得反向覆盖它。
2. **`lemmaStatus` 必须诚实**。自动抽取默认 `pending`；`verified` 只能来自明确审核。前端已按此区分文案（「已确认词元」/「待确认词形」）。
3. **不因生成者与审核者同为 DSH 而自动获得发布资格**（`AGENTS.md` 第 8 节明文）。AI 生成内容仍先进入草稿，须经独立双维度审核、版本化修订与完整校验。
4. **来源与许可边界不变**：只消费已发布且清权的分段；不得复制未授权全文；撤下内容不得因索引而继续可见。
5. **成本可观测**：MiniMax 调用须记录 provider、模型版本、延迟、请求 ID、估算成本（`AGENTS.md` 第 7 节），并设上限。
6. **低置信度与失败不产生能力证据**：抽取/审核失败不得生成 `evidence_events`，也不得降低 `mastery`/`confidence`。索引本身只产生语料事实，不是能力证据。

### 已接受的风险与缓解

| 风险 | 缓解 |
|---|---|
| 模型误抽（把屈折形式当独立词元、专名当普通词） | 候选审核 + `lemmaStatus: pending` 默认值 + 词性来自受控集合 |
| 模型漏抽 | 抽取只决定「候选集」，不决定「最终词表」；后续可重跑并增量补齐（幂等 `onConflictDoNothing`） |
| 全量抽取的 provider 费用 | 共用每日配额 + 估算上限 + 默认关闭的显式开关 |
| `corpus_occurrences.normalized_text` **无索引**，`READ-SHELF-001` 的代表出现查询可能 seq-scan | 上线前评估加索引（需迁移）；先量测再决定 |
| 索引把已撤下来源的文本带入上下文 | 复用既有 `visibleOccurrence` 谓词；代表出现查询必须同样受限 |

### 补充确认（2026-10-10，同日定稿，无未决项）

1. **短语来源**：只从已审核分段抽取；**不**把 `expressions` 的已发布条目并入 `phrase_entries`（守住「语料事实 vs 教学表达」边界）。
2. **批准粒度**：默认逐条批准；允许按来源批量批准**明确低风险类别**（例如仅 `pending` 词形的词元），批量操作必须留审计记录。
3. **来源全部撤下后的处置**：**保留词元、隐藏上下文**。词元是语言事实而非来源内容；`visibleOccurrence` 已保证不泄露已撤下/未清权来源的原文。若词元的 `meaningZh` 直接引用未清权来源，需单独评估。

### 替代方案与不选原因

- **纯人工逐条确认**：204 篇文章 + 537 个媒体版本的工作量实际等于不做，覆盖不足以支撑 `/read/corpus` 与短语库。
- **只索引已审核内容的高频词**：成本最低，但没有短语库、没有词性与词元审核，覆盖过窄；可作为方案 B 的**降级路径**（若 provider 费用超限，先只跑高频词）。
- **抽取后直接索引（不经 owner 批准）**：违反 `AGENTS.md` 第 8 节「不能自动直接发布」与 ADR-0007 的审核门禁，且会把未审核词元混入「正式词元」语义。**明确排除。**

## References

- 设计文档：`docs/superpowers/specs/2026-10-10-lexicon-indexing-pipeline-design.md`
- 发现过程：`docs/tasks/READ-SHELF-001.md`「阻塞发现」
- 外来调研对照：`docs/references/2026-10-10-language-reactor-saved-items-research.md`
