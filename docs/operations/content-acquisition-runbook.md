# 内容供应运行手册

## 范围

每日任务只从已启用且权利状态为 `verified` 的白名单来源发现候选，并推进到审核库。文章可按 ADR-0010 的受保护分阶段策略进入自动审核/发布；视频和播客只允许 `disabled → discover-only → review-only`，最多推进到 `review_ready`，不会自动公开。媒体仍必须由所有者在“我的 → 内容工作流”完成三维审核和显式发布。

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

媒体每日运行使用 `pnpm content:media-daily -- --mode <disabled|discover-only|review-only>`，受 `CONTENT_MEDIA_DAILY_LIMIT`（全局，最大 50）和 `CONTENT_MEDIA_SOURCE_LIMIT`（单来源，最大 50）约束。该命令只选择 `youtube`、`podcast-rss` 或已登记的 `language-reactor` 的 `enabled=true`、`rights_status=verified` 来源，并在报告中显式列出因权利未验证而跳过的媒体来源。`language-reactor` 只允许已验证的西语视频/播客目录和其来源策略中指定的 API、媒体主机；适配器不会从页面或 API 响应扩大 allowlist。它不接受 `auto-publish`，没有媒体自动发布 kill switch，也不能替代所有者发布操作。

Readlang 页面来源使用 `adapter_type=readlang-links`、`source_kind=article-site`，`external_source_id` 必须精确为 `https://readlang.com/es/links`，`rights_status=verified`，并在 `rights_policy` 保存 `readlang-links-v2.json` 的 `policyVersion`、精确 URL 快照和授权证据。该适配器只读取快照 URL；页面新增 URL 或主机前不得自动采集。`automatedPublication.enabled` 仍为 `false`，所以该来源最多进入 `review-only`，不能绕过分阶段门禁直接发布。

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
