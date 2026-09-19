# PROJECT_STATUS.md

这是当前工作树的任务核对与交接入口，不是部署监控。开始任务先核对 Git；规则见 [AGENTS](AGENTS.md)，按任务阅读见 [文档导航](docs/README.md)。

- 核对日期：2026-09-17。
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

### LEARN-MEDIA-DETAIL-004：播放页重排与字幕点词

- 授权：用户确认可修改骨架、字幕样式、逐词跟随及 MiniMax 点词解析；已授权全部视频/播客转写与翻译，无费用上限。当前全部缺失媒体使用 MiniMax `asr-1.0` 逐词转写，中文翻译使用 MiniMax；点词解析仍用 MiniMax。独立审核与显式发布门禁不变。
- 状态：UI 切片 review；当前 20 条视频和 2 条播客均已有双语字幕。2026-09-17 找出的 20 条缺失/不完整媒体已完成 MiniMax 词级转写、翻译、三维 AI owner-authorized 审核并显式发布。媒体基础设施提交为 `6e791cb`，学习资料库与播放页 UI 提交为 `23bed67`；尚未部署。
- 文件：`app/(product)/learn/media/[stableKey]/page.tsx`、`app/globals.css`、`package.json`、`pnpm-lock.yaml`；媒体 domain 的 `media.ts`、`segment-timeline.ts`、新增 `word-timeline.ts`；媒体 UI 的 `audio-player-adapter.tsx`、`media-learning-workbench.tsx`、`segment-transcript.tsx`、`lexical-drawer.tsx`、新增 `request-word-explanation.ts`；新增 `tests/unit/media-word-interactions.test.tsx`，两份 media E2E 与详情规格/计划。
- 新增实现：MiniMax `timestampLevel=word` 真词时间、独立 WAV 分块、词时间版本化存取、0034 nullable JSONB 迁移（本轮前序已应用）；播放器时钟驱动逐词框选和跨句切换，普通句、当前句、当前词使用三层视觉状态，进入下一句后上一句恢复初始颜色；字幕始终自动跟随当前句/词，手动浏览不再暂停跟随并已移除“回到当前句”按钮；解析标记简化为“AI 语境解析 · 仅供理解参考”；学习字幕不再显示 `S1` 等原始说话人编号，但底层数据仍保留。视频继续使用 Plyr，播客改用 `react-h5-audio-player`：进度条独占完整宽度，播放/时间/音量/倍速/自动暂停位于独立控件行，保留原 `AudioPlayerPort`、字幕时钟、自动暂停和进度保存契约。压缩页头、实测播放器高度同步、字幕缺译提示、进度恢复高亮修复。新增仅允许 draft 的翻译回写应用/仓储能力；正式媒体字幕上限统一为 2,000 段，避免长播客读取时静默截断。
- 验证：2026-09-16 的 24 项相关单测、22 项桌面/移动 E2E（3104 独立目录）及长媒体上限相关 19 项单测通过。2026-09-17 本轮字幕回填、Provider 契约、逐词交互、工作台和媒体路由共 7 文件/55 项测试通过；新增播放器级回归覆盖跨词、跨句、旧句复原、手动滚动后的强制自动跟随及原始说话人编号隐藏，定向视频同步与播客点词的桌面/移动 E2E 4/4 通过，目标 ESLint 与 `git diff --check` 通过。两份 media E2E 全跑为 20/22，通过项包含逐词/逐句同步；两个桌面 YouTube 错误态用例未出现预期文案，与本次字幕链路无关并如实保留。2026-09-17 全量真实数据库与应用播放投影再次核对：22 条、7,977 段全部有中文翻译，所有含文字段落都有合法逐词数据；浏览器插件认证失败，未把 fake E2E 冒充真实登录页面验收。
- 真实回填与发布：原视频 `youtube.language-reactor.5eeb575b31ecff93b7469fb7` version 4（91 段、765 词）和播客 `podcast.language-reactor.it_a790fe7fb425` version 8（643 段、8,405 词）保持有效。本轮另外 19 条视频和 1 条播客全部生成 MiniMax `asr-1.0` 逐词草稿、MiniMax 中文翻译，并发布为各自当前不可变新版本；`podcast.language-reactor.it_44ee82c677a4` 为 version 9，其余新视频为 version 4 或 5。20 条新 backfill 均为 `published`、`lowConfidence=false`、`translationFailedCount=0`，三项审核均由 `codex-ai-owner-authorized-review` 完成。全量当前媒体为 20 视频、2 播客、7,977 段；段落数与翻译数完全相等，含文字段落逐词覆盖 100%；当前 22 个 backfill 的 66/66 个审核维度均为该 AI owner reviewer 批准。
- 限制：本机 `localhost:3000` 仍要求用户个人登录会话，本轮未复制个人 Cookie；改用隔离测试认证打开真实数据库播客页面完成播放器布局核验。该结果不等同于部署、iPhone 真机或外部环境验收，也未为验收触发真实进度写入。MiniMax ASR/翻译为 AI 结果，审核记录如实标注 AI；抽样仍可能存在轻微专名译法或 ASR 词误差，不冒充真人逐音频校对。
- 用户验证：重新打开任意视频与播客详情；重点检查 `youtube.language-reactor.d877540d6f039fbffe1a2506` version 4 的 24 段双语字幕，以及长视频/播客的当前句、逐词框选、自动滚动和点词 MiniMax 解析。数据已发布，不再需要进入审核工作台。
- 本次文件与数据：沿用前序页面、字幕、Provider、回填/审核/发布实现；新增仅可替换同媒体版本唯一 draft 的安全刷新路径、短尾 PCM 合并、ffmpeg 流式输入和下载正文重试。真实 Provider 和数据库处理全部 20 条缺失/不完整媒体；两个历史 1/2 段草稿安全刷新为 163/173 段，旧审核记录清除后重新完成三维审核。一次性批处理/翻译/审核脚本在核验后删除。
- 下一步：完成产品视觉确认；部署后补远端登录页与 iPhone 真机核验，不把本地真实数据页面或数据库发布等同于代码已部署。
- 本次 typecheck：2026-09-19 补齐文章仓储测试 mock 的必需 `list` 契约（`1d33e93`）后，`pnpm typecheck` 通过。
- 播客播放器复核：2026-09-17 最终重跑逐词/自动跟随单测 12/12、播放器相关 3 文件 18/18、目标视频逐词同步桌面/移动 E2E 2/2、播客桌面/移动 E2E 6/6 与目标 ESLint，均通过；隔离本地服务读取真实数据后，Playwright 打开 `podcast.language-reactor.it_a790fe7fb425`，确认 643 段真实字幕、封面、自动暂停和 `0.5×` 至 `4×` 倍速完整，实际切换为 `1.5×`。播客无 Plyr 实例；桌面 1755×1052 的 485.656px 进度行和移动 375×812 的 277px 进度行均为播放器宽度 100%，控件位于下一行，两种视口均无横向溢出或页面错误。未复制个人 Cookie、未写入真实进度；隔离验收服务已停止。

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

