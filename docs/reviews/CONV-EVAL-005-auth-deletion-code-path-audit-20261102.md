# CONV-EVAL-005：Auth 删除代码路径与 Storage 清理审计（2026-11-02）

本切片是零费用、只读代码审计；没有读取密钥值、调用 Supabase Admin API、列出用户、删除账号、写真实数据库或 dispatch workflow。

## 当前代码路径

`DELETE /api/v1/me/account` 与 owner deletion route 都组装同一套 `runAccountDeletion` 依赖：

1. 标记 `deletion_requested_at` 并暂停账户，立即阻断后续业务访问。
2. 在事务内清理业务数据并保留 profile tombstone；记录 profile avatar 与 audio asset 的 Storage cleanup task。
3. 通过 `createSupabaseStorageObjectDeleter` 按 bucket 分组删除对象；缺少 `SUPABASE_SECRET_KEY`/旧 service-role key 或删除失败时 fail closed，任务标为 `failed` 并写入去重诊断事件，保留重试路径。
4. 通过 `createSupabaseAccountProvisioner` 调用 Auth `admin.deleteUser`；远端 404/missing user 按幂等成功处理，其他错误保留 tombstone 并返回可重试的 503。
5. Auth 删除成功后删除 profile tombstone，再写一次 `user.delete` audit；并发重试不会重复审计。

代码路径核验确认 Storage 清理覆盖 `profile-avatars` 和用户音频资产，Auth 删除失败不会被误报为成功，且业务清理、Storage 失败和 Auth 失败均有可重试边界。

## 离线验证

- `tests/database/account-deletion.test.ts`
- `tests/database/account-data-deletion.test.ts`
- `tests/unit/account-http.test.ts`
- `tests/unit/account-routes.test.ts`
- `tests/unit/account-export-application.test.ts`

结果：**5 files / 35 tests passed**，单 worker 19.67s。未调用真实 provider、Supabase Admin API 或真实 Storage。

## 结论与缺口

本切片关闭了“Auth 删除代码顺序、Storage 清理任务和失败重试边界”的离线审计，不关闭 `CONV-EVAL-005`。仍缺独立测试账号及删除授权、真实 Auth 用户消失、删除后旧 session 登录失效、真实 Storage 对象清理和 production pin workflow 生命周期证据。既有评估归档路径保持不变，没有新增收费归档。
