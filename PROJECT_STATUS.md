# PROJECT_STATUS.md

这是当前工作树的任务核对与交接入口，不是部署监控。开始任务先核对 Git；规则见 [AGENTS](AGENTS.md)，按任务阅读见 [文档导航](docs/README.md)。

- 核对日期：2026-09-16。
- 当前里程碑：内容驱动学习与自动内容供应重构；阶段 8 未由本次审计确认启动。
- 原有交接、测试与运行计数已迁至 [状态历史](docs/tasks/PROJECT-STATUS-HISTORY.md)，保留原日期、Commit、限制与更正；不再把旧“当前任务”当作领取指令。

## 当前核对

以下是 DOCS-001 在提交前基于 HEAD `5c6775e` 的本地核对快照，不代表提交后的 HEAD。INSTR-AUDIT-001 接续提交文档并核对远端分支；未查询生产库、运行网站或收费 Provider。

| 层次 | 核对结果 | 不代表 |
| --- | --- | --- |
| 当前工作树 | `D:\workspace`，`codex/ui-017-collapsible-shell`，HEAD `5c6775e`；有大量既有未提交修改及未跟踪文件 | 干净分支、已推送或可直接覆盖 |
| 当前提交链 | 媒体处理 `75f56ea`、事务草稿 `1a343d2`、审核投影 `6bda207`、revision 发布 `5c6775e` | 整个 MEDIA-002 或真实审核 E2E 已通过 |
| 本地 main | `3c1b9c6`；包含下表 LEX/PROFILE/OPS 交接提交 | 当前工作树、远端 main 或部署已具有这些功能 |
| 当前文件 | 学习媒体页存在；阅读目录没有词汇/语料子页面；没有 `.github/workflows` | 对应功能从未开发 |
| 部署/真实数据 | 历史有媒体发布、字幕回填与实播记录，本次未重验 | 当前仍有同样数量、链接有效或生产 schedule 正在运行 |

### 跨分支对账

使用本地 `git worktree list`、各分支 log 和 `git branch --contains <commit>` 核对。**已有分支，不应按旧表“待领取”重复实现。** 不在本轮重新分配其他任务或宣布验收。

| 任务 | 已有分支 | 交接提交 | 当前 HEAD 包含 | 本地 main 包含 |
| --- | --- | --- | --- | --- |
| LEX-001 | `codex/lex-001-lexicon-corpus-foundation` | `679eb4d` | 否 | 是 |
| LEX-002 | `codex/lex-002-corpus-assessment` | `f157262` | 否 | 是 |
| PROFILE-001 | `codex/profile-001-four-capability-profile` | `0d0f149` | 否 | 是 |
| OPS-001 | `codex/ops-001-daily-content-pipeline` | `a2fcd26` | 否 | 是 |

OPS 分支运行手册和 workflow 已读取：workflow 是 UTC 03:17（上海 11:17）的 discover 调度，声明 `content-production` environment；本次没有检查远端 Environment 保护/Secrets 或实际触发结果。它不证明 process、ASR、清理和显式发布已每天全链路运行。该分支命令不能直接复制到当前缺少 `content:pipeline` 的 package.json 环境。

## 当前任务

### DOCS-001：文档系统梳理

