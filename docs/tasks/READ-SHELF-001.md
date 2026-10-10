# READ-SHELF-001: 词句书架可见缺陷修复（B1–B6）

Status: **代码完成并验证（未提交）**。B1–B6 全部修复；`tsc` / 聚焦单测 / ESLint / 受影响 e2e 全绿。

**重要后续（本次发现，优先级高于本任务）**：词句语料管道在生产为空，见文末「阻塞发现」。

分支：`codex/disable-legacy-readlang`（沿用当前工作分支；本任务是缺陷修复，不新增分支）

## 来源

缺陷清单来自 2026-10-10 Language Reactor「已保存项目」页调研的对照结论：
`docs/references/2026-10-10-language-reactor-saved-items-research.md` §7.3。

该调研同时确认了两个产品决策（本任务只落实前者）：

| 决策 | 结论 |
|---|---|
| **D1 到期/复习调度** | **暂不引入**。先做「上下文 + 组织 + 导出」；复习结果与能力证据的关系**之后再单独设计**（涉及 `mastery`/`confidence` 分离与「阅读不产生口语证据」两条不变量，需 ADR） |
| 私人 AI 故事归类 | 归入「文章」kind 之下（`origin: "generated"`），不作为独立页签。**已由 `READ-SAVED-001` Phase 2 实现**，本任务不改 |

## 六个缺陷（均为代码级核实）

| # | 缺陷 | 证据位置 |
|---|---|---|
| B1 | 高频词网格学习状态筛选链接**不产生筛选效果**：只带 `intent` 不带 `view`，`viewSchema` 回落 `study`，而 `VocabularyStudyList` 从不读 `intent` | `vocabulary-word-grid.tsx:52`、`app/(product)/read/vocabulary/page.tsx`（`viewSchema`、`VocabularyStudyList` 调用处） |
| B2 | 「保存的短语」指向**公共短语库**而非已保存书架 | `vocabulary-word-grid.tsx:47` |
| B3 | 高频词详情 `context` / `sourceTitle` **恒为 null**（仓库层硬编码，单测直接喂数据掩盖了它） | `drizzle-lexicon-corpus-repository.ts:246-247` |
| B4 | 语料检索页**无分页控件**，API 已支持 `page`/`pageSize` 但表单不发 | `corpus-search.tsx:35` |
| B5 | 同一三态枚举**两套中文文案**：服务端 `已熟悉/想复现/暂不学习` vs 本机 `已掌握/学习中/不学习` | `lexicon-shelf-controls.tsx:7-9` vs `vocabulary-study-list.tsx:29-34` |
| B6 | `VocabularyWordGrid` 的 `saved` 字段恒 `false`、无赋值来源，「查看保存记录」入口不可达 | `vocabulary-word-grid.tsx:13,58`、`page.tsx:93` |

## 执行分组（按文件归属切分，避免写冲突）

| 组 | 覆盖 | 写范围 | 负责 |
|---|---|---|---|
| **G1** | B1 / B2 / B6 | `src/modules/reading/ui/vocabulary-word-grid.tsx`、`app/(product)/read/vocabulary/page.tsx`、`tests/unit/vocabulary-word-grid.test.tsx` | teammate `grid-link-fixer`（shared task `task-1`） |
| **G2+G3** | B3 / B4 / B5 | `src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository.ts`、`src/modules/lexicon-corpus/ui/corpus-search.tsx`、`src/modules/reading/ui/vocabulary-study-list.tsx`、`tests/unit/`（新增文件名，不改 G1 的测试文件） | teammate `repo-pagination-fixer`（shared task `task-2`） |

## 已确认的修法

- **B1**：让状态筛选链接落到**真正消费 `intent` 的视图**（默认 `view=lexicon`，服务端 `user_lexical_intents` 是权威）。
- **B2**：改为指向已保存书架中包含短语的位置（`READ-SAVED-001` 后页签为 `全部 ｜ 文章 ｜ 保存词语 / 短语 ｜ 高亮`，短语对应 `itemType=phrase`）。
- **B3**：从 `corpus_occurrences` 取**一个代表出现**，填 `context`（`contextBefore + surfaceText + contextAfter`，需截断）与 `sourceTitle`；**必须复用现有 `visibleOccurrence` 可见性谓词**（已发布 + 版权清晰），不得暴露已撤下/未清权来源；不得引入 N+1。
- **B4**：补分页控件并把 `page` 带入请求；保持 `AbortController` 取消语义与 loading/empty/error 三态。
- **B5**：统一到服务端链文案 `已熟悉 / 想复现 / 暂不学习`；只改文案，不动枚举值与 API 契约。
- **B6**：给出真实数据源；**若当前页面数据无法判断，则移除该不可达入口（连同 `saved` 字段）**，禁止保留恒 `false` 字段假装可用。

## 硬约束

- 不新增数据库迁移。
- 不改 `contracts/`（枚举与 DTO 不在本任务范围）。
- 不删除或放宽测试来通过；`tests/unit/vocabulary-speech-feedback.test.tsx` 是**既有失败**，与本任务无关，报告时必须分开。
- 无 `DATABASE_URL` 时，B3 的 SQL 正确性只能标注「未执行 DB 级验证」，不得用假数据单测替代该结论。

## 验收

1. 六处缺陷各有可复现的验证（单元测试优先，B4 需覆盖翻页请求，B3 需证明仓库层真的取到了 `corpus_occurrences` 的值而非假数据）。
2. `pnpm exec tsc --noEmit`：本次改动引入的错误为 0；既有错误（其他会话在途改动）单独列出并引用原文。
3. 改动文件的 ESLint exit 0。
4. Lead 复核最终 diff，并确认没有越出各自 write scope。
5. 交付说明包含：改动文件与行号、测试命令与真实结果、未执行项与原因、已知限制。

