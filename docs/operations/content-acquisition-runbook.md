# 内容供应运行手册

## 范围

每日任务只从已启用且权利状态为 `verified` 的白名单来源发现候选，并推进到审核库。文章和媒体都按受保护的分阶段策略运行；视频和播客可在 `CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH=true` 且当前版本通过内容、西语教学和结构三维审核时进入 `auto-publish`，否则最多停在 `review_ready`。自动发布仍不能绕过来源权利、结构校验、审核记录、revision/hash CAS 或资产可播放性门禁。

GitHub Actions 使用 UTC `03:17` 运行，对应 Asia/Shanghai 每日 `11:17`。同一 ref 使用 concurrency 互斥，前一次运行结束前不会启动第二个运行。

## 命令

```powershell
pnpm content:pipeline -- discover --source <stable-key> --limit 1 --dry-run
pnpm content:pipeline -- process --source <stable-key> --limit 10
pnpm content:pipeline -- cleanup --limit 100
pnpm content:pipeline -- report --limit 100
```

`discover` 兼容 `pnpm content:acquire` 的显式 `--source` 用法。生产运行应使用受保护的 `DATABASE_URL`、供应商密钥和 GitHub Environment；本地与 CI 测试只使用 fake source/provider。

文章日流水线使用 `CONTENT_ARTICLE_AUTO_PUBLISH_KILL_SWITCH=true` 作为受保护 Environment 的显式发布门闩。缺失或非 `true` 时，`auto-publish` 在 CLI 入口直接 fail closed；`disabled`、`discover-only` 和 `review-only` 不受此门闩影响。该变量表示发布开关已由维护者明确置于可运行状态，不代表绕过来源权利、双审核、结构校验或 CAS 门禁。

媒体每日运行使用 `pnpm content:media-daily -- --mode <disabled|discover-only|review-only|auto-publish>`，受 `CONTENT_MEDIA_DAILY_LIMIT`（全局，最大 50）和 `CONTENT_MEDIA_SOURCE_LIMIT`（单来源，最大 50）约束。`auto-publish` 还要求受保护 Environment 的 `CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH=true`，缺失或非 `true` 时 CLI fail closed。该命令只选择 `youtube`、`podcast-rss` 或已登记的 `language-reactor` 的 `enabled=true`、`rights_status=verified` 来源，并在报告中显式列出因权利未验证而跳过的媒体来源。`language-reactor` 只允许已验证的西语视频/播客目录和其来源策略中指定的 API、媒体主机；适配器不会从页面或 API 响应扩大 allowlist。音频资源会逐跳校验 HTTPS、重定向目标 host、MIME 和大小；失败会记录稳定的脱敏原因码（例如 `RESOURCE_HOST_NOT_ALLOWLISTED`、`RESOURCE_CONTENT_TYPE_UNSUPPORTED`、`RESOURCE_REQUEST_FAILED`），不会记录完整媒体 URL。若授权目录使用 CDN/跟踪重定向，必须先在来源策略中明确登记所有预期跳转 host，并重新运行来源策略校验。

每个媒体来源的 discovery 请求有 45 秒硬超时；超时会在报告中记录 `MEDIA_SOURCE_TIMEOUT` 并继续后续已授权来源，保留该来源游标，不会把未完成 discovery 当作成功或发布。媒体候选审核默认以 2 个候选并发运行，可由受保护变量 `CONTENT_MEDIA_REVIEW_CONCURRENCY` 调整（限制为 1-10）；每个候选仍独立完成内容、教学、结构审核和 CAS。`daily-limit` 是本次运行的处理上限，不是保证可发现或可发布的数量；视频还必须先完成 Bunny MP4 托管门禁。

文章候选审核默认以 2 个候选并发运行，可由受保护变量 `CONTENT_ARTICLE_REVIEW_CONCURRENCY` 调整（限制为 1-10）。发现、准备、双维度 MiniMax 审核、最多一次修订和发布仍按候选保持 revision/hash CAS；单个候选失败会记录脱敏错误并继续同批其他候选。并发只解决吞吐，不减少任一审核维度，也不把 `discovered`、`prepared` 或 `reviewed` 计为 `published`。

新视频发布时，YouTube URL 仅保存为来源与 provenance；公开播放资产必须先经 yt-dlp/ffmpeg 处理、上传 Bunny Storage + Pull Zone，并通过 MP4、SHA-256、字节数、CDN HEAD 与浏览器播放/seek 校验。没有 `bunnyVideoAsset` 的视频候选只能停留在审核或托管准备阶段，不能通过媒体 publisher；已存在的旧 official embed 不因迁移脚本成功而自动宣称已转为 Bunny。

Readlang 页面来源使用 `adapter_type=readlang-links`、`source_kind=article-site`，`external_source_id` 必须精确为 `https://readlang.com/es/links`，`rights_status=verified`，并在 `rights_policy` 保存 `readlang-links-v5.json` 的 `policyVersion`、164 个精确 URL 快照和授权证据。该适配器只读取快照 URL；页面新增 URL 或主机前不得自动采集。v5 的 `automatedPublication.enabled=true` 只表示这些精确 URL 已获所有者授权进入分阶段自动发布；仍必须通过 MiniMax 内容/教学审核、结构校验、revision/hash CAS 和显式 publisher，不能按 host 扩大抓取范围。

Readlang 入口目前由客户端渲染，适配器在先读取入口 HTML 后，只允许请求同站固定的 `https://readlang.com/api/popularDomains?language=es&limit=50`，再把返回的域名/路径逐条套用既有快照 allowlist；不会把 API 返回内容当作新的授权来源。每个外部页面有 15 秒超时和正文大小限制，未抽取出合规文章时保留当前游标以便重试，不把网站首页简介伪装成文章候选。

策略快照中已经明确列出的非首页 URL 会优先于 API 返回的域名首页尝试；这只改变已授权 URL 的处理顺序，不增加 host、路径或自动发现范围。仍需通过正文结构、语言、哈希和审核门禁后才能进入发布流程。

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

报告只允许包含 `runId`、来源 stable key、步骤、状态、数量、耗时、稳定错误码和估算成本。禁止输出数据库 URL、API key、完整媒体 URL、正文、字幕、音频或长期签名播放地址。诊断记录使用内部 ID 和脱敏 metadata。

## 发布门禁

发布前必须重新校验 candidate revision/hash、来源权利、审核维度、内容版本和播放/阅读资产有效期。任何自动化成功都不等于发布成功；撤下必须移除公开投影和语料索引，保留必要审计记录。
