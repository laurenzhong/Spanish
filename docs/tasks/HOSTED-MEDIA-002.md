# HOSTED-MEDIA-002：Bunny Storage 媒体迁移交接

- 核验日期：2026-09-19。
- 状态：`review`；当前数据库审计已确认所有当前视频使用 Bunny MP4，历史 YouTube 资产全部撤回，未来发布由 Bunny 资产校验和数据库 trigger 双重门禁保护。
- 当前复核：当前视频 41 条，41/41 为 `bunny-storage`、`video/mp4`、`available` 的 Bunny MP4；0 条可用 YouTube embed。另有 3 条视频条目已归档（含 1 条年龄限制来源，以及 2 条此前只有已撤回 YouTube 资产且无法取得 Bunny 文件的条目）。代码与数据库已核对，部署状态仍需单独确认。
- 分支：`codex/ui-017-collapsible-shell`；媒体基础设施与迁移脚本提交为 `6e791cb`，本交接随文档提交记录；尚未部署。
- 决策：[ADR-0009](../adr/0009-hosted-media-assets.md)；[实施计划](../plans/2026-09-15-hosted-media-assets-implementation-plan.md)。

## 本次真实结果

### 2026-09-19：当前分支真实迁移复核

- 追加数据清理：`youtube.language-reactor.caaa167f75b71cbde3afa057`（`5KMZI_4t6Uw`，ROMANTICISMO）和 `youtube.language-reactor.3531b7ee272335e38ccf29b9`（`pCJqZLaiySU`，Nada Es Como Antes）原本仍指向已撤回的 YouTube 资产，且当前环境 `yt-dlp` 复核均被 YouTube TLS EOF 阻断；通过现有发布归档流程撤下并保留审计记录。远端只读复核随后为当前视频 41 条、Bunny MP4 41/41、非 Bunny/不可用 0 条；历史 `official_embed/youtube` 资产 43 条均为 `withdrawn`。

- 最终当前状态：两条此前只有 YouTube embed 的视频 `eY8gZe7VZhU`、`uUPENpBbE5s` 已完成源文件解码、Bunny 上传、CDN 完整长度/SHA-256 校验、Chrome 播放/seek 验收并切换。当前发布投影为 **41** 条 Bunny 视频、**0** 条可用 YouTube embed；42 条历史 YouTube 资产均为 `withdrawn`，年龄限制条目另为 `archived`。
- 远端数据库已应用 `0035_bunny_video_asset_guard` 和幂等重申迁移 `0036_reassert_bunny_video_asset_guard`；触发器 `media_assets_bunny_video_guard` 实测拒绝把视频资产改回 `official_embed/youtube`。公开 repository、领域投影、详情页和媒体工作台均只接受/渲染 Bunny MP4。

- 修复恢复脚本：从数据库已有的 `youtube-nocookie.com/embed/<videoId>` 地址提取元数据和下载，不再强制改走不可达的 `youtube.com/watch?v=`；并将 Bunny CDN 分段完整性校验改为最多 4 段并发、按文件顺序合并 SHA-256。
- 目标视频 `youtube.language-reactor.bf2b3a27b939ede0875ef1db` 已切换为 Bunny MP4。源/目标为 1920×1080 H.264/AAC、2888 秒；Bunny HEAD、全文件 SHA-256、Chrome 原生首播/中段/尾段 seek 均通过。
- 对当前数据库剩余 YouTube 视频串行恢复：本轮新增 18 条成功，均通过完整解码、Bunny CDN MIME/长度/哈希和 Chrome 播放/seek 后才条件切换。第一条使用数据库已声明的 `es-ES` 作为音频语言上下文，记录了 YouTube 音轨未标注语言的回退；第二条保留 4K 源文件完整性证据，生成 1920×1080 H.264/AAC 兼容 MP4 以完成浏览器验收。当前视频计数为 Bunny **39**、YouTube **1**；播客 Bunny 资产未变。
- 仍为 YouTube 的唯一条目是 `youtube.language-reactor.f93f144e59cf21afe5c8f728`（`YWM3y1vs38Q`）：yt-dlp 的默认、`web_embedded`、`android`、`ios` 和 `web` 客户端均返回“Sign in to confirm your age”。没有授权登录会话或原始 MP4 时不能安全下载；未读取 Chrome cookies、未绕过年龄/访问控制，也未切换数据库。
- Playwright + 本机 Chrome（隔离 `AUTH_E2E_ENABLED=1` 服务、测试 cookie、真实数据库）验证目标页：页面 200，`iframe` 数量 0，原生 `<video>` 数量 1，Bunny MP4 `readyState=4`、1920×1080、时长 2888.35 秒；点击播放后 currentTime 增长并成功 seek 到 120 秒。Browser 插件不可用（`unsupported Codex auth method: apikey`），因此按技能要求记录为 Playwright fallback。
- 当前仍未完成全量迁移，也未部署；不要引用下面历史段落中的 20/20 完成宣称作为本次状态。

