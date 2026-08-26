# 数据库与迁移

本文描述个人 Alpha 的 PostgreSQL 数据基础。PostgreSQL 是学习证据、画像、内容版本、角色关系和记忆权限的权威来源；Web 与 Flutter 客户端都不能把本地状态当作能力事实。

## 1. 当前边界

ALPHA-003 建立 Supabase PostgreSQL / Drizzle 基础；ALPHA-004 在第二版迁移中补齐 Auth 生命周期和 RLS：

- 模块化 Drizzle Schema。
- 首版向前迁移和迁移元数据。
- 服务端惰性数据库连接。
- 空 PostgreSQL 数据库迁移测试。
- `evidence_events` 的应用角色只追加权限基线。
- Supabase Auth 邮箱会话。
- `profiles.id` 与 `auth.users.id` 的生命周期绑定。
- 全部用户私有表的 RLS 策略和跨用户隔离测试。
- Web 与 Flutter 的访问令牌传递。

新 Auth 用户由数据库触发器自动建立 `profiles` 和 `user_preferences`。私有表默认拒绝跨用户访问，客户端没有证据、画像、关系记忆、供应商调用和幂等记录的直接写权限。公开内容也只有在已发布且审核通过时可见。

迁移和 RLS 可在隔离的 PostgreSQL/PGlite 测试环境中验证；托管 Supabase 上线前仍需在目标项目执行迁移、检查 Auth 邮件模板/限流，并进行一次真实项目的策略验收。

## 2. 文件与所有权

- `src/shared/db/client.ts`：只供服务端使用的 PostgreSQL/Drizzle 连接入口。
- `src/shared/db/schema/users.ts`：用户资料与偏好。
- `src/shared/db/schema/content.ts`：沟通能力、表达、场景、内容包、阅读文章和审核。
- `src/shared/db/schema/training.ts`：训练会话、尝试、会话断点和有效活动事件。
- `src/shared/db/schema/evidence.ts`：只追加证据与可重算画像快照。
- `src/shared/db/schema/characters.ts`：人物设定、关系、对话、消息与记忆权限。
- `src/shared/db/schema/infrastructure.ts`：音频、供应商调用、幂等键和隐私 Storage 清理任务。
- `drizzle/`：版本化 SQL 迁移、快照和迁移日志。

READ-001 新增 `articles`、`article_versions`、`article_sources`、`article_segments` 和 `article_assets` 表族。文章版本以 `(article_id, version)` 唯一，保存规范化内容哈希、版权来源、段落和资产声明；公开 RLS 只允许已发布且在 `content_reviews` 中获批的文章版本及其从属行。文章关联的表达、目标和标签作为稳定 key 快照保存，阅读数据不写入 `evidence_events`、`user_skill_states` 或 `user_scene_states`。

READ-002 的 `GET /api/v1/content/articles` 只返回已发布文章的卡片 DTO，使用服务端分页、主题和搜索过滤；不会把文章正文或用户阅读状态放入列表响应。当前 bundle 只有 draft 文章，因此 Web 与 Flutter 均显示可解释的空状态。

ALPHA-005 新增 `content_bundle_imports` 作为服务端导入登记表，保存 bundle 稳定 ID、版本、规范化内容哈希和实体数量。该表不向 `anon` 或 `authenticated` 开放。`expression_tags.scoring` 区分能力权值与元数据标签；`content_sources` 增加版权状态和内部审核说明。

业务模块后续只能通过 repository/application 边界访问自己拥有的表，不能把 Drizzle 行类型直接扩散到 UI、Flutter 或公共 API。

ALPHA-028 的 `relationship_memories.fact_key` 是用户与角色范围内的稳定事实键，用于在事务中判定重复与冲突；冲突候选追加为 `conflict`，不会覆盖旧记忆。`share_scope` 默认保持 `private`，跨角色读取必须同时存在用户明确授予的 `memory_sharing_permissions` 记录。

ALPHA-030 的 `character_introduction_offers` 保存 Lucía 触发的好友介绍提议、可解释理由、用户决策和接受时明确授权的记忆 ID。提议以 `(user_id, offer_key)` 幂等；接受事务同时确保目标角色的 `character_relationships` 与 `conversations`，并只为通过服务端校验的非私密记忆写入目标角色共享权限。该表只向用户开放自己的 `SELECT`，创建、解决和授权必须经过服务端 application。隐私 UI 只读取服务端生成的非私密资料预览；撤销授权会关闭指定目标角色的权限，最后一条授权撤销后记忆恢复为 `private`。角色发布通过 `publishCharacterBibles` 事务完成，并在已有 `content_reviews` 中记录语言、教学和 canon 三项审核；个人 Alpha 暂时允许项目所有者授权 `codex-ai-temporary-review`，记录明确标注仍建议后续补充真人审核。

7.5a 在 `provider_calls` 中保存服务端生成或透传的 `request_id`，以及可选的学习会话、尝试、对话和 generation 关联 ID；`error_type` 只保存稳定错误码。`provider_calls` 仍没有客户端写策略，观测记录由服务端 repository 写入；调用记录不保存输入正文、音频内容、令牌或签名 URL。账号删除继续将其 `user_id` 置空并替换 metadata 为匿名标记，关联 ID 不用于恢复用户身份。

