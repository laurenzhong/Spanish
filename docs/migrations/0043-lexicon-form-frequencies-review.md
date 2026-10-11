# 迁移记录：0043 词形计数物化表（lexicon_form_frequencies）

- 日期：2026-10-11
- 任务：`task-17`（词汇页性能：物化词形计数表，冷路径降到 1.5 秒以下）
- 状态：**已生成、已预检、已应用**（产品明确批准「全做」，本任务包含应用）
- 生成器：`drizzle-kit 0.31.10`，`drizzle.config.ts`（`strict: true`）
- 产物：`drizzle/0043_curious_magdalene.sql`（+ `drizzle/meta/0043_snapshot.json`、`_journal.json` 第 44 条 `idx=43`）

## 结论摘要

- **只新增两张表**：`lexicon_form_frequencies`（4 列 + 2 check）与
  `lexicon_form_frequency_state`（3 列 + 2 check）。**没有任何 `ALTER TABLE`**，不触碰既有表。
- 迁移在**临时目录**中生成（见下），生成物与 `src/shared/db/schema/lexicon-corpus.ts` 当前定义一致，
  没有夹带他人在途的 schema 变更。
- 只读预检通过后才应用：迁移链无洞（idx 0..43 连续、文件与 journal 一一对应）、
  `drizzle-kit check` 报 `Everything's fine`、目标库两张新表均不存在、`journal` 最新 `when`
  大于目标库 `__drizzle_migrations.max(created_at)`。

## 生成方式（可复现命令）

```powershell
$scratch = ".tmp-task17-drizzle-gen"
New-Item -ItemType Directory -Force -Path "$scratch\drizzle" | Out-Null
Copy-Item "drizzle.config.ts" "$scratch/drizzle.config.ts"
Copy-Item "drizzle/meta"        "$scratch/drizzle/meta" -Recurse
Copy-Item "src"                 "$scratch/src" -Recurse
Copy-Item ".env"                "$scratch/.env"
Push-Location $scratch
& "D:\workspace\node_modules\.bin\drizzle-kit.CMD" generate
Pop-Location
# 产物：$scratch/drizzle/0043_curious_magdalene.sql + meta/0043_snapshot.json + meta/_journal.json
```

`drizzle.config.ts` 的 `out: "./drizzle"` 是相对路径，因此在 scratch 内运行只写 scratch 的
`drizzle/`；确认产物只含本次变更后，再把 SQL、snapshot 与 journal 复制回仓库的 `drizzle/`。

## 完整产物：`drizzle/0043_curious_magdalene.sql`

```sql
CREATE TABLE "lexicon_form_frequencies" (
	"word" text PRIMARY KEY NOT NULL,
	"occurrence_count" integer NOT NULL,
	"example_title" text NOT NULL,
	"example_text" text NOT NULL,
	CONSTRAINT "lexicon_form_frequencies_word_check" CHECK (length("lexicon_form_frequencies"."word") >= 2),
	CONSTRAINT "lexicon_form_frequencies_count_check" CHECK ("lexicon_form_frequencies"."occurrence_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "lexicon_form_frequency_state" (
	"id" text PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"form_count" integer NOT NULL,
	CONSTRAINT "lexicon_form_frequency_state_id_check" CHECK ("lexicon_form_frequency_state"."id" = 'corpus'),
	CONSTRAINT "lexicon_form_frequency_state_count_check" CHECK ("lexicon_form_frequency_state"."form_count" >= 0)
);
```

## 逐项设计说明

| 设计 | 理由 |
|---|---|
| 独立表，不塞进 `lexemes`/`corpus_occurrences` | 这是**词汇页的读模型**，不是语料事实的新来源；表里的每一条都必须能由 `source_texts` 谓词重算出来 |
| `word` 作主键（折叠后的词形） | 与 token 索引、页面查找用的是同一个键；读取是 `word = any(...)` 的主键等值集合，一次索引扫描 |
| `example_title` / `example_text` 非空 | 两个来源的 `source_text`、`title` 在 schema 里都是 `NOT NULL`，所以 `min(array[text,title])` 一定有值；不需要"示例可能为空"的分支 |
| `word` 长度 >= 2 的 check | live 查询在 JS 里丢弃折叠后长度 < 2 的词形；刷新侧用同一条规则（`length(word) >= 2`）把它们挡在表外，两条路径才等价 |
| `occurrence_count > 0` | 计数来自 group by，必然是正数；写进 0 说明刷新逻辑出错，宁可让数据库拒绝 |
| 单独的 `lexicon_form_frequency_state` 单行表 | 读取路径需要区分「从未刷新」和「刷新过但这个页面上的词恰好为 0 次」；空结果无法区分这两件事，而把后者当成前者会谎报 |
| 无 RLS | 表内是内容侧公开语料的词频，不含任何用户私有数据（与 `lexemes`/`phrase_entries` 的公开属性一致） |

