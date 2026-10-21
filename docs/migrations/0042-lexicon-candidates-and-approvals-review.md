# 迁移审查包：0042 词句候选表 + 审批审计表

- 日期：2026-10-10（0042 生成并核实于 2026-10-11；**同日已应用**）
- 任务：`LEX-INDEX-001`（切片：候选表 schema 与持久化）
- 状态：**已应用**（2026-10-11，`drizzle-kit migrate` 成功）
- 生成器：`drizzle-kit 0.31.10`，`drizzle.config.ts`（`strict: true`）
- 迁移文件：`drizzle/0042_stale_starbolt.sql`（本文件 SQL 与它**逐字节一致**，由测试断言）
- **本文件取代早前的 `0041` 审查包**（原因见下「编号变更」）

## 应用结果（2026-10-11 实测）

| 项 | 结果 |
|---|---|
| `drizzle-kit migrate` | **成功**（`migrations applied successfully!`） |
| 目标库已记录迁移 | 43 → **45** 条 |
| 0042 的记录 hash | `87f605031606…` —— 与本文件 SQL 的 SHA256 **一致** |
| `lexicon_candidates` / `lexicon_candidate_approvals` | **均已建立** |
| `articles` / `media_versions` 行数 | 204 / 540 —— **未受影响** |
| `drizzle-kit check` | `Everything's fine` |

应用过程中 Postgres 给出一条 NOTICE：外键名 `lexicon_candidate_approvals_candidate_id_lexicon_candidates_id_fk` 共 68 字符，超过标识符 63 字符上限，被截断为 `..._id_`。**这是无害的**：已实测该外键存在且定义正确（`FOREIGN KEY (candidate_id) REFERENCES lexicon_candidates(id) ON DELETE CASCADE`）。

**应用后立刻做的验证**：`scripts/verify-drizzle-candidate-repository.ts` 在真实库上跑通 create / 幂等 create / `findById` / jsonb 与时间戳往返 / CAS 两种结局 / 只读索引查询 / 数据库层审计约束，**14/14 通过且回滚干净（0 行残留）**。**该验证当场抓出一个真 bug**：Drizzle 仓储的 `findById` 对当前 `makeCandidateId()` 产出的每个 id 都返回 null（逆解析函数仍按旧的 5 字段格式，而 id 已含 `documentKind` 共 6 字段）。已修复并补回归测试，见 Commit `dee8bc7`。**这个 bug 类型检查与全部既有测试都抓不到** —— 内存实现按六列直接做键、从不解析 id；只有真实查询能暴露它。

## 结论摘要

- 一次迁移**新增两张表**：`lexicon_candidates`（26 列）与 `lexicon_candidate_approvals`（15 列），加 6 个索引（含 2 个唯一索引）与 13 个 check 约束。
- **不触碰任何既有表**：产物中没有任何针对既有表的 `ALTER TABLE`（唯一的 `ALTER TABLE` 是为新表加外键）。
- **不重复建他人表**：产物**不含** `media_cefr` 相关表（编号冲突的对象）。
- 从原始 `drizzle/meta/` 干净重跑两次，**SQL 内容 SHA256 完全一致**（`87F60503…`，4768 字节）；文件名后缀由 drizzle-kit 随机生成，内容可复现。
- 应用后目标库的 `__drizzle_migrations` 会新增一条记录；为此刻意**不放入 `drizzle/`**。

## 编号变更（重要）

早前审查包生成的迁移号是 **`0041_slimy_mimic`**。此后另一会话把 **`0041` 用于 `0041_media_cefr_four_levels`**（学习页主题分类工作），该编号已被占用。因此本次从当前 `drizzle/meta/`（含 `0041`，共 42 条 journal）重新生成，得到 **`0042`**。旧的 `0041` 产物作废并被删除（它也不含审批表）。

> 附带发现：`drizzle/meta/_journal.json` 与 `drizzle/0041_media_cefr_four_levels.sql` 在 `git ls-files` 中**未被跟踪** —— 即 `0041` 是另一会话**尚未提交**的在途工作。本审查包不触碰它。

## 生成方式（可复现命令）

在**临时目录**中运行，避免污染仓库的 `drizzle/`：

```powershell
$scratch = ".tmp-drizzle-gen3"
New-Item -ItemType Directory -Force -Path "$scratch\drizzle" | Out-Null
Copy-Item "drizzle.config.ts" "$scratch/drizzle.config.ts"
Copy-Item "drizzle/meta"        "$scratch/drizzle/meta" -Recurse
Copy-Item "src"                 "$scratch/src" -Recurse
Copy-Item ".env"                "$scratch/.env"
cd $scratch
& "D:\workspace\node_modules\.bin\drizzle-kit.CMD" generate
```

`drizzle.config.ts` 的 `out: "./drizzle"` 是相对路径，因此在 scratch 内运行只写 scratch 的 `drizzle/`。

## 完整产物：`drizzle/0042_*.sql`

