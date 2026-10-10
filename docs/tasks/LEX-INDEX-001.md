# LEX-INDEX-001: 词句索引管道（自动抽取 → 双审 → owner 批准 → 索引）

Status: **进行中**（切片 1 与切片 2 已完成并提交；切片 3 起需 provider 凭据与迁移评审）

分支：沿用 `codex/disable-legacy-readlang`（当前工作分支）

## 进展

### 前置核实：`MIG-RECONCILE-001` 的阻塞条件已不成立（2026-10-10 实测）

开工前对目标库只读核实，结论是**原任务页已过时**：

| 检查 | 结果 |
|---|---|
| 词句 schema 是否存在 | ✅ 8 张表全部存在（`corpus_occurrences` 16 列、`lexemes` 11、`lexeme_forms` 7、`phrase_entries` 12、`phrase_variants` 7、`user_lexical_intents` 7、`lexical_assessment_items` 16、`lexical_assessment_attempts` 14） |
| 由哪个迁移建立 | ✅ `0037_migration_reconcile.sql` |
| RLS | ✅ 8 张表全部 `relrowsecurity = true` |
| adapter 检查 | ✅ 已同时允许 `language-reactor` 与 `readlang-links` |
| journal 是否可前向迁移 | ✅ journal 最新 `when` (1790272583887) == 目标库最大 `created_at`，且无「journal 有但库中无记录」的条目 |

目标库有 43 条 recorded、仓库 journal 41 条，其中 2 条（id 41、44）时间戳早于当前最大值，属历史遗留，**不影响前向迁移**。因此 `MIG-RECONCILE-001` 的 7 项要求中 1–3 已完成，**实现可以继续**；其第 4 项（迁移评审）仍适用于本任务新增的迁移。

### 切片 1（部分完成）：候选状态机

Commit `33e39ec`（3 文件，509 行）：新增 `src/modules/lexicon-corpus/domain/lexicon-candidate.ts` + 导出 + `tests/unit/lexicon-candidate.test.ts`（13 例）。

已锁定的不变量（均有测试）：

- 自动抽取**无法**自行到达 `approved`：仅 `discovered → review_submitted → review_ready → approved` 合法，且 `review_ready` 必须双维度通过；
- 任一维度失败**立即**settle 为 `rejected`，不等第二维度；
- `approved` / `rejected` 为终态，`rejected` 不可复活（重新抽取必须产生新 revision）；
- 每次接受的迁移 `revision` 恰好 +1；过期 `expectedRevision` 返回 `CANDIDATE_REVISION_CONFLICT` 而不改动较新状态（过期回调）；
- 候选 id 内嵌 kind/文档/版本/段/归一文本，重新抽取不能冒充同一候选；
- 只声明**可达**的冲突码（`CANDIDATE_REVISION_CONFLICT` / `CANDIDATE_INVALID_TRANSITION` / `CANDIDATE_REVIEW_ALREADY_RECORDED` / `CANDIDATE_REJECTED_IS_TERMINAL`），删掉了无法触发与属于持久层的码。

验证：vitest `13/13`、`tsc --noEmit` exit 0、改动文件 ESLint exit 0。

**尚未做**：候选表 schema 与持久化。切分理由见下。

### 切片 2（已完成）：抽取 provider 契约 + fake

Commit `fcaa4ff`（4 文件）：新增 `src/modules/providers/lexicon-extraction/`（`lexicon-extraction.ts` 契约、`fake-lexicon-extraction.ts`、`index.ts`）+ `tests/contracts/lexicon-extraction-provider-contract.test.ts`（11 例）。

遵循仓库既有 provider 约定（`src/modules/providers/<capability>/` 自带 index）：错误码联合类型、`Readonly` 输入输出、`AbortSignal`、带 `code`/`retryable` 的错误类、显式安全声明、provider/model/延迟/成本可观测字段。

关键设计点：

- provider **只收文本** —— 不收音频、不碰用户私密数据；
- 组装 `LexiconCandidate`（id/revision/status/reviews）留在 application 层，provider 对状态机没有意见；
- `needsOwnerApproval` 恒为 `true`，安全块显式声明不写证据、不影响 `mastery`/`confidence`；
- 词性按受控集合校验，且 fake **一个都不声明** —— 凭空给词性等于编造语言事实；
- 畸形响应**整批失败**，不产生「部分可信」的候选集；
- 取消可传播且不产出候选。

验证：vitest `11/11`、`tsc --noEmit` exit 0、改动文件 ESLint exit 0；并检查了 `lexicon-corpus` domain **不 import** providers、provider 模块自包含，未引入分层反向依赖。

