# 角色身份与修订解耦 · 实施计划

- 日期：2026-10-12（2026-10-13 更新切片状态）
- 依据：`docs/adr/0014-character-identity-separate-from-revisions.md`
- 目标：让"修改圣经"不再需要迁移用户状态——新修订上线 = 插入修订行 + 翻转一次指针。
- 任务 ID 建议：`CHAR-IDENTITY-001`
- 分支：`codex/disable-legacy-readlang`
- 运行手册：`docs/operations/character-revision-runbook.md`

## 0. 前置事实（已核实，勿重新假设）

- 修订行 id 现状被 9 张表引用：`character_canon_facts`、`character_relationships`、`conversations`、`messages`、`conversation_preferences`、`proactive_message_candidates`、`character_introduction_offers`(source/target)、`memory_sharing_permissions`(target)、`relationship_memories`。
- 用户状态 vs 版本内容的归属，已在 2026-10-12 的 v1→v2 迁移中确认：`character_canon_facts` 与 `profile.relationships` 属版本内容；其余属用户状态。
- 运行时当前版本来自 `src/modules/conversation/domain/character-catalog.ts` 的 `conversationCharacterVersion()`；路由只服务当前版本。
- 发布路径：`scripts/import-character.ts` → `scripts/publish-character.ts`（`--current=<path>` 提供上一版）。
- 现有一次性迁移脚本可复用其结构：`scripts/roll-character-version.ts`（dry-run 默认、单事务、逐表行数核对、未分类 FK 即中止）。

## 1. 切片（每片独立提交，前一片验证通过再进下一片）

### 切片 1：schema 迁移（向后兼容，可安全先上）——✅ 已完成

- Commit `9e67a38`（2026-10-12），已推送到 `codex/disable-legacy-readlang`。
- 新增 `character_identities`（`id`、`stable_key` unique、`current_character_id` → `characters.id`、时间戳）。
- 给 7 张用户状态表加**可空** `identity_id`（`messages` 额外加 `identity_id`，保留 `character_id`）；实际落地为 **9 个 `identity_id` 列**（`character_introduction_offers` 的 source/target 与 `memory_sharing_permissions.target` 各一列），每列带索引与 RESTRICT 外键，**未删改任何既有列/索引/约束**。
- 唯一性处理与原文表述不同：**没有**在切片 1 建立 `(user_id, identity_id)` 唯一索引，只建了**非唯一**身份索引；当前写路径因此依赖显式 identity-keyed upsert 维持唯一性，对应唯一索引推迟到切片 4。
- 迁移 `drizzle/0045_lumpy_medusa.sql` 已**应用到线上库**；回填脚本 `scripts/backfill-character-identities.ts`（默认 dry-run、`--apply` 单事务、逐表核对行数）实跑：3 条身份（lucia、ines、mateo），用户状态置 `identity_id` **合计 111 行**（会话 3 / 消息 93 / 偏好 3 / 候选 7 / 关系 3 / 记忆 0 / 共享权限 0 / 介绍提议 2，其中介绍提议只按 source 计一次），**0 行遗留 null，复跑幂等（0 创建 / 0 更新）**。
- 验收：回填后 `identity_id` 无空值；`scripts/roll-character-version.ts` 的等价盘点脚本显示 `character_id` 与 `identity_id` 一一对应。

### 切片 2：仓库改读身份（写路径仍双写）——✅ 已完成

- Commit `b041393`（2026-10-12），已推送。
- 改读：`getOrCreateConversation`、会话列表/预览、`drizzle-lucia-contact-repository`、`conversation_preferences`、`proactive_message_candidates`、`introduction` 仓库、`privacy` 仓库、`memory` 仓库。
- 写路径双写 `identity_id` + `character_id`，保证回滚可用。
- **联系人仓库已整体切换**：它的 `get()` 从身份出发 JOIN 关系与会话；改为从 identity 出发后不再依赖版本，`CONTACT_REQUIRED` 卡死风险随之消失。
- 测试：`tests/database/*` 逐一更新。
- 顺带修掉三个潜伏缺陷：重复 accept 可能插入第二个 Lucía 会话；`markConversationRead('lucia')` 一直 503（未读徽标服务端永远清不掉）；proactive eligibility 一直读成 `inactive`（手动触发永远被拒）。
- 只读线上对照：会话 id、消息、偏好行、联系人 status/stage/summary 前后完全一致。

