# Sueño 学习页桌面 Web「任务时间线 + 详情」实施计划

- 日期：2026-08-28
- 状态：已批准，待进入代码实施
- 任务：`ALPHA-033`
- 目标分支：`fix/login-redirect-after-otp`
- 设计依据：[`2026-08-28-learning-page-desktop-web-design.md`](../superpowers/specs/2026-08-28-learning-page-desktop-web-design.md)
- 调研依据：[`2026-08-28-learning-page-desktop-web-technical-research.md`](../superpowers/specs/2026-08-28-learning-page-desktop-web-technical-research.md)

## 1. 目标

将已批准的 F 方案落到现有登录后学习页和训练页：桌面端优先使用固定左侧导航、12 列内容网格、任务时间线和条件详情 rail；保留现有训练状态机、断点、证据和隐私不变量；不凭客户端 UI 计算能力事实，不把视觉改造扩展为新的评分或供应商能力。

本计划仍属于 `ALPHA-033`，按以下执行切片逐步完成；切片不是新的全局任务 ID。每个切片完成后单独验证并更新状态页，再继续下一个切片。

## 2. 已确认边界

### 包含

- `/learn` 的稳定断点、无学习记录、静默方向和数据不可用状态的桌面信息层级。
- `/learn/practice` 的时间线、情境输入、统一宽度工作台、录音/文字、提示、反馈和技术失败恢复。
- 1280px、1440px 桌面优先；1024px/768px 语义降级；移动端不复制桌面 UI，只保持状态语义和现有底部导航。
- 键盘焦点、`aria-live`/`role=status`、`role=alert`、`prefers-reduced-motion`、44px 命中区、深浅主题对比度和无横向溢出。
- 真实按钮 loading、success、error、cancel 反馈；失败不产生负面能力证据，重复点击不重复写入。

### 不包含

- `mastery`、`confidence`、证据追加、关系记忆、评分算法或 provider 选择变更。
- 新的服务边界、实时双向语音、离线 ASR、支付、外部来源抓取或完整内容后台。
- 本切片将浏览器 checkpoint 迁移为服务端持久化；若需要服务端 `LearnDashboardDTO`，先建立独立契约/数据任务，不在视觉改造中偷偷替换事实来源。
- Flutter 页面视觉重写；Flutter 只在本切片后验证共享状态语义没有被破坏。

## 3. 当前实现基线与约束

- `/learn` 由 `app/(product)/learn/learn-page-content.tsx` 读取 `focus` 查询参数和浏览器训练 checkpoint；当前已有唯一主 CTA，必须保留该真实状态逻辑。
- `/learn/practice` 由 `FakeTrainingLoop` 渲染，状态机位于 `src/modules/training/domain/`，异步副作用带 `generationId`，checkpoint 通过 `src/modules/training/checkpoints/` 保存。
- 当前 `.focus-card` 在桌面被无内容的右列压窄；训练 context 和 workbench 的 max-width 不一致。实现应优先通过 CSS Grid、条件渲染和同一内容列令牌解决，不重写训练 reducer。
- 当前仓库存在其他代理未提交改动：`src/shared/ui/surface-state.tsx`、`tests/unit/surface-state.test.tsx` 及账号菜单设计文档；实施时不得覆盖或重排这些改动。

## 4. 执行切片

### 切片 A：桌面学习壳层与 `/learn` 时间线

目标：把现有首页主任务从窄卡片改为“主时间线 + 条件详情”，不改变推荐/断点事实。

计划修改：

- `app/(product)/learn/learn-page-content.tsx`
  - 将当前 focus 内容映射为时间线节点 DTO（已完成、当前、待解锁）；节点顺序由已有内容和 checkpoint 派生，不在组件内计算 mastery/confidence。
  - 为 `hasProgress`、无记录、静默方向和 checkpoint 不可用保留单一主 CTA；不可用状态使用明确重试/说明，不渲染假进度。
  - 将阅读库、Lucía、探索入口降为主任务下方的辅助入口；文章不可用继续使用非交互空状态。
  - 为动态恢复增加稳定的 `role=status` 文案和按钮 disabled/loading 语义。
- `app/globals.css`
  - 新增学习页桌面令牌和 `learn-desktop-shell`、`learn-timeline`、`learn-detail-rail` 等局部类；避免继续复用通用 `.main` 造成滚动容器冲突。
  - 1280/1440px 使用固定左栏 + 12 列主区；详情 DTO 为空时主区跨 12 列，不保留空列。
  - 1024px 详情折叠为顶部/当前节点下方；768px 以下沿用移动底栏和单列安全区。
- 如现有测试需要可读选择器，优先使用 `data-testid`/语义 role，不以页面快照作为行为断言。

验收：新用户只显示“开始第一次练习”；有真实 checkpoint 只显示“继续学习”；三种状态的主 CTA 均有即时可观察结果；1280/1440px 无横向滚动且详情 rail 不挤压主任务。

