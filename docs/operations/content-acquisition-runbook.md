# 内容供应运行手册

## 范围

每日任务只从已启用且权利状态为 `verified` 的白名单来源发现候选，并推进到审核库。文章和媒体都按受保护的分阶段策略运行；视频和播客可在 `CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH=true` 且当前版本通过内容、西语教学和结构三维审核时进入 `auto-publish`，否则最多停在 `review_ready`。自动发布仍不能绕过来源权利、结构校验、审核记录、revision/hash CAS 或资产可播放性门禁。

GitHub Actions 使用 UTC `03:17` 运行，对应 Asia/Shanghai 每日 `11:17`。同一 ref 使用 concurrency 互斥，前一次运行结束前不会启动第二个运行；整条文章、媒体、托管和报告流水线的硬上限为 60 分钟，避免 10 条视频与 10 条播客候选在完整审核和托管阶段被 30 分钟总超时截断。

## 命令

```powershell
pnpm content:pipeline -- discover --source <stable-key> --limit 1 --dry-run
pnpm content:pipeline -- process --source <stable-key> --limit 10
pnpm content:pipeline -- cleanup --limit 100
pnpm content:pipeline -- report --limit 100
```

`discover` 兼容 `pnpm content:acquire` 的显式 `--source` 用法。生产运行应使用受保护的 `DATABASE_URL`、供应商密钥和 GitHub Environment；本地与 CI 测试只使用 fake source/provider。

文章日流水线使用 `CONTENT_ARTICLE_AUTO_PUBLISH_KILL_SWITCH=true` 作为受保护 Environment 的显式发布门闩。缺失或非 `true` 时，`auto-publish` 在 CLI 入口直接 fail closed；`disabled`、`discover-only` 和 `review-only` 不受此门闩影响。该变量表示发布开关已由维护者明确置于可运行状态，不代表绕过来源权利、双审核、结构校验或 CAS 门禁。

媒体每日运行使用 `pnpm content:media-daily -- --mode <disabled|discover-only|review-only|auto-publish>`。自动发布目标按类型独立计算：`CONTENT_MEDIA_VIDEO_DAILY_LIMIT=10` 和 `CONTENT_MEDIA_PODCAST_DAILY_LIMIT=10`，合计目标为每天 10 条视频和 10 条播客；未显式设置环境变量时 CLI 也默认使用总计 20、视频 10、播客 10。将受保护 Environment 的 `CONTENT_MEDIA_VIDEO_DAILY_LIMIT` 设为 `0` 可暂停每日视频发现、处理、托管和发布，同时让播客按独立额度继续运行；workflow 会跳过 yt-dlp/PO Token 与视频托管步骤。恢复时将额度设为正数。`CONTENT_MEDIA_SOURCE_LIMIT` 仍限制单来源，最大 50。`auto-publish` 还要求受保护 Environment 的 `CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH=true`，缺失或非 `true` 时 CLI fail closed。

当 `CONTENT_MEDIA_REQUIRE_BILINGUAL_SUBTITLES=true`（生产默认值）时，流水线会先为无字幕或单语字幕的授权媒体创建临时音频，使用配置的 ASR 生成时间轴，再用 MiniMax 逐句翻译为简体中文；临时音频在成功、失败、取消和超时后删除。当前 revision 必须存在至少一个合法时间轴、每句同时有西语原文和中文翻译才允许自动发布；缺少字幕、只有单语字幕或翻译不完整的候选会记录 `MEDIA_BILINGUAL_SUBTITLES_REQUIRED`，不计入视频/播客完成数。该门禁不会把无字幕候选伪装成已完成，也不会绕过 ASR、翻译或审核流程。报告返回 `publishedByType` 和 `targetDeficitByType`，用于区分两类缺口；数据库配额计数同样只统计已发布正式媒体版本中完整双语时间轴的条目，不统计历史无字幕版本。