### 切片 3：发布流程维护指针——✅ 已完成

- Commit `b6bfaae`（2026-10-13），已推送。
- 发布修订时在**同一事务内**把 `character_identities.current_character_id` 置为该修订；该 `stable_key` 尚无身份时按 `stable_key` upsert 创建；指针写入排在状态翻转之后，因此不会指向未发布修订。
- `import-character-bible.ts`：**导入不创建也不移动指针**（2026-10-12 实现后修正原文）。原因：`character_identities.current_character_id` 是 `NOT NULL`，导入期创建的身份只能指向一个尚未发布的草稿——那正是 ADR 0014 禁止的状态；因此身份统一在**发布**时创建/更新（按 `stable_key` upsert），导入只写修订行。
- 验收测试：发布 v3 后，`current_character_id` 指向 v3，且**没有任何用户状态行被写入**（用行数/时间戳断言）。
- 只读线上审计：3 条身份 / 3 个 distinct `stable_key` / 0 重复；指针 `lucia→lucia@2`、`ines→ines@1`、`mateo→mateo@1` 全为已发布。

### 切片 4：去掉双写与旧列——🛑 未开始，且被阻塞

**这不是"再做一步就完"的收尾片：它包含不可逆 DDL，且当前有一个必须先解除的提交状态阻塞。**

前置条件（两条都满足才可开工）：

1. **`drizzle/meta/_journal.json` 的半提交状态必须先解除。** 该文件当前带着另一会话**未提交**的 `0044` 条目，而 `drizzle/0044_worried_the_executioner.sql` 与 `drizzle/meta/0044_snapshot.json` 仍是 untracked（`0045` 的 SQL 与 snapshot 已随 `9e67a38` 提交，但 journal 里连 `0045` 条目也还没提交）。此时生成第二个迁移会让仓库出现"journal 有条目、文件不在提交里"的状态——正是 `PROJECT_STATUS.md` 记为 `BUILD-INTEGRITY-001` 的那类半提交失败。**先由 0044 的负责人把 0044 落成一个完整提交（SQL + snapshot + journal 一起），并顺带把 `0043`/`0045` 的 journal 条目补齐。**
2. **切片 3 的指针语义在线上至少验证过一次真实修订发布**（下一次有人改圣经时按运行手册走一遍，确认用户状态零改动）。切片 4 删列之后，回滚只能靠备份。

确切步骤：

1. **补 `(user_id, identity_id)` 唯一索引**（与旧索引并存）：`conversations`、`conversation_preferences`、`character_relationships`（今天的唯一约束是 `(user_id, character_id)`），`memory_sharing_permissions`（今天是 `(memory_id, target_character_id)`，需改为 `(memory_id, target_identity_id)`）。`proactive_message_candidates (user_id, dedupe_key)`、`character_introduction_offers (user_id, offer_key)`、`messages (conversation_id, client_message_id)` 不含版本列，无需改。**这不是纯粹收尾**：切片 2 的写路径"先按身份读、再插入"，但 `onConflictDoNothing`/`onConflictDoUpdate` 的冲突目标仍是旧的 `(user_id, character_id)`，而列表中的 `character_id` 写的是"当前修订 id"。指针移到新修订后，插入值的 `character_id` 与已存在行不同，**旧冲突目标不再匹配**，两个并发请求都可能在"读不到 → 插入"窗口里各插一行（`getOrCreateConversation`、Lucía accept 的会话与关系、`conversation_preferences` 的插入分支都可能）。预读把窗口压窄，但只有唯一约束能关掉它。补上索引后各写路径的 `onConflict*` 目标要同步改成身份键。
2. **把 9 个 `identity_id` 列置为 `NOT NULL`**（先确认线上 0 行 null；本机 2026-10-13 实测全部为 0 遗留）。
3. **删除被取代的旧列与旧唯一索引**：`conversations.character_id`、`conversation_preferences.character_id`、`character_relationships.character_id`、`proactive_message_candidates.character_id`、`relationship_memories.character_id`、`memory_sharing_permissions.target_character_id`、`character_introduction_offers.source_character_id` / `.target_character_id`，以及第 1 步列出的旧唯一索引。
4. **`messages.character_id` 保留**为审计来源（这条消息由哪一版生成）；对应的旧索引也保留。

