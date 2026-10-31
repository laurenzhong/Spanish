# CONV-EVAL-005：跨路线与主动轨迹零费用审计（2026-11-01）

## 范围

本次只审计已有归档和本地测试，不调用 MiniMax，不写入生产数据库，也不把历史收费结果重新解释为当前代码下的通过证据。审计对象是 `CONV-EVAL-005` 关闭条件中的三项：完整主动轨迹、跨路线语义证据、删除/撤回后的关系重算。

## 可计入证据

- `baseline-conv-eval-006-20261026c` 的 R01 与 R05 归档各包含 24 个已完成普通用户回合、48 条 `conversation` 消息、2 条已完成 `proactive` 消息、2 个 `generated` 主动候选和完整 `turns` 序列（主动步骤为 12 与 25）。两条路线的工作区与桌面副本各 5 个文件，逐文件 SHA-256 一致。
- 同一批次的 R01/R05 记录保留了候选 `dedupeKey`、`generationId`、`messageId`、来源类型和完成状态，说明评估沙箱能够保存一条可回放的主动轨迹。它们不是生产用户数据，也不是当前代码下新生成的真实验收。
- 本地聚焦验证覆盖主动消息 route/runner/workflow、关系源 ledger、关系持久化/重放/隐私和账号导出/删除：17 个文件、172/172 通过（直接 Vitest 单 worker）。
- 针对候选完成竞态新增 `tests/database/proactive-message-boundary.test.ts`：在候选生成后写入 `proactive/all` 边界，`completeCandidate` 返回 `PROACTIVE_BOUNDARY`，不写入消息且候选保持 `generating`。该回归单测通过；加上原有主动路径 6 文件聚焦复跑为 35/35，直接 TypeScript 和定向 ESLint 通过。
- 新增零费用离线结构回归：`tests/unit/conversation-evaluation-runner.test.ts` 对现有 R01/R05 route 各完整运行 24 个普通回合和 2 个主动机会；两条均 `completed`、26 turns、2/2 proactive `generated`、最终 `familiar` 且无角色 proposal。R05 的 `friends_only` 意图保持为 `friends_only`，R01 保持 `unspecified`。该证据证明当前评估编排器能保留跨路线关系投影和主动轨迹，但使用 fake provider，不是语言质量或真人体验证据。

## 不能计入关闭条件的证据

1. R01/R05 的长归档均以 `new_contact` 关系阶段结束；其中部分批次因 `REVIEW_EVIDENCE_INVALID`、`stream-failed` 或 `AMBIGUOUS_CALL` 标记为失败，不能把普通回合数或主动候选数当作路线语义通过。
2. 现有长路线评审使用同模型评审器，且出现无效引文/无效 JSON；它们不构成真人西语复核，也没有提供当前修复后真实 provider R01/R05 的跨路线语义结论。新增的 fake R01/R05 structural replay 只证明编排与关系 projection 的确定性，不能替代真实 provider 评审。R04 的 retry32–35 证据不能替代 R01/R05。
3. 归档中的主动消息只证明沙箱内生成、持久化和去重字段存在；没有证明生产调度、真实登录态、失败/取消/重试后的完整主动生命周期，也没有证明主动消息与普通回复在当前数据库事务中共同读取同一关系快照。
4. 本次后续真实 PostgreSQL 回滚审计已覆盖关系 append/idempotency/CAS、五表 RLS、账号导出白名单、业务清理、Lucía 角色数据删除，以及三回合 reply-source replay 与 anchor source 撤回后的阶段重算（21/21）。这补足了数据库写路径和删除后关系重算的回滚证据，但不等于真实用户执行的最终删除/导出验收。

## 结论

`CONV-EVAL-005` 本次仍保持 `in_progress`，不关闭、不进入 `CONV-EVAL-007`。这项审计排除了“没有任何主动轨迹”的表述，并由真实 PostgreSQL 21/21 回滚审计补足来源撤回后的重算证据；仍不足以证明生产主动调度完整生命周期或跨路线语义通过。

## 下一步

- 继续补生产主动调度完整生命周期（含 slot 轮询、失败/取消/重试、去重和边界拒绝）与当前代码下的 R01/R05 跨路线语义证据。
- 只有在主动生命周期或跨路线证据出现可归因缺口时，才评估新的收费复验；任何收费 run 必须使用全新 `runId` 并保存工作区/桌面双份归档。
- 真人语言复核、稳定全仓 E2E、iPhone Safari、真实登录态和隐私删除/导出最终验收仍属于整体可用性阻塞项。