**合并验证**（切片 1+2 及相邻既有套件）：5 文件 / **35 测试**通过（`lexicon-candidate` 13、provider 契约 11、`lexicon-persistence` 6、`frequency-word-context` 4、`corpus-indexing` 1）。

### 切片 3（已完成）：MiniMax 抽取适配器

Commit `43bff2a`（3 文件 580 行）：新增 `src/modules/providers/lexicon-extraction/minimax-lexicon-extraction.ts`、`server.ts`、`tests/unit/minimax-lexicon-extraction.test.ts`（14 例）。

与既有 MiniMax provider（annotation 适配器）同构：`server-only`、可注入 fetch 与 clock、区分超时与调用方取消的 request signal、响应经 Zod 校验、带 `code`/`retryable` 的错误类。

只发分段**文本**（不发音频、不发用户数据），且输出仍**无法**到达 corpus：候选必须先过双维度审核再由 owner 批准。

**把模型输出当作不可信输入**，关键守卫：

- 引用的 surface form **必须真的出现在它声称的段里**，否则丢弃 —— 否则会造出指向「不含该词文本」的 corpus occurrence；
- 引用请求外段落的丢弃；
- 受控集合之外的词性**丢弃而非存为事实**；`lexeme` 带译文、`phrase` 带 lemma 的畸形组合丢弃；
- 即使模型超量产出，也强制调用方的每段上限；
- 畸形响应**整批失败**，不产生部分可信候选。

server-only 适配器从**新增的 `server.ts`** 导出而非 capability index —— 遵循 annotation 模块的既有约定，避免导入契约或 fake 时被 `server-only` 拖累。

验证：vitest `14/14`、`tsc --noEmit` exit 0、ESLint exit 0。测试全程 stub fetch，**不调用真实 provider**。

**验证中发现并修掉的两个问题（值得留档）**：

1. 超时测试第一版的 stub 忽略 `abort` signal，导致适配器的超时路径**从未被执行**、测试空挂 5 秒；改为像真实 `fetch` 一样在 abort 时 reject。
2. `tsc` 抓到 3 个**运行时测试已放过**的类型错误（未标注的 mock 调用元组、无法接受 fetch seam 的 helper 签名），因此 helper 现在显式按 seam 标注类型。

**最终合并验证**（切片 1+2+3 + READ-SHELF-001 修复 + 既有相邻套件）：8 文件 / **58 测试**通过。

### 切片 4 起的先决条件

- **候选表 schema 与持久化**（原切片 1 的另一半）：新增迁移会向真实数据库追加记录，必须先确认 `drizzle-kit generate` 的 diff 归属与基线、在空库/一次性副本验证、经迁移评审。**产品本人已定：只生成迁移、贴出 diff 供审查，不应用到数据库。**
- MiniMax 凭据已核实存在（`.env` 的 `MINIMAX_API_KEY`），但切片 4 之前需确认是否允许真实调用（会产生费用）。

### 候选表 schema（已完成，迁移未应用）

Commit `fc4c599`（2 文件）：`src/shared/db/schema/lexicon-corpus.ts` 加入 `lexiconCandidates`；审查包 `docs/migrations/0041-lexicon-candidates-review.md` 含**完整生成的 SQL**。

**S 已生成、未应用**（产品本人已定：只生成并贴 diff 供审查）：

- `drizzle-kit 0.31.10` 在**临时目录**中基于 `drizzle/meta/` 的原始快照生成，两次运行**逐字节一致**（2568 字节）；
- 产物**只新增一张表** + 3 索引 + 8 check 约束，正则核对**无任何 `ALTER TABLE`**，不触碰既有表；
- SQL 与 snapshot **刻意不放进 `drizzle/`**，因此没有任何自动迁移路径会应用它；
- 因此**schema 源码与数据库暂时不一致**，直到有人显式应用迁移。后续任何 `drizzle-kit generate` 都会再次产出这张表 —— 这是刻意的提醒。

`status = 'approved'` 时数据库层强制要求 `approved_by` 与 `approved_at` 非空 —— 让「未批准不进 corpus」成为**结构性事实**而非代码自觉。

**修正我自己的一处错误**：本页早前称「`drizzle/meta/` 只有 `_journal.json`、没有 SQL 快照，diff 基线无法离线复现」。**这是错的** —— 实际有 **37 个 `NNNN_snapshot.json`**（最新 `0040` 含 80 张表），`generate` 基于快照 diff、可离线复现。已在审查包中留档更正。

**验证**：`tsc --noEmit` exit 0、ESLint exit 0、`tests/database/schema.test.ts` 5/5（新增表未破坏既有 schema 断言）。

**应用前仍需**：空库/一次性副本验证；若将来允许用户提交候选则须补 RLS；迁移评审签字。

### 关于既有数据库测试失败（已实证，与本任务无关）