**不可逆性与回滚**：删列**不可逆**，ADR 0014 的回滚方案正是"**在切片 4 验证通过前不删除 `character_id`**"——在此之前回滚 = 读路径切回 `character_id`，旧列与双写都还在。切片 4 一旦落地，回滚只剩备份还原这一条路；因此第 1–2 步与第 3 步应在不同提交中分开，先上线唯一索引与 `NOT NULL`，观察后再删列。

验收：全套 DB 测试 + `pnpm test:e2e` + 生产构建。

### 切片 5：文档与运行手册——✅ 已完成

- `docs/architecture.md` 6.11 增加身份/修订模型描述，模块表补 `character_identities`。
- `docs/database.md` 记录 `character_identities`、9 个 `identity_id` 列、用户状态 vs 版本内容的归属，以及切片 4 的待办与阻塞。
- 新增运行手册 `docs/operations/character-revision-runbook.md`：导入 → 发布（指针已在发布事务内完成）→ 只读验证 → 回退指针；替换掉本次 v1→v2 的一次性迁移做法。
- `PROJECT_STATUS.md` 记录 `scripts/roll-character-version.ts` 从此不再是"每次升版必跑"的脚本，仅用于历史纠正（该页由维护者更新；本切片已在运行手册中写明这一点）。

## 2. 本次已完成的相关前置（不要再做一遍）

- `lucia@2` 已发布，v1→v2 迁移移动了 99 行用户状态，v1 保留版本内容。（**不要与切片 1 回填的 111 行混淆**：后者是回填时 8 张用户状态表按身份口径统计的全部行数，含 2026-10-12 之后新增的会话与消息；两者是不同时点的不同口径。）
- 运行时/路由/协议/客户端已改为从目录取当前版本；陈旧客户端会得到 404 而不是新建空会话。
- 发布门禁已支持传入上一版（`current` / `currentRevisions`）。
- 发布门禁此前把"上一版"写死为 `null`，而 `null` 只接受 version 1，**因此无法发布任何 version > 1 的修订**；已随 v1→v2 修复，`--current` 是必需的。

## 3. 已知风险与回滚

| 风险 | 处置 |
|---|---|
| 联系人门禁在切换中途返回 403 | 切片 2 已"查询与数据同一步"完成，联系人仓库整体按身份查询 |
| 指针指向未发布修订 | 指针更新与发布同一事务，且写入排在状态翻转之后；读取路径另校验 `status = published` |
| 回填漏表 | `backfill-character-identities.ts` 沿用 `roll-character-version.ts` 的"information_schema 未分类 FK 即中止"检查 |
| 回滚 | 切片 4 之前，旧列仍在、双写仍在；回滚 = 读路径切回 `character_id`，或按运行手册第 5 节把身份指针指回上一版已发布修订 |
| 切片 4 删列不可逆 | 唯一索引与 `NOT NULL` 先单独上线；删列前确认已备份，并保留 `messages.character_id` |
| journal 半提交（`BUILD-INTEGRITY-001` 类） | 切片 4 开工前必须先让 0044 的 SQL + snapshot + journal 组成一个完整提交 |

## 4. 完成定义

- 新增一个修订并发布后，用户状态零改动即可生效（有测试证明）。
- 仓库中不再存在按 `characterVersion` 硬编码的读路径。
- `docs/` 与状态页同步；`pnpm typecheck` / 聚焦测试 / `pnpm test:e2e` 通过。
- 切片 4 的删列完成后，`character_id` 双写窗口关闭，`messages.character_id` 作为审计列保留。
