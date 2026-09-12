# ALPHA-033 所有者授权 AI 内容审核实施计划

日期：2026-09-12  
任务：`ALPHA-033`  
设计：`docs/superpowers/specs/2026-09-12-owner-authorized-ai-content-review-design.md`

## 目标

在不冒充真人审核、不覆盖历史版本、不破坏用户收藏或学习断点的前提下，由 Codex 完成个人产品阶段首批正式内容审核，使 26 条表达、3 个基础场景及其生产支撑元数据达到可验证、可导入的 `published` 状态。

## 范围

本计划只处理：

- `alpha.core` 的 11 条表达、8 个领域、11 个目标和 1 个内容包。
- `alpha.scenario-practice` 的 15 条表达、3 个场景、1 个领域和 9 个目标。
- 上述表达的标签、变体、教学说明和场景/内容包内部任务。
- 内容校验器、导入器、运行时 bundle 选择及相关测试。
- 所有者授权 AI 审核所需 ADR、规范和状态文档。

不处理 5 个旧 `alpha.core` 场景、文章、glossary、角色、私人生成内容、Flutter 同步或 iPhone 真机验证。

## 版本原则

- 新建 bundle `alpha.core@2` 和 `alpha.scenario-practice@2`，保留 v1 文件。
- 只有正文、翻译、变体、语法、发音、语用、任务、提示或场景字段变化的版本化实体才提升实体版本。
- 未修改的表达、场景和内容包保留实体版本，只把状态单向推进到 `published`，从而保留 `stableKey@version` 的收藏和断点引用。
- 领域和目标没有实体版本；导入器只允许在其他字段完全一致时单向推进状态。
- 禁止任何状态降级、同版本内容改写或已归档内容重新发布。

## 切片 1：把审核门禁写成失败测试

### 修改文件

- `tests/contracts/content-contract.test.ts`
- `tests/database/content-import.test.ts`
- 如职责更清晰，可新增 `tests/unit/content-review-gate.test.ts`

### 测试要求

先新增并确认失败：

1. 已发布表达只有 `es-ES` 审核时拒绝。
2. 已发布表达只有 `zh-CN` 审核时拒绝。
3. 已发布场景缺任一审核维度时拒绝。
4. 两个维度均 approved 时通过。
5. 已发布表达的变体、目标或领域未发布时拒绝。
6. 已发布场景引用未发布表达或目标时拒绝。
7. 导入新 bundle 时允许内容完全相同的实体状态从 `draft` 提升为 `published`。
8. 导入器拒绝状态降级。
9. 导入器拒绝借状态推进修改任何不可变字段。
10. 状态推进与后续失败处于同一事务，失败时回滚。

### 完成条件

- 新测试能在未改生产代码时稳定复现缺口。

## 切片 2：实现双维度审核与引用完整性校验

### 修改文件

- `src/modules/content/import/validate-content.ts`
- 必要时仅补充类型辅助，不新增内容状态或数据库枚举。

### 实现

- 以 `entityType + stableKey + version + locale` 追踪 approved reviews。
- 已发布 expression 和 scenario 必须同时具有 `es-ES`、`zh-CN` approved review，且 reviewer reference 与 reviewedAt 完整。
- 已发布 domain、goal、content pack 继续要求至少一条 approved review。
- 已发布 expression 的所有 variants 必须 published，引用 goal 和所属 domain 必须 published。
- 已发布 scenario 的 goal 和 target expressions 必须 published。
- 现有 article 和 character 校验语义保持不变。

### 验证

```powershell
pnpm test --run tests/contracts/content-contract.test.ts tests/unit/content-review-gate.test.ts
pnpm typecheck
```

## 切片 3：实现事务内状态单向推进

### 修改文件

- `src/modules/content/import/import-content.ts`
- `tests/database/content-import.test.ts`

### 实现

- 定义内容状态顺序：`draft < review < approved < published < archived`。
- 对已有 domain、goal、expression、scenario、content pack 和本计划会触及的其他内容实体：
  - 比较时排除 status，但保留其他所有不可变字段比较。
  - incoming status 更高时在当前事务更新。
  - incoming status 相同则保持幂等。
  - incoming status 更低时抛出 `ContentImportConflictError`。
  - `archived` 不允许重新进入其他状态。
- 同一稳定 ID/版本内容字段变化继续要求新版本并产生冲突。
- bundle import claim、状态更新和实体写入保持同一事务。

### 验证

```powershell
pnpm test --run tests/database/content-import.test.ts
pnpm typecheck
```

## 切片 4：同步个人阶段内容治理文档

### 修改文件

- `docs/adr/0003-owner-authorized-ai-content-review.md`
- `AGENTS.md`
- `docs/content-authoring.md`
- `docs/architecture.md`
- `docs/superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md`
- `content/README.md`
- 必要的实施计划当前章节

### 内容

- 记录产品所有者 2026-09-12 授权。
- 明确审核者为 Codex，不是人类、母语者或教学专家。
- 个人阶段由 Codex 完成 `es-ES` 与 `zh-CN` 两个审核维度。
- 未来面向其他用户前必须用新 ADR 重审外部审核门槛。
- 版权、来源、版本、安全、隐私和评分规则保持不变。
- 生产环境仍只显示 `published`。

### 验证

- 搜索并消除当前权威章节中“个人阶段仍等待真人签字”的矛盾描述。
- 历史交接记录保留原始事实，并在当前状态注明已被新决定覆盖。
- `git diff --check` 通过。