生产媒体转写配置使用受保护的 GitHub Environment 变量/secret：`CONTENT_MEDIA_PROVIDER_MODE=live`、`CONTENT_MEDIA_STT_PROVIDER=minimax|openai`、`CONTENT_MEDIA_TRANSLATION_PROVIDER=minimax`，默认使用 MiniMax ASR；只有显式设置 `CONTENT_MEDIA_STT_PROVIDER=openai` 时才切换到 OpenAI。默认 provider 需要 `MINIMAX_API_KEY`，显式切换 OpenAI 时需要 `OPENAI_API_KEY`。OpenAI 使用 `OPENAI_TRANSCRIPTION_ENDPOINT` 与 `OPENAI_TRANSCRIPTION_MODEL`；MiniMax ASR 使用 `MINIMAX_TRANSCRIPTION_API_ENDPOINT`（默认 `https://api.minimax.cn/v1/speech_to_text`）和 `MINIMAX_TRANSCRIPTION_MODEL=asr-1.0`。`CONTENT_MEDIA_ASR_MAX_DURATION_MS`、`CONTENT_MEDIA_ASR_MAX_ASSET_BYTES`、`CONTENT_MEDIA_ASR_MAX_COST_MICROS` 和 `CONTENT_MEDIA_ASR_MIN_CONFIDENCE` 控制单条媒体的时长、临时文件大小、预算和最低置信度，默认时长上限与 Language Reactor 播客策略一致为 60 分钟。默认临时媒体上限为 50 MB；超过转写 provider 输入限制的音频会在临时目录内转换为 48 kbps 单声道 MP3，转换后的文件仍必须不超过 25 MB。默认测试使用 `CONTENT_MEDIA_PROVIDER_MODE=fake`，不会请求收费 Provider。缺少 live provider 凭据时 `auto-publish` fail closed，不会把候选或审核通过计为正式发布。

该命令只选择 `youtube`、`podcast-rss` 或已登记的 `language-reactor` 的 `enabled=true`、`rights_status=verified` 来源，并在报告中显式列出因权利未验证而跳过的媒体来源。媒体来源的配额顺序固定为 Language Reactor YouTube mix（`t_yt_mix_es`）→其他视频→Language Reactor podcast mix（`t_pd_mix_es`）→其他播客；`t_pd_mix_es` 的 API 返回类型是 `AUDIO_FILE`，因此只能生成播客候选，不能伪装为视频。`language-reactor` 只允许已验证的西语视频/播客目录和其来源策略中指定的 API、媒体主机；适配器不会从页面或 API 响应扩大 allowlist。音频资源会逐跳校验 HTTPS、重定向目标 host、MIME 和大小；失败会记录稳定的脱敏原因码（例如 `RESOURCE_HOST_NOT_ALLOWLISTED`、`RESOURCE_CONTENT_TYPE_UNSUPPORTED`、`RESOURCE_REQUEST_FAILED`），不会记录完整媒体 URL。若授权目录使用 CDN/跟踪重定向，必须先在来源策略中明确登记所有预期跳转 host，并重新运行来源策略校验。

每个媒体来源的 discovery 请求有 180 秒硬超时（包含授权音频的大小/MIME 探测和播客 artwork 查询）；超时会在报告中记录 `MEDIA_SOURCE_TIMEOUT` 并继续后续已授权来源，保留该来源游标，不会把未完成 discovery 当作成功或发布。候选下载、ASR、翻译和审核不共用 discovery 超时；每个候选默认有 15 分钟处理超时，可由受保护变量 `CONTENT_MEDIA_CANDIDATE_TIMEOUT_MS` 调整。媒体候选审核默认以 2 个候选并发运行，可由受保护变量 `CONTENT_MEDIA_REVIEW_CONCURRENCY` 调整（限制为 1-10）；每个候选仍独立完成内容、教学、结构审核和 CAS。分类 `daily-limit` 是本次运行的处理上限，不是保证可发现或可发布的数量；视频还必须先完成 Bunny MP4 托管门禁和双语字幕门禁。

文章候选审核默认以 2 个候选并发运行，可由受保护变量 `CONTENT_ARTICLE_REVIEW_CONCURRENCY` 调整（限制为 1-10）。发现、准备、双维度 MiniMax 审核、最多一次修订和发布仍按候选保持 revision/hash CAS；单个候选失败会记录脱敏错误并继续同批其他候选。并发只解决吞吐，不减少任一审核维度，也不把 `discovered`、`prepared` 或 `reviewed` 计为 `published`。

