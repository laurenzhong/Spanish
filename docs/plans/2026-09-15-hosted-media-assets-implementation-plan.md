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

## HOSTED-MEDIA-002：授权视频托管

### 目标

将已确认下载/再分发授权、已发布且版权状态为 `cleared` 的 YouTube 视频复制到 `media-video`，让详情页使用原生 MP4 播放器，不再依赖用户网络访问 YouTube。

### 范围

- 扩展 Supabase Storage provider，支持视频对象和 MIME/大小上限。
- 新增 `pnpm content:host-authorized-youtube-video` 一次性回填脚本；运行必须显式设置 `MEDIA_VIDEO_HOSTING_CONFIRM=I_HAVE_AUTHORIZATION`，并依赖调用环境提供 `yt-dlp` 与 ffmpeg。
- 上传成功后原子切换既有视频资产为 `kind=video`、稳定本站 URL、`playbackExpiresAt=null`；失败清理对象并保留官方嵌入。
- 详情工作台增加原生视频适配器，保留字幕、逐句控制和进度同步。

### 不在范围

- 绕过 YouTube 访问控制、DRM 或地区限制。
- 自动扩大到未确认授权的频道、用户上传媒体或通用下载服务。
- 在当前网络无法访问 YouTube 时声称已经完成视频回填。

### 验收

- 托管资产通过稳定 `media-video` URL 返回浏览器可播放的 MP4，并在详情页使用 `<video controls>`。
- 重复运行只处理仍为 `official_embed` 的行，失败不改变数据库资产。
- Playwright 验证 hosted video 的原生播放器、字幕交互和进度回调；官方嵌入回归继续通过。