## 切片 5：完成正式 AI 审核与版本化修订

### 新增/修改文件

- `content/bundles/alpha-core-v2.json`
- `content/bundles/scenario-practice-alpha-v2.json`
- `docs/reviews/ALPHA-033-ai-content-review.md`

### 审核动作

- 逐条审核 26 条表达的正文、中文、意图、变体、CEFR、地区、语域、语法、发音、语用、标签与权重。
- 审核 3 个场景的角色、开场、条件变化、任务、成功标准、三级提示、迁移和虚构现实边界。
- 审核 9 个领域、20 个目标、1 个内容包及其片段/活动。
- 所有审核记录使用 `codex-ai-owner-authorized-review`，并写明所有者授权和 AI 身份。
- 报告逐项记录 `approve`、修改前后、理由和最终版本；没有问题的项目也留下明确结论。

### 必须解决的已知问题

- 修复 `rental.se-permiten` 的 `se permits` 拼写。
- 调整 `repair.podria-hablar-mas-despacio` 的真实使用限制。
- 为 `navigate.creo-que-estoy-perdido` 提供不误导的性别适配。
- 复核并必要时改写 `restaurant.tomare-eso`、`campus.vengo-para`、`campus.puedo-enviarlo`、`rental.otra-hora`。
- 将含糊的中文重音简写改为清楚的音节与重音说明。

### 发布状态

- 审核通过的 domain、goal、expression、variant、scenario 和 content pack 设置为 `published`。
- content pack 填写 `publishedAt`；其他支持 `publishedAt` 的实体同步填写。
- expression 和 scenario 各写入 `es-ES` 与 `zh-CN` 两条 approved review。
- domain、goal 和 content pack 写入 `zh-CN` approved review；西语片段审核写入内容包审核备注。
- v2 bundle 不携带本次范围外的旧场景或文章；文章运行时继续使用 v1 来源。

### 验证

```powershell
pnpm content:validate -- content/bundles/alpha-core-v2.json
pnpm content:validate -- content/bundles/scenario-practice-alpha-v2.json
```

## 切片 6：切换运行时目录并保护用户版本引用

### 修改文件

- `src/modules/content/repositories/bundle-content-pack-repository.ts`
- `src/modules/explore/repositories/bundle-explore-repository.ts`
- `src/modules/explore/repositories/catalog-explore-library-repository.ts`
- `src/modules/scenario-practice/content/scenario-catalog.ts`
- `src/modules/training/ui/fake-training-loop.tsx`
- `app/(product)/learn/learn-page-content.tsx`
- 相关单元、契约与 Playwright 测试

### 实现

- 内容包、正式表达和基础场景目录切换到 v2。
- 文章 repository 与阅读器继续使用 v1，避免把文章纳入本任务。
- 未改实体保留原版本；已改实体通过稳定 key 解析最新发布版本。
- 既有 `stableKey@version` 收藏与断点继续可读，不自动把历史证据改绑到新版本。
- Explore 生产投影只出现 published 项，不再依赖 `allowDraft` 才能使用首批正式内容。

### 验证

```powershell
pnpm test --run tests/unit/content-pack.test.tsx tests/unit/explore-dashboard.test.ts tests/unit/explore-library.test.ts tests/unit/scenario-practice-content.test.ts tests/unit/fake-training-loop.test.tsx tests/unit/learn-page.test.tsx
pnpm test:e2e -- --project=chromium tests/e2e/explore-page.spec.ts tests/e2e/scenario-practice.spec.ts tests/e2e/content-pack.spec.ts
```

## 切片 7：导入、真实账号验证与发布候选门禁

### 前置检查

- 确认 `DATABASE_URL` 指向项目所有者授权的开发/个人 Alpha 数据库。
- 先执行只读查询确认 v1 import、用户内容包状态、收藏、断点和证据引用。
- 不记录令牌、邮箱、原始对话或其他敏感信息。

### 导入

```powershell
pnpm content:import -- content/bundles/alpha-core-v2.json
pnpm content:import -- content/bundles/scenario-practice-alpha-v2.json
```

每个 bundle 自身事务导入；任一失败时停止后续发布验证，不手工修改数据库绕过冲突。

### 全量门禁

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:e2e
pnpm build
```

### 真实账号桌面验证

- Explore 显示正式表达和三个基础场景。
- 内容包主动作可用，收藏与断点仍指向预期版本。
- 三个场景可进入实战，条件变化与提示工作正常。
- 文字输入不产生发音或真实口头反应证据。
- 刷新后收藏、进度和当前版本一致。

iPhone Safari/PWA 真机继续延期，不阻塞电脑端候选。

## 切片 8：交接和状态同步

### 修改文件

- `PROJECT_STATUS.md`

### 记录

- 设计、计划、实现、审核报告和内容 commit。
- 修改文件和审核范围。
- 校验、测试、导入及真实账号结果。
- 未执行项及原因。
- 个人阶段 AI 审核边界和未来扩大用户范围的 ADR 门禁。
- 下一任务是否可以进入阶段 8。

### 完成条件

- `git diff` 只包含本任务文件。
- 每个切片按单一目的提交并推送。
- `main...origin/main` 为 `0 0`。
- 只有所有内容、导入和电脑端发布候选门禁通过后，才将 `ALPHA-033` 标记为完成。