新视频发布时，YouTube URL 仅保存为来源与 provenance；公开播放资产必须先经 yt-dlp/ffmpeg 处理、上传 Bunny Storage + Pull Zone，并通过 MP4、SHA-256、字节数、CDN HEAD 与浏览器播放/seek 校验。没有 `bunnyVideoAsset` 的视频候选只能停留在审核或托管准备阶段，不能通过媒体 publisher；已存在的旧 official embed 不因迁移脚本成功而自动宣称已转为 Bunny。

媒体自动发布的托管步骤会先按 Asia/Shanghai 自然日统计正式 `published` 视频，再从所有当前 revision 已通过三维审核、仍为 draft 且没有 `bunnyVideoAsset` 的视频候选中按 `last_activity_at` 只取当天剩余缺口。审核前已存在的候选仍可在本次运行中托管；不能用运行开始时间排除它们。仅在人工单次回填需要限制时间窗口时，才显式设置 `MEDIA_VIDEO_HOSTING_SINCE`。

### YouTube PO Token provider（每日 workflow 默认）

每日 workflow 在 auto-publish 或 `media_canary_only` 模式安装 `bgutil-ytdlp-pot-provider==2.0.0`，并启动 `brainicism/bgutil-ytdlp-pot-provider:2.0.0` 容器。容器端口只绑定 runner loopback `127.0.0.1:4416`，yt-dlp 显式选择 `youtubepot-bgutilhttp` 并指向 `http://127.0.0.1:4416`，避免误选需要本机源码 checkout 的 script provider；视频下载使用 yt-dlp 官方当前推荐的 `mweb` player client，不需要账号或 cookies。服务启动失败时 job fail closed，job 收尾时删除 provider 容器。若改用专用 self-hosted runner，必须安装 Docker 并允许 runner 用户访问 Docker daemon。

PO Token 只用于 YouTube 客户端请求验证，不等于来源许可或下载授权；候选仍必须满足既有权利状态、审核、Bunny 资产和发布门禁。YouTube 可能继续对特定 IP、视频或格式返回拒绝，因此 token provider 不保证所有下载成功。插件在 yt-dlp PO Token Guide 中列为 featured provider，但并非 yt-dlp 官方项目的一部分。版本升级需同时核对插件和容器兼容性，并先执行单个已授权候选 canary。

单视频 canary：手动运行 `Daily content acquisition` workflow，勾选 `media_canary_only`。该模式按审核资格顺序最多尝试 10 个当前 revision 三维审核通过、仍为 draft 且尚无 Bunny 视频资产的候选，遇到年龄限制、区域或格式拒绝时记录脱敏错误并继续；只在第一条成功通过托管流程后停止，因此最多托管 1 条。它跳过文章阶段、媒体发现/审核/自动发布、候选 cleanup 和 report。结果写入 workflow summary，包含成功候选 ID、检查数量、上传来源、托管成功/失败数，并明确标记 `publication=skipped`。没有候选成功时 job 失败；canary 成功后仍需核对 Bunny HEAD 与浏览器播放/seek，之后再用普通 workflow 恢复日常发布。年龄/登录门槛代表 YouTube 访问限制，PO Token 不会绕过这些门槛。

本地 Windows 验证需使用同一 Python 环境安装 yt-dlp 与插件，并运行 Docker Desktop provider：

```powershell
python -m pip install --upgrade yt-dlp bgutil-ytdlp-pot-provider==2.0.0
docker run --rm --detach --name bgutil-ytdlp-pot-provider --publish 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider:2.0.0
```

本地候选处理完成后停止该容器：

```powershell
docker rm --force bgutil-ytdlp-pot-provider
```

只有在授权来源明确要求账户身份时，才考虑临时 cookies。不得通过 cookies 访问未授权内容。cookies 只作为临时 yt-dlp 输入，脚本会复制到临时目录、任务结束删除，不写入数据库、候选 metadata、日志或仓库。

