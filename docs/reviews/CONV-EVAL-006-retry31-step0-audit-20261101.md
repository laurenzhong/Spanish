# CONV-EVAL-006 retry31 step 0 离线缺陷审计（2026-11-01）

## 结论

retry31 step 0 的 `Cocinar me parece una hobby...` 是明确的西语性数搭配错误。共享工作树已经加入精确窄门禁：只匹配 `una hobby`，拒绝候选并触发一次更严格的 provider retry；它不会把普通的 `hobby`、引用用户原话或其他自然度争议扩展成通用语言检测。

本切片完成了离线回归，没有新增 MiniMax 调用，也没有改写 retry31 的 R04、来源或 8 批评审归档。

## 审计范围

- 生产来源：`artifacts/conversation-evaluations/baseline-r04-20261031retry31/r04/` 与 `quality-r04-retry31-source-20261031`；原始失败为 `Cocinar me parece una hobby...`。
- 规则实现：`src/modules/conversation/domain/language-purity.ts` 的 `malformedSpanishFragment` 精确模式 `una hobby`。
- 重试边界：`src/modules/conversation/application/stream-reply.ts` 使用现有安全门禁，首候选失败后最多生成一次替代候选；失败候选不产生学习证据。
- 回归：`tests/unit/language-purity.test.ts`、`tests/unit/provider-output-integrity.test.ts`、`tests/unit/conversation.test.ts`、`tests/unit/conversation-continuity-regression.test.ts`、`tests/unit/reply-plan.test.ts`。

## 验证

- Vitest 直接入口：5 files / 161 tests passed，单 worker。
- 直接 TypeScript：`node node_modules/typescript/bin/tsc --noEmit --pretty false` passed。
- 受影响 ESLint：`--max-warnings=0` passed。
- 收费调用：0；没有新的 runId，也没有新增归档。

## 边界与后续

该门禁的本地通过只说明已知缺陷不会直接发送；它不能证明 provider 长路线已稳定，也不能替代真人西语复核。retry31 的 step 3 密集连字符样本和 step 7 证据不足仍按语言质量协议保留为未决，不在本切片中扩展规则。CONV-EVAL-006 继续 active，下一步是获得真人语言复核与稳定 R01/R05 跨路线证据后再判断关闭条件。