HOSTED-MEDIA-002 完成核对（2026-09-17）：方案二已完成。当前已发布媒体为 Bunny 视频 20/20、播客 2/2，全部无播放有效期；最终完成审计 `passed=true`，逐条匹配迁移证明、CDN MIME/长度和当前资产。Playwright + Google Chrome 从真实学习详情页对当前 22 个 asset ID 全量完成首播、中段/尾段 seek，全部通过且无媒体/页面错误。Supabase media-video/media-audio 对象和全版本旧引用均为 0。`8Vegtx0gybI` 的 CDN seek 解码问题已通过 1080p H.264 短 GOP/faststart 规范化修复，旧故障 Bunny 对象已从源端删除。相关 6 文件 39 项回归通过；目标 ESLint 与 `git diff --check` 通过；基础设施已提交为 `6e791cb`，尚未部署。隔离 QA 服务已停止；完整证据与用户验证见 [任务交接](docs/tasks/HOSTED-MEDIA-002.md)。

HOSTED-MEDIA-002 最新核对（2026-09-16 20:37）：Bunny 视频 17、播客 2，19 条页面实播/中段/尾段验证通过；Supabase 音视频对象及全版本旧引用均为 0。剩余 `5E6pFYqL_es`、`K2_qZ2TKt9s`、`Eog6R528OMo` 下载受 YouTube TLS EOF/连接超时影响，正常与 IPv4 复测未恢复，等待用户确认 VPN/浏览器访问。批次和 QA 服务均已退出，不可沿用旧进程记录。整体方案仍缺 3 条，未完成、未提交；完整证据与下一步见 [任务交接](docs/tasks/HOSTED-MEDIA-002.md)。