### 2026-09-17：方案二完成

- 当前已发布投影为 Bunny 视频 **20/20**、播客 **2/2**；全部使用 `provider_key=bunny-storage`、`availability=available`、`playback_expires_at=null`，没有临时签名 URL 或 YouTube 播放依赖。
- 最后 3 条 `5E6pFYqL_es`、`K2_qZ2TKt9s`、`Eog6R528OMo` 已用 yt-dlp 完整恢复并切换；对应迁移清单均为 `stage=switched`、`databaseSwitched=true`。所有视频下载继续统一使用 yt-dlp，浏览器只用于播放验收。
- 完成审计逐条匹配 22 条当前资产与迁移证明，Bunny CDN 的 MIME、Content-Length 与目标内容哈希证据均通过。最终 `.tmp-runtime/bunny-completion-audit.json` 为 `passed=true`，计数为视频 20、播客 2。
- Playwright + 本机 Google Chrome 从真实学习详情页逐条验证 20 个视频和 2 个播客：首播推进、中段 seek、尾段 seek、时长、`readyState`、媒体错误和页面错误均通过；最终覆盖当前 22 个 asset ID，未用内置浏览器结果替代。
- `8Vegtx0gybI` 首轮在 CDN 中段 seek 出现 Chrome 媒体错误码 3；本地全片解码和原始哈希正常。将该条规范化为 1920×1080 H.264、短 GOP、faststart 后，重新完成全片解码、Bunny 全文件哈希、远程 Chrome 及学习页面中段/尾段验收，再条件切换数据库。旧故障对象全库引用为 0，并已从 Bunny Storage 源端删除；源端目录只剩新对象 `video-3c6d82df….mp4`（257,497,329 bytes）。
- Supabase `media-video` / `media-audio` 对象计数均为 0；全版本 Supabase Storage 媒体 URL/provider 引用计数为 0。没有删除第三方 YouTube 或播客源站内容。
- 相关回归 6 文件 **39/39** 通过；目标 ESLint 移除本切片的未使用变量后通过，`git diff --check` 通过。2026-09-19 整理提交时，相关 14 个媒体基础设施测试文件 **78/78** 通过；补齐文章仓储测试 mock 契约后全量 `pnpm typecheck` 通过。
- 隔离 QA 服务已停止；Next 自动加入的 `.next/hosted-recovery` 两个 tsconfig include 已移除。代码已提交但未部署；本结论证明当前真实数据和本地代码路径，不等同于 Vercel 或 iPhone 真机验收。
- 用户验证：启动当前工作树并登录后打开 `/learn`，任选视频或播客，确认封面、首播、拖动到中段/尾段和声音/画面正常；重点可复核 `youtube.language-reactor.7e66387dc3167d77fc379f15`。后续若新增视频，仍使用 `pnpm content:recover-youtube-to-bunny` 的 yt-dlp 流程，并保留完整哈希与真实页面播放门禁。

### 2026-09-16 20:37：19 条资产已验收，最后 3 条网络中断