7.5b 新增 `diagnostic_events` 作为不可变业务诊断事件表。`dedupe_key` 唯一约束抑制重复告警；`event_type`、`severity` 和 `status` 通过数据库 CHECK 限定；`request_id`/session/attempt/conversation/generation 只作为关联线索。该表启用 RLS 并撤销 `anon`/`authenticated` 的全部权限，只有服务端 repository 可以写入和查询。用户删除时 `user_id` 置空，事件保留为不含身份的运维事实。

## 3. 连接配置

复制 `.env.example` 为本地 `.env`，不要提交真实值：

```text
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

- `DATABASE_URL` 用于应用运行时；托管 Supabase 环境优先使用 transaction pooler。
- `DIRECT_DATABASE_URL` 用于迁移；应使用直接 PostgreSQL 连接。
- Drizzle 命令在没有环境变量时只回退到 Supabase CLI 的本机默认端口 `127.0.0.1:54322`，不会回退到任何远程环境。
- 浏览器和 Flutter 代码不得读取这两个变量；它们不能使用 `NEXT_PUBLIC_` 前缀。
- `NEXT_PUBLIC_SUPABASE_*` 只包含公开项目标识和 publishable key；service role key 永远不能使用公开前缀或进入客户端构建。

## 4. 迁移工作流

修改 Schema 后执行：

```powershell
pnpm db:generate
pnpm db:check
pnpm test --run tests/database
```

检查生成 SQL 和快照后，才可对明确指定的本地或测试数据库执行：

```powershell
pnpm db:migrate
```

规则：

- 已提交迁移只向前追加，不重写已部署历史。
- 不手工修改远程数据库来绕过迁移。
- 不把生产 URL、数据库密码、Supabase service role key 或真实数据写入仓库。
- `drizzle-kit generate` 必须在同一 Schema 上得到“无变化”，避免代码与迁移漂移。
- 第二版迁移同时从上一版本顺序执行；RLS 测试创建模拟 `anon` / `authenticated` 身份验证最小权限。

## 5. 数据不变量

- 用户私有表包含 `user_id`、`created_at` 和 `updated_at`；`profiles.id` 本身就是用户 ID。
- `evidence_events` 只追加。首版迁移在 Supabase 角色存在时撤销 `anon` 和 `authenticated` 的 `UPDATE` / `DELETE` 权限。
- `user_skill_states` 与 `user_scene_states` 是可重算快照，不能替代原始证据。
- 尝试、证据和角色消息包含稳定客户端 ID、幂等键或 generation 标识，后续重试不能重复写入事实。
- `practice_session_activity_events` 只保存服务端接收时间、客户端实例不透明 ID、序号和生命周期事件；`(session_id, client_instance_id, sequence)` 幂等，活动间隔由服务端领域函数保守聚合。
- 内容和人物设定保存版本；已经产生学习证据的版本不得静默覆盖。
- 普通录音使用 `audio_assets.retention_policy` 表达生命周期，真正的存储删除流程在语音任务中实现。
- 关系记忆只保存抽取后的短事实值及来源 ID，不保存完整私聊正文；完整 `done` 消息轮之外不得创建记忆候选。
- 介绍提议拒绝或过期不创建联系人；每个角色独立维护关系阶段和揭示状态，介绍不会自动共享教学画像或其他角色的私密记忆。

## 6. RLS 策略摘要

- 用户可以读取自己的训练、证据、画像、关系、对话、消息和音频记录，但不能读取其他用户的数据。
- 用户只可有限更新自己的资料和偏好。
- `evidence_events`、技能/场景快照、关系记忆、`provider_calls` 和 `idempotency_keys` 没有客户端写策略；写入必须经过服务端 application 层。
- `practice_session_activity_events` 只能通过活动 application 写入；客户端只读策略不开放插入、更新或删除。
- 关系记忆只能通过服务端 application 查看和删除；删除 `relationship_memories` 会级联清理 `memory_sharing_permissions`，客户端不能直接写入或绕过用户所有权检查。
- 7.4b 只向用户展示非 `ephemeral` 的 `audio_assets` 和 speech 尝试中的转写文本；录音删除使用 `deleted_at` 软删除，转写删除清空 `practice_attempts.response_text`，两者都保留证据历史。账号级删除的 Storage 对象清理由 7.4c 的专用 storage deleter 和可重试任务负责。
- 7.4c 的账号数据删除由服务端事务执行：先删除 `evidence_events` 解除 `practice_attempts` 的 restrict 引用，再删除 `profiles` 触发用户私有表级联；`provider_calls` 在 profile 删除前置空 `user_id` 并替换 metadata 为匿名标记。`privacy_cleanup_tasks` 不含 `user_id`，只保存待清理的 bucket/path、状态、尝试次数和脱敏错误，RLS 对客户端完全关闭。
- `diagnostic_events` 不开放客户端读写；内部查询只返回去掉 `user_id` 和 `dedupe_key` 的诊断投影。
- 表达、场景、内容包和角色必须同时满足已发布与审核通过才能公开。
- 变体、任务和内容片段通过可见的父内容继承读取权限。
- 敏感人物固定事实不通过公开客户端角色暴露。
- 介绍提议只允许读取自己的提议；客户端不能直接插入或解决提议，也不能直接写角色关系和记忆共享权限。
- 内容导入哈希、许可证据和内部审核说明保持服务端可见；公开客户端只能读取安全的来源署名与版权状态列。

RLS 是纵深防御而不是唯一授权层。Route Handler 仍需验证用户，并对资源执行服务端所有权和业务权限检查。