跑全量 `tests/database` 时 11 个失败（`media-persistence` 5、`article-acquisition-publish` 2、`video-acquisition-publish` 2、`podcast-acquisition-publish` 2），报错为**缺列**（`media_versions.artwork_*` 等），根因是这些套件自行拼接迁移（如 `0000` + `0024`/`0025`/`0026`），基线里没有 artwork 相关迁移。

**已做实证对照**：把 `src/shared/db/schema/lexicon-corpus.ts` 临时还原到父提交 `fc4c599^`（不含 `lexiconCandidates`）后重跑 `media-persistence`，结果**同为 5/5 失败**。因此这些失败是**既有基线缺失**，与本次 schema 改动无关。对照后已把文件逐字节还原（12769 字节，`git diff` 为空）。

### 切分决定：schema + 持久化单独立片

原计划的切片 1 把「状态机」与「候选表迁移」放在一起。实施时拆开，因为二者风险等级不同：

- 状态机是纯逻辑，零风险、可完全测试（已完成）；
- 新增迁移会**追加一条迁移记录到真实数据库**，且现有 `drizzle/meta/` 只有 `_journal.json`、**没有 SQL 快照**，因此 `drizzle-kit generate` 的 diff 基线无法离线复现 —— 在已有 41 条迁移的真实库上运行 generate 可能产出非预期的 schema 漂移。

因此 schema 片必须先：①确认 generate 的 diff 归属与基线；②在**空库/一次性副本**上验证（`MIG-RECONCILE-001` 第 3 项要求）；③经迁移评审后才可对目标库应用（第 4 项要求）。这些动作应显式告知产品本人。

## 为什么有这个任务

`READ-SHELF-001` 验证期间对生产库做只读计数，发现**整个词句语料管道为空**：

| 表 | 行数 |
|---|---|
| `corpus_occurrences` | 0 |
| `lexemes` / `lexeme_forms` | 0 / 0 |
| `phrase_entries` | 0 |
| `user_lexical_intents` | 0 |
| 对照 `articles` | 204（已发布 203） |
| 对照 `media_versions`（已发布+清权） | 537 |

根因：`indexContentVersion()` **零调用方**；`indexLexeme()` / `indexPhrase()` 在生产代码中只出现在自身定义，唯一调用方是 `tests/`；内容发布路径完全不触及词句索引；`corpus-indexing.test.ts` 只覆盖纯函数 `buildContext`。

后果：`/read/corpus`、`/read/vocabulary?view=lexicon`、`/read/phrases` 恒空；`intent` 三态**无从标记**；`READ-SHELF-001` 修好的 B3 上下文在生产不可见。可用能力仅剩 `view=frequency` 与默认 `study`。

## 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 谁来确认词句 | **方案 B**：自动抽取 → 双维度审核 → **owner 批准后才进 corpus** |
| 2 | 抽取范围 | 全量词元 + 短语 |
| 3 | 配额 | 共用现有每日配额（文章 50 / 媒体 20） |
| 4 | 短语来源 | 只从已审核分段抽取，**不并入** `expressions` |
| 5 | 批准粒度 | 默认逐条；低风险类别可按来源批量并留审计 |
| 6 | 来源撤下处置 | 保留词元、隐藏上下文 |

## 关联文档

- 决策记录：`docs/adr/0011-lexicon-indexing-gate.md`
- 设计与不变量：`docs/superpowers/specs/2026-10-10-lexicon-indexing-pipeline-design.md`
- 实施计划（8 个切片）：`docs/plans/2026-10-10-lexicon-indexing-pipeline-implementation-plan.md`
- 发现过程：`docs/tasks/READ-SHELF-001.md`「阻塞发现」

## 注意事项

- ~~`MIG-RECONCILE-001` 记录的 drizzle journal 不一致~~ → **已于 2026-10-10 核实为不再阻塞**（见上「前置核实」）。但其第 3、4 项（空库验证 + 迁移评审）仍适用于本任务新增的迁移。
- `docs/tasks/MIG-RECONCILE-001.md` 任务页本身已过时，建议由合并者更新其状态，不要据它停工。
- READ-SHELF-001 提交时 `docs/architecture.md` 的文案同步留在工作区（该文件同时含 `READ-SAVED-001` 未提交改动），需由该会话随其改动提交后再动该文件。

## 硬约束

- 不新增独立配额；默认开关关闭；缺凭据 fail-closed。
- 审核身份 `dsh-ai-owner-authorized-review`，必须标明 AI 身份，不得描述为真人、母语者或教学专家签字。
- 复用既有 `indexContentVersion()`，不重写索引逻辑。
- 抽取失败、审核失败、低置信度**不得**产生能力证据或降低 `mastery`/`confidence`。
- 默认测试不得调用真实收费 provider。
