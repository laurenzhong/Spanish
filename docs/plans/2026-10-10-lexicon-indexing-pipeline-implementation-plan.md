# 实施计划：词句索引管道（LEX-INDEX-001）

- 日期：2026-10-10
- 依据：`docs/adr/0011-lexicon-indexing-gate.md`、`docs/superpowers/specs/2026-10-10-lexicon-indexing-pipeline-design.md`
- 状态：**待产品放行后按切片执行**
- 前置：ADR-0011 已接受；6 项决策已全部确认（设计文档 §0、§6）

## 0. 已锁定的约束

1. 自动抽取只推进到**候选审核库**，`approved` 之前不得调用索引；默认开关关闭。
2. 抽取输入仅限**已发布且版权清晰**的文章/媒体版本分段。
3. 双维度审核（`content-es-ES` + `teaching-zh-CN`），身份 `dsh-ai-owner-authorized-review`，**必须标明 AI 身份**。
4. 短语只从已审核分段抽取，**不并入** `expressions`。
5. 批准默认逐条；低风险类别可批量，且留审计。
6. 来源全部撤下后保留词元、隐藏上下文（复用 `visibleOccurrence`）。
7. 不新增独立配额，共用现有每日配额（文章 50 / 媒体 20）。
8. 复用既有 `indexContentVersion()`，不重写索引逻辑。

## 1. 切片顺序（每片一个可独立验证的提交）

### 切片 1：候选数据模型与状态机（domain 优先）

- 新增候选表（迁移）：`lexicon_candidates`，字段形如
  `id, documentKind, documentStableKey, documentVersion, sourcePosition, candidateKind(lexeme|phrase), surfaceText, normalizedText, lemma, partOfSpeech, meaningZh, contextBefore, contextAfter, status, revision, reviewReference, createdAt, updatedAt`
- 状态机（纯 TypeScript）：`discovered → review_submitted → review_ready → approved | rejected`，非法迁移必须拒绝
- 唯一约束：同 (document, version, position, normalizedText, candidateKind) 幂等
- **测试**：合法/非法/失败/过期迁移；幂等 upsert；`revision` CAS

**为什么先做这个**：没有候选模型，抽取与审核都无处落；状态机是纯逻辑，可先于 provider 完成并测试。

### 切片 2：抽取 provider 接口 + fake

- `lexicon-corpus/domain` 定义 `LexemeCandidateProvider` 接口（输入=冻结分段，输出=内部候选类型）
- `fake` 实现（默认测试用，不发网络）
- 契约测试：schema 校验、失败/超时/取消传播
- **不接真实 MiniMax**（切片 3 才接）

### 切片 3：MiniMax 抽取适配器（server-only）

- 按 `src/modules/providers/annotation/` 既有模式新增 adapter
- 响应经 Zod 转内部类型；记录 provider、模型版本、延迟、请求 ID、估算成本
- 缺凭据时 fail-closed
- **测试**：fake + 契约测试；**禁止默认测试调用真实收费 provider**

### 切片 4：双维度审核接入

- 复用既有审核与 `review-identity.ts`；候选审核记录写 `dsh-ai-owner-authorized-review`
- 审核只审**冻结输入**，不得写库或发布
- **测试**：历史身份仍可放行、DSH 身份可放行、未知身份被拒（与既有 `content-review-identity-migration` 同构）

### 切片 5：owner 批准门禁 + 索引调用

- 批准后**才**调用 `indexContentVersion()`；`approved` 之前 corpus 必须保持零变化（用测试锁定）
- 批量批准仅限白名单类别，每条留审计
- **测试**：未批准不产生 `corpus_occurrences`；批准后产生；重复批准幂等

### 切片 6：调度与开关

- 接入每日流水线，共用配额；默认关闭的显式开关
- 观察性：沿用 `content-pipeline-observability` 的脱敏阶段计数
- **测试**：开关关闭时不抽取；配额用尽时停止

### 切片 7：性能与索引评估

- 量测 `READ-SHELF-001` 的代表出现查询在真实数据量下的表现（`normalized_text` 无索引）
- 若需要加索引 → **单独迁移切片**，不在本切片内混做

### 切片 8：端到端 canary

- 取 **1 篇**已发布文章跑完整链路：抽取 → 双审 → 批准 → 索引
- 验证：`/read/corpus` 可检索到该词、`view=lexicon` 可见、`intent` 可标记、高频词详情显示真实上下文（B3 首次在生产可见）
- 确认后再放量

## 2. 验收（整体）

1. 端到端：一篇已发布文章 → 候选 → 双审 → owner 批准 → `corpus_occurrences` 出现记录 → 四个页面可见、`intent` 可标记。
2. 未批准内容**绝不**进 corpus（有测试锁定）。
3. 撤下来源后原文不可见，词元保留（有测试锁定）。
4. `pnpm typecheck`、聚焦 `vitest`、改动文件 `eslint`、`pnpm build`、相关 e2e 通过。
5. 无 `DATABASE_URL` 时如实标注未执行的 DB/RLS 验证。

## 3. 风险与缓解

| 风险 | 缓解 |
|---|---|
| provider 费用超限 | 共用配额 + 成本记录 + 默认关闭；超限可降级为「只跑高频词」 |
| 误抽污染正式词元 | 批准前不进 corpus；`lemmaStatus` 默认 `pending`；词性取自受控集合 |
| 审核与生成同源导致门禁失效 | 双维度审核 + owner 批准是**两个**独立步骤；ADR 明文禁止自动发布 |
| 迁移与既有 baseline 冲突 | `docs/tasks/MIG-RECONCILE-001.md` 记录了 journal 不一致问题，**新迁移前必须先解决** |
| 索引查询性能 | 切片 7 单独量测，需要时单独加索引迁移 |

## 4. 暂不做（明确排除）

- 到期/复习调度（D1 已决定暂不引入，另行设计）
- `expressions` 并入 `phrase_entries`
- 开放给其他真实用户的多人审核门槛（需新 ADR）
- 从 `expressions` 反向生成语料事实
