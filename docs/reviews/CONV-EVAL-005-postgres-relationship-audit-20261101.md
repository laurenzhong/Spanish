# CONV-EVAL-005 真实 PostgreSQL 关系持久化审计

日期：2026-11-01  
脚本：`scripts/verify-relationship-postgres.ts`  
性质：真实数据库写路径的事务回滚审计；不改变持久数据。

## 验证内容

脚本显式加载 `.env.local`/`.env`，连接应用配置的 `DATABASE_URL`。它从现有 `profiles` 与 `character_identities` 读取一个合法 owner pair，然后在单个 PostgreSQL 事务中执行：

1. 创建或读取关系 head。
2. 追加一条关系事件。
3. 用相同幂等键重放，确认返回原事件。
4. 用相同幂等键但不同事件内容重放，确认 `RELATIONSHIP_EVENT_CONFLICT`。
5. 用真实 head revision 执行 CAS 前进。
6. 用旧 revision 执行 CAS，确认 `RELATIONSHIP_HEAD_REVISION_CONFLICT`。
7. 插入临时消息与事件来源，执行来源 tombstone 两次，删除消息后确认 `message_id` 置空且 tombstone 保留。
8. 在同一事务中创建主动候选、完成候选并重复完成，确认生成消息与幂等返回。
9. 读取真实账号导出快照，确认返回白名单字段且不包含 provider 调用；清理账号业务数据后确认 profile tombstone 保留。
10. 在同一事务中调用 Lucía 角色数据删除，确认会话与关系 head 清除。
11. 显式回滚事务，并比较回滚前后 head/event/pending 行数。
12. 在同一事务内创建三条带有真实 `conversation_reply_sources` 成员关系的完整 user/assistant 回合，追加 `voluntary_personal_anchor`、`mutual_conversation_welcome`、`user_continuity_return` 三个独立 episode；调用生产 replay 读取器确认 live source 投影为 `familiar`。
13. 对第一个回合的 user source 执行 tombstone，再次调用生产 replay 读取器，确认撤回来源后阶段按 live source 重算为 `new_contact`。

事务外还核验五张关系表均启用 RLS 且至少存在一条策略。

## 结果

真实 PostgreSQL **21/21 PASS**：

- `relationship_heads`、`relationship_events`、`relationship_event_sources`、`relationship_boundaries`、`relationship_pending_sources` 均存在。
- append、幂等重放、冲突拒绝、CAS 成功与过期 CAS 拒绝均通过。
- 关系来源 tombstone 首次更新 1 行、重复更新 0 行；删除临时消息后来源保留为 tombstoned 且 `message_id` 为空。
- 主动候选从 `generating` 到 `generated` 的真实写路径通过；重复完成返回原消息，没有重复插入。
- 真实账号导出返回 scoped snapshot，未暴露 provider calls；业务数据清理保留 profile tombstone，适合后续 Auth 删除重试。
- Lucía 角色数据删除在同一事务内清除会话与关系 head；随后整体回滚，关系 head/event/pending、会话、消息和主动候选计数均保持不变（`0/0/0/3/71/24` → `0/0/0/3/71/24`）。
- 三个真实 user/assistant 回合和 reply-source membership 能被生产 `readRelationshipConversationContext` 正确重放：三条 live episode 得到 `familiar`；撤回 anchor 的 source 后再次读取降为 `new_contact`，证明阶段与证据依赖 live source，而不是只信任事件行。
- 回滚前后计数均为 `heads=0, events=0, pending=0`，没有留下审计数据。
- 五张表 RLS 与策略核验通过。

PGlite 聚焦回归同时通过：

- `character-relationship-persistence.test.ts`
- `conversation-relationship-pending-receipt.test.ts`
- `proactive-message-persistence.test.ts`
- `proactive-message-boundary.test.ts`
- `account-data-deletion.test.ts`

结果：5 files / 18 tests passed；直接 TypeScript 与脚本定向 ESLint 通过。

## 限制

该审计证明真实 PostgreSQL 的关系 append/idempotency/CAS/RLS 基础路径、三回合 replay 以及来源撤回后的阶段重算可执行，并不证明生产主动调度、完整普通/主动消息事务、Auth 用户最终删除、跨路线语义证据或真实登录态。所有测试写入均回滚，未执行线上业务数据删除；账号导出/业务清理仍是事务内回滚审计，不是最终用户验收。

