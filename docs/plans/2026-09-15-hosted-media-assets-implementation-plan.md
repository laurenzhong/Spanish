# 授权媒体资产托管实施计划

## HOSTED-MEDIA-001：授权播客托管

### 目标

将已审核、已发布且明确授权的 Language Reactor 播客复制到 Supabase Storage，使用稳定本站资产 URL 播放；源站失效时不再影响已托管对象。

### 范围

- 新增服务端 `MediaAssetStorage` provider 与 Supabase 实现。
- 下载校验 HTTPS、allowlist、音频 MIME、Content-Length/Range 上限和完整响应。
- 幂等对象路径 `media/{stableKey}/{version}/audio`，上传成功后原子更新 `media_assets`。
- 失败清理、撤下后的公开投影和脱敏日志。
- 为现有两条 Language Reactor 播客提供一次性所有者脚本和 Playwright/单元回归。

### 不在范围

- YouTube 下载或转码。
- ASR、翻译、字幕生成和词句索引。
- 通用 CMS、用户上传媒体和公开 Storage 管理界面。

### 验收

- 已托管对象使用稳定 URL 且 `playbackExpiresAt=null`。
- 重复运行不重复上传或创建版本。
- 下载、校验、上传、数据库更新任一步失败都不会留下不可追踪的对象。
- 播客源站返回 404/410 后，详情页仍能通过本站 Storage 播放。
- 不记录签名 URL、令牌或音频正文。

