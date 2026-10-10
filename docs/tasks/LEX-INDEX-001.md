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

### 切片 3 起的先决条件

- **MiniMax 适配器**需要 provider 凭据；`.env` 中是否已配 MiniMax 需在开工时核实；缺少凭据时必须 fail-closed。
- **候选表 schema 与持久化**（原切片 1 的另一半）需要先完成迁移评审，见下「切分决定」。

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
