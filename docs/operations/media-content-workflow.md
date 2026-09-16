# 媒体素材运行手册

适用：项目所有者操作当前检出的代码。这里集中维护从 README 迁出的采集、托管和字幕命令；内容质量与发布政策以 [内容制作规范](../content-authoring.md) 为准，托管决策见 [ADR-0009](../adr/0009-hosted-media-assets.md)。以下是操作说明，不是本次执行记录。

## 1. 执行前确认

- 在仓库根目录核对分支、工作树和 [项目状态](../../PROJECT_STATUS.md)。截至 2026-09-16，本工作树的 MiniMax、字幕回填和 Bunny 实现包含未提交文件；换分支后先检查脚本与配置是否存在。
- 来源许可见 [Language Reactor 授权记录](../references/language-reactor-authorization.md)。非盈利不取消平台、署名、第三方处理和撤下义务；确认字符串只表示操作者确认，不替代授权证据。
- CLI 命令的真实来源是 [package.json](../../package.json) 和对应脚本。这些脚本加载根目录 `.env`（dotenv），已有进程环境变量优先；不要假设它们自动读取 Next.js 的 `.env.local`。
- 应用数据库连接使用 `DATABASE_URL`；迁移与本手册托管/字幕脚本优先 `DIRECT_DATABASE_URL`，不存在才回退。空字符串不等于未设置。只在本机核对目标，禁止把连接字符串打印进报告。详见 [数据库](../database.md)。
- 认证公开变量、服务端密钥和所有者 `CONTENT_WORKFLOW_OWNER_USER_IDS` 的配置来源见 [.env.example](../../.env.example)、[认证](../authentication.md)及 [内部工作流鉴权](../../app/api/v1/internal/content-workflow/http.ts)。没有所有者授权不能调用审核操作。
- 首次只处理一条已核对的素材。采集 `--dry-run` 仍可能访问真实来源，不是离线测试；它不批准也不发布。默认验证使用 fake。
- 采集、迁移、下载、上传、ASR、发布和清理均有副作用，文档审计不执行。不要把原始 CLI stderr 直接上传：当前下载路径会转述子进程错误，不能保证第三方错误自动脱敏。

## 2. 来源注册与候选采集

确认目标数据库、迁移 SQL 和授权记录后，才执行迁移与一次性来源注册；这不是首次启动网站的必需步骤：

```powershell
pnpm db:migrate
pnpm content:register-language-reactor
pnpm content:acquire -- --source language-reactor.podcast-mix-es --limit 20
pnpm content:acquire -- --source language-reactor.youtube-mix-es --limit 20
```

## 3. 已发布播客托管

已明确授权的 Language Reactor 播客可在发布后复制到 Supabase Storage，使用稳定本站对象 URL 播放：

```powershell
pnpm content:host-language-reactor-audio
```

该脚本需要服务端 `SUPABASE_SECRET_KEY`（或旧版 `SUPABASE_SERVICE_ROLE_KEY`）；它不会下载 YouTube 视频。

## 4. 单条字幕回填（收费调用）

没有字幕的已发布媒体不会自动生成字幕。对已确认拥有音频处理授权的单条播客或已托管视频，可先在服务端设置 `MEDIA_TRANSCRIPT_BACKFILL_CONFIRM=I_HAVE_AUTHORIZATION`，再运行 `pnpm content:backfill-media-transcript -- --stable-key <stableKey>`。该命令有日/月预算门禁，只生成 owner-only 审核草稿；完成 `content-es-ES`、`teaching-zh-CN`、`structure` 三项审核后，才通过内容工作流发布不可变的新媒体版本。官方 YouTube embed 不会被下载或处理。

字幕回填默认使用 OpenAI；需要使用 MiniMax 官方语音识别时，设置 `MEDIA_TRANSCRIPT_PROVIDER=minimax` 和 `MINIMAX_TRANSCRIPTION_API_ENDPOINT=https://api.minimaxi.com/v1/speech_to_text`。MiniMax ASR 使用 `asr-1.0` 的 `verbose_json` 句段时间戳，结果仍必须经过三维审核后才公开。

## 5. 授权视频托管

如果已单独确认某个 YouTube 来源的下载与再分发授权，并希望让视频脱离 YouTube 网络播放，可在提供 `yt-dlp` 与 ffmpeg 的服务端环境运行。以下路径只是占位示例，先替换为本机可执行文件；字幕回填直接 spawn ffmpeg，因此 `FFMPEG_BIN` 用可执行文件路径，不用目录：

```powershell
$env:MEDIA_VIDEO_HOSTING_CONFIRM="I_HAVE_AUTHORIZATION"
$env:MEDIA_VIDEO_STABLE_KEY="youtube.language-reactor.<替换为已核对的单条key>"
$env:YTDLP_BIN="D:\tools\yt-dlp.exe"
$env:FFMPEG_BIN="D:\tools\ffmpeg\bin\ffmpeg.exe"
# 当前应用默认 50 MiB；另需核对目标存储项目和 bucket 限额。
$env:MEDIA_VIDEO_MAX_HEIGHT="360"
pnpm content:host-authorized-youtube-video
```

授权与平台允许访问仍是前提。脚本支持 `MEDIA_VIDEO_COOKIES_FROM_BROWSER` 或 `MEDIA_VIDEO_COOKIES_FILE`，但拥有 cookies 不等于拥有下载/再分发许可，也不能用来绕过访问限制。2026-09-16 的状态记录显示，关闭 Chrome 后仍出现 DPAPI/App-Bound Encryption 解密失败，因此不要反复把“关闭浏览器重试”当作已验证修复。若所有者自行提供合法、临时的 Netscape cookies 文件，只在本机以 `MEDIA_VIDEO_COOKIES_FILE` 传入；不要上传、打印或提交，使用后由所有者确认删除。优先考虑授权方提供原始媒体。

