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

### 2026-09-16 已批准的方案二与当前子切片

19:15 接续：官方下载路线已恢复，所有者指定今后视频下载统一使用 yt-dlp。新增 `content:recover-youtube-to-bunny`，按最高原生分辨率与西语音轨恢复剩余来源，完整 source/output 解码、CDN 哈希与实播之后条件切换；不再把浏览器接管作为下载前提。首条恢复已完成，其余 9 条批处理正在执行；最终验收必须核对全部 20 条视频、2 条播客的当前资产、完整性证据、网站实播与 Supabase 精确清理，不能只验收先前的 10 条视频。阶段性计数统一见任务交接及实时数据库。

视频目标调整为 Bunny Storage + Pull Zone，使用服务端预转码 MP4，不等待 Bunny Stream 编码；播客另行核对，不计为本轮视频迁移完成量。下述原 Supabase 范围作为历史实现保留。

1. 补齐 Bunny 视频无租约的数据库支持与迁移回归；复用已验证的首条哈希对象，条件切换原资产。
2. 补齐批量脚本的完整下载、严格解码、长度/哈希、CDN 播放校验与可恢复清单，再迁移其余现有托管视频；禁止只凭上传 HTTP 成功批量改库。
3. 检查网站真实播放和所有历史引用后，精确清理可删除的 Supabase 原对象；来源恢复或重新采集不得自动发布新候选。

2026-09-16 当前结果：原 Supabase 的 10 条视频均完成迁移、10/10 网站实播与 seek、两个历史引用迁移以及旧对象删除；独立查询确认 media-video bucket 为空。另 10 条 YouTube 视频尚未迁移，至少一条已在 Chrome 实播，下载器错误不能证明源站下架。播客两条均已迁移并完成页面复测，整体方案仍缺剩余视频。详见 [任务交接](../tasks/HOSTED-MEDIA-002.md)。既有低分辨率文件迁移不等于画质升级；高画质仍需要合格的授权原文件或重新采集来源。

批量迁移现使用 `pnpm content:migrate-hosted-videos-to-bunny`：授权确认、单进程锁、来源主机/大小/ETag/精确 Range、完整解码、H.264/AAC 转码、时长一致、哈希路径、CDN 全文件哈希及 Chrome 实播/seek 后才条件切换；失败保留原资产，局部文件和清单在 `.tmp-runtime/bunny-hosted-migration` 供核查恢复。清理入口 `node --import tsx/esm scripts/cleanup-migrated-supabase-videos.ts` 默认 dry-run；需网站证明与 CDN 再校验，并显式设置 `MEDIA_VIDEO_CLEANUP_CONFIRM=DELETE_VERIFIED_SUPABASE_VIDEO_OBJECTS` 才执行精确清理。网站隔离验收使用真实数据库/媒体、测试登录身份并拦截浏览器写请求，不代表真实用户身份或进度写入已验收。

2026-09-16 17:03 更新：同一方案的播客子切片已完成。两条已授权播客均已复制到 Bunny、校验原字节哈希与真实音频播放并条件切换；两条网站页面最终复测通过。Supabase 音频历史引用已迁移，音频/视频桶均无剩余对象。保留首次页面复测的一次加载超时记录。该切片不处理字幕、词句或学习评分；余下 10 条 YouTube 视频仍需恢复完整授权源并迁移，不计为方案二整体完成。

### 目标

将已确认下载/再分发授权、已发布且版权状态为 `cleared` 的 YouTube 视频复制到 `media-video`，让详情页使用 Plyr 包装的 MP4 播放器，不再依赖用户网络访问 YouTube。

### 范围

- 扩展 Supabase Storage provider，支持视频对象和 MIME/大小上限。
- 新增 `pnpm content:host-authorized-youtube-video` 一次性回填脚本；运行必须显式设置 `MEDIA_VIDEO_HOSTING_CONFIRM=I_HAVE_AUTHORIZATION`，并依赖调用环境提供 `yt-dlp` 与 ffmpeg。
- 上传成功后原子切换既有视频资产为 `kind=video`、稳定 Bunny MP4 URL、`playbackExpiresAt=null`；失败不进入公开投影，保留来源审计记录但不保留可播放的 YouTube fallback。
- 详情工作台增加 Plyr 视频适配器，保留字幕、逐句控制和进度同步。

### 不在范围

- 绕过 YouTube 访问控制、DRM 或地区限制。
- 自动扩大到未确认授权的频道、用户上传媒体或通用下载服务。
- 在当前网络无法访问 YouTube 时声称已经完成视频回填。

### 验收

- 托管资产通过稳定 `media-video` URL 返回浏览器可播放的 MP4，并在详情页使用 Plyr 控制器包装 `<video controls>`。
- 重复运行只处理仍为可迁移来源资产的行；成功后只返回 Bunny MP4，年龄/访问限制归档并撤回来源资产，其他失败不改变公开投影。
- Playwright 验证 hosted video 的 Plyr 控制器、字幕交互和进度回调；视频不再回归到 YouTube 嵌入路径。
