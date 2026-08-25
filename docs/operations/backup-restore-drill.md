# Alpha 数据库备份与恢复演练

本文是个人 Alpha 的可执行演练说明，不代表已经在生产项目完成演练。任何恢复操作必须使用隔离的 Supabase 项目或 PostgreSQL 实例，禁止覆盖生产数据库。

## 目标

- 目标 RPO：24 小时。至少每天确认一次托管 PostgreSQL 备份可用。
- 目标 RTO：4 小时。恢复后先完成权限和关键路径验收，再恢复业务流量。
- 数据库是学习证据、画像、关系记忆和消息的权威来源；Storage 音频对象不包含在 PostgreSQL dump 中，必须单独确认其备份或接受恢复限制。

## 演练前检查

1. 在 Supabase 项目设置中确认数据库备份计划、最近成功时间和保留期限；记录时间戳，不把连接串或密钥写入演练记录。
2. 准备隔离项目和一次性数据库连接。使用 `DIRECT_DATABASE_URL`，只从未提交的环境变量读取凭据。
3. 确认当前仓库迁移通过 `pnpm db:check`，并记录待恢复的迁移版本。
4. 准备脱敏验收样本：一名测试用户、一个训练会话、一个证据事件、一条关系记忆和一段消息元数据；不要复制真实录音或完整私密对话。

## PostgreSQL 演练步骤

以下命令只允许对隔离数据库执行。路径应指向临时目录，dump 完成后按组织策略删除或加密保存。

```powershell
pg_dump --format=custom --no-owner --no-acl --file="$env:TEMP\sueno-alpha-drill.dump" "$env:DIRECT_DATABASE_URL"
pg_restore --clean --if-exists --no-owner --dbname="$env:DRILL_DATABASE_URL" "$env:TEMP\sueno-alpha-drill.dump"
pnpm db:check
```

恢复后依次验证：

1. `information_schema` 中的表、索引、约束和迁移记录与仓库版本一致。
2. `anon` / `authenticated` 无法直接写 `evidence_events`、`provider_calls`、`diagnostic_events`、关系记忆和 Storage 清理任务。
3. 用户 A 只能读取自己的训练、证据、画像、关系、对话和消息；用户 B 的记录不可见。
4. 证据追加、重复证据幂等、记忆冲突记录和 `diagnostic_events` 去重约束仍有效。
5. Web 登录、继续学习、聊天完成流和账号数据摘要可以在隔离环境中完成。

## Storage 限制

`audio_assets` 只保存 bucket/path 元数据，PostgreSQL 恢复不会自动恢复对象内容。若项目未启用经过验证的 Storage 备份，恢复验收必须明确标记“数据库已恢复、音频对象未恢复”；不得用数据库中的路径伪造音频可用状态。账号删除产生的 `privacy_cleanup_tasks` 仍应保持可重试，清理器不得因为恢复演练重复删除无关对象。

## 记录模板

```text
演练日期：
执行人：
源项目/隔离项目：
最近备份时间：
备份版本或文件校验值：
恢复开始/完成时间：
实际 RPO/RTO：
迁移版本：
RLS 验证：通过 / 失败
关键路径验证：通过 / 失败
Storage 状态：已验证 / 未恢复 / 不适用
发现的问题与后续任务：
```

演练失败时保留结构化失败原因和时间，不记录数据库密码、访问令牌、签名 URL、原始录音或完整私密内容。