- 授权：用户明确要求维护文档系统，不延续无关功能开发。
- 状态：`review`；文档整理，不改变其他任务状态。
- 分支：`codex/ui-017-collapsible-shell`；由 INSTR-AUDIT-001 接续提交这 14 份文档，提交标题 `docs: consolidate documentation and scope agent workflows`。原核对和验证记录保留如下，不代表本轮重跑。
- 范围：README/AGENTS、任务阅读导航、完整约束与状态历史迁移、媒体运行手册、过时停点和配置说明、维护与验证约定。
- 验证：本地 Markdown 链接/锚点扫描覆盖 84 份文件、219 个引用，无断链；`git diff --check` 退出 0；Next.js 自动指令块原样保留；完整历史迁移内容与预期转换一致。未运行 lint/typecheck/Vitest/E2E/build、真实 Provider、生产或真机验收（本轮仅文档）。
- 审阅边界：重点审阅入口、当前规格/计划、架构/内容/认证/数据库/测试、媒体脚本与配置、近期提交；早期设计按相关章节阅读。未访问完整旧会话、真实 `.env`、私人运行产物或供应商后台；ALPHA release checker 未完成源码审计。
- 并发变更：最终哈希比对中，52 个非文档 dirty/untracked 文件里有 5 个路径相对初始清单新增/变化：`drizzle/meta/_journal.json`、`src/shared/db/schema/media.ts`、`tests/database/media-persistence.test.ts`、`drizzle/meta/0032_snapshot.json`、`drizzle/0032_bunny_storage_video_expiry.sql`。它们不是本轮写入，未覆盖或验收；其他 47 个所检文件哈希一致。本轮所有写入均为 Markdown。
- 复核方法：从 README → 文档导航 → 任务/运行手册查找；检查原规则和历史信息保留、链接及命令对应当前分支。

### INSTR-AUDIT-001：指令精简与文档提交

- 授权：用户要求接续 DOCS-001 的 14 份文档，落实指令审计建议并提交推送；不再由原会话重复推送。
- 范围：按任务读取资料、直接授权任务入口、局部阻塞、适度验证、本轮 diff 边界与交接频率；保留产品、评分、权限、隐私、审核发布和 Next.js 自动指令。
- 提交：本条随 `docs: consolidate documentation and scope agent workflows` 提交；推送结果以远端分支核对和本次交接为准，不递归追加自身 hash。
- 本机 Skills：修改 openai-docs、ui-ux-pro-max、design-system、brand、documents、visualize；这些文件位于用户目录，不属于项目 Git，不随本分支推送。插件缓存更新可能覆盖本地调整。
- 验证：14 份暂存 Markdown 的 145 个本地链接/锚点通过；暂存 `git diff --check` 通过；6 个修改后的 Skills 通过 UTF-8 模式 quick_validate；新增内容凭据模式扫描未命中。仅文档及指令变更，不运行业务测试、构建、真实 Provider、生产操作或真机验收。
- 限制：保留并发 Bunny 迁移及其他功能改动；只提交 DOCS-001 的文档范围，数据库文档中的并发 0032 说明留给对应功能提交。未跟踪的设计稿/脚本仅标为本机参考，不宣称已进入提交。
- 验证方式：查看本任务提交的文件列表及远端分支；以小修复、已批准设计、可选 Python 不可用场景检查规则是否仍引入无关步骤。
- 下一步：合并者按 main 当前状态对账；功能任务和部署验收由对应负责人继续。

### 相关功能的现有停点

HOSTED-MEDIA-002 本轮补充核验：当前已发布视频投影为 Bunny 1 条、Supabase 9 条、YouTube 10 条。全量 lint 执行失败（7 处非本切片 React Hook 依赖警告，0 error），全量 typecheck 的两个 mock 错误见下文；全量 Vitest/E2E/build 本轮未执行，仅完成迁移相关测试与独立 Chrome 实播，不构成发布候选验收。文件范围：媒体 Schema、0032 SQL/快照/迁移日志、media-persistence 回归测试、ADR-0009、托管计划、数据库文档及本状态记录；本地迁移核验脚本/清单仅在未提交的 `.tmp-runtime`，不纳入源码提交。

以下是原有交接的摘要，不是本次重跑测试或重新分配状态：

