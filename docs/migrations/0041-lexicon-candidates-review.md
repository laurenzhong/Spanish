# 迁移审查包：0041 词句候选表（lexicon_candidates）

- 日期：2026-10-10
- 任务：`LEX-INDEX-001`（切片：候选表 schema 与持久化）
- 状态：**已生成，未应用**（产品本人已定：只生成并贴出 diff 供审查）
- 生成器：`drizzle-kit 0.31.10`，`drizzle.config.ts`（`strict: true`）

## 结论摘要

- **只新增一张表**：`lexicon_candidates`（26 列）+ 3 个索引 + 8 个 check 约束。
- **不触碰任何既有表**：产物中没有任何 `ALTER TABLE`（已用正则核对）。
- 从原始 `drizzle/meta/` 干净重跑两次，产物**逐字节一致**（2568 字节），可复现。
- 应用后目标库的 `__drizzle_migrations` 会新增一条记录；为此该文件**未放进 `drizzle/`**，避免任何自动迁移路径把它应用掉。

## 生成方式（可复现命令）

在**临时目录**中运行，避免污染仓库的 `drizzle/`：

```powershell
$scratch = ".tmp-drizzle-gen"
New-Item -ItemType Directory -Force -Path "$scratch\drizzle" | Out-Null
Copy-Item "drizzle.config.ts" "$scratch/drizzle.config.ts"
Copy-Item "drizzle/meta"        "$scratch/drizzle/meta" -Recurse
Copy-Item "src"                 "$scratch/src" -Recurse
Copy-Item ".env"                "$scratch/.env"
cd $scratch
& "D:\workspace\node_modules\.bin\drizzle-kit.CMD" generate
```

`drizzle.config.ts` 的 `out: "./drizzle"` 是相对路径，因此在 scratch 内运行时只写 scratch 的 `drizzle/`。

> **修正记录**：本文档早前版本称「`drizzle/meta/` 只有 `_journal.json`、没有 SQL 快照，diff 基线无法离线复现」。**该判断是错的** —— `drizzle/meta/` 实际有 **37 个 `NNNN_snapshot.json`**（最新 `0040_snapshot.json` 含 80 张表）。因此 `generate` 是基于快照 diff 的，可离线安全复现，无需 introspect 实时库。原判断已作废。

## 完整产物：`drizzle/0041_slimy_mimic.sql`

```sql
CREATE TABLE "lexicon_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_kind" text NOT NULL,
	"document_kind" text NOT NULL,
	"document_stable_key" text NOT NULL,
	"document_version" integer NOT NULL,
	"segment_index" integer NOT NULL,
	"source_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"lemma" text,
	"part_of_speech" text,
	"meaning_zh" text,
	"context_before" text DEFAULT '' NOT NULL,
	"context_after" text DEFAULT '' NOT NULL,
	"source_title" text NOT NULL,
	"source_kind" text NOT NULL,
	"provider" text NOT NULL,
	"model_version" text,
	"confidence" integer,
	"status" text DEFAULT 'discovered' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexicon_candidates_kind_check" CHECK ("lexicon_candidates"."candidate_kind" in ('lexeme', 'phrase')),
	CONSTRAINT "lexicon_candidates_status_check" CHECK ("lexicon_candidates"."status" in ('discovered', 'review_submitted', 'review_ready', 'approved', 'rejected')),
	CONSTRAINT "lexicon_candidates_document_kind_check" CHECK ("lexicon_candidates"."document_kind" in ('article', 'media')),
	CONSTRAINT "lexicon_candidates_version_positive_check" CHECK ("lexicon_candidates"."document_version" > 0),
	CONSTRAINT "lexicon_candidates_segment_index_check" CHECK ("lexicon_candidates"."segment_index" >= 0),
	CONSTRAINT "lexicon_candidates_revision_positive_check" CHECK ("lexicon_candidates"."revision" > 0),
	CONSTRAINT "lexicon_candidates_confidence_check" CHECK ("lexicon_candidates"."confidence" is null or "lexicon_candidates"."confidence" between 0 and 100),
	CONSTRAINT "lexicon_candidates_approved_audit_check" CHECK ("lexicon_candidates"."status" <> 'approved' or ("lexicon_candidates"."approved_by" is not null and "lexicon_candidates"."approved_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lexicon_candidates_identity_uidx" ON "lexicon_candidates" USING btree ("candidate_kind","document_kind","document_stable_key","document_version","segment_index","normalized_text");--> statement-breakpoint
CREATE INDEX "lexicon_candidates_status_idx" ON "lexicon_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lexicon_candidates_document_idx" ON "lexicon_candidates" USING btree ("document_kind","document_stable_key","document_version");
```

## 逐项设计说明

| 设计 | 理由 |
|---|---|
| 独立表，不与 `lexemes`/`phrase_entries` 混放 | 候选是**提议**；批准前不得进入 corpus（ADR-0011）。分表使「未批准不进 corpus」成为结构性事实，而不是靠代码自觉 |
| `status` 用 `text` + check，不用 `pgEnum` | 与 `lexicon-corpus.ts` 既有风格一致（该文件全用 `text` + check） |
| `document_version` 进唯一索引 | 内容改版后重新抽取**不能**与旧候选碰撞；也保证已批准候选不会静默指向新文本 |
| 唯一索引含 `segment_index` + `normalized_text` | 同一段同一词形的重复抽取幂等（`onConflictDoNothing` 可依赖它） |
| `approved_by` + `approved_at` 非空审计约束 | `status='approved'` 时**数据库层**强制要求审批人与时间，防止绕过审计 |
| `confidence` 存整数 0–100 | 避免浮点比较；provider 的 `[0,1]` 在写入前换算 |
| `reviews` 用 `jsonb` 数组 | 与领域模型的 `LexiconCandidateReview[]` 对应，含 `dimension`/`outcome`/`reviewerReference`/`reviewedAt` |
| 未启用 RLS | 候选表**不含用户私有数据**（只有内容侧进展），与 `lexemes`/`phrase_entries` 的公开语料属性一致。**若后续把用户提交的候选写入此表，必须先加 RLS**，见下 |

## 应用前必须完成的检查（尚未做）

1. **在空库或一次性副本上应用并回滚验证** —— `MIG-RECONCILE-001` 第 3 项要求。本次**未执行**（未获授权操作数据库）。
2. **RLS 决策**：当前设计假设候选只来自内容侧自动抽取、无用户私有数据。若将来允许用户提交候选，需同一迁移内补 RLS 与服务端所有权检查（`AGENTS.md` 第 6 节）。
3. **迁移评审签字** —— `MIG-RECONCILE-001` 第 4 项要求。
4. 应用后 `pnpm db:check`（若存在）与 journal 一致性核对。

## 当前仓库状态（重要）

- `src/shared/db/schema/lexicon-corpus.ts` **已加入** `lexiconCandidates` 定义并提交。
- `drizzle/` **未改动**：SQL 文件与快照都**没有**放进仓库。
- 因此**当 schema 源码与数据库不一致**，直到有人显式应用迁移为止。任何 `drizzle-kit generate` 的后续运行都会再次产出这张表的迁移 —— 这是刻意的，用来提醒「迁移尚未应用」。
- 需要应用时：把本文件的 SQL 存为 `drizzle/0041_slimy_mimic.sql`，并把 scratch 的 `drizzle/meta/0041_snapshot.json` 与更新后的 `_journal.json` 一并放入 `drizzle/meta/`，然后走既有迁移流程。
