# 自动内容供应与词句学习重构实施计划

## 2026-10-16 所有者文案调整：READ-VOICE-LABEL-001

独立局部任务，所有者明确要求后 ready 并由本聊天领取，沿用共享分支 `codex/disable-legacy-readlang`。阅读器侧栏声音标题与试听无障碍名称由“MiniMax 女声”改为“Serene Woman 女声”，同步既有组件和浏览器测试预期；不改变供应商、音色、播放或评分。验证结果、未执行检查及下一步记录于 `PROJECT_STATUS.md`。

## 2026-10-16 所有者故障修复：READ-LOAD-001

用户报告 `/read` 文章 SQL 的未捕获错误，本任务 ready 后由本聊天领取，沿用共享分支，独立于供应队列。只读排查底层数据库连接，公共文章目录捕获连接创建/首查/页码收敛再查故障并提供明确错误态；用户点击重试刷新当前 URL，保留搜索、筛选与页码。成功零条仍使用既有空态，配置数据库的失败不回退本地 bundle；不改数据库、来源、审核、评分或私人数据。验收包含先失败的组件回归、失败后恢复、隔离 loopback 故障数据库的桌面/手机浏览器重试与导航保留、定向 lint 和类型检查。结果与全量限制登记于状态页与同任务交接。

交付review：6文件34项、桌面/手机Chrome2/2、定向lint与全树typecheck通过；所有者确认页面恢复，真实只读复验202篇/本页12篇，未改连接配置。未提交/推送/部署；中间失败、全量未执行原因和用户验证见[READ-LOAD-001交接](../reviews/READ-LOAD-001.md)。不自动开始下一任务。

## 2026-10-16 所有者授权：TTS-LATENCY-001

依赖TTS-READALOUD-001；用户反馈点击后起声慢并说明当前网络较差。本切片ready后由本会话领取，沿用共享分支，无其他负责人。范围限共享客户端：当前控制器短期、有界、可清理的音频内存复用，以及长文较短首段；声音、音质、鉴权端点、供应商与证据规则不变。不做付费预生成、不改变串行按需费用语义。验收覆盖弱网模拟下重复朗读零新增请求、首次首段缩短且全文保留、缓存隔离/过期/释放/会话变化/取消及关键桌面手机路径。交付review：每控制器8段/4MiB、60秒内存复用；超过300字符先读最多180字符首段。最终8文件73项、桌面/手机E2E16/16、定向lint、全树typecheck及生产build77/77通过。模拟800ms请求等待的重播零新增请求；不冒称真实扬声器或供应商起声计时。未提交/推送/部署，全部文件、全量未执行原因与下一步见[性能交接](../reviews/TTS-LATENCY-001.md)。

## 2026-10-16 所有者授权：TTS-READALOUD-001

前置 TTS-AUDITION-001 试听完成，所有者已选 MiniMax 女声并明确要求全站现有与未来合成朗读统一。仅领取此任务，负责人为本会话，沿用共享分支 `codex/disable-legacy-readlang`，状态 review；无新服务、数据库迁移或评分变更。决定见 [ADR-0019](../adr/0019-unified-minimax-read-aloud.md)，实现与验证见 [交接](../reviews/TTS-READALOUD-001.md)。最终核心63项、UI213项、关键浏览器14项与专项lint通过；全仓门禁受OOM及其他在途媒体功能编译/测试错误阻塞，不宣称全仓通过。未提交/推送/部署；下一步为iPhone Safari/PWA试听及共享任务收尾后的全仓复验。

实施范围：固定 Serene Woman / speech-2.8-turbo / 合成速度1；鉴权通用路由和内部application/provider；用户隔离的有界短期内存复用；共享HTMLAudio客户端/hook；迁移词汇、短语、语料、媒体点词、书架、文章、内容包、训练、场景与聊天；保留合法真人录音及媒体原声。未来入口不得绕过共享实现。验收包括长文无截断、playing反馈、停止/换文/卸载/过期回调、严格请求校验、鉴权与私有缓存、失败/限流手动恢复、契约与浏览器回归。不自动重试收费请求，不宣称全局幂等或真人发音。交接结果记入 PROJECT_STATUS 与同任务报告。

## 2026-10-15 独立设计：MEDIA-SERIES-000

所有者认可系列/单集方向，并明确要求视频播放结束后在下方展示当前系列的其他视频。[系列规格](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)、[ADR-0018](../adr/0018-media-series-directory.md)及[独立实施计划](2026-10-15-media-series-implementation-plan.md)记录首版001数据/协议、002既有归属/导入、003系列入口/页面/选集、004视频播后推荐；005换批多样性与006采集建议为后续可选切片。000仅文档review，详细规格确认后001才ready，当前未分配实现或创建建议分支；不重排原供应队列或改其他负责人。无自动连播，不修改历史版本/字幕/进度/证据，本轮未执行代码、迁移、真实归属写入或采集。

2026-10-15 所有者批准的独立评估 `TTS-AUDITION-001`：以20个原创西语单词和10个原创短句比较 Kokoro 本地合成与 MiniMax 系统西语音色，输出本地可播放的试听页、生成元数据、错误与测量限制。Azure 按所有者后续答复暂不纳入。不接入产品页面、不迁移、不写学习数据，不改变已选供应商或生产隐私策略；合成录音不冒称真人或已通过语言审核。验收为每个成功样本能解码、来源/模型/音色可追溯、同文本可对比、失败诚实显示、重复执行复用已生成文件，真实听感由所有者判断。产物位于忽略目录，保持现有共享分支和其他任务改动。

- 日期：2026-09-12
- 状态：产品本人已批准上位规格；实施计划待合并到 `main`
- 当前规划任务：`IA-001`
- 设计依据：[自动内容供应与词句学习重构设计](../superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)
- 架构决策：[ADR-0008](../adr/0008-content-led-learning-and-automated-ingestion.md)
- 活动客户端：Next.js 响应式 Web/PWA；当前以电脑端 Web 为主要验收环境

## 1. 交付目标

本计划把产品从任务式“学习首页”迁移为内容驱动结构：

> 每日白名单增量获取 → 自动清洗/转写/词句抽取 → 所有者审核 → 显式发布 → 视频/播客学习、文章阅读、词句查询与考察 → 四板块能力证据

最终用户路径为：

- 打开“学习”直接选择视频或播客，进入逐句媒体学习器。
- 打开“阅读”选择文章、词汇、短语或跨来源语料，不经过任务式入口。
- 在文字题中验证词汇与短语；不要求口头作答。
- 在场景、长期 AI 角色、语音消息和跟读中分别形成适用证据。
- 在“我的”查看词汇与短语、交流运用、语音表达、跟读表现四个板块。
- 所有者在“我的 → 内容工作流”处理自动发现的候选，自动化不直接发布。

## 2026-10-13 插入任务：LEARN-BROWSE-001（独立于供应队列）

产品本人批准学习页“刷新”改为“换一批”。范围：只读 `POST /api/v1/media/browse` 的 DTO/OpenAPI、纯领域确定性来源轮换与批次游标、媒体 repository 完整候选查询与当前用户进度、页面的筛选保留/取消/重试/耗尽/返回恢复。保留默认时间排序，不改采集发布、画像或用户私有表，不新建迁移。

验收：足够内容时换出未展示的 24 条；筛选仍生效；固定批次翻页无重复/遗漏，变化目录返回可恢复失效；失败保留旧网格；切频道、卸载和新批次隔离旧响应；返回恢复相同顺序和位置；接口鉴权、版权/发布/资产投影及进度隔离通过。领域、组件、Route、JSON Schema、PGlite/RLS 与桌面/手机 Playwright 覆盖；再运行全仓检查，如实记录既有基线失败。

本任务沿用产品本人的共享工作区，只交付本任务文件范围，其他任务不重排；完成测试和限制登记于 `PROJECT_STATUS.md` 后由协调者收集独立提交。

同任务读取故障补充：首屏读取失败不能同时显示“内容准备中”或筛选零结果。无卡片时统一显示不可用状态和“重试”；重试保留筛选、发起不使用浏览器缓存的真实读取，成功后清除首屏故障标记，只有成功返回零条才显示空态。已有卡片时换批失败继续保留。排查真实目录时必须区分十分钟缓存命中和新数据库查询；本地直连仅有 IPv6 且连接超时时，可使用项目配置的 session pooler 修复本地运行连接，保持迁移连接和数据库内容不变。

同日产品本人进一步要求换批静默：去掉换批加载和失败两句文案，保留禁用/aria-busy、旧卡片和可再次点击。换批失败用独立状态标记，不能污染首屏的真实零结果。新增慢响应回归：22 秒成功可更新卡片，45 秒挂起仍终止并恢复按钮，取消/过期响应规则保持；背景分页预取不能冒充用户换批响应。

同日继续修复下滑加载与滚动开销：移除补齐整行造成的五列/24 条页面连读；IO 在游标和加载状态变化后重新检查，支持观察点一直位于加载边界内的连续分页，过期 observer 回调失效。合并滚动历史写入为 200ms 窗口，详情点击前即时 flush，取消/卸载释放 timer；浮动按钮用单个 rAF 和阈值变化更新，卡片 memo 复用。验收包含正常列表持续分页、换批后完整刷新再滚动到本批全部候选（无重复/遗漏）、未触及底部不因列数主动追加、滚动事件合并写入且离开前位置准确、既有详情返回顺序与位置保持。新增真实 IntersectionObserver 的 240 卡浏览器回归，不用手动加载按钮替代自动分页。

## 2026-10-16 插入任务：CHAT-ASSIST-003（单输入框翻译）

用户“可以”批准002三状态交互稿。只完成此任务：将「译」放进现有输入栏，直接翻译当前中文/混输草稿；输入框上方按需显示小预览，只保留试听、使用与关闭，无重复中文输入框、标题或常驻说明。使用才替换草稿并恢复焦点，仍须显式发送；无辅助标注。空草稿点击只聚焦输入，加载由原翻译入口显示且可取消，失败保留草稿并局部重试；编辑原文、发送/录音、账户/角色变化与页面生命周期取消请求及音频，过期结果不能替换新草稿。保留内部来源与全部服务端门禁，API/provider/数据库/评分不变。验收覆盖单输入框、无自动生成/发送、中文输入法、源文变动/竞态、试听/使用、排队/重试，以及320–1440px浅深主题、低高度/长内容和44px触控目标。运行聚焦回归、专项lint、全树typecheck和可行的生产build，准确报告共享树门禁限制。

结果 `review`：单输入框与临时预览已实现，具体文件、取消/竞态边界与验收见[003交接](../reviews/CHAT-ASSIST-003.md)。专项85项、桌面/手机Chromium14/14、专项lint、全树typecheck及严格生产build77/77通过；首次页面生成OOM，降为1个worker后显式exit0，无类型忽略。未重跑全仓lint/全量Vitest/整个E2E和真实provider/DB/RLS/Safari；无Commit/推送/部署，保留共享树。下一建议为iPhone Safari键盘/朗读体验验收。

## 2026-10-16 插入任务：CHAT-ASSIST-002（设计调研与去除标注）

用户反馈001界面不简洁，要求调研相关设计，并明确无需“翻译辅助”标注。只完成此任务：查阅官方输入中翻译/写作辅助说明，区分核实事实与本产品设计建议；针对双输入框、多个并列按钮、常驻说明和占用聊天空间提出具体简化方向。立即移除输入区及发送/历史消息上的辅助标注，保留内部辅助来源、显式发送、取消与隐私边界，无API/provider/数据库变更。新的完整交互以提案呈现，不擅自引入自动翻译或自动发送。更新相关单元/桌面手机E2E，运行专项lint/typecheck；文档记录文件、验证、限制和下一步，保留共享树其他改动。

结果 `review`：已去除标注，官方调研与单输入框/临时预览三状态稿见[002交接](../reviews/CHAT-ASSIST-002.md)。相关UI45项、桌面/手机E2E10/10、专项lint通过；全树typecheck因未修改内容处理模块缺 `processingAudience` 10项失败，不记通过。未重跑全量或build，无Commit/推送/部署。下一步确认具体提案后改造输入区。

## 2026-10-16 插入任务：CHAT-ASSIST-001（独立于供应队列）

所有者已批准：聊天输入区提供「这句怎么说」，输入中文或中西语混合草稿，结合当前用户与当前角色最近完成的对话生成一个自然 es-ES 表达。结果仅在辅助面板预览，可用统一 MiniMax 女声「听一遍」或手动「填入输入框」，允许继续编辑，由用户显式发送。没有强制先尝试、答题、自动发送、收藏或复习。

只完成此任务，沿用共享工作区 `codex/disable-legacy-readlang`，不覆盖其他任务。实施切片：严格 DTO 与鉴权只读辅助接口/application；既有 translation provider 支持中西双向与有界上下文；输入区可取消的辅助面板；发送队列/重试保留 translation 辅助来源。服务端只读取当前用户当前角色已完成且未撤回的有界历史，不读取其他角色记忆；中文草稿、临时结果不持久化、不写普通日志。只有显式发送的西语作为消息保存，辅助发送的来源记为 `translation_assisted`，不改写既有证据。当前聊天不产出学习评分；来源标记缺失不能成为未来独立能力证据的授权。

验收：中文/混输→单个西语表达，失败可手动重试；填入不自动发且可修改；听后口述同样保留本轮辅助来源。关闭、修改源文、切角色/账户、页面隐藏和卸载取消请求及朗读，过期响应无效；草稿不会被晚到结果覆盖。原有聊天、语音、排队、重试、历史翻译保持可用。覆盖应用规则、provider fake/契约、鉴权/所有权/严格协议、辅助来源持久化幂等，以及桌面/手机 Playwright（浅深主题、320–1440px、44px控件、零自动发送/评分）。先聚焦用例，再全局类型/lint/Vitest、E2E/build，单独报告环境或基线限制；不真实调用收费供应商。结果同步状态页、架构与测试文档。