- **MEDIA-002**：核心处理/事务/审核 revision 已提交；MiniMax、已发布媒体字幕回填及迁移 `0031` 等仍包含未提交内容。历史记录提出审核 E2E、分块边界和真实播放回放待补，不能将所有切片笼统标 done。
- **VIDEO-PLAYBACK-RELIABILITY-001**：2026-09-16 已重新打开，修复未提交。旧 `32fa257` 的“只是外网问题”结论被本站超时遮罩/迟到 SDK 缺陷更正；fake 测试通过不证明目标 YouTube 实播恢复。
- **HOSTED-MEDIA-002**（2026-09-16 本任务追加的真实执行结果，不属于 DOCS-001 审计）：按所有者批准采用 Bunny Storage + Pull Zone，ADR-0009 与托管实施计划已补充。版本化迁移 `0032_bunny_storage_video_expiry` 已应用，只放行 Bunny 视频无租约。首条 `youtube.language-reactor.9b656c190ce7a1e06f658f55` 经 CDN 全文件 SHA-256、Playwright/Chrome 实播与 seek 校验后，已条件切换数据库；Supabase 原文件保留，未完成全量迁移。数据库持久化/RLS 2 文件 6 项通过，目标 ESLint、db:check 通过，再次 db:generate 无变化。重新执行 typecheck 仍被 composite-article-repository 测试 mock 缺失 list 阻断。网站新测试浏览器跳转登录，登录后的页面验收未完成。当前修改未提交；下一步补批量完整性/可恢复门禁及页面验收，再逐条迁移与清理。
- **LR-001、LEARN-HOME、LEARN-MEDIA-DETAIL、UI-017**：保留原 review 与视觉/真实账号验收限制；逐项实现和测试出处见状态历史。
- **LEX/PROFILE/OPS**：按跨分支表先对账，不重复开发，不在本轮直接合并。
- **ALPHA-033 / 阶段 8**：旧任务式入口门禁不能作为内容驱动新版验收。即使其他分支存在 release gate 工具，也必须核对它实际检查什么、真实测试与用户确认；本轮未审计该工具实现。

原记录中 typecheck 的 mock 缺少 list、lint 警告、真实设备/Provider 限制均属于当时结果；下一实现任务应先复现，不能预先把新失败称为“既有”。

## 活跃分支任务

当前工作树并非协调 main，且混有多个既有切片。任务负责人/活动分支以实时 Git 和对应分支状态页共同核对；历史任务表已归档，不能用其中 blocked/待领取覆盖已存在的交接提交。此轮不重新排列全局任务队列。

协调者后续应在 main 对账已合入任务、未合入媒体切片与 dirty 文件的所有权，明确一个目标分支/任务后再实施。未经用户明确要求，不在文档维护中切分、清理或提交业务改动。

## 接下来任务

1. 用户/合并者复核 DOCS-001 文档差异；提交时只包含已确认的文档变更，保留既有修改。
2. 下一相关功能会话先核对当前工作树与 main 差异，明确播放器/MEDIA-002 的单一收敛切片及目标分支；不要从 LEX-001 重新做起。
3. 先处理该切片的真实验收与未提交工作，再按 [内容供应实施计划](docs/plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md) 的依赖核对，不能自动开始后续任务或阶段 8。

待裁决/待验证：Bunny 新供应商决策；目标浏览器真实播放；MEDIA-002 完整审核 E2E；远端部署/生产 schedule；跨分支最终合并方案。没有新增授权前不执行对应外部操作。

## 最近完成

本次仅完成文档整理；之前任务与测试见 [状态历史](docs/tasks/PROJECT-STATUS-HISTORY.md)。不在这里重复维护历史日志。

## 更新模板

每项只维护一个当前记录；复杂跨会话细节链接到 docs/tasks，不复制整段日志。

```text
任务：TASK-ID
状态：ready / in_progress / blocked / review / done
核对日期：YYYY-MM-DD
分支 / HEAD / 负责人：
范围 / 不在范围：
实现 Commit：未提交或真实 hash；另列合并 Commit
修改文件：
验证：本次命令、环境、结果；历史证据另列来源
未执行检查与原因：
限制 / 待确认：
用户验证方式：
下一项与开始条件：
```

分支负责人在任务交接或重要状态变化时同步分支状态，不要求每次提交后追加文档提交；合并者负责 main 对账、合并结论与下一任务分配。文档维护检查见 [文档导航](docs/README.md#维护约定)。
