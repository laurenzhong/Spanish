## CONV-EVAL-006：R01/R05 retry36 归档审计（2026-11-01）

本次只读检查工作区归档 `artifacts/conversation-evaluations/baseline-r01-r05-20261101retry36/`，并与桌面副本的既有 SHA-256 校验结果交叉核对；没有调用 provider、没有生成新评审批次，也没有改写归档。

### R01

- 路线为稳定朋友，step 0 完成，step 1 的两个候选分别命中已有语言纯度门禁（`Hascookido`、`¿Has cooked?`），随后 `stream-failed`。
- 结果为 1/24 普通来回，整批 `failed`，关系仍为 `new_contact / unspecified`；没有可用于关系阶段或语言质量通过的完整路线证据。

### R05

- 路线为只做朋友；step 7 的职业连续性门禁最终成功承接 `librería`，step 12 产生 1 条主动消息，step 13 的 `bons días` 是已记录的明确语言缺陷。
- step 15 首答先被重复问题门禁拒绝，重试又出现供应商内部规划污染，最终 `stream-failed`。普通来回完成 14/24，整批 `failed`。
- 失败前的投影曾达到 `familiar / friends_only`，但该阶段不是完整路线成功；没有评审来源，不能作为跨路线语义通过或 006 关闭证据。

### 结论

retry36 的价值是确认现有职业连续性、重复问题和语言纯度门禁确实能阻断部分污染，并保留了真实 provider 失败证据。它没有提供 R01/R05 完整稳定路线、真人语言复核或关系语义通过证据；不追加收费重跑，除非后续出现可独立归因的结构性修复需要验证。CONV-EVAL-006 与 CONV-EVAL-005 均保持未关闭，仍不能进入 007 或宣称整体可用。