实现已完成，状态 `review`；新增E2E10/10、全树typecheck、专项lint与未忽略类型错误的生产build通过。全仓lint内存不足，全量Vitest10项失败，扩展聊天E2E6项失败，尚未用隔离基线确认归因；不视为全量门禁通过。过程缓存仅30秒且单进程，不保证重启/跨进程去重；真实供应商、真实库/RLS与Safari真机留待验证。文件、专项测试最终计数、日志和用户验收步骤见[CHAT-ASSIST-001交接](../reviews/CHAT-ASSIST-001.md)。无Commit/推送/部署，保留共享树其他改动；下一步为真人试用并按需单独处理全量门禁失败。

## 2. 执行规则

- 一次只领取一个任务 ID，一个分支只处理该任务。
- 每个实现任务先写失败测试，再写最小实现，最后整理重复代码。
- 开始任何 Next.js 页面或 Route Handler 前，先从当前工作树定位 `node_modules/next/dist/docs/` 并完整阅读相关 App Router、Route Handler、缓存/动态渲染和 metadata 指南；不按旧版 Next.js 经验猜接口。
- `domain` 保持纯 TypeScript；Route Handler 只负责鉴权、Zod 校验、application 调用和协议转换。
- 默认测试只使用 fake、固定 RSS/XML/JSON/字幕样本和本地小型媒体，不访问公网或收费 Provider。
- 公网发现、下载、ASR、发布、撤下和清理必须显式运行并产生脱敏汇总。
- 发现、处理、审核、发布和索引分别建模；任一步失败不得产生半发布内容。
- 所有用户私有表带 `user_id`、RLS、服务端所有权检查和删除策略。
- 观看、阅读、查词、收藏、播放进度和学习时长不写能力证据。
- 每个任务实现提交并推送后，立即用独立文档提交更新 `PROJECT_STATUS.md`；状态同步记录实现 Commit、测试、限制和下一项。
- 原 `D:\workspace` 的 `codex/ui-014-reading-density` 未提交改动属于用户，任何任务开始前先保留并逐文件判断复用，不覆盖、不清理。

## 3. 任务顺序、分支与停点

`READ-LAYOUT-002` 最新产品要求（2026-10-13）：阅读器中隐藏阅读分类导航，文章顶栏贴到顶部；`/read/article/*` 加载态也不显示分类导航，返回文章库恢复导航。下方“两行 sticky”描述保留为首轮实现背景，已由本要求取代；当前验收使用单行 64px 文章顶栏及关联工具面板/拖动边界。

2026-10-13 产品反馈修复 `READ-LAYOUT-002`（独立于内容供应队列）：只处理文章阅读页顶部导航/顶栏重叠、左右额外边距和关联工具面板边界。在阅读壳层样式内限定文章页，分类导航与顶栏分两行 sticky、按实际内容列对齐；取消会改变固定面板包含块的入场 transform，浮动/固定面板与拖动下界跟随顶栏下缘。新增先失败的浏览器几何回归，覆盖浅/深主题、320–1920px、滚动、拖动与回到书架后的导航保留/边距恢复；复核已有查词、设置、固定翻译器和朗读。无内容、评分、API 或数据库变更。沿用产品反馈所在工作区，保留其他任务改动，不混合提交。

2026-10-13 产品反馈修复 `READ-TTS-002`（独立于内容供应队列）：只修文章划词朗读与共用浏览器 TTS 暂停恢复。先新增失败回归，再在同步点击调用内先排入 utterance、后恢复队列；文章按钮显示播放/停止，generation 隔离旧回调。修改限于文章阅读器、`browser-tts.ts`、对应单元/E2E 与状态/架构/测试文档。验收为暂停后可开始并结束、可停止、静默失败可重试、旧回调不污染新状态；不改内容、评分、接口或数据库。沿用产品反馈所在工作区，保留其他任务未提交内容，不能混合提交。

同日续修根据产品本人「一直显示正在朗读、没有声音」反馈追加验收：准备状态须等 start 才转播放；Chrome 假活跃队列不可阻止超时及其他西语音色回退；默认本地优先，已保存西语选择仍先尝试；已开始/权限拒绝/取消不自动回放；适配器 generation 隔离过期回退。规格、默认音色规则与测试同步，只使用浏览器语音，不引入付费供应商。

| 顺序 | 任务 | 建议分支 | 依赖 | 用户可见停点 |
| --- | --- | --- | --- | --- |
| 0 | `IA-001` 规格、ADR、实施计划与权威文档同步 | `codex/ia-001-content-supply-design` | 已确认产品方案 | 新规则与任务队列一致 |
| 1 | `ACQ-001` 自动采集领域与持久化基础 | `codex/acq-001-content-acquisition-foundation` | IA-001 | 可用 fake 完成每日增量候选链路 |
| 2 | `REVIEW-001` 所有者审核与发布门禁 | `codex/review-001-owner-content-workflow` | ACQ-001 | “我的”可复核候选；真实发布适配器尚未接入时诚实禁用 |
| 3 | `ARTICLE-001` 文章 RSS 与正式 article 接入 | `codex/article-001-automated-article-ingestion` | ACQ-001、REVIEW-001 | 至少一篇文章可从 fake/授权源进入审核并发布 |
| 4 | `MEDIA-001` 统一媒体领域与学习资料库 | `codex/media-001-library-foundation` | ACQ-001、REVIEW-001 | `/learn` 替换为视频/播客资料库，空库也诚实可用 |
| 5 | `VIDEO-001` YouTube 白名单视频纵向闭环 | `codex/video-001-youtube-learning` | MEDIA-001 | 视频发现、官方嵌入、字幕和逐句学习可用 |
| 6 | `PODCAST-001` 播客 RSS 纵向闭环 | `codex/podcast-001-rss-learning` | MEDIA-001 | 节目发现、音频播放、转写片段和恢复可用 |
| 7 | `MEDIA-002` ASR、翻译、成本与媒体可靠性 | `codex/media-002-asr-processing` | VIDEO-001、PODCAST-001 | 合格无字幕媒体可形成审核草稿并安全清理临时音频 |
| 8 | `LEX-001` 词汇、短语与出现索引 | `codex/lex-001-lexicon-corpus-foundation` | ARTICLE-001、MEDIA-001 | 阅读页出现词汇/短语并可跳回上下文 |
| 9 | `LEX-002` 语料查询、文字考察与证据 | `codex/lex-002-corpus-assessment` | LEX-001、MEDIA-002 | KWIC 查询和不需口头回答的词句考察可用 |
| 10 | `PROFILE-001` 四板块能力 | `codex/profile-001-four-capability-profile` | LEX-002；现有对话/语音/场景证据 | “我的”用四板块取代八维主展示 |
| 11 | `OPS-001` 每日生产调度与全链路门禁 | `codex/ops-001-daily-content-pipeline` | ACQ-001 至 PROFILE-001 | 每日自动运行、清理、观测与发布候选链路稳定 |

每个任务完成后暂停并由产品本人验收。未通过当前停点时不领取下一任务。

## 4. IA-001：文档基线与队列重排

### 4.1 修改文件

- `docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md`
- `docs/adr/0008-content-led-learning-and-automated-ingestion.md`
- `docs/plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md`
- `AGENTS.md`
- `README.md`
- `PROJECT_STATUS.md`
- `docs/architecture.md`
- `docs/content-authoring.md`
- `docs/testing-strategy.md`
- `docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`
- `docs/superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md`
- `docs/plans/2026-08-20-personal-alpha-implementation-plan.md`

### 4.2 要求

1. 把 ADR 状态改为 `Accepted`，上位规格标为书面批准。
2. 用新的学习页不变量替换“开始第一次练习/继续学习”要求。
3. 把五项导航、手机头像、四板块能力、内容保留和自动发布边界同步到权威文档。
4. 在 `PROJECT_STATUS.md` 登记 IA-001 完成、`ACQ-001` 为下一项 `ready`，并阻塞与新信息架构冲突的 UI-014 至 UI-017 和旧 ALPHA-033 退出门禁。
5. 明确旧设计是历史背景，已有训练、证据和内容数据不物理删除。

### 4.3 验证与提交

```powershell
rg -n "开始第一次练习|继续学习|唯一主动作|八维" AGENTS.md README.md PROJECT_STATUS.md docs
git diff --check
```

检查所有新增 Markdown 本地链接可解析，无 `TBD`、`TODO` 或相互矛盾状态。文档任务不运行代码测试。

建议提交：

- `docs: add content supply implementation plan`
- `docs: sync content-led learning roadmap`

## 5. ACQ-001：自动采集领域与持久化基础

### 5.1 目标与边界

建立来源、运行、候选、处理步骤、权利和预算的纯领域与数据库基础，用 deterministic fake 证明每日增量、去重、失败恢复和 30/7 天保留策略。不访问公网、不接真实 ASR、不创建用户页面，也不发布正式文章或媒体。

### 5.2 先写测试

新增：

- `tests/unit/content-acquisition-state.test.ts`
- `tests/unit/content-acquisition-dedup.test.ts`
- `tests/unit/content-acquisition-budget.test.ts`
- `tests/unit/content-acquisition-retention.test.ts`
- `tests/unit/content-acquisition-run.test.ts`
- `tests/database/content-acquisition-persistence.test.ts`
- `tests/database/content-acquisition-rls.test.ts`
- `tests/contracts/content-source-adapter-contract.test.ts`
- `tests/fixtures/content-acquisition/v1/manifest.json`
- `tests/fixtures/content-acquisition/v1/fake-source-page.json`

先覆盖：

1. `discovered → screened → acquiring → processing → review_ready` 合法路径和所有非法跳转。
2. `failed` 可按新 generation 重试，旧 generation/revision 不能覆盖新结果。
3. 来源平台 ID、规范化 URL 和 SHA-256 三层去重；同键不同内容返回冲突。
4. 游标只在本批承诺写入完成后推进；中途失败不会漏掉条目。
5. 权利状态不明不得获取大型资产；受限/撤销来源不能处理或发布。
6. ASR 日/月预算、单候选大小和时长门禁可确定性测试。
7. 未发布草稿 30 天、拒绝大型产物 7 天和临时资产立即清理的计划生成。
8. 普通数据库角色不能写来源、候选、审核或运行；服务端 repository 可以按最小权限写入。

### 5.3 领域与 application

新增：

```text
src/modules/content-acquisition/
  domain/
    acquisition-state.ts
    source-policy.ts
    candidate-identity.ts
    budget-policy.ts
    retention-policy.ts
    index.ts
  application/
    register-source.ts
    run-acquisition-source.ts
    process-candidate.ts
    retry-processing-step.ts
    plan-candidate-cleanup.ts
    index.ts
  adapters/
    content-source-adapter.ts
    fake-content-source-adapter.ts
    index.ts
  repositories/
    content-acquisition-repository.ts
    drizzle-content-acquisition-repository.ts
    index.ts
  schemas/
    content-acquisition.ts
    index.ts
  index.ts
```

所有时间、ID、哈希和预算时钟可注入。application 使用 `runId`、`jobId`、`generationId` 和 revision；不把数据库行或第三方原始响应暴露为公共 DTO。

### 5.4 数据库与迁移

新增 `src/shared/db/schema/content-acquisition.ts`，修改 `src/shared/db/schema/index.ts`，使用 `pnpm db:generate` 生成下一条版本化迁移和 snapshot。

表：

- `acquisition_sources`
- `acquisition_runs`
- `content_candidates`
- `candidate_artifacts`
- `candidate_processing_attempts`
- `candidate_reviews`

关键约束：来源适配器/外部 ID 唯一；候选规范化 URL 与来源身份唯一；处理 attempt 的 job/generation 唯一；状态、权利、保留期限和预算值有 CHECK；候选产物必须属于同一候选。正式内容表不依赖候选生命周期，清理候选不能级联删除已发布内容。

### 5.5 CLI 与合同

新增 `scripts/acquire-content.ts` 和 package script：

```json
"content:acquire": "tsx scripts/acquire-content.ts"
```

CLI 第一版只支持 `--source <stableKey>`、`--dry-run`、`--limit` 和注入 fake；没有显式 source 时失败关闭。输出只含计数、内部 run ID、步骤状态和估算成本。

修改：

- `contracts/registry/v1/error-codes.json`
- `contracts/openapi/v1/openapi.json`
- `src/shared/contracts/v1/api-contract.ts`

增加 `CONTENT_SOURCE_NOT_FOUND`、`CONTENT_SOURCE_DISABLED`、`CONTENT_ACQUISITION_CONFLICT`、`CONTENT_RIGHTS_REQUIRED`、`CONTENT_BUDGET_EXHAUSTED` 和 `CONTENT_PROCESSING_FAILED`。

### 5.6 验证

```powershell
pnpm exec vitest run tests/unit/content-acquisition-*.test.ts
pnpm exec vitest run tests/contracts/content-source-adapter-contract.test.ts
pnpm exec vitest run tests/database/content-acquisition-persistence.test.ts tests/database/content-acquisition-rls.test.ts
pnpm db:check
pnpm lint
pnpm typecheck
git diff --check
```

建议提交：`feat: add content acquisition foundation`

## 6. REVIEW-001：所有者审核与发布门禁

### 6.1 目标与边界

提供仅所有者可见的候选列表、详情、修订、双维度审核、发布请求和撤下编排。类型专用正式 publisher 尚未接入时返回 `CONTENT_PUBLISHER_NOT_AVAILABLE`，不能用 fake 在真实运行时冒充发布成功。

### 6.2 先写测试

新增：

- `tests/unit/content-workflow-owner-access.test.ts`
- `tests/unit/content-review-gate.test.ts`
- `tests/unit/content-workflow-routes.test.ts`
- `tests/unit/content-workflow-page.test.tsx`
- `tests/database/content-review-transaction.test.ts`
- `tests/e2e/content-workflow.spec.ts`