- 隔离批次已退出：7 条重试中 4 条成功、3 条失败。加上此前成功项，当前 Bunny 视频 **17**、播客 **2**，余下 YouTube 视频 **3**：`5E6pFYqL_es`、`K2_qZ2TKt9s`、`Eog6R528OMo`。没有运行中的下载/迁移 worker，不能按旧 session/PID 记录继续当作运行。
- 3 条失败的直接复测证据为 yt-dlp 的 `SSL: UNEXPECTED_EOF_WHILE_READING`。正常及 `--force-ipv4` 均未恢复；独立 curl 访问 YouTube 连接超时（HTTP 000），GitHub HTTP 200。未关闭 TLS 验证、未改系统代理或 VPN 配置。已请用户确认 VPN 与日常浏览器访问，尚待答复；不能把来源标为已下架。
- 网站 Playwright 验收覆盖当前 17 条视频，中段/尾段均通过，无 pageerror。两条播客首轮因验收脚本在 React effect 绑定 src 前过早断言而失败；补等待正确 src 后单独重跑，两条均通过。原失败记录保留在 `bunny-final-website-audit.json`，更新证据在 `bunny-final-podcast-audit.json`，不可用最初错误结果宣称播客业务回归。
- 独立完成审计逐一匹配 19 条当前 Bunny 资产的迁移清单、源/目标哈希证据、CDN HEAD 长度/MIME、cleared/available/无租约；全部匹配。Supabase media-video/media-audio 对象数 0，全版本对应 provider/旧 URL 引用数 0。整体审计仍失败，明确因为 3 条 YouTube 未迁移且没有全 22 条页面证据，未缩小成功标准。
- 隔离 QA 3105 服务本轮已停止，仅移除 Next 自动加入的 `.next/hosted-recovery` 两个 tsconfig include，保留其他并发修改。未提交；36 项相关回归已通过，完整 typecheck 的原有 mock 错误仍未解决，未作全仓发布验收。
- 下一步：网络恢复后运行正式 `pnpm content:recover-youtube-to-bunny`，当前查询只会领取最后 3 条；确认无遗留活跃 worker/锁后再启动。完成后重跑全部 22 条网站验收和完成审计，再决定是否完成目标。

### 2026-09-16：统一 yt-dlp 与剩余 9 条批处理

19:29 接续：首轮批处理已正常结束（migrated=2、failed=7）。除下载器命令失败外，`8Vegtx0gybI` 曾在播放阶段失败，未切换；改用每条独立进程重试后已完成原生 1080p 的复核和切换。当前已知 Bunny 视频 14、YouTube 6；`VW1rpazHzb4` 已完成完整原生 1080p 下载/解码/上传，正在 CDN 校验。隔离协调进程 session **72024**、PID **29440**，仍需实时检查，不得仅凭记录重启。剩余行继续串行，不重复迁移已切换资产。

- `content:recover-youtube-to-bunny` 已改为正式 `scripts/recover-youtube-videos-batch.ts` 协调器，每条子进程结束后释放内存；worker 保留原锁与门禁。当前在途运行是功能相同的私人启动器，完成后不再需要它作为正式入口。
- 7 文件相关回归以 `--maxWorkers=1 --no-file-parallelism` 重跑 **36/36 通过**；目标 ESLint 通过。此前并行 worker 内存崩溃不计为通过，具体下载器失败未一概认定为内存原因；新增错误分类将网络、访问、格式、JS 组件、内存和超时分别脱敏记录。全量 typecheck 仍为文章 mock 两处错误。
- AGENTS 与完整执行约束均同步“视频下载统一 yt-dlp”；不修改其余产品/评分/权限规则。最终全库页面验收与完成审计脚本已准备，尚未运行到最终全部成功状态；本任务仍未完成、未提交。

- 所有者明确要求之后视频下载统一使用 yt-dlp，已同步媒体运行手册和 ADR-0009；旧授权视频 CLI 也明确加入 `--js-runtimes node`。浏览器仅用于播放验收，不再用于下载/录屏。
- 新入口 `pnpm content:recover-youtube-to-bunny` 对当前 published/cleared 的 YouTube 官方嵌入逐条恢复。格式解析校验视频 ID/时长，选最高原生分辨率与西语音轨，排除 AI-upscaled；完整 source/output 解码、CDN 全文件 SHA-256、原生 Chrome 中段/尾段验收、锁定条件切换与独占运行锁均已实现。运行清单在 `.tmp-runtime/youtube-recovered`，不记录签名 URL。
- 本轮开始时当前状态为 Bunny 视频 11、YouTube 9、Bunny 播客 2。批处理已实际启动，`PfWVG7FFIbw` 48:08 原生 1280×720（131,163,551 bytes）完成校验和切换。下一条 `yw5EhfOU2iE` 已取得原生 1920×1078，不因旧 360p 默认值降低画质；具体是否已切换以实时清单/数据库为准。
- 本轮新增 `youtube-recovery-formats.ts`、相应 5 项回归和 `recover-youtube-videos-to-bunny.ts`，测试及目标 ESLint 通过。全量 typecheck 仍复现文章仓库 mock 两处缺少 list；随后 7 文件并行回归因本机内存不足发生 worker 崩溃（29 项通过不代表整轮通过），待迁移结束后用单 worker 重跑。
- 运行句柄：批处理 exec session 22659，启动 PID 22448（恢复必须实时检查，不能仅凭此段或 lock 重启）；私人 `.tmp-runtime/verify-all-bunny-media.mjs` 已准备，尚未对这批最终状态执行。网站验收仍未完成，整体目标未完成。本轮未提交。

