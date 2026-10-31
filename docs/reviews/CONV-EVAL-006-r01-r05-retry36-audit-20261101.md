# CONV-EVAL-006 retry36 R01/R05 归因审计

日期：2026-11-01  
批次：`baseline-r01-r05-20261101retry36`  
模型：`MiniMax-M3.1-Flash`  
性质：收费结果的离线审计；不是语言质量通过、真人复核或整体可用性证明。

## 证据范围

- 工作区归档：`artifacts/conversation-evaluations/baseline-r01-r05-20261101retry36/`
- 桌面归档：`C:\Users\master\Desktop\Lucia聊天测试\baseline-r01-r05-20261101retry36\`
- 两份归档已逐文件完成 SHA-256 一致核对；本审计不改写历史归档。

## 逐字归因

### R01 step 1

首候选为：`Vaya, día largo. Al menos ya estás en casa. ¿Hascookido algo hoy o hasчил y te has pedido algo?`。一次安全重试为：`Qué bien, Álex. ¿Has cooked?`。两者分别包含混合/破损词和明确英语词，均被现有语言门禁拦截；之后路线以 `stream-failed` 结束。门禁行为符合预期，未发现需要修改的重试状态机或关系规则。

### R05 step 7

首候选为：`Ah, ¿trabajas en una librería? Entonces tienes libros a tu alcance durante el día, ¿no?`。该候选重新询问用户已经给出的职业，触发现有职业连续性门禁；最终可见回复为 `Hola, Álex. Qué bien que tengas un rato libre después de trabajar en la librería. Te acompaño con poca conversación.`，已承接 `librería`。这属于现有门禁保护的重试场景，不新增规则。

### R05 step 13

可见回复为：`¡Hola, Álex! Bienvenido de nuevo. Espero que hayan sido bons días. No me has contado qué tal llevas estos días.`。`bons días` 不是该回复应使用的西班牙语短语，且不是需要语境解释的借词或专名。新增精确 `malformedSpanishFragment` 模式，并补充 stream retry 回归；门禁会要求供应商改写为自然西语。模式保持短语级别，避免推广成通用语言检测器。

### R05 step 15

首候选重复了前一步的 `¿Qué te apetece hacer ahora?`，触发重复活动问题门禁；重试候选为供应商内部规划污染，随后 `stream-failed`。这是当前供应商在有界重试中的不稳定证据；没有足够证据新增业务规则或继续扩充词表。

## 离线验证

- `tests/unit/language-purity.test.ts`
- `tests/unit/conversation-baseline-reliability.test.ts`
- `tests/unit/conversation.test.ts`
- 结果：3 files / 112 tests passed。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- 定向 ESLint（语言纯度实现与两份回归）：通过。
- 本切片未追加收费调用，未写真实数据库。

## 结论与限制

该切片只关闭了 retry36 中一个可精确归因的语言门禁缺陷，不能关闭 `CONV-EVAL-006`。R01/R05 当前批次仍是失败路线，且没有自动评审来源。`CONV-EVAL-005` 的真实 PostgreSQL CRUD/CAS、RLS 写路径和删除后关系来源重算已由独立 21/21 回滚审计覆盖；仍缺生产级主动生命周期、跨路线语义证据和真实用户隐私最终验收。整体可用还受真人语言复核、稳定全仓 E2E、真实登录态与 iPhone Safari 限制。

