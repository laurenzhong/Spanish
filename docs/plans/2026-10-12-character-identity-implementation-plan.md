# 角色身份与修订解耦 · 实施计划

- 日期：2026-10-12
- 依据：`docs/adr/0014-character-identity-separate-from-revisions.md`
- 目标：让"修改圣经"不再需要迁移用户状态——新修订上线 = 插入修订行 + 翻转一次指针。
- 任务 ID 建议：`CHAR-IDENTITY-001`

## 0. 前置事实（已核实，勿重新假设）

- 修订行 id 现状被 9 张表引用：`character_canon_facts`、`character_relationships`、`conversations`、`messages`、`conversation_preferences`、`proactive_message_candidates`、`character_introduction_offers`(source/target)、`memory_sharing_permissions`(target)、`relationship_memories`。
- 用户状态 vs 版本内容的归属，已在 2026-10-12 的 v1→v2 迁移中确认：`character_canon_facts` 与 `profile.relationships` 属版本内容；其余属用户状态。
- 运行时当前版本来自 `src/modules/conversation/domain/character-catalog.ts` 的 `conversationCharacterVersion()`；路由只服务当前版本。
- 发布路径：`scripts/import-character.ts` → `scripts/publish-character.ts`（`--current=<path>` 提供上一版）。
- 现有一次性迁移脚本可复用其结构：`scripts/roll-character-version.ts`（dry-run 默认、单事务、逐表行数核对、未分类 FK 即中止）。

## 1. 切片（每片独立提交，前一片验证通过再进下一片）

### 切片 1：schema 迁移（向后兼容，可安全先上）
- 新增 `character_identities`（`id`、`stable_key` unique、`current_character_id` → `characters.id`、时间戳）。
- 给 7 张用户状态表加**可空** `identity_id`（`messages` 额外加 `identity_id`，保留 `character_id`）。
- 为 `(user_id, identity_id)` 等既有唯一约束建立对应的新唯一索引（与旧索引并存）。
- 回填脚本：每个 `stable_key` 建一条 identity（`current_character_id` = 当前 `published` 修订）；再按各行 `character_id` 所属修订的 `stable_key` 回填 `identity_id`。
- 验收：回填后 `identity_id` 无空值；`scripts/roll-character-version.ts` 的等价盘点脚本显示 `character_id` 与 `identity_id` 一一对应。

### 切片 2：仓库改读身份（写路径仍双写）
- 改读：`getOrCreateConversation`、会话列表/预览、`drizzle-lucia-contact-repository`、`conversation_preferences`、`proactive_message_candidates`、`introduction` 仓库、`privacy` 仓库、`memory` 仓库。
- 写路径双写 `identity_id` + `character_id`，保证回滚可用。
- **联系人仓库必须整体切换**：它的 `get()` 从角色行出发 JOIN 关系与会话；改为从 identity 出发后不再依赖版本，`CONTACT_REQUIRED` 卡死风险随之消失。
- 测试：`tests/database/*` 逐一更新，新增"identity 与修订不一致时失败关闭"的用例。

### 切片 3：发布流程维护指针
- `publish-character-bible.ts`：发布成功后在同一事务内更新 `identity.current_character_id`；若该 `stable_key` 尚无 identity 则创建。
- `import-character-bible.ts`：导入新修订时确保 identity 存在（但不移动指针——指针只由发布移动）。
- 验收测试：发布 v3 后，`current_character_id` 指向 v3，且**没有任何用户状态行被写入**（用行数/时间戳断言）。

### 切片 4：去掉双写与旧列
- 迁移期结束后：把 `identity_id` 置非空，删除用户状态表上的 `character_id`（`messages.character_id` 保留为审计来源）。
- 删除已无用的旧唯一索引。
- 验收：全套 DB 测试 + `pnpm test:e2e` + 生产构建。

### 切片 5：文档与运行手册
- `docs/architecture.md`、`docs/database.md` 更新身份/修订模型。
- 新增"发布新修订"的三步运行手册（导入 → 发布 → 指针已在发布事务内完成），替换掉本次 v1→v2 的一次性迁移做法。
- `PROJECT_STATUS.md` 记录 `scripts/roll-character-version.ts` 从此不再是"每次升版必跑"的脚本，仅用于历史纠正。

## 2. 本次已完成的相关前置（不要再做一遍）

- `lucia@2` 已发布，99 行用户状态已迁到 v2，v1 保留版本内容。
- 运行时/路由/协议/客户端已改为从目录取当前版本；陈旚客户端会得到 404 而不是新建空会话。
- 发布门禁已支持传入上一版（`current` / `currentRevisions`）。

## 3. 已知风险与回滚

| 风险 | 处置 |
|---|---|
| 联系人门禁在切换中途返回 403 | 切片 2 必须"查询与数据同一步"；先在本地库跑通 `lucia-contact-gate` 与 route 测试，再碰生产库 |
| 指针指向未发布修订 | 指针更新与发布同一事务；读取路径校验 `status = published` |
| 回填漏表 | 复用 `roll-character-version.ts` 的"information_schema 未分类 FK 即中止"检查 |
| 回滚 | 切片 4 之前，旧列仍在、双写仍在；回滚 = 读路径切回 `character_id` |

## 4. 完成定义

- 新增一个修订并发布后，用户状态零改动即可生效（有测试证明）。
- 仓库中不再存在按 `characterVersion` 硬编码的读路径。
- `docs/` 与状态页同步；`pnpm typecheck` / 聚焦测试 / `pnpm test:e2e` 通过。