## 应用结果（真实输出）

只读预检（应用前）：

```
database: postgres @ 2406:da18:1248:be00::4ff7/128
lexicon_form_frequencies present: NO
lexicon_form_frequency_state present: NO
recorded migrations: 45
latest recorded created_at: 1791680750773
visible source segments now: 99285 media + 9926 article = 109211
```

`drizzle-kit check`：`Everything's fine 🐶🔥`

应用：`node_modules/.bin/drizzle-kit.CMD migrate` → `[✓] migrations applied successfully!`

应用后结构核对（真实输出）：

```
lexicon form-frequency tables present: lexicon_form_frequencies, lexicon_form_frequency_state
  lexicon_form_frequencies.word text not null
  lexicon_form_frequencies.occurrence_count integer not null
  lexicon_form_frequencies.example_title text not null
  lexicon_form_frequencies.example_text text not null
  lexicon_form_frequency_state.id text not null
  lexicon_form_frequency_state.refreshed_at timestamp with time zone not null
  lexicon_form_frequency_state.form_count integer not null
check constraints: lexicon_form_frequencies_count_check, lexicon_form_frequencies_word_check,
                   lexicon_form_frequency_state_count_check, lexicon_form_frequency_state_id_check
rows after migration, before refresh: 0 form rows, 0 state row(s)
recorded migrations: 46 (latest created_at 1791709664573)
```

首次刷新（`scripts/refresh-frequency-forms.ts`）：

```
previous refresh   (never)
forms written      62996
refreshed at       2026-10-11T09:15:43.065Z
duration           14676 ms
state row          2026-10-11T09:15:43.065Z (62996 forms)
```

## 刷新时机与陈旧度

- **刷新入口**：`scripts/refresh-frequency-forms.ts`。发布/撤下/改版**不会**自动触发刷新。
- **可重跑且幂等**：整个刷新（delete + insert + 状态行）在一个事务内，读者只会看到旧的完整集合或
  新的完整集合，永远不会看到写了一半的表；重复运行得到同样的行和新的时间戳。
- **最坏陈旧度**：`刷新周期 + 刷新耗时`。按推荐的每日（夜间）节奏，约 24 小时 + 15 秒。
- **上界是被执行的，不是写在文档里的**：`refreshed_at` 超过 36 小时后，读取路径不再信任该表，
  改跑完整 live 扫描 —— 宁可慢，不给陈旧数字；并在日志里打印 `stale: refreshed Xh ago, cap is 36.0h`。
- **可观测**：`select refreshed_at, form_count from lexicon_form_frequency_state;`；每次冷加载打印
  数据来源与刷新年龄；从未刷新/空表/超龄/表不存在各自的回落原因都会打印。
- **空表与未刷新绝不等于 0**：无状态行、表为空、或代码先于迁移上线（表不存在）都回落到 live 扫描，
  页面的计数仍然正确。

## 回滚

反向迁移未生成（本任务不做回滚演练）。若需回退：

```sql
drop table if exists lexicon_form_frequencies;
drop table if exists lexicon_form_frequency_state;
```

删除这两张表只会让读取路径回落到 live 扫描（回落分支已在测试中覆盖），不会改变任何用户可见的事实。
`drizzle/meta` 中的 `0043_snapshot.json` 与 journal 条目需在回滚时一并处理，否则后续 `generate`
会以为这两张表仍然存在。

## 已验证内容（详见任务交接）

- 新增/既有共 6 个文件 41 个用例全绿：刷新幂等、可见性双路径一致、空表/未刷新/超龄/表缺失四种回落、
  快速路径恰好 1 条语句且不扫语料、共享可见性片段的漂移防护、以及「只有唯一模块喂这张表」的结构性防护
  （`tests/database/corpus-form-frequency-materialisation.test.ts` 11 例 +
  `tests/unit/corpus-form-frequency-source.test.ts` 3 例 + `frequency-word-{shelf,context,example,list}` 27 例）。
- 真实库：逐字段等价 6,296 个词形（计数/示例文本/示例标题各 0 处不一致），
  头条数字 `ser 2659`、`todo 3670`、`ya 6064`、`total 7922` 与人工对账一致；
  交错 A/B 冷路径 live 3555/3585/3657 ms → materialised 927/947/994 ms（同进程内、排除建连开销）。