### 切片 B：`/learn/practice` 统一训练工作台

目标：保持现有 `TrainingState`/`TrainingEvent` 和副作用生命周期，只改变页面编排，使情境、工作台、反馈和错误共享同一主列宽。

计划修改：

- `src/modules/training/ui/fake-training-loop.tsx`
  - 抽出页面级训练时间线（已完成 → 当前 → 待解锁）和右侧详情数据；状态仍完全由 reducer 产生。
  - 将 `presenting-input`、`awaiting-output`、`recording`、`transcribing`、`evaluating`、`showing-feedback`、`completed`、`recoverable-error` 保持在同一工作台容器内条件替换。
  - 为录音、转写、评估、取消和重试补齐 `aria-live`/`role=alert`、可见进行中文案与 disabled 状态；保留文字回答不产生口语证据的说明。
  - 详情 rail 只显示已确认的证据强度、提示级别、输出方式和录音隐私，不显示实时严格发音分数。
- `app/globals.css`
  - 统一 context/workbench/feedback 的 max-width 和 gap；删除桌面下不必要的窄左对齐规则。
  - 为 `prefers-reduced-motion` 提供无动画最终态，确保录音提示不依赖颜色或波形动画。

验收：技术失败在工作台内显示“没有产生负面能力记录”和“再试一次”；旧 generation 回调不覆盖新状态；成功反馈只能在显式 `done`/完成事件后出现；完成后稳定 checkpoint 和下一句入口可见。

### 切片 C：交互、可访问性与跨视口回归

计划修改：

- `tests/unit/learn-page.test.tsx`
- `tests/unit/fake-training-loop.test.tsx`
- `tests/e2e/training-loop.spec.ts`
- 必要时新增 `tests/e2e/learn-page.spec.ts`，覆盖首页唯一主 CTA、断点恢复和数据不可用重试。
- 必要时在 `tests/unit/` 增加时间线节点映射、详情 rail 空状态和主 CTA 状态转换测试。

重点断言：

1. `/learn` 无记录、断点、静默和加载失败不会出现假进度或第二个同权主 CTA。
2. 点击继续/开始/重试时，按钮进入 loading，成功/失败/取消均停在可恢复位置。
3. `/learn/practice` 录音、文字、提示、反馈和错误的可用动作与 `TrainingState` 一致；文字输入不调用发音证据路径。
4. 1280、1440、1024、768、414、375、320px 无横向溢出；桌面详情按断点折叠；移动底栏顺序不变。
5. 键盘可到达当前节点、主 CTA、提示和错误恢复；状态播报不重复；深浅主题和 reduced-motion 均可读。

### 切片 D：发布候选门禁交接

- 运行受影响的 Vitest 和 Playwright，随后按发布候选范围运行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:e2e`、`pnpm build`。
- 涉及 Flutter 时运行 `flutter analyze`、`flutter test`；明确记录没有 Mac/Xcode 时不能声称 iOS 编译或真机验收通过。
- 若全量检查受已有 fixture/worker/环境阻塞，记录精确命令、失败原因、是否为本切片引入，并在 `PROJECT_STATUS.md` 保留发布阻断项。
- 只提交与 F 方案相关的代码、测试和文档；每个切片一个清晰英文前缀 commit。

## 5. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 现有 checkpoint 仅在浏览器 localStorage | 本计划只做视图适配；不伪造服务端事实，服务端 dashboard DTO 另立数据任务。 |
| 通用 `.main` 类覆盖外层滚动 | 学习页面内部使用 feature-specific 类名，回归断言滚动容器 `scrollHeight > clientHeight`。 |
| 状态 UI 与 reducer 漂移 | 组件只消费 `TrainingState`，为每个状态补单元测试和 E2E 行为断言。 |
| 桌面 rail 在窄宽度挤压主任务 | 1024px 开始折叠，低于 960px 单列；测试禁止横向溢出。 |
| 视觉改造误触证据/隐私逻辑 | 不改 application/provider/repository；只透传服务端/状态机已确认字段，失败状态明确不写证据。 |

## 6. 完成定义

- 设计文档、预览和本实施计划保持一致，未引入 Alpha 延后范围。
- `/learn` 和 `/learn/practice` 在桌面优先布局下可完成或恢复核心路径，且所有状态有可观察文案和动作。
- 关键状态、取消、过期回调、数据不可用、无证据和权限失败有自动化回归。
- `git diff` 只包含本切片预期改动；状态页记录 commit、测试、限制和下一切片。
- 产品本人在视觉预览和实现后的关键路径上再次确认后，才将本次收敛结果作为发布候选的一部分。

## 7. 开始实现前的停点

本计划已由产品本人确认 F 方向后建立。进入切片 A 前需要协调者在 `PROJECT_STATUS.md` 中确认 `ALPHA-033` 的当前负责人和代码切片；在此之前不直接修改学习业务代码。
