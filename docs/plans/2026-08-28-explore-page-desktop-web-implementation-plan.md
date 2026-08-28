# Sueño 探索页桌面 Web「目标索引 + 内容网格 + 详情 rail」实施计划

- 日期：2026-08-28
- 状态：已获产品确认，待进入代码实施
- 任务：`ALPHA-033`
- 目标分支：`fix/login-redirect-after-otp`
- 设计依据：[`2026-08-28-explore-page-desktop-web-design.md`](../superpowers/specs/2026-08-28-explore-page-desktop-web-design.md)
- 调研依据：[`2026-08-28-explore-page-desktop-web-technical-research.md`](../superpowers/specs/2026-08-28-explore-page-desktop-web-technical-research.md)

## 1. 目标

将当前 `/explore` 的静态目标列表与单个草稿卡片升级为桌面优先的真实发现工作区：顶部意图过滤、沟通目标索引、继续探索条、已发布内容网格和选中后的条件详情 rail。保持服务端内容发布、训练、证据、画像、隐私和角色不变量不变；客户端不能自行推导能力事实或伪造内容状态。

本计划是 `ALPHA-033` 的一个可验证子切片。每个切片完成后单独检查并更新状态页，再继续下一个切片。

## 2. 已确认边界

### 包含

- Next.js `/explore` 桌面布局，1280/1440px 为主要验收视口。
- 1024px 以下 rail 折叠为抽屉或卡片下方区域；320–767px 保持单列语义和五项移动导航。
- 真实内容状态：`published`、`in_progress`、`draft`、`unavailable`；状态决定是否允许进入、继续或重试。
- 意图输入第一版只做已知沟通目标匹配和过滤，不调用自由生成聊天，不写证据。
- 键盘焦点、ARIA 名称/状态、44px 命中区、深浅色主题、reduced-motion 和无横向滚动。

### 不包含

- 不改变评分、mastery/confidence、证据事件、关系记忆、RLS 或供应商协议。
- 不新增任意 URL/RSS/Newsletter 导入、开放社交网络、实时双向语音、支付或角色商城。
- 不把阅读、打字或内容浏览直接写入口语证据。
- 不在本切片重写 Flutter UI；只检查共享 API/状态语义没有漂移。

## 3. 当前实现基线与约束

- `/explore` 当前由 `app/(product)/explore/page.tsx` 提供服务端静态集合和内容包卡片；草稿状态必须继续保持非交互。
- 内容包真实字段位于 content/reading application 层；组件不能直接读取数据库行或拼装发布状态。
- `/learn`、`/learn/practice` 和 `/read` 已有暖编辑式令牌与五项导航，探索页应复用语义变量和 feature-specific class，避免修改全局颜色含义。
- 当前工作区存在其他代理未提交改动（对话、surface state、tsconfig 等）；实施时只触碰 Explore 相关文件与必要契约/测试。

## 4. 执行切片

### 切片 A：Explore Dashboard DTO 与状态映射

目标：建立应用层聚合 DTO，明确卡片字段和状态转换，页面不再依赖静态数据库行或客户端猜测。

计划修改：

- 在 `src/modules/content/` 或现有 explore application 边界新增 `ExploreCardDto`、`ExploreGoalDto`、`ExploreDashboardDto` 及 `ExploreCardStatus`。
- 聚合真实内容包版本、审核/版权状态、用户断点、保存标记和更新时间；缺失数据库/配置时返回结构化 `unavailable`，不返回假数据。
- 新增只读 route handler（建议 `/api/v1/explore/dashboard`），由鉴权、Zod 校验和 application use case 组成；Route Handler 不直接查询数据库。
- 为 `published`、`in_progress`、`draft`、`unavailable`、无内容和权限失败补充单元/契约测试。

验收：同一用户只读到自己的进度/保存状态；草稿无训练 route；旧版本内容不被静默覆盖；错误可重试且不产生证据。

### 切片 B：桌面 `/explore` 工作区与详情 rail

计划修改：