```sql
CREATE TABLE "lexicon_candidate_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"mode" text NOT NULL,
	"batch_id" text,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"document_kind" text NOT NULL,
	"document_stable_key" text NOT NULL,
	"document_version" integer NOT NULL,
	"segment_index" integer NOT NULL,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lexeme_count" integer DEFAULT 0 NOT NULL,
	"phrase_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexicon_candidate_approvals_mode_check" CHECK ("lexicon_candidate_approvals"."mode" in ('single', 'batch')),
	CONSTRAINT "lexicon_candidate_approvals_revision_positive_check" CHECK ("lexicon_candidate_approvals"."revision" > 0),
	CONSTRAINT "lexicon_candidate_approvals_document_kind_check" CHECK ("lexicon_candidate_approvals"."document_kind" in ('article', 'media')),
	CONSTRAINT "lexicon_candidate_approvals_batch_id_check" CHECK (("lexicon_candidate_approvals"."mode" = 'batch' and "lexicon_candidate_approvals"."batch_id" is not null) or ("lexicon_candidate_approvals"."mode" = 'single' and "lexicon_candidate_approvals"."batch_id" is null)),
	CONSTRAINT "lexicon_candidate_approvals_counts_check" CHECK ("lexicon_candidate_approvals"."lexeme_count" >= 0 and "lexicon_candidate_approvals"."phrase_count" >= 0)
);
--> statement-breakpoint
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
ALTER TABLE "lexicon_candidate_approvals" ADD CONSTRAINT "lexicon_candidate_approvals_candidate_id_lexicon_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."lexicon_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lexicon_candidate_approvals_candidate_revision_uidx" ON "lexicon_candidate_approvals" USING btree ("candidate_id","revision");--> statement-breakpoint
CREATE INDEX "lexicon_candidate_approvals_batch_idx" ON "lexicon_candidate_approvals" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "lexicon_candidate_approvals_approved_at_idx" ON "lexicon_candidate_approvals" USING btree ("approved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lexicon_candidates_identity_uidx" ON "lexicon_candidates" USING btree ("candidate_kind","document_kind","document_stable_key","document_version","segment_index","normalized_text");--> statement-breakpoint
CREATE INDEX "lexicon_candidates_status_idx" ON "lexicon_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lexicon_candidates_document_idx" ON "lexicon_candidates" USING btree ("document_kind","document_stable_key","document_version");
```

## 逐项设计说明

### `lexicon_candidates`

| 设计 | 理由 |
|---|---|
| 独立表，不与 `lexemes`/`phrase_entries` 混放 | 候选是**提议**；批准前不得进入 corpus（ADR-0011）。分表使「未批准不进 corpus」成为**结构性事实**而非代码自觉 |
| `status` 用 `text` + check，不用 `pgEnum` | 与 `lexicon-corpus.ts` 既有风格一致 |
| `document_version` 进唯一索引 | 内容改版后重新抽取**不能**与旧候选碰撞，也保证已批准候选不会静默指向新文本 |
| 唯一索引 `…_identity_uidx` 含六列**且与 `makeCandidateId()` 逐列对齐** | 一个 domain id 精确对应一行；`documentKind` 不一致会折叠 id（已修复，见 Commit `375edcf`） |
| `status='approved'` 必须有 `approved_by` + `approved_at` | **数据库层**强制审计，无法绕过 |
| `confidence` 存整数 0–100 | 避免浮点比较；provider 的 `[0,1]` 写入前换算 |

### `lexicon_candidate_approvals`（本次新增）

| 设计 | 理由 |
|---|---|
| 独立子表 | `mode`/`batch_id`/`lexeme_count`/`phrase_count` 在候选表里**没有列**；合并会逼 Postgres 实现要么抛异常、要么**静默丢弃审计证据** |
| 唯一索引 `(candidate_id, revision)` | 同一次批准只记录一次；重试幂等 |
| `batch_id` 与 `mode` 的互斥 check | `batch` 成员必须指名批次，`single` 必须为空 —— 防止「批量批准」被悄悄记成单条 |
| `reviews` 快照 | 保留批准当时的两个维度，即使候选行之后推进或审核身份变化，审计仍可读 |
| `ON DELETE cascade` | 候选被删则审计随之清理（审计属于该候选，不是独立事实） |
| **不启用 RLS** | 批准由所有者对**内容侧**候选做出，不含终端用户私有数据，与公开语料表属性一致。**若将来允许用户提交候选，本表必须同一变更内加 RLS** |

## 应用前的检查（均已完成）

1. **在一次性 Postgres 上应用并验证** —— **已完成**。`tests/database/lexicon-candidates-migration.test.ts`（7 例）在一台真实 Postgres（PGlite）上**真正执行**该迁移并断言产物：两张表、8 个索引、13 个 check 全部存在，且 `approved_audit_check`、`batch_id_check`、身份唯一索引**确实拒绝**违规行。
2. **只读预检真实库** —— **已完成**（`scripts/preflight-migration-0042.ts`）：43 条迁移已记录、`cefr` 数据无越界值、两张词句表均不存在。
3. **`0041` 依赖已解决** —— **已完成**。`0041_media_cefr_four_levels` 原为另一会话**未提交**的在途文件却已占用 journal idx 41，导致前向链不可应用（Drizzle 按序应用、不能跳过）。已按最小完整集落地（SQL + 快照 + journal + schema 的 CEFR 一行 + 它自带的测试），**不含**该会话其余在途工作，见 Commit `c4be780`。
4. **RLS 决策复核** —— 维持**不加 RLS**：批准由所有者对**内容侧**候选做出，不含终端用户私有数据。**若将来允许用户提交候选，本表必须同一变更内加 RLS。**
5. **编号再确认** —— `0041` 已落地，`0042` 编号稳定。
6. **应用后 journal 一致性** —— **已核对**：目标库 45 条记录，最新一条 hash 与本文件 SQL 一致。

## 当前仓库状态

- `src/shared/db/schema/lexicon-corpus.ts` 含 `lexiconCandidates` 与 `lexiconCandidateApprovals` 两个定义。
- `drizzle/0042_stale_starbolt.sql` + `drizzle/meta/0042_snapshot.json` + journal 条目**均已提交**，且**已应用到真实库** —— schema 源码、迁移历史与数据库三者一致。
- `docs/migrations/0042_lexicon_candidates_and_approvals.sql` 是审查副本，与 `drizzle/` 里实际应用的产物**逐字节一致**（由测试断言，防止审查文档漂移）。