如果没有 YouTube 账号，授权方可以直接提供原始 MP4；设置 `$env:MEDIA_VIDEO_LOCAL_FILE="D:\authorized\video.mp4"` 后运行单条托管。脚本读取该本地文件并上传到所选存储；输入文件由所有者管理，不应误当作脚本临时文件删除。

脚本只处理已发布且版权状态为 `cleared` 的官方嵌入视频；默认下载最高 360p，并设置网络重试与单视频超时。成功后切换到所选存储的 MP4 URL，失败则保留原嵌入资产。若要使用更高画质，必须先提高 Supabase Storage 单对象上限并设置 `MEDIA_VIDEO_MAX_BYTES`。

当前代码默认 `MEDIA_VIDEO_MAX_BYTES=52428800`（50 MiB），这是应用默认值，不是对所有 Supabase 套餐的保证。历史状态记录中曾有提高 bucket 上限被拒的案例；本次未访问供应商后台核实套餐。提高画质前分别核对目标项目、bucket、应用三处限制及预算。确认允许后再调整 `MEDIA_VIDEO_MAX_BYTES` 与 `MEDIA_VIDEO_MAX_HEIGHT`；如需重托管已托管资产，显式设置 `MEDIA_VIDEO_REHOST_HOSTED=1`。不设此开关时默认只处理尚未托管的官方嵌入。不要照抄历史 5 GB 示例作为已获批准的限额。

### Bunny 配置参考（按对应 ADR 核对，不是执行授权）

先核对新供应商 ADR、预算与撤下策略，再评估以下当前代码配置；不能把本段当作立即迁移的指令。获批后的首次验证仍限定单条 `MEDIA_VIDEO_STABLE_KEY`，确认编码、MP4 fallback 和实播后才考虑扩大范围。

当前 Bunny Stream 路径要求在 Video Library 的 Encoding 设置中开启 MP4 Fallback，并在服务端设置 `MEDIA_VIDEO_STORAGE_PROVIDER=bunny-stream`、`BUNNY_STREAM_LIBRARY_ID`、`BUNNY_STREAM_API_KEY` 和 `BUNNY_STREAM_PULL_ZONE_HOSTNAME`，运行同一回填命令。Bunny 会自动编码，当前适配器轮询编码状态后构造 MP4 URL；这不证明 URL 实际可播放，必须再做实播验收；API key 只放在服务端环境变量中。

采集只会生成候选并自动推进到审核待命；在 `/me/content-workflow` 完成审核并显式发布后，内容才会出现在 `/learn`。播客 enclosure 仍需通过无凭据 HTTPS、主机白名单、HEAD 类型/大小和有效期检查。

## 6. 验收与恢复

1. 采集：核对 run、来源、候选数量、hash/revision、重复和失败；`review_ready` 不等于已审核或已发布。
2. 回填：核对 provider/model、时间轴、低置信度、预算与临时资产清理结果；两个内容审核维度加结构审核都绑定当前修订。生成草稿成功不等于发布成功。
3. 发布：显式发布新媒体版本后，检查公开目录、字幕数量、旧版本/进度保留及撤下路径。不要用直接修改数据库绕过门禁。
4. 播放：在真实目标学习页检查请求、MIME/Range、播放器 readyState、实际画面/声音及 currentTime 增长；HTTP 200/206、iframe load、编码状态完成、fake E2E 都不能单独证明播放成功。
5. 失败：保留可恢复状态和脱敏错误。清理请求已登记不等于对象已删除；必须确认删除结果，失败保留重试依据。未经确认不扩大到批量。
6. 回填结束清除本轮临时确认开关；只清理已核对的本轮临时文件，不删除授权方原件或历史媒体对象。

### 已有证据与适用边界

- **历史实测：Chrome cookies**：关闭浏览器后仍失败，见 [状态历史](../tasks/PROJECT-STATUS-HISTORY.md) 的 2026-09-16 MEDIA-002 记录；是否可读取取决于本机加密环境，不能保证导出方案有效。
- **当前代码与历史实测：Windows ffmpeg**：字幕脚本在 Windows 默认使用 PATH 原生 ffmpeg，避免非本机 `ffmpeg-static` 二进制的 EFTYPE；先用 `Get-Command ffmpeg` 和 `ffmpeg -version` 确认。证据：本机未提交脚本 `scripts/backfill-media-transcript.ts`（提交后再建立链接）；这不代表所有 Windows 安装都有该故障。
- **历史诊断更正：YouTube 153**：按来源身份/Referer 缺失排查，不能仅凭直接导航 embed 就断言反机器人验证或源视频失效；必须检查目标页面的真实嵌入请求。证据：[播放器](../../src/modules/media/ui/video-player-adapter.tsx)、状态历史的播放器重开记录。
- **待验收：Bunny**：当前代码可选 `bunny-stream` / `bunny-storage`，供应商决定以 ADR-0009 对应提交为准。命令存在不代表正式供应商决策或迁移验收已完成；新增供应商的预算、数据保留和撤下影响须有 ADR，不在本次文档任务中代为批准。
- **当前分支限制：每日调度**：这里仅支持 `content:acquire -- --source ... [--dry-run] [--limit 1..500]`；不支持把计划中的 discover/process/cleanup/report 当作该 CLI 子命令。本地 main/OPS 分支另有 `content:pipeline` 与运行手册，当前分支未包含。其 workflow 只调用 discover；配置文件存在不证明生产 schedule 已启用，也不证明全链路每日执行。集成前按状态页对账。