### 2026-09-16 18:59：首条 YouTube 完整来源恢复

- 用户再次指定 yt-dlp 及 `v3qW03aZOT0` 后，核对官方 EJS 安装说明，确认此前 pip 安装缺少 `yt-dlp-ejs`；按官方 `pip install --user --upgrade "yt-dlp[default]"` 补齐依赖（yt-dlp 2026.08.19、ejs 0.8.0、Node 24.14.1）。缺失组件是此前下载器失败中的实际遗漏，不再以“必须先接管浏览器”作为下载前提。
- 该条下载 `136+140`，原生 1280×718 H.264 + 西语 AAC，保留全片 2374.727982 秒，不按链接的 152 秒起点截断。源站 1080p 被标为 AI-upscaled，因此选原生最高画质而非 AI 放大版。完整 MP4 为 91,963,911 bytes，SHA-256 `f56a20d6eae395f1cdfe5088bec0fe027776e2310065e7854c68d33d86752ab9`，全片严格解码通过。
- 本地原片保留在 `.tmp-runtime/youtube-recovered/v3qW03aZOT0/source.mp4`；无损 remux 为 faststart MP4 后上传 Bunny，CDN 完整字节数/哈希、Chrome 原生中段与尾段播放均通过，再对仍为当前、published/cleared 的同一 YouTube 资产进行锁定条件切换。未创建新内容版本、未修改字幕或学习证据，未删除第三方来源。
- 实际网站隔离验证使用 3105 和独立 `.next/hosted-recovery`，测试登录、真实数据库/媒体、浏览器写请求拦截。首次页面验证超时；补充诊断后重跑，在 152 秒、中段和尾段均推进播放，readyState=4、error=null、1280×718、pageErrors=0。不能将重跑通过解释为不存在间歇加载问题。
- 最新独立数据库计数：Bunny 视频 11、YouTube 视频 9、Bunny 播客 2；Supabase media-video/media-audio 仍无对象。全量方案还剩 9 条视频，未标完成。
- 本轮仅安装官方下载依赖、增加私人下载/迁移/验证脚本和更新文档，未提交；未跑全量 lint/typecheck/Vitest/build，真实操作验证不替代全仓发布验收。下一步将已验证下载路线纳入可复用迁移脚本，逐条选择原生画质并恢复余下 9 条，保留同等完整性与页面验收门禁。

以下为此前 10 条 Supabase 视频迁移记录，保留原计数与证据范围：

- 10 条原 Supabase 托管视频全部转换为 H.264/AAC MP4 并切换到 Bunny Storage + Pull Zone。转码保留原尺寸，不声称迁移自动提高画质。
- 下载验证来源主机、完整长度、ETag 和精确 Content-Range；转码前后完整解码，核对时长；上传后 CDN 全文件 SHA-256 与本地输出一致，独立 Chrome 实播与临近结尾 seek 通过。
- 网站页面使用真实数据库和真实 Bunny 文件，隔离 localhost 服务、测试登录身份、拦截浏览器非 GET/HEAD 请求；10/10 页面实播与 seek 通过，媒体 error=null、readyState=4、无 pageerror。删除旧文件后再跑 10/10 仍通过。不等同于真实用户身份、进度写入或 iPhone Safari 真机验收。
- 两个历史版本的同源视频资产地址先事务迁到 Bunny，字幕、版本、可用状态与学习记录不改动。随后重新校验 CDN 哈希并在资产写锁下确认零引用，删除 10 个精确 Supabase 原对象。
- 独立查询 `storage.objects` 确认 `media-video` bucket 对象数为 **0**；全版本旧播放地址引用均为 **0**。删除的 Supabase 原文件不能直接恢复；Bunny 上保留已验证的兼容编码副本。
- 移除原对象共 **284,346,704 bytes**；Bunny 视频共 **490,351,166 bytes**（约 467.64 MiB）。H.264 比原有 AV1 更大是兼容编码成本，不是画质提升。

## 尚未完成

### 播客后续执行（2026-09-16）