覆盖：未登录、已登录非所有者、缺少 allowlist 和伪造客户端角色均拒绝；`es-ES` 与 `zh-CN` 必须独立批准；同版本生成者不能自动成为审核通过；发布再次校验权利、哈希、revision 和结构；请求修改/拒绝/重试不丢备注；发布事务失败不产生半版本。

### 6.3 实现

新增：

```text
src/shared/auth/content-workflow-owner.ts
src/modules/content-acquisition/application/
  list-candidates.ts
  get-candidate-review.ts
  submit-candidate-review.ts
  request-candidate-reprocessing.ts
  publish-candidate.ts
  archive-published-candidate.ts
src/modules/content-acquisition/publishers/
  candidate-publisher.ts
  candidate-publisher-registry.ts
src/modules/content-acquisition/ui/
  content-workflow-dashboard.tsx
  candidate-review-workbench.tsx
app/(product)/me/content-workflow/page.tsx
app/(product)/me/content-workflow/[candidateId]/page.tsx
app/api/v1/internal/content-workflow/sources/route.ts
app/api/v1/internal/content-workflow/runs/route.ts
app/api/v1/internal/content-workflow/runs/[runId]/route.ts
app/api/v1/internal/content-workflow/candidates/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/reprocess/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/reviews/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/publish/route.ts
app/api/v1/internal/content-workflow/candidates/[candidateId]/archive/route.ts
```

所有者授权使用服务端配置的用户 UUID allowlist，例如 `CONTENT_WORKFLOW_OWNER_USER_IDS`；不在普通日志记录邮箱或 UUID，只记录内部 hash。页面入口只有授权用户可见，但每个 Route 和 application 仍独立校验。

候选 publisher 是 application 端口。测试注册 deterministic publisher；真实运行没有对应 kind 的 publisher 时按钮显示原因并保持禁用/可恢复状态。

### 6.4 合同与验证

增加候选列表、详情、审核、发布结果 JSON Schema 与 OpenAPI；错误码增加 `CONTENT_WORKFLOW_FORBIDDEN`、`CONTENT_REVIEW_INCOMPLETE`、`CONTENT_PUBLISHER_NOT_AVAILABLE` 和 `CONTENT_PUBLICATION_CONFLICT`。

