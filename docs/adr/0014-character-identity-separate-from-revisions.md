# ADR 0014：把角色身份与角色修订分开，用户状态不再挂在修订行上

- 状态：已接受（业主 2026-10-12 选择长期方案，替代"每次升版本迁移用户状态"）
- 日期：2026-10-12

## 背景

`characters` 表每一行是**一个修订**（`stable_key` + `character_version`），`characters.id` 是修订行 id。而所有**用户状态**都以外键指向这个 id：

- `conversations.character_id`、`conversation_preferences.character_id`
- `messages.character_id`
- `proactive_message_candidates.character_id`
- `character_introduction_offers.source_character_id` / `target_character_id`
- `character_relationships.character_id`（用户与该角色的关系状态：status / stage / summary）
- `memory_sharing_permissions.target_character_id`、`relationship_memories.character_id`

同时，**版本内容**也指向它：`character_canon_facts.character_id`、`characters.profile.relationships`（她背景里的关系条目）。

设计规定已发布修订不可原地修改（`docs/superpowers/specs/2026-08-24-lucia-character-bible-design.md:72`「已发布人物同版本修改被拒绝」），因此任何内容修订都必须发新版本。于是两件事被绑在一起：**只要动一行圣经内容，就必须重新安置所有用户状态。**

**代价已在 2026-10-12 实测**：为给 Lucía 的 `personality.responseStyle` 增加两条规则，实际需要——

1. 导入并发布 `lucia@2`；
2. 迁移 99 行用户状态（会话 1、消息 88、偏好 1、主动消息候选 7、邀请 2）；
3. 改掉 6 处硬编码 `characterVersion: 1`（stream 守卫、协议 meta 类型与解析器、4 个路由、客户端 prop 类型）；
4. 修一个被掩盖的真实缺陷：发布门禁把"上一版"写死为 `null`，而门禁规定 `null` 只接受 version 1，**因此这条路此前根本无法发布任何 >1 的版本**；
5. 更新 6 个既有测试文件。

而**至今仍有 5 处按 v1 查角色**（主动消息仓库、Lucía 联系人仓库、隐私仓库、记忆抽取默认值、介绍邀请路由）。其中联系人仓库最关键：它从 v1 行出发读取用户关系状态，若只改一半（改代码不改数据，或反之）就会立刻 `CONTACT_REQUIRED` 403，卡死聊天。当前之所以还能用，是因为关系行被刻意留在 v1——**属于"不一致但侥幸可用"**。

结论：成本不在"写两行规则"，而在"用户状态挂在修订行 id 上"。

## 决定

引入**角色身份**作为用户状态的唯一外键目标。修订仍是 `characters` 行，但用户状态不再引用它。

- 新表 `character_identities`：`id uuid pk`、`stable_key text unique`、`current_character_id uuid → characters.id`、`created_at`、`updated_at`。
- 用户状态表增加 `identity_id`（迁移期先可空、回填后置非空）：
  `conversations`、`conversation_preferences`、`proactive_message_candidates`、`character_introduction_offers`(source/target)、`character_relationships`、`memory_sharing_permissions`(target)、`relationship_memories`。
- `messages` **保留** `character_id` 作为审计来源（这一条消息由哪一版生成），同时增加 `identity_id` 用于查询与归属。
- 发布新修订 = 插入新的 `characters` 行 + **一次指针更新** `character_identities.current_character_id`；用户状态零迁移。
- 版本内容（`character_canon_facts`、`characters.profile.relationships`）继续挂修订行 id——它们本来就属于那一版，不是用户状态。

## 替代方案

- **A. 每次升版本迁移用户状态（本次实测的现状）**：已被否定。每改一行圣经内容都要动生产数据，且任何一处读路径漏改就会 403 或产生重复会话。
- **B. 用户状态改挂 `stable_key` 文本**：也能解耦，但把 uuid 外键换成文本键，索引体积更大、易拼写漂移，且丢失"身份是实体"的可演进性（未来角色改名、合并、多语言版本）。不采用。
- **C. 把 `characters` 拆成 identity + revisions 两张表**：语义最干净，但 import/publish/runtime 与全部查询都要改表名与字段，风险与工作量最大，而收益与本题相同。暂不采用；若将来出现更多角色级实体（角色商店、多角色共享内容），可在此基础上演进。

## 后果

- **正面**：圣经修订变成"导入 → 发布 → 翻转指针"，用户状态完全不动；不再需要按版本硬编码；联系人门禁与修订版本解耦，不会因为升版 403；"已发布修订不可变"的纪律得以保留（内容仍按版本冻结）。
- **成本**：一次性 schema 迁移 + 8 张表回填；迁移期需要"双列并存"窗口；RLS 与所有权检查逐表复核。
- **约束**：迁移必须可回滚——在切片 4 验证通过前**不删除** `character_id` 列；发布流程与指针更新必须**同一事务**，否则会出现"已发布但未生效"或"指针指向未发布版本"。

## 验收

1. 发布一个新修订后，历史消息、会话偏好、关系状态、主动消息去重状态**逐项不变**（与迁移前快照对比）。
2. 新修订成为当前版本**只需一次指针更新**，不产生任何用户状态写入。
3. 数据库测试覆盖：身份缺失、指针指向未发布版本、身份与修订 `stable_key` 不一致、跨用户隔离、以及"发布后旧修订仍可被历史查询解析"。