本地 Windows 运行：

```powershell
$env:MEDIA_VIDEO_COOKIES_FILE = 'C:\secure\youtube-cookies.txt'
$env:MEDIA_VIDEO_HOSTING_CONFIRM = 'I_HAVE_AUTHORIZATION'
pnpm exec tsx scripts/host-video-candidate-to-bunny.ts <candidate-uuid>
Remove-Item -LiteralPath $env:MEDIA_VIDEO_COOKIES_FILE
```

若授权方直接提供原始 MP4，可在本机对单条已审核候选使用 `MEDIA_VIDEO_LOCAL_FILE`；脚本只复制该文件到临时目录进行 ffmpeg、哈希、Bunny HEAD 和 Chrome 播放/seek 校验，绝不删除原始文件：

```powershell
$env:MEDIA_VIDEO_LOCAL_FILE = 'C:\secure\authorized-video.mp4'
$env:MEDIA_VIDEO_HOSTING_CONFIRM = 'I_HAVE_AUTHORIZATION'
pnpm exec tsx scripts/host-video-candidate-to-bunny.ts <candidate-uuid>
Remove-Item Env:MEDIA_VIDEO_LOCAL_FILE
```

每日 workflow 也可从专用 Linux self-hosted runner 读取授权 MP4。先将每个文件明确对应到数据库中的候选 UUID，并放入 runner 专用目录，文件名必须为 `<candidate-uuid>.mp4`。在 GitHub repository variables 中设置 `CONTENT_MEDIA_RUNNER_LABELS=["self-hosted","linux","x64","content-media"]`（标签必须匹配已注册的专用 runner），并在 `content-production` Environment variables 中设置 `CONTENT_MEDIA_AUTHORIZED_ASSET_DIR` 为该 runner 上的素材目录。workflow 只把文件传给当前 revision 三维审核通过、仍为 draft 的对应候选；缺失文件才回退到既有 yt-dlp 路径。批处理拒绝单文件变量，避免同一个 MP4 被错误复用于多条候选。上传仍经过完整 FFmpeg、SHA-256、Bunny HEAD 和浏览器播放/seek 校验；源文件不删除。self-hosted runner 未配置时继续使用 GitHub-hosted runner 与原有 yt-dlp 处理。

GitHub Actions 使用受保护的 `content-production` Environment secret。不要把 cookies 文件提交到仓库或粘贴到 issue/聊天；先在本地生成一次 base64 文件，再通过标准输入写入 secret：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\youtube-cookies.txt')) | Set-Content -NoNewline 'C:\secure\youtube-cookies.b64'
Get-Content -Raw 'C:\secure\youtube-cookies.b64' | gh secret set YOUTUBE_COOKIES_B64 --repo laurenzhong/Spanish --env content-production
Remove-Item -LiteralPath 'C:\secure\youtube-cookies.b64'
```

配置后先用 `limit=1` 的 `review-only` 或单候选托管 canary，确认候选带有 `bunnyVideoAsset`、Bunny HEAD 与浏览器播放/seek 校验通过，再开启媒体 `auto-publish`。若 cookies 未配置、过期或格式不正确，流程会稳定失败关闭；不会把审核通过、托管失败或候选数量计为正式发布。

Readlang 页面来源使用 `adapter_type=readlang-links`、`source_kind=article-site`，`external_source_id` 必须精确为 `https://readlang.com/es/links`，`rights_status=verified`，并在 `rights_policy` 保存 `readlang-links-v6.json` 的 `policyVersion`、164 个精确 URL 快照和授权证据。v6 将已授权的 100 个 `https://readlang.com/library/<id>` URL 放在快照队列首位；其余精确 URL 仍完整保留。文章全局配额会先分配给该 Readlang 来源，再分配给其他文章 RSS 来源；这不会把 `https://readlang.com/es/library` 页面本身扩展为新的授权范围。该适配器只读取快照 URL；页面新增 URL 或主机前不得自动采集。v6 的 `automatedPublication.enabled=true` 只表示这些精确 URL 已获所有者授权进入分阶段自动发布；仍必须通过 MiniMax 内容/教学审核、结构校验、revision/hash CAS 和显式 publisher，不能按 host 扩大抓取范围。

