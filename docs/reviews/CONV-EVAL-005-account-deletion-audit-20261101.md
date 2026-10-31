## CONV-EVAL-005：Auth 用户删除最终步骤审计（2026-11-01）

本次只做离线代码审计和隔离 PGlite 回归，没有调用 Supabase Admin API，也没有删除真实账户。

### 已验证

- `deleteOwnAccount` 与 owner deletion 共用同一编排：先设置 `deletion_requested_at` 和 `suspended`，再事务清理业务数据并保留 profile tombstone，之后调用 `AccountProvisioner.deleteUser`，最后删除 profile 并写一条 `user.delete` 审计。
- Supabase adapter 只接受服务端 `SUPABASE_SECRET_KEY`（兼容旧 `SUPABASE_SERVICE_ROLE_KEY`）；缺少 URL 或 secret 时 fail closed，不发请求。缺失 Auth 用户按幂等成功处理，其他 provider 错误映射为可重试失败。
- Auth 删除失败时业务数据已经清理、profile tombstone 和删除 marker 保留；重试可继续完成 Auth 删除，不提前写成功审计。
- 新增并验证并发收尾保护：若另一请求在 Auth 删除成功后先移除了 tombstone，当前请求把 `deleteAccountProfile=false` 视为幂等成功并跳过重复审计，不再把已完成删除报告成 503。
- 真实 Route Handler 的鉴权、确认短语、Idempotency-Key、`no-store` 响应和 503 fail-closed 分支均由隔离 PGlite route 测试覆盖。

### 测试结果

以下 6 个聚焦文件共 **52/52** 通过：

`tests/database/account-deletion.test.ts`、`tests/database/account-data-deletion.test.ts`、`tests/unit/account-http.test.ts`、`tests/unit/account-routes.test.ts`、`tests/unit/account-admin-application.test.ts`、`tests/unit/account-export-application.test.ts`。

覆盖了 self-service 与 owner deletion、profile tombstone、provider 失败后的重试、幂等重复删除、业务数据/证据/provider call 清理、导出脱敏、RLS 兼容的请求边界和凭据 fail-closed。该回归使用 fake provisioner/PGlite，不访问真实 Supabase 或真实数据库中的用户。

并发 tombstone 收尾回归另在 `tests/unit/account-admin-application.test.ts` 覆盖；本次相关账户聚焦集合实际为 **3 files / 37 tests** 通过，直接 TypeScript 与定向 ESLint 也通过。

### 未完成与结论

真实 Auth 最终删除仍未验收：执行它会对外部 Supabase 账号产生不可逆副作用，需要明确的测试账号和删除授权。当前证据足以证明本地编排和失败恢复设计，但不能证明真实 Auth 删除、真实登录态失效、删除后再次登录被拒绝或真实 Storage 清理已经完成。因此 CONV-EVAL-005 仍保持 `in_progress`，不能进入 007 或宣称整体可用。下一步应在独立、明确授权的测试账号上执行一次端到端删除并保存脱敏结果；在获得该授权前不调用真实删除 API。
