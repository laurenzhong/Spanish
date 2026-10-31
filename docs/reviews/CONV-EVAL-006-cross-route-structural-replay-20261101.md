# CONV-EVAL-006 R01/R05 零费用跨路线结构回放（2026-11-01）

## 结论

当前评估编排器在不调用收费 provider 的条件下，能完整回放 R01（稳定朋友）与 R05（只做朋友）两条跨会话路线，并保留各自的关系边界。该证据补足 006 的结构性跨路线检查，但不替代真实 MiniMax 语义、语言质量评审或真人使用验收。

## 结果

- R01：26 turns，2/2 proactive opportunities `generated`，终态 `familiar`，`characterProposal=none`，`userRomanticIntent=unspecified`。
- R05：26 turns，2/2 proactive opportunities `generated`，终态 `familiar`，`characterProposal=none`，`userRomanticIntent=friends_only`。
- 两条路线均保留 `voluntary_personal_anchor` 与 `user_continuity_return` 关系证据；无失败状态、错误码或重复主动消息。
- 运行使用 `scripted-fake-v1` 与 `fake-structural-v1`，没有 MiniMax 调用、数据库写入或新归档批次。

## 验证

- `tests/unit/conversation-evaluation-runner.test.ts`：34/34 通过，其中 R01/R05 完整 structural trajectory 用例均通过。
- 组合评估/关系/沙箱/存储/脱敏套件：5 files / 56 tests 通过。
- 直接 TypeScript：`node node_modules/typescript/bin/tsc --noEmit --pretty false` 通过。

## 限制

该回放只证明本地状态机、关系投影、主动机会和幂等编排的结构边界；它不能证明 R01/R05 的真实 provider 长路线稳定、语言自然度、跨路线真人语义，或整体可用。CONV-EVAL-006 继续 active，下一步仍需真人语言复核和稳定真实路线证据。