## 执行结果（Lead 在冻结树上统一验证）

改动范围（7 个已跟踪文件 + 2 个新增测试，均在授权 write scope 内）：

| 文件 | 变化 |
|---|---|
| `src/modules/reading/ui/vocabulary-word-grid.tsx` | B1 状态链接加 `view=lexicon`；B2「保存的短语」改指已保存书架；B5 文案统一并去图标；B6 删除 `saved` 字段与死入口 |
| `app/(product)/read/vocabulary/page.tsx` | 删除 `saved: false,` 投影（B6） |
| `src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository.ts` | B3 代表出现批量查询填 `context`/`sourceTitle`（1 次查询/页） |
| `src/modules/lexicon-corpus/ui/corpus-search.tsx` | B4 发送 `page`、保留已提交查询与筛选、补分页控件 |
| `src/modules/reading/ui/vocabulary-study-list.tsx` | B5 文案 → `已熟悉/想复现/暂不学习` |
| `tests/e2e/lexicon-library.spec.ts` | 断言同步 `已熟悉` |
| `docs/architecture.md:236` | 文案同步，保留「仅存浏览器、不写能力证据」 |
| `tests/unit/frequency-word-context.test.ts`（新） | B3：PGlite 真实 SQL，4 例 |
| `tests/unit/corpus-search-pagination.test.tsx`（新） | B4：翻页与三态，4 例 |

**统一验证结果（所有 writer 停止后由 Lead 执行）**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0，零诊断** |
| 聚焦 Vitest（13 文件） | **63/63 通过** |
| 改动文件 ESLint（10 文件） | **exit 0** |
| Playwright `lexicon-library.spec.ts` | **6 passed**（desktop + mobile） |
| 变异验证（由 G1 执行） | 还原旧行为 → B1/B2/B6 三条测试转红；重新加回 `saved: boolean` → `tsc` 报 `TS2578`，编译期守卫有效 |

**未执行**：全仓 `pnpm lint`（尝试后 Node 堆 OOM，exit 134，属本机内存限制；改动文件单独 lint 通过）；`pnpm build`；`pnpm test:e2e` 全量；`tests/database` 与 RLS（无 `DATABASE_URL`）。B3 的 SQL 正确性为 **PGlite 真实引擎**验证，**非真实 PostgreSQL**，且该测试里 join 的 article/media 表是手写 stub。

**两位 teammate 各自独立报告**：`vocabulary-speech-feedback.test.tsx` 在本机**未复现**既有失败（改动前后均 2/2 通过），因此该「既有失败」的记录需重新核实后再引用。

## 阻塞发现（优先级高于本任务）

Lead 在验证期间对生产库做只读计数，发现**整个词句语料管道为空**：

| 表 | 行数 |
|---|---|
| `corpus_occurrences` | **0** |
| `lexemes` / `lexeme_forms` | **0** / **0** |
| `phrase_entries` | **0** |
| `user_lexical_intents` | **0** |
| 对照：`articles` | 204（已发布 203） |
| 对照：`media_versions`（已发布+清权） | 537 |

根因：`indexContentVersion`（`src/modules/lexicon-corpus/application/index-content-version.ts:9`）**零调用方**；`indexLexeme` / `indexPhrase` 在生产代码中只出现在仓库自身定义，唯一调用方是 `tests/`；`tests/unit/corpus-indexing.test.ts` 只覆盖纯函数 `buildContext`，不覆盖 `indexContentVersion`。

后果：`/read/corpus` 恒空；`view=lexicon` 与 `/read/phrases` 恒空；`intent` 三态**无从标记**（没有 lexeme id 可标）；**本次修好的 B3 在生产不会显示任何东西**（它取的正是这张空表）。可用的只有 `view=frequency`（算 `article_segments`/`media_segments`）与默认 `study`（静态术语表）。

这需要产品决策：**谁来「确认」词句？**（所有者内容工作流人工确认 / MiniMax 双审核自动抽词元 / 只索引已审核内容的高频词）。属新能力，须先走设计 + ADR。

## 遗留项（本任务范围外，建议后续）

1. `保存的单词` 与 `保存的短语` 现指向同一页签（`READ-SAVED-001` 已把词与短语合并为 `itemType=phrase`）；LR 参考实现是两个独立页签。彻底区分需 D2 或新增 words-only 查询能力。
2. 未登录用户点状态筛选会落在 `view=lexicon` 并看到空态：`intentFilter` 在有 `intent` 但无 `userId` 时返回 `sql\`false\``（既有行为）。
3. B5 文案仍**重复在 5 个文件**、无共享常量；本次只钉住 grid ↔ shelf-controls 两侧，真正解法是抽公共常量。
4. B3 的 `corpus_occurrences.normalized_text` **无索引**，可能 seq-scan；加索引需迁移（本次明确不新增迁移）。
5. `docs/references/2026-10-10-language-reactor-saved-items-research.md` §7.3 记录的 B1–B6 应补记「已修复」并引用本任务。

## 下一步（本任务之后）

- D2（统一「保存」语义边界）、D3（上下文是否冻结到保存时刻）、D4（导出许可边界）、D5（词频表来源）仍需产品决策。
- 「把 `study` 视图本机标记提升为服务端 `user_lexical_intents`」是建议的下一刀（解 D2 核心 + B5 的根因 + 换设备丢状态）。