- 已新增/应用 `0033_bunny_storage_audio_expiry`、Bunny MP3 支持、`scripts/migrate-podcasts-to-bunny.ts`、`scripts/cleanup-migrated-supabase-audio.ts`。13 项相关测试通过，目标 ESLint 通过。
- 第一条 `it_44ee82c677a4` 按原 MP3 字节迁移（46,115,625 bytes），CDN 哈希与原文件一致；实际页面播放和尾段 seek 通过。一个旧版本地址先迁移，然后删除 Supabase 中 `media-audio` 对应原对象并通过 Storage 表核对。
- 第二条 `it_a790fe7fb425` 已完成切换：从 Language Reactor 正式 API 刷新来源后，完整下载 113,547,219 bytes，SHA-256 为 `eed6ad6b795a3fe3692a2c48c72ef5ab45419e5eef9251db7be9ca03c8ea0b10`。完整解码时长门禁、CDN 全文件哈希、Chrome 播放/尾段跳转均通过，播放时长 3548.265556 秒。不使用旧的 81,788,928 bytes 截断缓存，不删除第三方源站文件。
- 两条播客的网站页面最终复测均通过，readyState=4、error=null、页面错误数 0。第一条在本轮首次页面复测有一次 45 秒加载超时，重跑后通过；保留这一间歇失败，不将重跑成功解释为永无网络故障。验证使用真实数据库/媒体、测试登录身份和浏览器写请求拦截，不代表真实用户进度写入或真机验收。
- 2026-09-16 17:01（上海）独立数据库核对：当前 Bunny 视频 10、YouTube 视频 10、Bunny 播客 2；Supabase 的 media-video/media-audio 对象均为 0。运行证据为 `.tmp-runtime/bunny-current-audit.json`、播客迁移清单与 `.tmp-runtime/bunny-podcast-website-verification.json`。

- 另有 10 条当前视频仍为 YouTube 官方嵌入。此前下载器返回“不可用”，但后续 Playwright + Chrome 已实际播放 `v3qW03aZOT0`（时长 2374.681 秒、readyState=4、error=null），推翻了将下载器错误等同于源站下架的判断。其余来源和正常授权下载链路仍需分别核查；不能绕过访问控制或把可播放算作迁移完成。
- 当前两条播客均已迁移；整体“全部迁移”仍缺 10 条 YouTube 视频，目标未完成。
- 新命令覆盖既有 Supabase 视频；旧 `content:host-authorized-youtube-video` 的 Bunny 路径尚未纳入同样的校验/恢复门禁，不用于宣称后续来源恢复已经完成。

## 修改范围

- `src/modules/media/storage/bunny-storage.ts`：专用域名、区域地址、路径校验、超时、禁止凭据请求重定向。
- `src/modules/media/storage/hosted-video-integrity.ts`：HTTP Range、来源与历史引用校验；对应单元测试。
- `scripts/migrate-hosted-videos-to-bunny.ts`：授权门禁、独占运行锁、断点复用、下载/转码/哈希/播放验证、当前资产条件切换。
- `scripts/cleanup-migrated-supabase-videos.ts`：默认 dry-run，要求近期网站证明、再次验证 CDN 哈希、历史地址迁移与零引用精确删除。
- 媒体 Schema、0032 SQL/快照/迁移日志及持久化回归；package 命令、ADR、计划、数据库文档与状态页。
- 私人运行清单、校验脚本和截图在 `.tmp-runtime`，不提交。恢复前必须检查实际进程，不能仅凭锁文件断定仍在运行。

## 验证

- `pnpm test --run tests/unit/hosted-video-integrity.test.ts tests/unit/bunny-storage.test.ts tests/database/media-persistence.test.ts tests/database/media-rls.test.ts`：4 文件、19 项通过。
- `pnpm exec playwright test tests/e2e/video-learning.spec.ts --grep 'plays a hosted video' --reporter=line`：桌面与手机视口共 2 项通过（fixture，仅补充界面回归）。
- 本任务文件 ESLint 通过；0032 已应用，此前 db:check 通过，再次生成无 Schema 差异。
- 重新执行全量 typecheck 仍被 `tests/unit/composite-article-repository.test.ts:49` 的两个 mock 缺少 list 错误阻断。本任务新增 TS 错误已修复；不修改无关 mock。
- 全量 lint 上次为 7 处无关 React Hook 警告、0 error，严格零警告命令失败。全量 Vitest、全量 E2E、build 未在本切片执行；工作树存在并发 UI/字幕改动，本次不作全仓发布验收。

## 运行与用户验证

