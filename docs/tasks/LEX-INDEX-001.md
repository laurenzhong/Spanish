# LEX-INDEX-001: 词句索引管道（自动抽取 → 双审 → owner 批准 → 索引）

Status: **待放行**（决策与设计已完成，实施计划已出；尚未开始编码）

分支：待定（建议新分支，避免与 `codex/disable-legacy-readlang` 的在途工作互相干扰）

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

## 放行前必须解决

- `docs/tasks/MIG-RECONCILE-001.md` 记录的 **drizzle journal 不一致**：新增迁移前必须先解决，否则迁移基线会冲突。
- READ-SHELF-001 提交时 `docs/architecture.md` 的文案同步留在工作区（该文件同时含 `READ-SAVED-001` 未提交改动），需由该会话随其改动提交后再动该文件。

## 硬约束

- 不新增独立配额；默认开关关闭；缺凭据 fail-closed。
- 审核身份 `dsh-ai-owner-authorized-review`，必须标明 AI 身份，不得描述为真人、母语者或教学专家签字。
- 复用既有 `indexContentVersion()`，不重写索引逻辑。
- 抽取失败、审核失败、低置信度**不得**产生能力证据或降低 `mastery`/`confidence`。
- 默认测试不得调用真实收费 provider。