HOSTED-MEDIA-002 批次恢复（2026-09-16 19:29）：yt-dlp 首轮新增 2 条后部分失败；改为独立进程串行后，另 1 条原生 1080p 验证并切换成功，当前已知 Bunny 视频 14、YouTube 6、Bunny 播客 2。隔离批次 session 72024/PID 29440 在途，必须实时确认，不凭文档重启。36 项相关回归已单 worker 全部通过，目标 ESLint 通过，typecheck 仍有文章 mock 两处错误。全部页面验收尚未完成，整体目标未完成。新增正式批次入口、yt-dlp 全局约定与恢复详情见任务交接。

HOSTED-MEDIA-002 来源恢复（2026-09-16 18:59）：补齐官方 yt-dlp-ejs 依赖后，`v3qW03aZOT0` 已完整下载、严格解码、无损 faststart remux、Bunny 全文件哈希/实播验证并切换。网站重跑验证 152 秒、中段、尾段均通过（首次超时如实保留）。当前 Bunny 视频 11、YouTube 视频 9、Bunny 播客 2，Supabase 媒体桶为空。之前“必须先接管浏览器”的下载阻点已被此次成功推翻；尚需迁移 9 条视频，不代表整体完成。详见 [任务交接](docs/tasks/HOSTED-MEDIA-002.md)。

HOSTED-MEDIA-002 浏览器对照（2026-09-16 17:25）：10 条 YouTube 均确认可开始播放，但新建 Playwright Chrome（可见/无界面、1 倍速、不拦截媒体）在首条约 50 秒后报源站播放器错误。用户日常 Chrome 同视频连续 2 分钟正常，不能判成源站下架。当前日常 Chrome 无调试入口，浏览器连接器不可用；需要用户配合建立专用可连接会话，未复制个人 cookies 或关闭用户浏览器。Language Reactor 目录 API 未发现独立视频文件 URL。完整下载/迁移尚未完成，见 HOSTED-MEDIA-002 交接。

HOSTED-MEDIA-002 播客追加进展（2026-09-16 17:03）：两条播客均已迁到 Bunny。第二条完整下载 113,547,219 bytes，通过完整解码、CDN 哈希、Chrome 实播后条件切换；两条网站页面最终实播/seek 均通过（第一条曾有一次加载超时，重跑通过）。独立数据库核对当前 Bunny 视频 10、YouTube 视频 10、Bunny 播客 2；Supabase media-video/media-audio 对象均为 0。本轮断点恢复等 23 项测试和目标 ESLint 通过；typecheck 仍有文章仓库 mock 两处错误。迁移进程已成功退出。剩余 10 条视频继续调查正常下载恢复，整体目标未完成；完整证据见任务交接。

