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
5. YouTube 视频不在本 ADR 中下载。除非后续确认下载和再分发权利、平台条款及存储预算，否则继续使用官方嵌入。

## 后果

本站播放不再依赖播客源站的短期签名 URL，代价是下载流量、Storage 容量和授权撤下运维。托管不是自动获得版权；每个对象必须能追溯到已审核版本和授权记录。