- 迁移：明确授权后设置 `MEDIA_VIDEO_HOSTING_CONFIRM=I_HAVE_AUTHORIZATION`、正确原生 `FFMPEG_BIN` 与大小上限，再执行 `pnpm content:migrate-hosted-videos-to-bunny`；已切换的当前资产不再选中。
- 清理：`node --import tsx/esm scripts/cleanup-migrated-supabase-videos.ts` 默认只检查；仅在所有门禁通过后显式设置 `MEDIA_VIDEO_CLEANUP_CONFIRM=DELETE_VERIFIED_SUPABASE_VIDEO_OBJECTS` 执行。不可跳过网站证明或直接删库表。
- 用户刷新学习页，打开任一已托管视频，开始播放并拖到中段/结尾。最长已验证视频约 1008.58 秒。YouTube 官方嵌入的 10 条不在这份成功量内。
- 下一切片：核查并完成 10 条 YouTube 来源的正常下载链路，不再将下载器失败直接标成源站不可用。

### 断点下载修复（2026-09-16）

- 上轮第二播客下载在约 36 MiB 后退出，旧实现 finally 删除了未完成分段。已改用 `resumable-audio-download.ts`：1 MiB 分段、最多 5 次尝试、HTTPS/重定向白名单、严格 Content-Range/MIME/长度校验，强 ETag 与本地 SHA-256 核验后复用断点；不保存签名 URL。
- 新增 4 项 fake 回归覆盖中断恢复、缓存损坏、ETag 变化、越界重定向，连同解码门禁共 10 项通过；目标 ESLint 通过。全量 typecheck 本轮复现原有文章仓库 mock 的两处缺少 list 错误。
- 真实下载已正常退出（migrated=1、failed=0），完成上述验证和切换。新增断点/解码/Bunny/持久化/RLS 共 23 项测试通过；最终缓存身份加上来源路径哈希后，4 项断点回归和目标 ESLint 再次通过。本轮未提交；未做全量 lint/Vitest/E2E/build，因本轮是迁移切片且存在并发功能改动，不作全仓发布验收。
- YouTube 新诊断：Chrome 再次实播首条并列出最高 1080p 的格式信息，但页面没有直接文件 URL。保存正常浏览器收到的未加密 SourceBuffer 数据的实验，在约 59 秒后播放流重置并停滞，实验进程已退出、未获得完整文件、未上传或改库；不得把实验片段算作成功下载。诊断与片段仅在 `.tmp-runtime/youtube-browser-capture`，后续需对比未拦截、正常播放速度下的持续播放行为，再决定下载恢复路线。

### 浏览器环境差异核验（2026-09-16 17:25）

- 已完成未拦截、1 倍速的持续播放对照：Playwright 新建的无界面及可见 Chrome 均在约 40–50 秒后重置播放器，YouTube 显示“出了点问题。请刷新或稍后重试。”相关媒体 HTTP 返回 200，无 requestfailed；不能仅凭 HTTP 200 或开头几秒播放证明完整来源可取得。
- 用户随后明确反馈：其日常浏览器中同一 `v3qW03aZOT0` 连续播放至少 2 分钟正常。因此阻点是测试浏览器环境与用户日常环境的差异，尚不能确定具体为会话、网络或其他因素；不能推断源站整体故障。
- 10 条来源的页面均返回 OK，格式/时长与既有媒体对应；8 条首次开头播放通过，另 2 条修正主播放器定位后也通过。全部仍无直接文件 URL，不算完整下载。运行记录为 `.tmp-runtime/youtube-browser-all-source-audit.json` 与 `youtube-browser-targeted-source-audit.json`。
- Language Reactor 正式视频目录 API 本轮返回 100 条 YOUTUBE metadata，没有视频文件 URL 字段；现有适配器也只转换为 YouTube 来源。这次检查未发现可直接替代的独立文件入口，不声称网站所有接口绝无该能力。
- 用户当前 Chrome 未启用 remote-debugging-port/pipe；浏览器连接器库存读取返回 unsupported Codex auth method: apikey，未连接到日常浏览器。未复制 cookies、未关闭用户 Chrome、未修改其个人配置。下一步需要建立可连接的专用浏览器会话，并由用户完成必要的登录/验证，再对比持续播放和授权下载。
- 本轮仅增加私人诊断脚本和更新交接，未改业务代码、未上传视频、未删数据；未重跑全仓测试。本轮诊断进程均已退出，网站隔离服务另行保留。