```powershell
pnpm exec vitest run tests/unit/content-workflow-*.test.ts tests/unit/content-review-gate.test.ts
pnpm exec vitest run tests/database/content-review-transaction.test.ts
pnpm exec playwright test tests/e2e/content-workflow.spec.ts --project=desktop-chromium --workers=1
pnpm test:contracts
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

建议提交：`feat: add owner content review workflow`

## 7. ARTICLE-001：文章自动采集接入

### 7.1 目标与边界

用文章 RSS 和一个有明确来源策略的专用适配器，把候选转换为现有 article 草稿并接入 REVIEW-001 publisher。禁止付费墙、来源不明全文和客户端 HTML 执行；不改文章阅读证据边界。

### 7.2 测试先行

新增：

- `tests/contracts/article-feed-adapter-contract.test.ts`
- `tests/unit/article-feed-normalization.test.ts`
- `tests/unit/article-candidate-publisher.test.ts`
- `tests/database/article-acquisition-publish.test.ts`
- `tests/e2e/article-acquisition.spec.ts`
- `tests/fixtures/content-acquisition/article-feed/*.xml`
- `tests/fixtures/content-acquisition/article-pages/*.html`

覆盖 ETag/Last-Modified、分页/游标、重复 GUID/URL、恶意 HTML、异常编码、正文缺失、许可不全、同版本不同哈希、发布事务和撤下后公开查询不可见。

### 7.3 实现

新增：

```text
src/modules/content-acquisition/adapters/rss/article-rss-adapter.ts
src/modules/content-acquisition/adapters/articles/article-source-adapter.ts
src/modules/content-acquisition/normalizers/article-candidate.ts
src/modules/content/publishers/acquired-article-publisher.ts
```

如仓库没有可靠 XML 解析器，本任务引入并锁定最小维护良好的 XML 解析依赖；不得用正则解析 RSS。正文清洗只保留纯文本段落和允许字段。`acquired-article-publisher` 调用 content/article application/repository，不由 acquisition 直接写 article 表。

修改现有 article Schema/导入应用，使候选发布保存来源、作者、URL、许可、署名、抓取日期、内容哈希、两个审核记录和变更原因。发布后的 UI 继续复用 `/read/article/[articleId]`。

### 7.4 验证

运行聚焦单元/契约/数据库/E2E、`pnpm content:validate`（涉及 bundle 时）、`pnpm db:check`、lint、typecheck、build 和 `git diff --check`。默认只使用本地 fixture；真实来源接入需单独显式运行并记录来源与结果。

建议提交：`feat: ingest reviewed article feeds`

## 8. MEDIA-001：统一媒体领域与学习资料库

### 8.1 目标与边界

建立视频/播客共享媒体模型、DTO、列表、播放投影和用户进度；把 `/learn` 替换为直接内容资料库。当前不接真实来源、不执行 ASR；空库显示诚实状态。旧训练 route 和数据先保留但从主导航移除。

### 8.2 测试先行

新增：

- `tests/unit/media-domain.test.ts`
- `tests/unit/media-progress.test.ts`
- `tests/unit/media-routes.test.ts`
- `tests/unit/media-library.test.tsx`
- `tests/database/media-persistence.test.ts`
- `tests/database/media-rls.test.ts`
- `tests/contracts/media-contract.test.ts`
- `tests/e2e/media-library.spec.ts`

更新：

- `tests/unit/learn-page.test.tsx`
- `tests/e2e/learn-page.spec.ts`
- `tests/e2e/product-shell.spec.ts`

首先断言 `/learn` 不出现旧 Hero、开始/继续 CTA、练习时间线和顶部头像；直接显示 `全部/视频/播客`、搜索、筛选、媒体卡或真实空状态。覆盖内容撤下、播放信息过期、进度 revision 冲突和跨用户隔离。

### 8.3 领域与数据库

新增：

```text
src/modules/media/
  domain/media.ts
  domain/source-position.ts
  domain/media-progress.ts
  application/list-media.ts
  application/get-media.ts
  application/get-media-playback.ts
  application/save-media-progress.ts
  repositories/media-repository.ts
  repositories/drizzle-media-repository.ts
  schemas/media.ts
  ui/media-library.tsx
  ui/media-card.tsx
  index.ts
src/shared/db/schema/media.ts
```

表：`media_items`、`media_versions`、`media_assets`、`media_segments`、`user_media_progress`。正式媒体版本不可变；资产 URL 不以长期地址进入客户端；进度按用户＋版本唯一并使用 revision/CAS。

### 8.4 页面与 API

替换：

- `app/(product)/learn/page.tsx`
- `app/(product)/learn/learn-page-content.tsx`

新增：

```text
app/(product)/learn/media/[stableKey]/page.tsx
app/api/v1/media/route.ts
app/api/v1/media/[stableKey]/route.ts
app/api/v1/media/[stableKey]/playback/route.ts
app/api/v1/media/[stableKey]/progress/route.ts
```

列表按 cursor 分页，完整字幕只在详情/播放接口中有界返回。移动壳层从 `src/shared/ui/app-shell.tsx` 移除 `AccountMenu` 常驻头像；桌面侧栏底部账户菜单保持。

`/learn/practice`、旧 recommendation 和 checkpoint 代码不在本任务删除；先移除用户可见主入口，并为仍被文章/场景引用的旧 route 增加兼容测试。

### 8.5 验证

运行媒体单元/合同/数据库、学习页和壳层 Playwright，覆盖 320–1440px；再运行 lint、typecheck、`pnpm test --run`、`pnpm db:check`、build 和 `git diff --check`。

建议提交：`feat: replace learning home with media library`

## 9. VIDEO-001：YouTube 白名单视频纵向闭环

### 9.1 目标与边界

接入至少一个白名单频道的官方 RSS/Data API 增量发现，使用 YouTube 官方嵌入播放。只读取平台允许取得的元数据和字幕；不下载 YouTube 音视频，不调用非公开下载接口。没有合法字幕/音频来源时允许发布“仅播放、无逐句辅助”的内容，或留在候选库。

### 9.2 测试先行

新增：

- `tests/contracts/youtube-source-adapter-contract.test.ts`
- `tests/unit/youtube-candidate-policy.test.ts`
- `tests/unit/media-segment-timeline.test.ts`
- `tests/unit/video-learning-workbench.test.tsx`
- `tests/e2e/video-learning.spec.ts`
- `tests/fixtures/content-acquisition/youtube/*.xml`
- `tests/fixtures/content-acquisition/youtube/*.json`
- `tests/fixtures/media/captions/*.vtt`

覆盖频道游标、删除/私密视频、重复视频 ID、区域失效、嵌入被禁、字幕缺失、VTT 时间边界、字幕模式、逐句跳转、A/S/D/Q、自动暂停、旧 generation 和移动抽屉焦点。

### 9.3 实现

新增：

```text
src/modules/content-acquisition/adapters/youtube/youtube-channel-adapter.ts
src/modules/content-acquisition/adapters/youtube/youtube-policy.ts
src/modules/media/publishers/acquired-video-publisher.ts
src/modules/media/domain/segment-timeline.ts
src/modules/media/ui/media-learning-workbench.tsx
src/modules/media/ui/video-player-adapter.tsx
src/modules/media/ui/segment-transcript.tsx
src/modules/media/ui/lexical-drawer.tsx
```

播放器通过小型内部端口暴露 play/pause/seek/currentTime/ready/error，不让 YouTube SDK 对象扩散到 domain。字幕 parser 把允许取得的 VTT/结构化字幕转换为内部 segment DTO；任何自动字幕都标记来源和审核状态。

### 9.4 验证

默认测试完全拦截网络并使用 fake player。首次真实运行只抓元数据和允许字段，输出候选报告；所有者审核后才发布。运行聚焦测试、媒体回归、Playwright、lint、typecheck、build 和 `git diff --check`。

建议提交：`feat: add reviewed youtube video learning`

### 9.5 MEDIA-PLAYER-002：播放中黑屏与旧自动暂停入口（2026-10-14 用户报告）

- 仅修复统一播放器生命周期与已弃用的外部复选框；保留 Plyr 内置自动暂停、Q、字幕、续播及进度 CAS，不改媒体版本、供应商或证据。
- 先复现相同资源的新播放 DTO/回调导致销毁、Plyr 恢复克隆节点后旧 ref 脱离页面，以及加载时旧复选框出现。
- 生命周期回调读取最新提交的值而不触发资源重建。React 只持有稳定宿主；每次源切换/重试创建独立输入节点，销毁后释放宿主内容与监听，过期事件不能影响当前播放。
- 验证托管视频、YouTube 与播客的刷新不销毁、源切换新节点仍连接、旧事件无效、恰好一次销毁；播放失败重试、字幕/快捷键/进度回归；桌面/手机 Playwright 检查连续位置更新后视频节点及内置控件仍在，且旧复选框始终不存在。
- 当前共享工作树原有改动全部保留，不混合提交；完成后登记测试、限制和本人实际视频复核步骤。

### 9.6 MEDIA-TRANSCRIPT-001：当前字幕居中跟随（2026-10-14 用户报告）

- 仅修复字幕超出可见范围后当前句始终贴底的问题；沿用共享工作树，保留其他任务改动。
- 开启跟随时，每次换句将当前行置于字幕视区中间，为后续句预留阅读空间；首尾按可滚动范围限制，超长行优先显示开头。桌面仅滚动字幕列表，窄屏完整文本布局跟随页面居中。
- 关闭跟随后停止自动滚动；重新开启、切换双语或从隐藏恢复时对齐当前句。同一句中的逐词播放刷新不触发滚动。
- 先增加可复现单元回归；Playwright 使用仅非生产可用的 30 句视频 fixture 验证桌面/手机居中、关闭/恢复跟随、双语与隐藏恢复，以及桌面播放器位置不被字幕滚动改变。不修改进度、内容版本或学习证据。

### 9.6 MEDIA-WORD-001：字幕点词可用闭环（2026-10-14 用户授权本会话决策）

- 视频、播客继续共用 `LexicalDrawer`：显示点选词、字幕原句、可用的词典原形/词性/中文释义/搭配与折叠变形；复用词架的 `POST /api/v1/read/word-lookup`，审核词表提供即时回退，缺条目与服务故障分开显示。
- 点词及显式朗读前暂停正在播放的媒体，关闭不自动续播；关闭/Escape 将焦点还给触发词。面板为非模态辅助区，允许继续点别的字幕词；内部按钮的空格/箭头不被媒体快捷键截获。解释成功聚焦结果，Escape 不依赖原按钮继续存在；滚动后关闭按钮仍可见。手机面板保留底部导航空间。
- 单词朗读复用 `useBrowserSpeech`，只读所选表面词/es-ES，标记合成音；start 前显示准备，可停止，失败可再次朗读，切词/关闭/隐藏/卸载取消。
- 只有显式点击才调用已有 `POST /api/v1/read/word-explanation`，发送点选词及当前原句；AI 解释与例句明确标记。JSON/Zod 与 NDJSON 显式 done 校验，断流/错误/超时可重试。成功后不保留重复生成按钮。语料链接按表面词查询，在新标签页保留原播放位置。
- 每个词/原句选择拥有独立请求与状态：词典 20 秒、解释 30 秒硬截止；切词/卸载取消并忽略旧响应，释放 reader/监听/timer。无新数据库、迁移、供应商、收藏或 evidence/profile 写入；不混入其他字幕任务。
- 回归：占位功能先失败；词典成功/缺失/故障/畸形/重试/超时、词形回退、朗读准备/start/停止、解释显式触发/done/断流/取消/过期隔离、快捷键/焦点；桌面与手机 Playwright 视频/播客查词/朗读/解释/安全区。真实付费解释和 Safari 听感不由 fake 测试代表。

### MEDIA-WORD-002：点词直接生成解析（2026-10-15 用户授权）

- 覆盖 MEDIA-WORD-001 的二次显式生成要求：视频、播客点词即通过现有解释端点请求当前词及真实字幕语境，与词典查询并行；相同选择的普通重渲染不重复请求。
- 按用户确认保留朗读按钮和字幕原句，去掉“单词朗读 · 合成音”闲置提示、词典未收录/释义待补提示及“AI 语境解释 · 按需生成”；直接显示生成结果，AI 例句继续标识身份。朗读进行状态、技术失败与手动重试仍可用。
- 初始显示生成中，失败或 30 秒超时提供手动重试；切词、换原句或关闭时取消旧请求并释放计时器，旧响应不能覆盖新选择。结果自动完成不转移键盘焦点，Escape 保持可用。不更改 API、供应商、词典内容、数据库或能力证据。
- 先更新可复现单元回归，再验证自动生成、缺词/词典挂起、同词不同原句、取消/超时/断流重试及桌面/手机视频和播客路径；真实收费供应商、扬声器听感与 Safari 真机另行验收。

### 9.7 MEDIA-SEGMENT-CAP-001：完整已审核字幕交付（2026-10-14 用户报告）

- 修复 “El bulto de Mamá Rabbit | Peppa Pig en Español Latino” 后半段字幕缺失：数据库已有 848 条已审核字幕，视频 54:45，前 500 条仅至 33:46.340，完整末条至 54:30.460；被隐藏的时间跨度为 20:44.120，无需补采、ASR 或数据库写入。
- 移除 repository 的 500 行截断、domain 的 500 条切片和播放协议的 `maxItems: 500`。按当前版本和 approved 状态读取完整字幕，保留原 index、排序、中文翻译与 words；显式读取播放需要的列，不返回审核或采集元数据。
- 播放接口不增加分页：完整字幕一次读取，避免多个请求中版本内容不一致；进度仍按用户隔离读取，发布、版权、撤下、过期地址门禁不变。协议同步已有可空逐词时间轴，不新增学习评分语义。
- 测试先复现 501/848/1025 条 domain 截断、848 条契约拒绝和数据库读取截断；验证待审核句过滤、原版本隔离、排序及末尾词时间轴。桌面/手机 Playwright 用独立 848 句 fixture 验证末句高亮、双语与前后跳句。
- 真实库仅只读核验，报告条数、末尾时间与载荷大小；不打印私有进度或资产地址。沿用共享工作树保留其他任务改动，不混合提交；全量检查与既有失败单独登记。

### 9.8 MEDIA-LOAD-001：媒体点击与分段请求加载优化（2026-10-14 用户报告）

- 仅优化现有视频/播客加载。Range 代理不再重复读取完整字幕、逐词时间轴和个人进度，改用 `getMediaStreamSource` application 与 repository 的无缓存单查询窄 DTO；完整播放接口仍交付全部已审核字幕与最新个人进度。
- 每次请求仍鉴权并重查当前已发布、版权 cleared、可用且未过期的源；保留白名单、重定向、Range、上游故障和取消语义。不得为速度缓存私人进度或绕过撤下。
- 卡片使用 Next 默认部分预取与已有详情 loading 边界，避免高优先级图片同时触发整份字幕预取；图片加载优先级保留。
- 先复现窄读取缺失；数据库验证视频/播客一次查询、不访问字幕/进度表、当前版本与撤下/版权/过期门禁。Range 路由保留鉴权和媒体回归；相关单元、类型、ESLint、桌面/手机媒体 E2E 与 build 验证。真实库只读对比窄读取与完整播放读取，不输出源地址或私人进度；不把数据库耗时等同于用户点击到播放的总耗时。
- 用户澄清为详情骨架等待后继续本任务：首屏只挂载一批字幕及当前句附近的行，其余已获取的完整字幕分帧增量挂载；明确暂时加载状态，跳句与恢复位置不必等待全部行挂载，取消/隐藏/换源清理旧批次。保留完整版本/词时间轴与全部最终可读文本，不做字幕裁剪、API 分页或能力证据变更。补充服务器渲染节点数、增量完成/取消和远处当前句回归；隔离真实库测量详情渲染与浏览器标题出现时间，并区分冷编译、真实会话鉴权和媒体播放耗时。

### 9.9 MEDIA-SPEAKER-LABEL-001：字幕不显示机器说话人编号（2026-10-15 用户报告）

- 用户报告部分视频字幕出现 `S1`、`S2` 等无关标识。只读核查真实库：`media_segments` 共 99,285 条，30,493 条的 `speaker` 非空，取值全部是 `S1`–`S9`（其中 S1 14,591、S2 8,512），来自 Language Reactor 导入字幕的说话人区分编号；`source_text`/`translation` 本身不含这些标识，字幕行把它们渲染成了句前的加粗前缀。
- 领域新增 `projectSpeakerLabel`：纯机器编号（`S1`、`s 2`、`Speaker_11` 等）归一为 `null`，真实姓名保留并按原名显示。播放领域投影和字幕行共用这一条规则，视频与播客同源生效。
- 不改写已发布数据：`speaker` 属于候选内容哈希覆盖的版本内容，清理历史值会造成版本与哈希不一致，因此保持原值、只改面向学习者的投影与渲染；不新增迁移、版本、API 字段、供应商调用或学习证据。
- 测试先行：领域投影与 `SegmentTranscript` 的 `S1`/`S2` 断言先在旧实现失败（真实渲染为 `00:00S2Buenos días, Peppa.`），修复后通过；视频与播客 E2E fixture 各带真实编号，浏览器验证字幕区无 `S1`/`S2` 文本且句子仍完整显示。

### 9.10 MEDIA-WORD-003：最近发布播客的词级时间轴缺失（2026-10-18 用户报告）

- 用户报告“最近更新的几条播客没有词级时间轴”。只读核查真实库：已发布播客 97 条中恰有 5 条（2026-10-16～18 每日采集管线发布的 v1）全部 `media_segments.words IS NULL`；更早发布的 92 条播客及 80 条视频均有词级时间轴。5 条句子时间戳也是按整段时长平均分配，不是真实 provider 时间。
- 根因：`content-media-runtime` 的 `SpeechToMediaTranscriptionProvider` 只消费 provider 返回的 `text`，丢弃 MiniMax ASR 在 `timestamp_level=word` 时返回的逐词时间戳 `result.segments`，再用 `splitTranscriptText` 平均分配句子时间。下游从候选草稿、DB `words` 到播放投影本已支持词级时间轴。
- 代码修复（T1）：新增 media 纯领域 `groupProviderWordsIntoSentences`，只用 provider 词时间戳分组句子并生成精确 UTF-16 词级 offsets；每个 provider 单元必须是单个词元，句末标点/gap>1000ms/长度≥240 切句；任何非词级、重叠、越界一律 fail-closed（`MEDIA_WORD_TIMELINE_INVALID`），绝不生成估算时间轴。live MiniMax 显式请求 `timestampLevel: "word"`；纯文本 provider 仍走原平均回退（保留既有行为但不产生 words）。
- 贯通：`media-processing` 增加独立小 DTO `MediaTranscriptWordTiming`，`RawTranscriptSegment`/`MediaTranscriptSegment` 透传并在 `segmentMediaTranscript` 做结构校验；`validateSegmentTimeline` 在准备审核、内容审核和发布前对非空 `words` 用 `validWordTimings` 严格校验；`processMediaCandidate` 写库前按草稿 schema 归一化再算 contentHash，避免 zod 键序导致 Hash 与审核/发布重算不一致。
- 评审/修订 provider 输入投影掉 `segment.words`（`mediaReviewInputHash` 同样基于投影），避免加词后请求体从数 KB 膨胀到数百 KB；发布草稿的 contentHash 覆盖范围与真实草稿不变。
- 数据修复（T2/T3）：5 条播客重跑 MiniMax 词级 ASR + 翻译生成 `media_transcript_backfills` 草稿（32/23/136/111/145 段，650/566/1198/1779/2055 词），独立复核并修正 12 处译文后版本化发布 v2；两条 CNN 的真实音频比 LR 元数据短约 90 秒（megaphone 动态广告/rendition 差异），用既有 `correct-media-duration.ts` 发布 v3 修正为 245107/221492ms。发布后当前版本 words 覆盖率 100%，`wordTimingsForPlayback` 每段非空，旧版本与历史证据保留，审核身份为 `dsh-ai-owner-authorized-review`。
- 播放资产收口：5 条新播客仍引用外部 signed/不可达 URL（libsyn 已 403、blubrry 本机网络不可达），与库内其余播客的 `bunny-storage` 不一致；按既有托管模式把 T2 已下载、生成词级时间轴的精确音频上传自有 Bunny CDN 并 CAS 切换当前版本 asset（5/5 成功，56,977,088B；库内播客当前版本托管 97/97），避免签名过期/动态广告 rendition 与词级时间轴漂移（T4）。
- 测试先行：新增分组、runtime 词级适配、media-processing 透传/拒绝、审核输入投影、processMediaCandidate 级 5 个单测文件与 segment-timeline 扩展用例（32 个断言），先红后绿；全树 typecheck 与受影响 ESLint 通过。
- 已知限制：未做真实听音与人工母语/教学复核；ASR 文本仍有少量残余（如 Baler/Valer）；严格单词语元策略会让含缩写点/连字符复合词的 provider 响应整条失败（需另开任务决定拆分策略）；长音频 >500s 的 MiniMax 分段偏移未用真实 provider 复验；每日管线代码需合并到默认分支后才会影响后续定时运行。

### 9.11 LEARN-NAV-PERF-001：点卡片先闪学习页网格骨架（2026-10-18 用户报告）

- 用户报告从 `/learn` 点击视频/播客时先显示学习资料库的加载骨架。真实 Chrome 逐帧探针确认：点击后约 69–91ms 提交 pushState，但目标路由的 `loading.tsx` 客户端 chunk 尚未加载，React 的 suspense 冒泡到已挂载的 `/learn/loading.tsx` 祖先边界，于是先画网格骨架；目标 loading chunk 首字节到达（5–9ms 后）即切成详情骨架。dev 下目标 chunk 可延迟数秒；整页直访详情从不出现该闪动。
- 修复：把完整 24 卡自适应网格骨架移入 `app/(product)/learn/learn-library-skeleton.tsx`，由 `learn/page.tsx` 的页内 `<Suspense>` 使用，直访/筛选搜索仍先流式输出真实资料库骨架；`learn/loading.tsx` 改为只保留顶栏占位与“正在打开…”的中性壳，不再渲染 `.media-grid`，但保留路由 loading 边界使 `/learn` 仍可预取。卡片新增 `media-card-link.tsx`：保留 `Link` 默认预取，在 hover 约 100ms/focus/touchstart 时手动 `router.prefetch(href)`（默认 auto，只到详情 loading 边界，避免把带用户进度的完整 RSC 缓存进 static TTL），同 href 去重、离开取消、`onInvalidate` 复位，并用 `useLinkStatus` 显示 pending 圆点。
- 验证：`learn-page`/`media-card-link` 等 4 文件 22 项通过；改动文件 ESLint 0，全树 tsc 0；dev 浏览器直访 `/learn` 初始 HTML 含网格骨架，四个导航场景（悬停视频/播客、不悬停视频/播客）逐帧网格标记均为 false，不悬停时只出现中性壳，悬停后命中详情骨架。
- 限制：Next 16 开发模式的 `createPrefetchURL` 直接返回 null，`router.prefetch` 在 dev 是 no-op；意图预取的服务器预热效果必须在 production build/start 复验，dev 只证明结构不再误导。未跑全量 E2E/build。

### 9.12 MEDIA-DETAIL-PROGRESSIVE-001：打开视频/播客后加载慢（2026-10-18 用户报告）

- 只读载荷实测：当前媒体详情页在渲染前 `await getPlayback`，一次性读取当前版本全部已审核 segments（含 words）。177 条可播媒体中 DTO 中位 147–162KB、p90 约 532–620KB、最大 940KB；`words` 逐词时间轴占 DTO 的 68.5–83.1%（DB 原始层 89%），而首屏真正需要的 media+asset+progress 仅 1.1–1.9KB。当前网络到 Supabase 异常（冷建连 0.75–6.9s、传输约 20–30KB/s；同一代码同一数据波动 >10×，服务端执行计划 <1ms），一次性大载荷把网络抖动放大成数秒到数十秒的骨架等待。
- 服务端：新增 `getPlaybackOverview(stableKey, userId, now)`，复用当前版本/发布/版权/可用/过期/鉴权与卡片/资产投影，只并发读 progress、系列摘要和一次 approved segment `count(*)`，不读 `source_text`/`words`；`getPlayback` 增加可选 `{ includeWords: false }`（SQL 直接返回 null，默认行为不变）；`GET /api/v1/media/:stableKey/playback?include=text` 返回同契约的纯文本字幕，非法 include 返回 400；OpenAPI 同步。
- 页面/客户端：`page.tsx` 顶层只 `await params` 并返回 `<Suspense fallback={<MediaDetailLoading/>}>`，数据半区移到兄弟模块 `media-detail-content.tsx`（Next typed routes 禁止 page 额外导出）；真实路径用 overview 先渲染标题与播放器，客户端两阶段取字幕：先 `?include=text` 渲染文本，再取默认 `/playback` 只合并 words。两阶段都校验 stableKey+version 一致，具备取消/45s 超时/StrictMode 去重/旧响应隔离；词级失败保留文本并可单独重试。播放器 `hasSegments` 使用 overview 句数稳定值，字幕到达不重建播放器；`?t=` 优先，`?segment=` 在字幕到达后定位一次；E2E fixture 仍在服务端使用完整 playback，不经后台 fetch。
- 验证：overview PGlite 门禁/计数 4 项、playback route（默认/include=text/非法 400）5 项、experience 两阶段/失败重试/版本/取消/StrictMode 9 项、workbench/播放器/字幕/loading/source-position 等 8 文件 81 项通过；改动文件 ESLint 0，全树 tsc 0。Lead 真实库只读浏览器复核：真实视频直访 h1 618ms、字幕 2.0s、词级合并 4.7s；从 `/learn` 点击视频 h1 815ms、字幕 3.7s，无网格骨架；真实播客直访 h1 957ms、字幕 4.4s、词级合并 5.2s（当前慢网条件，仅本机 dev）。
- 限制：未在真实播放中复核字幕到达不中断播放（遵循只读，未点播放），由单测覆盖；未跑全量 E2E/build；未做 Safari 真机；当前数据库网络异常会继续影响字幕后台阶段，需单独立项排查 Supabase 连通性；`/playback` 在 409 进度恢复时仍会重拉完整载荷，可作为后续减重项。

## 10. PODCAST-001：播客 RSS 纵向闭环

### 10.1 目标与边界

接入至少一个白名单播客 RSS，发现节目和 episode，保存来源元数据并在权利门禁允许时使用 enclosure 播放/临时处理。第一版不做完整播客平台、自动订阅推荐或无限历史回填。

### 10.2 测试先行

新增：

- `tests/contracts/podcast-rss-adapter-contract.test.ts`
- `tests/unit/podcast-candidate-policy.test.ts`
- `tests/unit/podcast-audio-player.test.tsx`
- `tests/e2e/podcast-learning.spec.ts`
- `tests/fixtures/content-acquisition/podcast/*.xml`

覆盖 GUID/URL 去重、重发 episode、enclosure 类型/大小/重定向限制、失效音频、节目下架、无 transcript、有 transcript、播放恢复和字幕/词句抽屉。

### 10.3 实现

新增：

```text
src/modules/content-acquisition/adapters/rss/podcast-rss-adapter.ts
src/modules/content-acquisition/adapters/podcast/podcast-policy.ts
src/modules/media/publishers/acquired-podcast-publisher.ts
src/modules/media/ui/audio-player-adapter.tsx
```

共享 ARTICLE-001 引入的 XML 解析边界。enclosure 请求限制允许主机、HTTPS、重定向、Content-Type、Content-Length 和流式读取上限；不把完整 URL 或音频写入普通日志。播放器继续复用 media workbench、segment、快捷键、进度和错误状态。

### 10.4 验证

使用本地音频 fixture 和 fake fetch 完成全部默认测试。真实 RSS 只在显式运行中访问；未取得处理权时只保存允许的元数据/播放链接，不下载或 ASR。

建议提交：`feat: add reviewed podcast learning`

### 10.5 PODCAST-UI-001：播客文本主体与顶部播放条（2026-10-14 产品本人批准）

- 加载态同步采用上下布局：`loading.tsx` 用路由参数中的 `podcast.` 前缀作为展示提示，使用紧凑音频骨架和文本占位，不显示视频矩形或当前片段；实际媒体类型仍由服务端校验，非此命名的自定义媒体保留通用骨架。复用正式播客宽度和移动端样式，补单元复现及桌面/手机实际 loading 边界回归。仅 `AUTH_E2E_ENABLED=1` 且非生产的专用 fixture 延迟 3 秒，生产路径无新增等待。
- 沿用共享工作树，单独处理播客 UI。复用现有播放器、字幕、进度及点词生命周期，不新增 API、供应商、迁移或能力证据。
- 播客各屏宽统一为顶部紧凑播放条、下方文本的上下布局，整页限制 960px 阅读宽度；桌面封面与控制横排，手机隐藏播放条封面腾出控制空间。仅播客移除重复“当前片段”，视频布局不变。
- 字幕面板按视口高度有界滚动；自动居中、手动浏览、双语与隐藏恢复不滚动外部页面。播放条可贴顶，播放器菜单不能被外框裁剪，错误/重试、空字幕、查词/焦点恢复继续使用既有状态。
- 窄屏进度条独占一行，主要按钮至少 44px；保留静音，以系统音量取代挤占空间的音量滑杆。字幕四项切换同排，面板预留底部导航空间。增加进度条宽度、命中区、菜单实际可点和底栏遮挡回归；先复现 320px 进度条宽度为 0，再验证修复。
- 单元先复现重复当前句及隐藏字幕后仍显示当前句；运行播客、视频工作台及 Plyr 回归。新增仅非生产使用的 36 句播客 fixture，桌面/手机 Playwright 覆盖 320/375/768/1024/1440/1920px 上下布局、无控制横向溢出、阅读宽度、长文本跟随与手动滚动后播放器位置、双语/隐藏/恢复及现有查词/进度路径，截图人工复核。
- 验证聚焦 Vitest、全局 typecheck、受影响 ESLint 和媒体专项 Playwright；全量失败/OOM 基线与 Safari 真机限制分别登记，不把手机 Chromium 当作真机验收。保留其他任务在途改动，不混合提交。

## 11. MEDIA-002：ASR、翻译、成本与可靠性

### 11.1 目标与边界

为通过门禁且无可用字幕的媒体生成 ASR/翻译草稿，完成切句、低置信度标记、临时音频清理、成本硬限制和来源撤下恢复。草稿不自动发布。

### 11.2 测试先行

新增：

- `tests/unit/media-processing-orchestrator.test.ts`
- `tests/unit/media-asr-eligibility.test.ts`
- `tests/unit/media-segmentation.test.ts`
- `tests/unit/media-cleanup.test.ts`
- `tests/contracts/media-transcription-provider-contract.test.ts`
- `tests/contracts/media-translation-provider-contract.test.ts`
- `tests/database/media-processing-transaction.test.ts`
- `tests/e2e/media-processing-review.spec.ts`

覆盖人工字幕优先、自动字幕次之、ASR 最后；同音频哈希不重复收费；预算耗尽不调用 Provider；取消/超时/失败均删除临时音频；无 `done` 流失败；低置信度片段阻塞审核；翻译失败保留西语；撤下后目录和语料索引不可见。

### 11.3 实现

新增：

```text
src/modules/content-acquisition/application/process-media-candidate.ts
src/modules/content-acquisition/application/cleanup-candidate-artifacts.ts
src/modules/content-acquisition/processors/media-transcription-processor.ts
src/modules/content-acquisition/processors/media-translation-processor.ts
src/modules/content-acquisition/processors/media-segmentation.ts
src/modules/providers/media-transcription/
src/modules/providers/media-translation/
```

复用现有 STT/translation 供应商基础设施和观测方式，但使用独立 acquisition DTO 与数据保留策略，避免把用户练习音频和第三方媒体混为同一业务尝试。媒体长度超过 provider 单次限制时先在 application 层分块并保存块边界；块级失败不得拼成伪完整转写。

清理使用可重试工作记录；“删除请求已登记”不能伪装成已删除。成功、失败、取消和超时均在 finally/补偿路径登记并验证清理。

### 11.4 验证

默认只使用假音频与 fake Provider。显式真实回放限定单个已授权候选和硬预算，记录 provider、模型、请求 ID、延迟、成本和清理结果，不提交音频或原始响应。

建议提交：`feat: process media transcripts safely`

## 12. LEX-001：词汇、短语与出现索引

### 12.1 目标与边界

建立跨文章和媒体的词元/词形、短语、出现位置与个人复习意图；在 `/read` 增加 `文章/词汇/短语/语料` 子导航。当前只实现词汇/短语浏览和上下文跳转，不写能力证据。

页面设计以 [`2026-10-12 阅读页短语与语料页面设计`](../superpowers/specs/2026-10-12-reading-phrase-and-corpus-page-design.md) 和 ADR-0012 为准。短语页是表达库：每张卡默认展示一条真实代表例句，保留变体、语用和个人复习意图；公共条目与当前用户私有条目必须显示范围。语料比较与多词匹配属于 LEX-002，不在本任务中把 token AND 查询伪装成连续短语。

### 12.2 测试先行

新增：

- `tests/unit/spanish-tokenization.test.ts`
- `tests/unit/lexeme-normalization.test.ts`
- `tests/unit/phrase-matching.test.ts`
- `tests/unit/corpus-indexing.test.ts`
- `tests/unit/lexicon-routes.test.ts`
- `tests/unit/lexicon-pages.test.tsx`
- `tests/database/lexicon-persistence.test.ts`
- `tests/database/lexicon-rls.test.ts`
- `tests/contracts/lexicon-contract.test.ts`
- `tests/e2e/lexicon-library.spec.ts`

覆盖西语重音、标点、缩写、clitic/变形的安全边界、同形异义、不确定 lemma、短语重叠、版本冻结、撤下来源、私人来源所有权和 intent 幂等。

### 12.3 领域与数据库

新增：

```text
src/modules/lexicon-corpus/
  domain/content-reference.ts
  domain/spanish-token.ts
  domain/lexeme.ts
  domain/phrase.ts
  domain/corpus-occurrence.ts
  application/index-content-version.ts
  application/list-vocabulary.ts
  application/list-phrases.ts
  application/set-lexical-intent.ts
  repositories/lexicon-corpus-repository.ts
  repositories/drizzle-lexicon-corpus-repository.ts
  schemas/lexicon.ts
  ui/read-section-navigation.tsx
  ui/vocabulary-library.tsx
  ui/phrase-library.tsx
  index.ts
src/shared/db/schema/lexicon-corpus.ts
```

表：`lexemes`、`lexeme_forms`、`phrase_entries`、`phrase_variants`、`corpus_occurrences`、`user_lexical_intents`。

第一版只把人工/词典/provider 明确给出的 lemma 标为 verified；无法可靠归一的词形以 surface 记录并标记 `lemmaStatus=pending`，不能猜 lemma 后合并两个不同词。正式短语继续执行内容审核，用户保存短语保持私人。

### 12.4 页面与 API

新增：

```text
app/(product)/read/vocabulary/page.tsx
app/(product)/read/phrases/page.tsx
app/(product)/read/corpus/page.tsx
app/api/v1/lexicon/vocabulary/route.ts
app/api/v1/lexicon/phrases/route.ts
app/api/v1/lexicon/intents/[entryId]/route.ts
```

修改阅读一级页和文章/媒体词句入口，共用 `ContentDocumentRef` 与 `SourcePosition`。`familiar/revisit/ignore` 只写个人意图，不写 evidence/profile。

页面切片：

- 短语卡增加一条可见来源的 `representativeOccurrence` 投影；其余例句继续使用有界懒加载。
- 短语条目返回不暴露拥有者 ID 的 `scope`（`public`/`private`），卡片明确显示“公开/私有”范围。
- 短语搜索与意图筛选保留 URL 状态；意图控件满足键盘和至少 44px 触摸命中区。
- 短语卡提供“在语料中查看全部用例”和来源跳转；跳转使用版本化 `ContentDocumentRef`/`SourcePosition`。
- 短语页的加载、错误、空结果和私有/公共范围文案必须与设计规格一致。
- 过渡片段模式只呈现适用的文本筛选；正式条目专属的学习状态、语用、语域、地区和 CEFR 筛选在该模式下隐藏，避免把无元数据误报为无内容。零结果仍保持片段控件和重置入口；读取失败单独显示不可用状态。
- 正式索引暂未给出可见条目时，过渡语料片段按文章、视频、播客及来源轮转后分页；不得把一个长媒体的连续分段当成整个首屏，也不得把片段称为已审核短语。
- 2026-10-13 产品本人授权的 `VOCAB-UI-001` 仅收敛词汇页工具栏和窄屏排名导航；具体范围/验收见[词汇朗读实施计划第 5 节](2026-10-12-vocabulary-read-aloud-implementation-plan.md)。不扩展词库、音源、画像或索引任务。

### 12.5 验证

运行全部 lexicon 单元、合同、数据库、阅读/媒体 E2E 回归、lint、typecheck、`pnpm db:check`、build 和 `git diff --check`。

建议提交：`feat: add contextual vocabulary and phrases`

### 12.6 PHRASE-REDESIGN-001：实用表达手册（2026-10-15 所有者覆盖旧页面要求）

当前短语页按 [ADR-0016](../adr/0016-practical-phrasebook.md) 完整重做，旧代表片段/来源卡片不再是此路由的验收要求。一个任务完成以下切片：模块内 24 条、6 类原创内容和独立双维度审核；Zod 结构/内容哈希与版本；主题目录、中文/西语搜索、完整对话和用法、账号隔离的浏览器收藏、遮住西语回想、最多五条的无评分情境自测、已有浏览器朗读。数据层、私有短语与语料 API 保持既有协议，不新增迁移或真实 provider 调用。

验收：无需语料 DB 就有可用内容；来源按钮和随机截取片段退出页面；存储/音频失败可恢复；自测答案与迁移情境对应、支持重练和键盘退出；桌面/触屏 320/375/768/1024/1440px、浅深主题无溢出；浏览和练习零证据写入。结果及限制记录于状态页，内容审核见 `docs/reviews/PHRASE-REDESIGN-001.md`。后续建议根据本人实际使用反馈扩充内容，收藏跨设备同步另立任务。

### 12.7 PHRASE-CONTENT-002：表达内容扩充与自测朗读

2026-10-15 所有者确认新版设计并要求继续扩充，随后要求自测说法有发音按钮。保留现有六主题与视觉设计；v1 内容和审核记录冻结，新版增加36条，使总数60、每主题10条。新增内容先草稿、独立语言/教学双维度审核、修订复验和Schema/版本/依赖哈希校验后接入。接话/澄清/观点/安排/请求/办事各补缺口，不复制已有表达凑数。

自测揭晓后参考句和展开的核心句各有朗读/停止按钮，必须朗读各自实际西语；next、退出、切换主题或卸载释放播放资源，复用已有TTS generation与错误门禁。旧收藏ID及localStorage key保持，主题数量从实际内容派生。验证内容唯一/覆盖/审计依赖、旧收藏、新表达搜索/展开/自测，以及真实浏览器音频fake的文本、语言、停止/不支持路径；不调用收费provider、不形成评分证据。

实现已进入review：v2的60条、36条独立双维复验与依赖哈希、原24条冻结、自测朗读/停止及收起核心表达取消均完成。聚焦Vitest46项、Playwright桌面/手机14项、定向ESLint、全局TypeScript及75页生产构建通过；真实听感与Safari待实际设备确认。审核修订见 `docs/reviews/PHRASE-CONTENT-002.md`，文件、检查与未提交状态见状态页同任务条目。

### 12.8 PHRASE-CONTENT-003：120条实用表达与对话朗读

2026-10-15所有者批准：在v2的60条基础上新增60条，六主题各20条，重点补充人际交流、沟通修复及真实办事情境。所有新增条目具备完整双语对话、语用边界、替代表达、模板与自测；先起草，再独立进行es-ES语言及zh-CN教学双维度审核，修订复验后绑定版本和哈希。原60条、收藏ID与历史审核保持不变。

示例对话逐句提供朗读/停止，读对应西语，与核心表达、自测共用一个浏览器TTS实例；切句、收起、筛选、主题、自测、卸载或收藏变化导致条目消失时取消，覆盖旧回调、失败重试与不支持。验收120条/各类20条、旧内容冻结、Schema/唯一性/审核哈希、旧收藏及新增内容搜索/展开/自测，桌面与手机浅深主题、320–1440px和44px控件；不增加API写入或能力证据。

实现已进入review：新增内容独立双维度复验均60/60 approved，7项依赖哈希匹配。聚焦Vitest **51项**、桌面/手机Playwright **24项**及追加截图检查 **2项**、受影响ESLint、全局TypeScript和 **75页** 生产构建通过，截图人工复核。全仓lint/全量Vitest/完整E2E未重跑，既有基线及实际听感/Safari限制见状态页。审核修订见 `docs/reviews/PHRASE-CONTENT-003.md`；未提交、推送或部署，保留共享树其他改动。下一步由本人在实际设备确认音色与内容体验。

## 13. LEX-002：语料查询、文字考察与词句证据

### 13.1 目标与边界

完成 KWIC 查询、来源过滤、准确位置跳转和不要求口头回答的词句考察。只有服务端确认的答题提交可以形成“词汇与短语”证据。

### 13.2 测试先行

新增：

- `tests/unit/corpus-search.test.ts`
- `tests/unit/lexical-assessment.test.ts`
- `tests/unit/lexical-assessment-evidence.test.ts`
- `tests/unit/corpus-routes.test.ts`
- `tests/unit/lexical-assessment-routes.test.ts`
- `tests/database/lexical-assessment-persistence.test.ts`
- `tests/contracts/corpus-assessment-contract.test.ts`
- `tests/e2e/corpus-assessment.spec.ts`

覆盖表面词/verified lemma/完整短语、大小写/标点/重音、连续短语与 `all` 多词模式、分页上限、撤下和跨用户泄漏；选择、判断、填空、少量完整输入；自然等价答案；题目版本冻结；重复提交不重复证据；浏览/收藏/跳过不写证据。

### 13.3 实现

新增：

```text
src/modules/lexicon-corpus/domain/kwic.ts
src/modules/lexicon-corpus/domain/lexical-assessment.ts
src/modules/lexicon-corpus/application/search-corpus.ts
src/modules/lexicon-corpus/application/get-assessment.ts
src/modules/lexicon-corpus/application/submit-assessment-attempt.ts
src/modules/lexicon-corpus/ui/corpus-search.tsx
src/modules/lexicon-corpus/ui/lexical-assessment.tsx
app/api/v1/corpus/search/route.ts
app/api/v1/corpus/browse/route.ts
app/api/v1/lexicon/assessments/[assessmentId]/route.ts
app/api/v1/lexicon/assessments/[assessmentId]/attempts/route.ts
```

数据库增加 `lexical_assessment_items`、`lexical_assessment_attempts`。assessment application 创建/验证 `practice_attempts` 或明确的通用 attempt 引用，再调用 evidence application；客户端不能提交 outcomeScore、skillKey 或 confidence。

语料页面切片：

- `corpusQuerySchema` 增加 `match: "phrase" | "all"`，默认 `phrase`，并保留 `q/match/documentKind/sourceKind/stableKey/page` 的 URL 恢复语义。
- 语料页面默认调用 `listCorpusClusters` 浏览内容，不要求先输入 query；每个短语聚类按文章、视频、播客分 lane 展示真实上下文。`query`、来源类型和内容类型只是可选筛选，缺少某类来源时省略该 lane。
- `phrase` 模式按西语 token 边界和顺序匹配；`all` 模式沿用同片段包含全部 token 的查询语义。两者都必须先通过服务端可见性、发布状态、版权和用户所有权检查。
- 语料结果 DTO 对客户端提供 `sourceKind`、`entryKind`、`entryId` 和位置；文章跳到段落，媒体跳到毫秒/片段。
- 语料结果默认有界分页；查询中保留旧结果，取消或过期响应不能覆盖新查询；无结果和失败状态提供恢复动作。

建议 skill key 使用版本化前缀：`lexical.recognition.*`、`lexical.context.*`、`lexical.collocation.*`、`lexical.retrieval.written.*`。完整输入只是文字主动提取，不映射发音/语流/口头反应。

### 13.4 验证

运行 corpus/assessment 单元、连续短语匹配与 URL 状态组件测试、合同、数据库、E2E、evidence/profile 回归、lint、typecheck、db:check、build 和 `git diff --check`。Playwright 至少覆盖 375px 与桌面视口、无 query 时的默认短语聚类、文章/视频/播客 lane、短语卡代表例句、`match=phrase`/`match=all`、来源跳转、分页恢复和浏览不写证据。

建议提交：`feat: add corpus search and lexical assessment`

### 13.5 VOCAB-RECALL-001：当前词架原地默写（2026-10-13 产品本人批准）

- 仅复用词架当前可见结果中的本浏览器 `familiar` 标记，进入时冻结词形与已有词典释义；缺释义条目不生成题目，明确提示跳过数量。
- 两个模式按钮：看释义写单词 / 看单词写释义。原位置变为输入框，非练习词保留展示；不同模式的输入、批改和提示记录分开保留。
- 2026-10-14 产品本人追加批准判题反馈并要求答对更有喜悦感：独立匹配正确显示绿色底色/描边、✓「答对了！」、闪亮图标与 260ms 轻弹；使用提示或自行确认的正确仍清楚区分来源。错误使用红色 ×「需要复习」和参考答案；重音错误使用橙色 ! 并标出参考词形的重音字母；中文待确认使用橙色 ?，保留自行确认按钮，空项中性显示。反馈原位保留，编辑后清除旧判题样式；图标装饰性隐藏，文字支持读屏，只有错误/重音错误设置 aria-invalid，减少动态效果时关闭轻弹。
- 产品本人追加确认上下机械拨轮：用 CSS perspective/rotateX 在原位绕横轴转动，文字转走、输入空位转入，退出再转回；420ms，减少动态效果时直接切换。退出计时器卸载清理，不新增动画依赖。已检查 `react-card-flip@1.2.3`（MIT，React 18 peer）和 `react-flip-numbers@3.0.9`（MIT，数字翻转组件），采用当前原生实现以容纳输入框与 React 19。
- 填写期间不判错；Enter 检查当前词后聚焦当前模式/重练轮次的下一空位，跳过已填写项，到末尾后回到前面漏填项，全部填写后留在当前词。空答案或中文待确认留在当前词；输入法组合阶段 Enter 不提交也不跳转。「批改」检查本组，空项标为未作答。西语忽略大小写/首尾空格，保留 ñ/ü 区分，漏/错重音单列。中文只对完整词典释义或明确并列含义进行匹配，不凭子串/编辑距离推断语义；未匹配显示待确认，用户对照参考释义自行确认或标为需复习。
- 查看答案标记使用提示；禁用悬浮释义与自动发音、关闭词卡并取消旧声音，避免答案旁路。搜索在练习中暂停，退出后恢复；模式切换保留各自进度，重练仅重置当前模式的需复习/待确认/未作答/使用提示条目。
- 纯 TypeScript 编排器负责输入、批改、确认、切换和重练。反馈是临时自查结果，退出/刷新后清除，不保存用户答案，不写学习证据或能力画像，不自动改变已知标记；服务端可信 assessment 仍遵循 LEX-002 独立契约，不在本任务接通。
- 验证领域规则、非法动作、模式隔离、React 原位替换/恢复、无提示泄漏、输入法、取消生命周期、桌面/手机关键路径；Enter 聚焦覆盖跳过已填写项、回到漏填项、末题停留、待确认停留、模式/重练/退出重启隔离，不批改其他答案；不调用真实收费 provider。真实 Safari 单列未验证。

### 13.6 VOCAB-SHELF-001：词表加载故障续修（2026-10-14 用户报告）

- 当前本地参考词表、功能词过滤和释义资产是词架文字的来源；语料扫描只提供附加例句，不能因扫描超过 30s 或 DB 不可用阻断词表、搜索、本机标记和临时默写。
- Application `load-vocabulary-shelf` 对附加例句最多等待 1500ms；快速成功保留既有真实例句，失败/超时/无 DB 时从同一参考表生成完整、同序、同搜索语义的展示 DTO。DTO 不包含伪造的 occurrenceCount，context/sourceTitle 明确为 null，并提示部分例句不可用。真正搜索零结果仍显示空态。
- 不放宽词频快照的 36h 陈旧度规则，不刷新或改写生产数据库，不改变语料可见性/版权/评分/API。超时释放页面计时器，已有共享查询继续按其原缓存生命周期完成，晚结果/晚异常不改写已返回展示。
- 验证快速成功、真实空结果、无 DB、拒绝、慢查询、晚完成/异常、计时器释放、搜索/排序不变；Playwright 桌面/手机在禁用 DB 的环境下检查完整 7922 词、搜索、默写判题/退出、空态与零 API 写入；另只读复核配置真实 DB 的本地页面。

### 13.7 CORPUS-REDESIGN-001：真实用例查询与对照（2026-10-15）

所有者授权先评估必要性并重做有价值的语料页。评估决定保留：它解决真实输入中的用法验证，与词汇释义、原创短语手册互补。旧机械2–3词片段与缺失出现索引的查询不适合作为主体，采用ADR-0017。

- 默认已发布文章段落/已审核字幕，来源与类型交错。无译文的长文章段按西语句界显示完整命中句，浏览时显示开头两句；展开保留完整段落和前后文，朗读/对照使用实际显示句。有段落译文或无法分句时保留原段，避免译文错位和机械截字。独立鉴权GET `/api/v1/corpus/examples` 直接查询原文，不要求出现记录；连续原词序或同段全部词，大小写/重音折叠、完整词边界，不声称lemma或中文语义搜索。
- 同一SQL读取结果与计数，文章最新已发布版、媒体currentVersion，重验发布/清权/字幕审核/私人文章owner；相邻前后文只来自同一可见版本。默认每页12条、最多24条，page上限100,000以覆盖当前49,247条实际资料，不沿用旧1,000页限制。
- 暖色编辑式原句列表，搜索/类型/匹配方式/译文开关/前后文/浏览器合成朗读/最多三条临时对照，刷新清除对照；稳定URL及历史恢复。请求20秒截止，取消/过期回调/错误/空态/越界页有恢复；不新增provider、迁移、录音或评分写入。
- 来源入口必须可用：文章带 `@version` 并让有效hash优先旧位置；媒体页解析t/segment，显式t优先冲突segment，稳定index支持稀疏字幕，播放器ready后seek及高亮一致。
- 测试覆盖真实SQL可见性/分页/源轮转、Route鉴权与合同、UI取消/重试/对照/朗读、跨来源定位、桌面/手机浅深主题320–1440px和44px操作。真实库仅只读核验，不调用收费供应商；Safari/扬声器听感另行记录。

最终验证：15 files / 134专项测试（含12项真实SQL）、受影响ESLint、全局tsc、76/76页面生产构建通过；桌面/手机Playwright18/18通过。真实库只读49,247条，por eso 192条，无语料API拦截的真实浏览器无写入/pageerror；人工复核长段完整命中句与手机首屏。全量检查和真机/RLS限制见 `docs/reviews/CORPUS-REDESIGN-001.md`。任务为review，未提交/推送/部署；不修改其他任务状态，不混合提交共享树。

## 14. PROFILE-001：四板块能力画像

### 14.1 目标与边界

以四个能力板块取代八维雷达图的产品主展示，保留底层事件和历史审计。没有可靠映射的数据保持“数据积累中”。

### 14.2 测试先行

新增：

- `tests/unit/four-capability-profile.test.ts`
- `tests/unit/profile-evidence-routing.test.ts`
- `tests/unit/profile-history-migration.test.ts`
- `tests/unit/profile-four-capability-route.test.ts`
- `tests/unit/profile-four-capability-panel.test.tsx`
- `tests/e2e/profile-four-capabilities.spec.ts`

更新现有 profile/evidence 测试，覆盖：文字考察只进入词句；文字场景/聊天只进入交流；可信语音可分别进入交流和语音；跟读只进入跟读；同 attempt 不同 skill 去重；低置信度、技术失败和打字不污染语音；历史八维不强制均匀映射。

### 14.3 实现

新增或替换：

```text
src/modules/profile/domain/capability-groups.ts
src/modules/profile/domain/four-capability-overview.ts
src/modules/profile/application/get-four-capability-overview.ts
src/modules/profile/ui/four-capability-panel.tsx
```

修改：

- `src/modules/profile/repositories/profile-repository.ts`
- `src/modules/profile/repositories/drizzle-profile-repository.ts`
- `app/api/v1/profile/route.ts`
- `app/(product)/me/page.tsx`
- `contracts/schemas/v1/profile-overview-response.schema.json`（新增版本化结构或新文件）
- `contracts/openapi/v1/openapi.json`

不要原地改变旧响应含义。优先新增显式 `capabilityGroups`，保留一段迁移期的旧 axes 审计字段或旧端点；页面只消费新结构。历史映射表必须逐 skill prefix 明确，无法匹配的 evidence 只计审计总量。

### 14.4 验证

运行 profile/evidence 单元、Route、合同和 E2E；再运行全量 Vitest、lint、typecheck、build。检查学习时长未进入任何能力计算。

建议提交：`feat: replace profile with four capability groups`

## 15. OPS-001：每日生产调度与全链路门禁

### 15.1 目标与边界

把已验证模块接入每日定时 CI runner，建立来源、预算、失败、清理、撤下和运行手册。只有此任务才启用真实白名单和生产级 schedule；仍不自动发布。

### 15.2 测试先行

新增：

- `tests/unit/content-acquisition-scheduler.test.ts`
- `tests/unit/content-cleanup-runner.test.ts`
- `tests/unit/content-pipeline-observability.test.ts`
- `tests/e2e/content-pipeline-smoke.spec.ts`
- `.github/workflows/content-acquisition-daily.yml`
- `docs/operations/content-acquisition-runbook.md`

测试 workflow 输入、并发互斥、手动触发、dry-run、失败退出码、预算耗尽、重复调度、清理失败可重试和日志脱敏。CI 测试 job 只用 fake；真实 source job 必须通过 protected secrets/environment 显式启用。

### 15.3 运行实现

扩展 `scripts/acquire-content.ts` 支持：

- `discover`
- `process`
- `cleanup`
- `report`
- 单来源/全启用来源、有界 limit 和 dry-run

workflow 使用 concurrency group 防止同一环境重叠运行，以 UTC 表达固定日程并在文档注明 Asia/Shanghai 对应时间。密钥使用 CI secret；输出不包含数据库 URL、API key、完整媒体 URL、正文或字幕。

观测至少记录 run/source/step、数量、状态、稳定错误、耗时和估算成本；连续失败、清理失败、预算异常和来源大面积失效进入现有 diagnostic event 或新的最小事件类型。是否外发通知由用户另行决定，不默认发送邮件或第三方消息。

### 15.4 首次受控运行

按顺序执行：

1. dry-run：一个 YouTube 频道、一个播客 RSS、一个文章 RSS，只发现元数据。
2. 核对去重、来源、权利策略、速率和成本汇总。
3. 非发布处理：每类最多一个候选，确认临时资产清理。
4. 所有者在工作流中完成双维度审核。
5. 每类显式发布一个内容并验证目录、播放/阅读、词句索引和撤下。
6. 重跑相同范围，确认无重复候选、版本、证据或费用。

任何一步失败立即停在可恢复状态，不扩大候选数量。

### 15.5 最终门禁

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:contracts
pnpm db:check
pnpm test:e2e
pnpm build
git diff --check
```

另做真实登录桌面人工验收；iPhone Safari/PWA 真机仍按当前项目决定记录为延期，不能用 Playwright WebKit 冒充完成。

建议提交：`ops: schedule reviewed content acquisition`

### CONTENT-AUDIT-001：媒体库存与补充目标盘点（2026-10-15）

用户同意先核对现有视频/播客数量、难度和主题分布，再确定首批补充类别。本切片只读当前配置数据库，按当前公开目录的版本/发布/清权/有效资产规则统计，单列候选与当前revision审核情况；不新增来源、不采集、不调用收费provider、不发布或修改已有版本。

23:06快照得到80视频、92播客、约52.01小时；已审核双语片段39,321条。主要缺口为短篇成人日常交流素材；泛化标签、主题映射遗漏和地区疑似误标单独记录，不在本任务修改。下一批选材目标12条，六种场景各配视频/播客一条，8条A2/4条B1；这是建议目标，不是已交付内容。真实候选、统计口径、一致性验证及未执行项见 [CONTENT-AUDIT-001报告](../reviews/CONTENT-AUDIT-001.md)。原供应队列、其他任务负责人和状态保持。

### CONTENT-SELECT-001：六场景媒体候选准备（2026-10-15）

用户已批准 CONTENT-AUDIT-001 建议的下一步；依赖为该盘点。此任务 ready 且由本会话领取，沿用共享分支，限定12个选材目标（六场景各视频/播客一条），优先8条A2/4条B1、视频3–8分钟/播客4–10分钟。核对现有启用且权利 verified 的白名单、库内候选及授权目录元数据，去重并记录具体条目、时长、现有难度标签、适用性证据与待处理项。无法满足的席位如实保留缺口，不能以搞笑标题、词义课或超长文化节目凑数。交付可核验的候选准备清单；不新增来源、不运行收费媒体处理或发布、不更改自动化与全局队列。

交付（review）：白名单目录分页规范化后400视频/199播客；本地准备包6条视频线索/6集播客备选，原12席位4待适用性复核/8未填补，不能计为新增内容。来源和候选身份去重、定点当前revision/hash/审核/字幕/托管缺口已记录；纯元数据选材不代替听审或授权/CEFR核验。清单结构与一致性断言、脚本语法及diff check通过，未改产品代码，未跑全量应用检查；没有数据库候选创建、收费处理或发布。见 [CONTENT-SELECT-001报告](../reviews/CONTENT-SELECT-001.md) 和同名JSON。下一建议切片为V1药房草稿适用性复核；来源补选另立任务，不变更全局队列。

### CONTENT-FIT-001：药房候选适用性复核（2026-10-16）

用户“开始”授权后，依赖CONTENT-SELECT-001的本切片ready并由本会话领取，沿用共享分支。只复核V1现有121段双语草稿、同revision/hash、时间结构、西语语用和中文教学适用性，不扩大到来源启用、付费处理或发布。验收为有片段索引/时间依据的采用结论、明确的错译/待听审问题、未完成门禁和后续建议。

交付（review）：revision5/hash一致，121段结构断言通过，两名独立AI分别通读西语语用和中文教学，建议不纳入本批A2实用药房核心素材，保留娱乐/俚语线索。5处处方多义误译、俚语字面化、消音残句等详见 [CONTENT-FIT-001报告](../reviews/CONTENT-FIT-001.md)；没有原音听辨或正式审核批准。选材目标据此3待复核/9未填补，旧清单保留历史快照。脚本语法/文档diff检查通过；无产品代码变更，未跑全量应用测试；无数据库/审核/媒体下载/付费provider/发布写入。下一建议为V3朋友聚会的内容可取得性与适用性检查，不在本任务扩大处理范围。

### CONTENT-FIT-002：朋友聚会候选材料可用性核查（2026-10-16）

用户“继续”授权承接CONTENT-FIT-001下一建议；本切片ready且由本会话领取，无其他负责人或独立活动分支，沿用共享分支。范围限于V3当前revision/hash、字幕、处理产物、媒体版本及已有取得路径核查；材料充分才进入适用性判断。验收为可核验的材料状态、明确的审核结论边界与下一步依赖，不新增来源、不触发收费处理或发布。

交付（review）：候选revision5/hash字段一致；10:12:37只读快照0段字幕、无托管元数据/产物/当前revision审核/同stableKey媒体版本。当前LR适配器仅提供元数据，未取得可供语义审核的材料；材料核查完成，实质适用性审核待材料，不能因缺字幕拒绝或凭标题批准。选材仍3待复核/9未填补。见 [CONTENT-FIT-002报告](../reviews/CONTENT-FIT-002.md)。外部脚本语法、证据一致性、文档链接和限定diff检查通过；仅文档变更，未跑全量应用检查，无数据库/审核/媒体下载/收费provider/发布写入。下一建议先取得授权字幕，或明确全部门禁与处理资产后走现有单候选ASR草稿流程，再独立双维审核；不扩大本任务或重排其他队列。

### CONTENT-PREP-001：朋友聚会候选审核材料准备（2026-10-16）

用户“继续下一步”授权，依赖CONTENT-FIT-002；本切片ready后由本会话领取，沿用共享分支，无其他负责人或独立活动分支。只为V3取得授权范围内的字幕或ASR草稿：先核对来源授权记录、正常访问的原字幕与本机处理条件；如需ASR，先明确相关性、语言、时长、权利、预算与资产门禁，限制为一个候选并清理临时媒体。验收为绑定来源/当前版本的可审核材料，或有脱敏原因和明确恢复条件的取得失败。不发布、不启用新来源、不批量处理、不变更全局队列或其他任务状态。

交付（review）：用户明确指定MiniMax转写后，使用本机已存在loopback代理恢复正常public视频连接，保持系统代理配置不变；来源声明/25MiB策略和当前revision5/hash只读核对通过。单次MiniMax `asr-1.0`调用得到42段带provider真实时间的西语ASR草稿，临时音频已删除，阻塞解除。SRT/JSON及调用清理证据在仓库外，见 [CONTENT-PREP-001报告](../reviews/CONTENT-PREP-001.md)。provider聚焦7/7、脚本语法、草稿hash/42段时间/SRT一致性及文档检查通过；无产品代码变更，未跑全量应用检查，无数据库/审核/来源策略/发布写入。费用/置信度未提供，保留null；本次真实请求一次，不重试或额外翻译。选材仍3待复核/9未填补；下一建议为42段逐句校对、中文翻译和独立双维审核，不能把ASR成功当发布批准。

### CONTENT-FIT-003：朋友聚会字幕校对与双维适用性复核（2026-10-16）

用户“是”确认CONTENT-PREP-001下一建议，ready后由本会话领取，沿用共享分支。只处理V3的42段MiniMax西语草稿、中文教学翻译和独立西语/中文维度复核，保留原稿并绑定hash。以同视频来源字幕辅助文字核对，不能冒称原音听审或凭语感猜补；未决原文以明确标记进入审核。验收为42段双语校对稿、可追溯修订和未决问题、两维独立复核及本批选材采用建议；不写数据库/正式审核/发布，不重排其他队列。

交付（review）：42段双语v2与原ASR/v1分别保留，100条同视频人工字幕作文字交叉证据；5条来源补充单列，cue94与ASR38部分重叠未重复合入。两名独立AI分别复核西语语用与中文教学，v1提出的无据长幼、尺寸、转述/欲望义、性俚语再、截断及指代等已修订，v2均绑定同一hash；20段显式待原音/同步核验，无正式批准。整片不推荐本批A2聚会核心席位，保留喜剧/地区语用线索；本批2待复核/10未填补，旧报告保留历史快照。详见 [CONTENT-FIT-003报告](../reviews/CONTENT-FIT-003.md)。原hash、42段原文/原时间、双语非空、来源全映射、补充去重、双维覆盖/hash、UTF-8、脚本语法/文档/限定diff检查通过；无产品代码变更，未跑全量应用检查或原音/播放器/Safari核验，无新增收费调用/音视频下载/数据库/审核/发布写入。下一建议另立短对话来源补选，在既有白名单核实真实交际动作与字幕/授权，不自动扩大收费或发布范围。

### CONTENT-SELECT-002：实用短对话来源补选（2026-10-16）

用户“可以”确认CONTENT-FIT-003下一建议，依赖已完成的字幕/适用性复核；本任务ready后由本会话领取，沿用共享分支，无其他负责人或独立活动分支。先只读核实当前启用且verified来源与候选身份，在现有白名单目录内补选3–8分钟视频/4–10分钟播客，优先聚会邀请、时间/地点协商、回应与澄清。可取得字幕时核对实际交流动作；不能凭标题、元数据或关键词把线索视为适用性通过。交付来源/具体条目/时长/字幕/权利/待审核门禁清单或有证据的缺口；不新增来源、不收费处理、不写数据库/审核/发布、不重排其他任务。

交付（review）：当前白名单仍2个混合目录，只读583候选身份及两条定点详情；14次请求400视频/200播客，202符合时长、146状态过滤、排除既往不采用后145。Hacer Amigos和Tipos De Amigos取得119/165条人工字幕，完整文本阅读及独立AI选材复核后保留2条邀请/介绍/失败澄清片段线索，不计整片A2核心席位；字幕作者评论/音效污染明确标记，未听审。目标仍2待复核/10未填补。第三历史线索不在新目录，首次脚本中止后复用成功材料并跳过，无重复字幕取得或第三条请求。见 [CONTENT-SELECT-002报告](../reviews/CONTENT-SELECT-002.md) 和机器清单；只读、去重/计数、revision/hash、284字幕原件及片段追溯、独立review hash、UTF-8/脚本/文档/限定diff检查通过。无产品实现变更，未跑全量应用检查或原音/播放器/Safari/CEFR核验，无数据库/正式审核/新来源/收费/媒体下载/发布写入。下一建议单独准备新增实用对话来源提案，核实官方来源、少量样本与许可后确认白名单范围，不继续用娱乐目录条目填数。

### CONTENT-SOURCE-001：新增实用对话来源提案（2026-10-16）

用户“可以”确认CONTENT-SELECT-002下一建议；本任务ready后由本会话领取，沿用共享分支。调研少量官方来源及具体公开样本，记录实际交际动作、时长、字幕/公开文字、许可、署名及所有者可确认的有限范围。重点补邀请、时间地点协商和日常办事；视频3–8分钟/播客4–10分钟要求不静默放宽，短片段只作备选。仅公开页面和元数据查证，不启用来源、不写数据库/审核/发布、不下载音视频、不收费或向第三方发消息。验收为具体可审的提案及尚缺授权，不把“公开可看”当成“已获处理/分发许可”。

交付（review）：[CONTENT-SOURCE-001报告](../reviews/CONTENT-SOURCE-001.md)与同名JSON列出3官方源/5样本：VideoEle邀请/用餐289/256秒优先，Easy Spanish谈计划/点咖啡473/477秒备选，Learning Lab邀请/接送公开文字仅原站参考且音频时长未知。VideoEle公开PDF只发现链接，动作以官方功能和练习短摘确认，未冒称完整双人对话；CC BY-NC-ND 4.0不推定允许分发双语改编。Easy官方身份链和频道已核实，未取得字幕或会员材料；Learning Lab特定2018回复不扩大为一般许可。有限页/ID/字段/署名撤下、具体授权记录模板和未决门禁齐备，不能直接导入或标verified；本批仍2待复核/10未填补。证据hash/JSON/UTF-8、时长/身份/短摘、脚本语法、链接、其他任务段落与限定diff检查，独立AI事实复核见报告；无产品代码/Schema变更，未跑全量应用检查或原音/画面/播放/Safari/CEFR/真实库检查。无来源启用、写库、完整字幕/PDF/音视频取得、收费、外部消息、发布或提交。下一建议为VideoEle两样本具体使用权与适配器门禁核验，之后再决定来源配置和内容审核；播客席位仍缺。

### DIALOGUE-SOURCE-002：真实双人对话替代来源（2026-10-16）

用户“嗯”确认CONTENT-ASSET-001换选建议，登记ready后本会话领取in_progress，沿用共享分支`codex/disable-legacy-readlang`。限定少量官方开放教育/对话教学来源，优先公开且可合法查看的原稿，先证明连续双人往返及实用交际动作，再核视频3–8分钟/播客4–10分钟、官方原稿/时间轴取得及逐素材许可。过短仅列备选，不以拼接/循环凑时长；未知时长不冒称达标。避开已排除的VideoEle和娱乐条目，保持原有2待复核/10未填补历史快照。

交付具体课程/样本链接、正文结构依据、真实时长或未知项、授权/署名与媒体例外、可用原稿/对齐情况以及采用决定；研究提案不是运行白名单或正式双维审核。本轮只公开页面与最小元数据，不启用来源、不写库、不下载音视频、不调用ASR/翻译、不联系第三方或发布。没有实现变更时不重复跑产品测试充数。

交付（review）：[来源筛选交接](../reviews/DIALOGUE-SOURCE-002.md)及同名JSON，列出 Trayectos 官方目录→旧域名→现站身份链、CC BY-SA 4.0 许可／作者、室友12轮、介绍场景6/8/5轮和表姐妹10轮往返原稿。四段官方MP3链接已定位但未请求媒体，时长、音轨对应、时间轴及逐音频许可覆盖待验；三人介绍不冒称双人，约晚餐文字不计媒体，零原定席位填补。保留原时长条件，短录音补充问题未获答复；仍2待复核／10未填补历史快照。JSON／UTF-8、官方证据hash／时间、轮数／音频链接、文档链接、历史／其他任务保留及限定diff／脚本语法检查；纯研究未跑产品全仓测试或真实媒体／provider／库。无Commit／推送／部署、来源启用／审核／写库／媒体下载／ASR／翻译／外部消息。下一建议单独做四段录音的许可覆盖、有界取得／试听和实测时长，优先室友；不自动进入下一任务。

### CONTENT-ASSET-001：VideoEle原版文字稿取得与适配度核验（2026-10-16）

用户“开始”确认下一步素材取得，登记ready后本会话领取in_progress，沿用共享分支`codex/disable-legacy-readlang`。范围仅两条官方教学页链接的原版transcripción PDF；按官方许可供所有者个人学习检查，原件与提取文本保存在仓库外，不提交全文。核对HTTP/MIME/大小/PDF可解析、全部页面、标题/署名/内部许可与对话结构，记录hash和来源；已有文件匹配时复用，不重复下载。可得正文不等于可发布双语字幕，不编造说话人或时间轴。

验收为实际取得结果、PDF视觉/文本核对、两条内容的适配度与剩余取得/用途条件、机器清单和交接。无YouTube音视频取得、ASR/翻译API、来源启用、候选/媒体/授权写库、正式内容审核或发布。只完成此任务，不另建下载器、私人译稿库或绕过现有Bunny/处理门禁。

交付review：[CONTENT-ASSET-001交接](../reviews/CONTENT-ASSET-001.md)及同名JSON。2原版PDF/3页取得并保留仓库外，来源、作者/许可、HTTP/MIME/大小/签名/hash/权限、全部页面视觉核验完成。首次提取在权限检查之前，发现copy/modify禁止后删除派生全文，修正为先验权限和视觉阅读，不改原件、不抹去已发生的会话输出。两份主要是住房/餐饮旁白，缺连续双人往返及时间轴，不计入核心短对话供给；仍2待复核/10未填补。仅报告/素材未跑产品全仓检查，未执行音视频取得、ASR/翻译、正式审核/来源写库/发布或提交。下一建议换选实际双人对话且原稿/时间轴与使用范围清晰的素材，避免继续加工不匹配内容。

### SOURCE-CONFIG-001：VideoEle单ID配置与实际处理就绪核验（2026-10-16）

用户“嗯”确认YOUTUBE-EXACT-001下一建议，登记ready后本会话领取in_progress，沿用共享分支`codex/disable-legacy-readlang`。只处理VideoEle的S0irU4fsfA0与z-CS3hAuOxs：沿用当日公开证据、定点复验官方教学页/法律页，形成按A2/B1拆开的禁用/unknown草案；逐动作标明处理/受众/取得依据和未决条件；以当前schema与fake核实拒绝和将来元数据dry-run条件。不能通过先置verified或虚构mediaProcessing来走通测试。

验收为机器可读草案与交接报告、证据时间/hash、严格schema/fake回归、明确实际代码路径限制及不执行真实操作的判定。无来源启用、真实配置/候选写入、正式Data API、字幕/PDF全文或音视频取得、云处理、发布或第三方消息；本任务不扩为新下载器/私人译稿库或重做前轮泛化许可研究。

交付review：[SOURCE-CONFIG-001交接](../reviews/SOURCE-CONFIG-001.md)及同名JSON。两个单ID按A2/B1分开，均禁用/unknown，无ID、license和mediaProcessing，不可导入；4官方HTML补齐作者署名，保留历史审计。18组离线断言及3文件61项测试通过。现有factory耦合enabled/verified、每日来源选择、普通youtube音频取得拒绝与Bunny发布要求均已明确，未执行真实试运行。仅文档/草案未重跑全仓门禁或真实环境，无提交/来源写入/处理/发布；下一建议落实可处理原素材和范围，或另切片做不落库官方元数据核查。

### YOUTUBE-EXACT-001：频道与精确视频ID元数据发现（2026-10-16）

用户“嗯”确认MEDIA-RIGHTS-001下一建议，登记ready后本会话领取in_progress，沿用共享分支`codex/disable-legacy-readlang`。只支持可选allowedVideoIds（1–2个互异、合法的11字符ID）；存在时直接调用官方videos.list，不请求最新feed，不回退整频道。复验返回ID属于本页且视频属于配置频道，沿用公开/可嵌入/语言/地区/时长/许可门禁。尊重limit并用绑定频道与ID有序列表的游标续页；一轮结束复位null，后续运行可重新核实，不依赖发布时间。缺失/不符的指定条目不换成其他视频；非法或配置失配游标在请求前拒绝。先写失败回归，再实现，测试不得访问真实API。

本切片只改适配器与来源策略的内部契约及文档，不启用来源、不录入真实授权/候选，不取得字幕/媒体，不调用翻译/ASR或自动发布。SOURCE默认CEFR仍仅选材信号，不把两个不同等级视频冒充同一已审核等级；真实配置与发布仍须后续逐项核验。

交付review：[YOUTUBE-EXACT-001交接](../reviews/YOUTUBE-EXACT-001.md)。完成直接官方API查询、当前页ID/频道复验、有序分页与末页复位、游标严格绑定及旧feed兼容；application在外部await后拒绝取消的晚到结果，保留原子候选/游标提交与source revision CAS。专项6文件81项、PGlite5项、6文件lint、全树typecheck、生产build77/77通过（单页面worker、exit0），独立复核48项通过。未重跑全仓lint/全量Vitest/整个E2E及真实API/provider/库/RLS/Safari，不把此前全量失败算通过。保留历史稳定key转小写及协作取消限制，已同步架构、内容、运行与测试文档；无提交/推送/部署或真实来源操作。下一建议单独核实来源配置与逐项授权，再评估受限元数据canary。

### MEDIA-RIGHTS-001：字幕翻译与ASR处理前权利重验（2026-10-16）

用户确认CONTENT-RIGHTS-001首项建议，登记ready并由本会话领取in_progress，沿用共享分支`codex/disable-legacy-readlang`。只修复处理门禁，不同时实现精确ID发现。已有字幕与无字幕处理均须在供应商调用前重验来源/候选当前权利、操作许可、受众、第三方处理与到期；取消、超时、撤销、过期generation不得产生成功回写。先写失败回归，再实现，fake验证零未授权调用与临时音频清理。

交付状态review：[MEDIA-RIGHTS-001交接](../reviews/MEDIA-RIGHTS-001.md)。共用显式可选mediaProcessing授权，来源/候选权利、source revision与candidate revision/generation重验，固定shared-learning受众，预检整链并逐段复验，清理后拒迟到结果。旧实现回归20失败/1通过；最终专项12文件97项、13文件lint、全树typecheck、视频播客桌面/手机E2E18/18通过。全量2560通过/24失败/1跳过，含运行期间新增2项回归最终专项已通过，未跑冻结全量或隔离归因其余失败；生产编译成功但build TS worker OOM。未跑全仓lint/整个E2E/真实DB/RLS/provider/Safari；无真实来源操作、授权回填、内容新增或提交。已同步架构/内容/测试文档；跨表原子撤权与永不返回调用的协作式取消限制明确记录，下一建议仍为独立精确ID元数据切片。

兼容决定：旧来源策略仍可被适配器读取，但缺少显式处理授权时暂停新增翻译/ASR，不从verified、许可证标签或temporaryMediaProcessing自动推导权限；本任务不迁移/回填真实策略，不改变播放与发布审核。当前候选是准备进入学习资料库的内容，私人非分享译稿许可不能被当作资料库处理授权。字段及最终结果补充在交接报告。

### CONTENT-RIGHTS-001：VideoEle具体使用权与适配器门禁核验（2026-10-16）

用户“可以”确认CONTENT-SOURCE-001下一建议；本任务ready后由本会话领取，沿用共享分支。限定VideoEle频道`UCQK4L3hsPP0ei2_54lDaB6g`及`S0irU4fsfA0`/`z-CS3hAuOxs`两条，核查官方许可/署名、原样链接嵌入、PDF/字幕读取、私人改编与对外分发、中文翻译/词句索引、第三方处理和媒体下载的具体边界；同时只读核实现有适配器精确ID限制、许可表达、字幕取得与审核发布门禁。验收为绑定证据和代码位置的动作矩阵、可用路径/未决条件及有边界的下一实现建议；未满足即保留提案，不用全频道启用或伪造verified绕过。不扩展产品实现、来源配置/写库/正式审核/发布，不下载音视频/完整字幕/PDF，不调用收费provider或向第三方发消息。

交付（review）：[CONTENT-RIGHTS-001报告](../reviews/CONTENT-RIGHTS-001.md)及同名JSON提供两ID、13动作/13份短摘证据、署名/官方联系路径、17个代码/测试hash与可实施后续。既有许可支持条件内原版PDF个人学习及非商业不Share的私人改编；不泛化为禁止全部原样摘录/技术切分/索引，也不推定许可覆盖云处理/改编分发。官方YouTube许可选项CC BY与网站BY-NC-ND不等价，captions.download需编辑视频权限。现有适配器无精确ID策略且只读最新feed，无法靠limit=2取得两指定旧视频；已有字幕翻译分支在ASR门禁之前、未重验sourceEnabled/rightsStatus，fake实证1次翻译，无真实provider。既有聚焦Vitest5文件19项、外部fake6项、JSON/UTF-8/证据hash/脚本/链接/限定diff和其他任务/旧报告保留检查通过。无产品代码/接口/Schema/DB变更，未跑全量应用检查或真实库/原音/播放/Safari/正式Data API；未启用/写库/正式批准/发布/收费/媒体或全文取得/联系第三方，Commit无。用户可按矩阵核官方声明与重现；当前可用原站学习路径，仍2待复核/10未填补。下一建议先另任务补字幕/ASR处理前权利重验，再独立支持频道且精确ID的官方元数据发现；两者均为建议、未领取，不改全局队列。

## 16. 任务级验收与回滚原则


- 数据迁移只向前；功能回滚通过关闭来源、隐藏新入口、撤下内容或切回旧读模型完成，不执行破坏性 reset。
- `/learn` 切换前保留旧 route 和历史数据；确认无依赖后另建退役任务，不在 MEDIA-001 删除训练模块。
- 发布内容使用不可变版本；纠错或来源变化创建新版本或撤下，不能原地覆盖历史证据引用。
- 新索引可重建；原始事实是已审核 article/media 版本和 append-only evidence，不把搜索索引当权威。
- 每个任务失败时应能停在前一稳定版本，且不需要手工修改生产数据库恢复。

## 17. 用户验证清单

每个用户可见任务交付后，由产品本人确认：

- 页面是否打开即进入内容或明确操作，没有任务式欢迎、重复说明和假按钮。
- 视频/播客/文章是否真实可用，来源、地区、字幕和失败状态是否诚实。
- 查词、短语、语料和文字考察是否保留上下文且不打断主要内容。
- 手机是否只通过底部“我的”进入账户，没有顶部重复头像。
- 四板块能力解释是否符合主观学习感受，且能追溯到代表性证据。
- 内容工作流是否能清楚判断为什么候选被接受、修改、拒绝、发布或撤下。

## 18. 当前停点

`IA-001` 合并后，只把 `ACQ-001` 标为 `ready`。不得在同一分支顺手替换 `/learn`、创建媒体/词库迁移、访问公网来源或调用真实 ASR。
