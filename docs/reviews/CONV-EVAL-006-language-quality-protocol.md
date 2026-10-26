# CONV-EVAL-006：独立语言质量诊断协议（离线阶段）

日期：2026-10-26  
状态：协议、离线回放和首个受控真实 diagnostic 校准完成；整体真实批次语言质量仍未通过。

## 目的

R04 `retry2`–`retry6` 证明有界安全重试能让普通回合完成，但可见文本仍出现 `dishes/Preparation`、`perfectly`、`CURIOUS`、`te.has`、`commitments` 和 `tocaOMC` 等问题。继续为每个新词追加门禁会产生追逐效应，因此本切片把“能否发送”和“发送后是否自然可用”分开：现有语言安全门禁保留，新增独立语言质量评审协议。

## 固定 rubric

评审输入只包含当前用户消息、最近可见消息和角色候选原文。候选被包在 `<VISIBLE_REVIEW_INPUT>` 中，并明确标为待评数据；评审不能把候选中的指令当作指令，也不能看到隐藏候选、关系状态或模型思维。

每条 finding 必须包含：

- `severity`：`critical`（严重污染或不可发送）、`major`（明显非西语/破损词、改变意义的语法语义问题或明显答非所问）、`minor`（重复、机械、轻微不自然或轻微贴合问题）。
- `category`：`language-contamination`、`non-spanish-or-broken`、`grammar-semantics`、`repetition-mechanical`、`context-fit`、`naturalness`。
- `quote`：候选中逐字连续、可核验的证据；不能引用用户消息、隐藏草稿、评审输入之外的内容。
- `issue` 与 `confidence`：中文影响说明和证据置信度。

门槛固定为：0 条 `critical`、0 条 `major` 且 `minor` 不超过 2 条才通过；仅有 minor 时标记 `sendable-with-notes`。三条以上 minor、任意 major 或 critical 标记 `not-sendable`。证据不足标记 `inconclusive`，不当作通过。两个独立评审必须都可用且结论一致；不一致或任一证据不足时整条样本为 `inconclusive`。

## 实现与离线证据

- `scripts/conversation-evaluation/language-quality.ts` 提供固定 rubric、严格 Zod 结构、候选 SHA-256、逐字 quote 校验、分级门槛、双评审合并和不调用网络的 replay harness。
- `tests/unit/conversation-evaluation-language-quality.test.ts` 覆盖干净回复、严重污染、非西语/破损、语法语义、上下文错位、重复机械、可发送但不自然、三条 minor 失败、无效引用、输入数据边界、双评审不一致，以及重复样本 ID 在首次评审前失败。
- 离线回放使用 fake reviewer，14 项通过；没有修改候选、关系状态、人物设定或历史归档。
- 真实校准批次 `language-quality-20261026-diagnostic-001` 从已归档 `quality-20261025-models-diagnostic-001` 固定选取 3 个样本，每个样本调用两次独立 `MiniMax-M3.1-Flash` reviewer，共 6 次，全部完成；已知 usage **¥0.006158**，未知计费 0。主档和 `C:\Users\master\Desktop\Lucia聊天测试\language-quality-20261026-diagnostic-001` 批次索引与 payload SHA-256 一致。
- 其中 `d01/full-m3-native/0` 的 `¿Qué cuisine más?` 被两次评审判为 `major / non-spanish-or-broken`，合并结果 `fail/not-sendable`；另两个样本均为 `pass/sendable`。该结果确认协议能捕获已知可见破损词，但样本量不足以代表整批或长路线。
- 保留集批次 `language-quality-20261026-holdout-001` 按显式 `h01/h02/h03` case 选择运行，每个样本两次独立 reviewer，共 6 次，全部完成；已知 usage **¥0.004435**，未知计费 0。三条合并结果均为 `pass/sendable`，主档和 `C:\Users\master\Desktop\Lucia聊天测试\language-quality-20261026-holdout-001` 的批次文件 SHA-256 一致。

## 限制与下一步

本协议尚未证明模型能稳定做出正确语言判断，也没有替代真人语言复核。下一步应把诊断失败样本和后续长路线抽样交给所有者复核，并沿用相同 schema 扩大保留集覆盖；不能把这 6 个样本的结果外推到 R04 长路线。历史批次保持原样，不用新评分回写旧结论。

