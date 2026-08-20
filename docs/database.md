# 数据库与迁移

本文描述个人 Alpha 的 PostgreSQL 数据基础。PostgreSQL 是学习证据、画像、内容版本、角色关系和记忆权限的权威来源；Web 与 Flutter 客户端都不能把本地状态当作能力事实。

## 1. 当前边界

ALPHA-003 只建立 Supabase PostgreSQL / Drizzle 基础：

- 模块化 Drizzle Schema。
- 首版向前迁移和迁移元数据。
- 服务端惰性数据库连接。
- 空 PostgreSQL 数据库迁移测试。
- `evidence_events` 的应用角色只追加权限基线。

以下内容由 ALPHA-004 完成：

- Supabase Auth 邮箱会话。
- `profiles.id` 与 `auth.users.id` 的生命周期绑定。
- 全部用户私有表的 RLS 策略和跨用户隔离测试。
- Web 与 Flutter 的访问令牌传递。

因此，当前迁移可在普通空 PostgreSQL 中验证，但还不能被描述为完整认证或生产安全配置。

## 2. 文件与所有权

- `src/shared/db/client.ts`：只供服务端使用的 PostgreSQL/Drizzle 连接入口。
- `src/shared/db/schema/users.ts`：用户资料与偏好。
- `src/shared/db/schema/content.ts`：沟通能力、表达、场景、内容包和审核。
- `src/shared/db/schema/training.ts`：训练会话、尝试和断点。
- `src/shared/db/schema/evidence.ts`：只追加证据与可重算画像快照。
- `src/shared/db/schema/characters.ts`：人物设定、关系、对话、消息与记忆权限。
- `src/shared/db/schema/infrastructure.ts`：音频、供应商调用和幂等键。
- `drizzle/`：版本化 SQL 迁移、快照和迁移日志。

业务模块后续只能通过 repository/application 边界访问自己拥有的表，不能把 Drizzle 行类型直接扩散到 UI、Flutter 或公共 API。

## 3. 连接配置

复制 `.env.example` 为本地 `.env`，不要提交真实值：

```text
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...
```

- `DATABASE_URL` 用于应用运行时；托管 Supabase 环境优先使用 transaction pooler。
- `DIRECT_DATABASE_URL` 用于迁移；应使用直接 PostgreSQL 连接。
- Drizzle 命令在没有环境变量时只回退到 Supabase CLI 的本机默认端口 `127.0.0.1:54322`，不会回退到任何远程环境。
- 浏览器和 Flutter 代码不得读取这两个变量；它们不能使用 `NEXT_PUBLIC_` 前缀。

## 4. 迁移工作流

修改 Schema 后执行：

```powershell
pnpm db:generate
pnpm db:check
pnpm test --run tests/database/schema.test.ts
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
- 跨版本升级和 RLS 测试在拥有第二版迁移后补充；首版当前验证从空库执行。

## 5. 数据不变量

- 用户私有表包含 `user_id`、`created_at` 和 `updated_at`；`profiles.id` 本身就是用户 ID。
- `evidence_events` 只追加。首版迁移在 Supabase 角色存在时撤销 `anon` 和 `authenticated` 的 `UPDATE` / `DELETE` 权限。
- `user_skill_states` 与 `user_scene_states` 是可重算快照，不能替代原始证据。
- 尝试、证据和角色消息包含稳定客户端 ID、幂等键或 generation 标识，后续重试不能重复写入事实。
- 内容和人物设定保存版本；已经产生学习证据的版本不得静默覆盖。
- 普通录音使用 `audio_assets.retention_policy` 表达生命周期，真正的存储删除流程在语音任务中实现。

RLS 是下一任务的强制安全边界。在其完成前，不建立允许客户端直连私有表的产品流程。