Readlang 入口目前由客户端渲染，适配器在先读取入口 HTML 后，只允许请求同站固定的 `https://readlang.com/api/popularDomains?language=es&limit=50`，再把返回的域名/路径逐条套用既有快照 allowlist；不会把 API 返回内容当作新的授权来源。每个外部页面有 15 秒超时和正文大小限制，未抽取出合规文章时保留当前游标以便重试，不把网站首页简介伪装成文章候选。

策略快照中已经明确列出的非首页 URL 会优先于 API 返回的域名首页尝试，其中 Readlang library URL 优先于其他精确快照 URL；这只改变已授权 URL 的处理顺序，不增加 host、路径或自动发现范围。仍需通过正文结构、语言、哈希和审核门禁后才能进入发布流程。

## 首次受控运行

1. 对一个 YouTube、播客 RSS 和文章 RSS 来源分别执行 `discover --dry-run`，核对数量、重复、权利和估算成本。
2. 去掉 `--dry-run`，每类 `--limit 1`，确认候选进入审核库且没有自动发布。
3. 在候选页面完成内容与教学审核，再显式发布一个版本。
4. 重复相同范围，确认游标、候选和版本幂等，没有新增重复费用。
5. 执行 `cleanup`，确认过期草稿和临时资产被删除；删除失败必须保留为可重试状态。

## 故障处理

- 429、5xx、网络超时：保留游标，修复来源或限流后重试；不要手工推进游标。
- 权利、鉴权或 Schema 错误：停止该来源并修复配置，不盲目重试。
- 预算耗尽：停止媒体处理，只保留元数据候选和脱敏报告。
- 清理失败：保留 artifact 为 `failed`/`delete-pending`，下一次 `cleanup` 重试；不要把“请求删除”报告为已删除。
- 大面积来源失败、连续失败或数据库不可用：暂停生产 Environment，保存 `runId` 和错误码交给维护者。

## 日志与隐私

### 2026-10-15：Bunny 上传 401 的区域配置纠正（OPS-CI-001）

run `38704586687`（北京时间 16:17）在播客自动发布阶段两次报告
`bunny-storage-upload-401`，发布 0。它来自 Daily content acquisition，
并非 Lucía 主动消息 workflow。

GitHub `content-production` 的 `BUNNY_STORAGE_REGION` 当时为 `storage`，
而项目本机配置为新加坡 `sg`。用相同本机 zone/password 对官方端点做只读
GET 对照：`storage.bunnycdn.com` 返回 401，`sg.storage.bunnycdn.com`
返回 200；没有读取或输出目录内容。北京时间 **16:54** 已将该 GitHub
Environment 变量更新为 `sg`，并回读确认。没有更换 secrets、上传文件或
手动重跑收费媒体流程；没有修改产品代码或数据库。

此验证不能证明不可读取的 GitHub secrets 与本机相同，也不能代替远端 PUT
上传验证。下一次自然调度应核对 401 是否消失与实际发布结果；若仍报 401，
需再核对同一 Environment 的 `BUNNY_STORAGE_ZONE_NAME` 和
`BUNNY_STORAGE_PASSWORD`，不能把账户 API key 与 Storage zone password
混用。不要在日志或聊天里输出密钥。

该 run 同时记录 ASR 不符合资格、审核响应无效和音频获取失败；本次只修
区域配置，其他错误仍需分别定位，不可将配置修正报告为完整流程恢复。

报告只允许包含 `runId`、来源 stable key、步骤、状态、数量、耗时、稳定错误码和估算成本。禁止输出数据库 URL、API key、完整媒体 URL、正文、字幕、音频或长期签名播放地址。诊断记录使用内部 ID 和脱敏 metadata。

## 发布门禁

发布前必须重新校验 candidate revision/hash、来源权利、审核维度、内容版本和播放/阅读资产有效期。任何自动化成功都不等于发布成功；撤下必须移除公开投影和语料索引，保留必要审计记录。