HOSTED-MEDIA-002 视频真实核验（2026-09-16）：原 10 个 Supabase 视频对象已删除，两个历史引用已先迁移；独立查询确认 media-video bucket 对象数 0、旧 URL 全版本引用数 0。删除后 10/10 实际页面播放与 seek 复测通过（测试登录身份、真实媒体、浏览器写请求拦截）。10 条 YouTube 尚未迁移；Chrome 已实播其中一条被下载器报不可用的视频，不能将其判为源站下架。浏览器媒体数据保存实验未取得完整文件，未上传或改库。本任务未提交；完整证据及恢复入口见 [HOSTED-MEDIA-002 交接](docs/tasks/HOSTED-MEDIA-002.md)。

以下是原有交接的摘要，不是本次重跑测试或重新分配状态：

- **MEDIA-002**：核心处理/事务/审核 revision 及 MiniMax、已发布媒体字幕回填、迁移 `0031`/`0034` 已提交；历史记录提出的审核 E2E、分块边界和真实播放回放仍需按对应切片证据判断，不能将所有切片笼统标 done。
- **VIDEO-PLAYBACK-RELIABILITY-001**：2026-09-16 已重新打开，修复未提交。旧 `32fa257` 的“只是外网问题”结论被本站超时遮罩/迟到 SDK 缺陷更正；fake 测试通过不证明目标 YouTube 实播恢复。
- **HOSTED-MEDIA-002**：`done`；Bunny Storage + Pull Zone 的 20 视频与 2 播客迁移、全量真实页面播放、完整性审计及 Supabase 对象/引用清理均已完成。代码已提交为 `6e791cb`，仍未部署，不能据此宣称远端环境完成。
- **LR-001、LEARN-HOME、LEARN-MEDIA-DETAIL、UI-017**：保留原 review 与视觉/真实账号验收限制；逐项实现和测试出处见状态历史。
- **LEX/PROFILE/OPS**：按跨分支表先对账，不重复开发，不在本轮直接合并。
- **ALPHA-033 / 阶段 8**：旧任务式入口门禁不能作为内容驱动新版验收。即使其他分支存在 release gate 工具，也必须核对它实际检查什么、真实测试与用户确认；本轮未审计该工具实现。

原记录中 typecheck 的 mock 缺少 list、lint 警告、真实设备/Provider 限制均属于当时结果；下一实现任务应先复现，不能预先把新失败称为“既有”。

## 活跃分支任务

当前工作树并非协调 main，且混有多个既有切片。任务负责人/活动分支以实时 Git 和对应分支状态页共同核对；历史任务表已归档，不能用其中 blocked/待领取覆盖已存在的交接提交。此轮不重新排列全局任务队列。

协调者后续应在 main 对账已合入任务、未合入媒体切片与 dirty 文件的所有权，明确一个目标分支/任务后再实施。未经用户明确要求，不在文档维护中切分、清理或提交业务改动。

## 接下来任务

1. 用户/合并者复核 DOCS-001 文档差异；提交时只包含已确认的文档变更，保留既有修改。
2. 合并者核对 `6e791cb` 的 HOSTED-MEDIA-002/字幕基础设施与 `23bed67` 的 UI 边界后再合入目标分支；不要从 LEX-001 重新做起。
3. 部署后另做远端登录播放和 iPhone Safari 验收；再按 [内容供应实施计划](docs/plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md) 的依赖核对，不能自动开始后续任务或阶段 8。

待裁决/待验证：MEDIA-002 完整审核 E2E；远端部署/生产 schedule；跨分支最终合并方案。Bunny 供应商决策与本地目标浏览器全量播放已在 HOSTED-MEDIA-002 完成；没有新增授权前不执行其余外部操作。

## 最近完成

HOSTED-MEDIA-002 的方案二已在当前工作树与真实媒体数据上完成，代码提交为 `6e791cb`，尚未部署。更早任务与测试见 [状态历史](docs/tasks/PROJECT-STATUS-HISTORY.md)，不在这里重复维护历史日志。

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
