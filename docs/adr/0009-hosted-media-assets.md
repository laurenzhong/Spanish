# ADR-0009: Host Authorized Media Assets

- 日期：2026-09-15
- 状态：Accepted
- 影响：media 播放资产、Language Reactor 播客可靠性、Storage 运维

## 背景

媒体目录此前保存第三方 enclosure 或签名播放 URL。本站代理可以隐藏来源并转发 Range，但不能在源站删除、签名过期或用户网络无法访问时继续播放。

## 决定

1. 对明确授权且已发布的播客，下载时执行 HTTPS、主机、MIME、大小和响应完整性校验后，复制到专用 Supabase Storage bucket `media-audio`。
2. 公开已发布媒体使用稳定的 Supabase public object URL；`media_assets.playback_expires_at` 设为 `NULL` 只表示本站对象没有租约，不表示来源授权永久不可撤回。
3. Storage 对象路径使用 `media/{stableKey}/{version}/audio`，不包含邮箱、令牌或原始签名参数。原始第三方 URL 继续只保留在服务端数据库审计字段，不进入客户端和普通日志。
4. 上传失败不得更新数据库；数据库更新失败必须删除刚上传对象。撤下媒体时先移除公开投影，Storage 对象保留到明确的清理任务执行，以保留历史版本和可审计性。
5. 在项目所有者明确确认下载、再分发权利、平台条款和存储预算后，已发布的 YouTube 视频可以通过一次性服务端回填复制到专用 Supabase Storage bucket `media-video`。回填只接受已发布且版权状态为 `cleared` 的视频，使用受控 `yt-dlp`/ffmpeg 管线生成浏览器兼容 MP4；成功后把同一 `media_assets` 行切换为 `kind=video` 和稳定本站 URL，失败时保留原官方嵌入，不自动发布或伪造托管成功。
6. 托管视频详情页使用原生 `<video>` 播放器和现有字幕/进度工作台；官方嵌入只作为未托管视频的降级路径。对象路径使用 `media/{stableKey}/{version}/video.mp4`，不包含令牌或签名参数。

## 后果

本站播放不再依赖已托管媒体的第三方网络可达性，代价是下载流量、视频转码、Storage 容量和授权撤下运维。托管不是自动获得版权；每个对象必须能追溯到已审核版本和授权记录。若下载源当前网络不可达，回填任务只能报告失败，不能通过代理绕过平台访问限制。