- `app/(product)/explore/page.tsx`：读取 Dashboard DTO，渲染意图输入、继续条、五目标索引、内容分组和选中卡片。
- 如需交互状态，新增 `explore-page-content.tsx`，只管理选中目标、rail 开关、输入过滤和 URL query/hash；不持有能力事实。
- 详情 rail 只在选中卡片时渲染；底部仅保留一个主动作，动作 route 由 DTO 提供；draft/unavailable 只显示解释。
- `app/globals.css`：新增 Explore feature-specific 网格、rail、卡片状态、hover/focus/reduced-motion 规则；复用现有暖米白、赤陶、灰绿色令牌。
- 保持当前 `/learn?focus=...` 目标入口；内容包仍进入已存在的 `/explore/packs/[packKey]` 或 DTO 指定 route。

验收：1440px 下主内容和 rail 不互相挤压；无选中内容时不留空 rail；目标切换、卡片选择、保存和返回均有可观察结果；不存在假按钮。

### 切片 C：筛选、回访和错误状态回归

计划修改：

- `tests/unit/explore-page.test.tsx`：目标切换、状态标签、唯一主动作、rail 条件渲染、意图无匹配和无内容状态。
- `tests/unit/`：Dashboard DTO、状态映射、所有权和不可用错误；必要时增加 route handler 契约测试。
- `tests/e2e/explore-page.spec.ts`：桌面 1280/1440、1024 rail 折叠、移动单列、键盘 Tab、published 进入、in_progress 继续、draft 不可点击、unavailable 重试。
- 检查 URL query/hash 可深链到目标，浏览器返回不会丢失筛选或 rail 状态。

重点断言：

1. 输入只匹配已知目标，不调用自由生成接口；无匹配有解释性空状态。
2. 低置信度/技术失败只显示可恢复错误，不创建学习证据。
3. 选中卡片后详情 rail 的主动作与状态一致；关闭 rail 后焦点回到触发卡片。
4. 320–1440px 无横向滚动，sticky rail 不遮挡焦点，reduced-motion 仍可完成流程。

### 切片 D：发布候选门禁交接

- 先运行 Explore 相关 Vitest、契约测试和 Playwright，再按候选范围运行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:e2e`、`pnpm build`。
- 若新增 Flutter DTO 或共享 fixture，再运行 `flutter analyze`、`flutter test`；没有 Mac/Xcode 时不声称 iOS 编译或真机验收通过。
- 环境/数据库不可用时记录精确错误和恢复路径，不以 fixture 硬编码替代真实状态。
- 每个切片一个清晰英文前缀 commit，并在 `PROJECT_STATUS.md` 记录修改、测试、限制和下一步。

## 5. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 内容数据仍只有一个草稿包 | DTO 明确空/整理中状态；视觉上保持可读，不填充假卡片 |
| 详情 rail 破坏桌面滚动 | 1440/1280/1024 三档回归，1024 开始折叠，检查焦点可见 |
| 意图输入被误解为 AI 对话 | 文案和 DTO 限定为目标匹配；不发送自由文本给生成 provider |
| 卡片点击重复创建进度/证据 | 主动作复用现有幂等训练入口，按钮 loading/disabled，状态由服务端或 checkpoint 决定 |
| 客户端缓存越权显示 | Dashboard API 做用户所有权校验；缓存只作为短期恢复，不作为事实来源 |

## 6. 完成定义

- 设计文档、预览和本计划一致，未引入 Alpha 延后能力。
- Explore 页面由真实 DTO 驱动；发布、断点、草稿和不可用状态都有明确视觉与行为。
- 目标索引、筛选、rail、回访和错误恢复具备单元与 Playwright 行为断言。
- 桌面优先布局在 320–1440px 无横向滚动，键盘和 reduced-motion 可用。
- 状态页记录每个切片 commit、测试结果、限制和下一步；产品本人完成人工视觉复核后再并入发布候选。

## 7. 开始实现前的停点

本计划已获产品本人确认。进入切片 A 前，协调者需确认当前 `ALPHA-033` 负责人和是否已有 Explore application/DTO 任务在进行；确认后才修改业务代码。

