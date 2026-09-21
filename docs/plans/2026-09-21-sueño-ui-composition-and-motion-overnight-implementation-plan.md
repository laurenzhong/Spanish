# UI-SYSTEM-001 Sueño UI 组合层与动效规范夜间实施计划

- 任务 ID：`UI-SYSTEM-001`
- 日期：2026-09-21
- 状态：`review`；`UI-SYSTEM-001A–F` 的实现和 `001G` 全量门禁已存在于 `codex/public-home-001` 当前工作树，但尚未作为本任务提交、合并或部署；`001H` 本地生产预览性能门禁已通过，`001I` 可信 light/dark axe 扫描已通过，`001J-final` 已补齐本地 fixture provenance 但仍为 `partial`，仓库外 artifacts 与交接已生成
- 目标：在不改变学习评分、权限、角色真实性、内容审核和记忆隔离的前提下，建立可复用基础组件层、统一动效合同，并按页面切片收敛交互密度。
- 设计依据：[技术调研与决策规格](../superpowers/specs/2026-09-21-sueño-ui-composition-and-motion-technical-research.md)
- 架构边界：[ADR-0010](../adr/0010-sueño-ui-composition-and-motion.md)
- 页面/组件契约：[页面/组件契约与状态矩阵](../superpowers/specs/2026-09-21-sueño-ui-component-contracts-and-state-matrix.md)
- 运行手册：[夜间运行手册](../operations/2026-09-21-sueño-ui-system-001-overnight-runbook.md)
- 验收矩阵：[UI-SYSTEM-001 验收矩阵](../testing/2026-09-21-sueño-ui-system-001-acceptance-matrix.md)
- 夜间模式：无人值守只允许本地 fake/fixture、静态检查、组件测试、隔离 Playwright 和构建；不得访问生产、采集/发布内容、调用收费 Provider、写真实学习进度或清理数据。

## 进展核对（2026-09-21）

- 视觉复核补充：Explore/Read 保持原有页面结构，仅收敛内容工作区层级与控件样式；用户复核后移除了新增的页面级视觉头部，保留 Explore/Read 原有 `sr-only` 语义标题。此前视觉 pass 的截图只作为历史证据，不代表当前仍渲染页面级头部。
- 回滚后最终状态的 axe 复扫为 8 路由 × light/dark 16/16，artifact 位于 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-after-rollback\axe-results.json`；本地服务端 HTML 也确认新增头部文案不再输出。
- `001A–C`：基础 primitives、motion/focus/reduced-motion token、MediaLibrary 生命周期、公共页 server/client 拆分和 `picture` 响应式媒体源已在工作树完成。
- `001D–F`：`/explore`、`/read`、`/chat`、`/me` 和内容工作流已接入本地 primitives/高价值交互；服务端评分、generation/done、权限、revision/hash/publishable 和隐私边界未改变。
- 本轮证据：桌面与移动 `product-shell` 均为 `25/25`；移动核心 conversation/explore/content workflow `23/23`；公开首页 `1/1`；阅读 shelf/article `1/1`；最新全量 Vitest `220/220 文件、950/950 tests`；全量 E2E `171/172`（1 skip）；typecheck、目标 lint、`git diff --check` 和 build 通过。全量 lint 仍命中 `.tmp-runtime` 生成物并标记 `baseline-known`。`001G` 仓库外 artifacts 与交接已完成；`001H` 在隔离 `next start`、4× CPU/慢 4G 近似条件下完成 1440×900 与 375×812 各 5 次冷上下文采样，桌面 LCP/FCP p75 1,724ms、移动 1,548ms，结果为本地生产预览 `pass`；`001I` 在本地 fake/fixture Chromium 完成 8 路由、16 个 light/dark 扫描，axe 四级 violation 均为 0；最新 `001J-final` 完整记录 provenance，桌面/移动各 9/9，18 个 artifact 中 14 个 `pass`、4 个 `partial`，最大 action latency 262.7ms、Event Timing p75 104ms、最大长任务 100ms、CLS 0，因此 J 总体仍为 `partial`。历史 `001J-after` 仅保留作对照，不作为最新结论。
- 当前工作树仍有并发 dirty/untracked 文件，尚未生成 UI-SYSTEM-001 独立 commit；真实 iPhone Safari、部署、生产数据库和收费 Provider 不属于夜间证明范围。

## 1. 完成定义

任务只有同时满足以下条件才可标记 `review`：

- 共享 primitives 有明确源码归属、许可证来源、token、状态和无障碍测试。
- 页面切片没有重复主入口、伪按钮统计、不可恢复错误或通过动画掩盖业务状态。
- 学习页仍打开真实视频/播客资料库；阅读承载文字与词句；对话流仍要求显式 `done`；旧 generation 不更新当前状态；技术失败/低置信度不扣能力；内容发布门禁仍在服务端。
- 相关单元/组件/E2E、lint、typecheck、build 和 `git diff --check` 已按本计划运行并记录。
- 真实 iPhone Safari、部署、真实数据库/Provider 若未执行，必须在交接中单独列出，不能用 fake 结果替代。

## 2. 夜间批次顺序

每一批是可独立回滚和验收的提交。批次之间必须保留工作树边界，不能把所有页面混成一个提交。

### 2.0 执行图与依赖

夜间 runner 按以下依赖执行，不得因某一批失败而跳过它依赖的质量门：

```text
001A 基线/来源/token
        ↓
001B primitives + 行为测试
        ↓
001C 公开页 server-first + 媒体库生命周期
        ↓
001D 学习/探索/阅读 ─────┐
        ↓               │
001E 对话高价值交互 ────┤
        ↓               │
001F 我的/内容工作流 ───┘
        ↓
001G 全量质量、差异台账、交接
        ↓
001H 生产构建性能基线（本地生产预览通过；不等同部署/真实设备通过）
        ↓
 001I 路由无障碍自动门禁（仅测试依赖，未在 H 引入）
        ↓
 001J 本地交互复测（`001J-final` 已完成 provenance）；生产预览待按批准环境运行
```

`001D–F` 可以在 `001C` 的静态检查和定向测试通过后分开执行，但不能并行改同一页面或共享 primitive 文件。每批开始前重新读取当前 `git status`，发现无法归属的并发修改就停在该批并保留日志。

### `UI-SYSTEM-001A` 基线、来源与 token

**范围**

- 记录 shadcn/beUI/Rare/Transitions/Beautiful UI 及替代候选的 URL、版本、许可和复制文件。
- 对商业/闭源/托管/平台原生候选记录 `adopt|trial|reference-only|reject|not-run`、价格/合同或许可、DPA/数据流、CVE/安全核对、bundle/SSR/无障碍证据、owner、退出与本地回退；夜间不注册试用或发送遥测。
- 增加本地 UI registry 约定（可使用 `components.json` 或等价 Markdown/JSON 清单，但不能把远端 registry 当运行时依赖）。
- 建立 `.sueño`/CSS token 层：motion duration/easing、focus、z-index、surface、control size、reduced-motion。
- 只添加最小基础组件目录，不改业务页面结构。

**门禁**

- `pnpm lint`、`pnpm typecheck`、`pnpm test --run` 相关组件测试通过。
- `git diff --check` 通过；许可证扫描能追溯每个复制文件的来源。
- 非开源/托管候选字段完整，缺字段只能 `reference-only`，不能进入页面 bundle。
- light/dark、keyboard、reduced-motion 的 Story/fixture 能渲染。

### `UI-SYSTEM-001B` 基础 primitives

**范围**

- 复制/实现 Skeleton、Tooltip、Popover、Tabs、Sheet、AlertDialog、ScrollArea、Select/Command 中实际需要的最小集合。
- 使用原生 HTML 或 Radix 行为；不要同时引入 Base UI、Headless UI、React Aria。
- 组件 API 只表达视觉/交互状态，不接受 mastery、confidence、evidence 或 publishable 事实。

**门禁**

- 每个 primitive 有 loading/open/closed/disabled/empty/error 状态测试。
- Dialog/Sheet/Popover：焦点进入、Escape、关闭恢复焦点、遮罩点击策略、窄屏滚动和 `aria-*` 状态通过。
- Tabs/Select/Command：键盘操作、选中态和无鼠标操作通过。
- `prefers-reduced-motion` 下无位移依赖，内容和焦点仍可达。

### `UI-SYSTEM-001C` 公共页与媒体库性能修复

**范围**

- 将 `app/public-home-experience.tsx` 拆为 server/static shell + 最小 journey client island；保持文案、链接、真实产品图和现有公开页验收行为。
- 修复 `MediaLibrary` scroll/IntersectionObserver 生命周期：稳定 ref/callback，必要时 rAF/throttle，避免重复 observer 和 setState 风暴。
- 记录生产构建 client/CSS 产物基线；不把 dev bundle 作为正式预算。

**门禁**

- `/` 桌面 `1440x900`、移动 `375x812`：HTTP 200、无框架 overlay、无横向溢出、首屏露出下一段、journey button 可操作。
- `prefers-reduced-motion` 与标签页隐藏时不出现持续动画/错误；链接和 alt text 保留。
- `/learn` 空/失败/成功 fake fixture 仍显示真实媒体库语义，不出现 Hero 或开始/继续学习 CTA。
- `MediaLibrary` 加载更多只触发一次；失败可重试；滚动不产生明显 jank。

### `UI-SYSTEM-001D` 学习、探索、阅读切片

**范围**

- `/learn`：Skeleton、Tooltip、Popover/Select；媒体卡和 toolbar 保持内容优先。
- `/explore`：Tabs/Command/Popover/Sheet；把统计保持为非交互状态；只在真实进度存在时使用 Step Player/Scroll Progress。
- `/read` 与文章阅读器：筛选/排序/添加菜单、解释浮层和进度；正文宽度、保存、来源和版权不变。

**门禁**

- 搜索、筛选、排序、分页、打开详情、解释词语、保存/删除的真实点击结果有 Playwright 断言。
- 关键控件可用键盘完成；弹层焦点不被 sticky UI 遮挡。
- 页面在 375、768、1024、1440 宽度无横向滚动；dark/light 对比度达标。
- 不增加新的主 CTA；不把阅读/打字写入口语证据。

### `UI-SYSTEM-001E` 对话高价值交互

**范围**

- 只复制/组合 beUI 的 MessageScroller、Prompt/Composer、Toast、Drawer 中必要部分；Transitions.dev 只提供 text swap/error/skeleton 模式。
- 保留 `ChatThread` 现有 state machine、`ConversationNdjsonParser`、generationId、缓存/刷新、取消、显式 done、角色安全和关系记忆规则。
- 评估 Floating UI 处理消息菜单、引用菜单、翻译/词语浮层的定位边界。

**门禁**

- 流式回复：token 更新可见；没有 `done` 时不显示完成；断流/超时有重试且不重复写消息。
- 发送、录音、转写、停止、引用、翻译、联系人菜单和移动 Drawer 有真实状态断言。
- 键盘 Escape/Tab、屏幕阅读器 live region、消息滚动跟随/新消息提示通过。
- 不引入 assistant-ui/AI SDK runtime；无“思考过程”伪造，不在表达未完成前纠错。

### `UI-SYSTEM-001F` 我的、内容工作流与全站一致性

**范围**

- `/me`：Tabs/Accordion/AlertDialog/Toast，收敛空态和隐私操作。
- 内容审核：AlertDialog、Skeleton、Toast；审核、revision、权利和显式发布仍服务端决定。
- 统一 icon button、focus ring、status/error/empty 文案与 token；清理只在本任务新增的选择器范围内进行，不重写 12k 行全局 CSS。

**门禁**

- 数据导出、删除、语音保留、关系记忆共享和内容发布/撤下都要求正确确认/权限结果。
- 空态不产生假操作；错误有一个清晰恢复动作；toast 不抢焦点。
- 深浅色、键盘、reduced-motion 和 1024px/1440px 布局回归通过。

### `UI-SYSTEM-001G` 全量质量与交接

**范围**

- 汇总组件、页面和性能基线；生成差异台账和未验证项。
- 运行全量门禁；只在所有批次提交后做一次，不把全量失败隐藏到夜间日志。

**命令**

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:e2e
pnpm build
git diff --check
```

`001G` 的全量门禁必须和 baseline 分开报告。媒体 fixture/schema/error-code 的 4 项历史失败已修复并由最新全量 Vitest `950/950` 关闭；全量 lint 仍扫描 `.tmp-runtime` 生成物，只能标记 `baseline-known`，不得删除生成物、放宽规则或修改无关源码。目标 UI 文件 lint、定向测试、typecheck、build 和相关 Playwright 均通过；E2E 1 项 skip 保留原测试标记，未把它写成通过。

### `UI-SYSTEM-001H` 生产构建性能基线

**范围**

- 在生产构建和隔离 `next start` 上，以 Chrome、4× CPU throttling、慢 4G 近似网络、`zh-CN`/`Asia/Shanghai`、每视口 5 次冷上下文采样匿名 `/`。
- 保存 Web Vitals、HTTP 状态、横向溢出、桌面/移动首屏截图和复现命令；只测量实验室条件，不访问生产或真实用户数据。

**结果**

- `1440×900`：隔离 `next start`、HTTP 200、无溢出、CLS 0、TTFB p75 10.8ms；LCP/FCP p75 1,724ms，满足 LCP 2.5s 和 FCP 1.8s 预算。
- `375×812`：隔离 `next start`、HTTP 200、无溢出、CLS 0、TTFB p75 4.2ms；LCP/FCP p75 1,548ms，满足 LCP 2.5s 和 FCP 1.8s 预算。
- INP 为 0 仅表示本 H 脚本没有产生可测交互样本，不能作为 INP 通过；筛选、Popover、发送/停止的交互测量由 J-final 补齐，仍有超 200ms 样本。
- 传输大小、长任务、帧率和真实设备 p75 未在 H 批次测量；这些项目保持 `not_run`。

**证据**：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001H\performance.json`、`screenshots\desktop.png`、`screenshots\mobile.png`、`acceptance.json`、`commands.txt`、`manifest.json`、`handoff.md`。H 通过本地生产预览实验室门禁，但不证明部署/CDN、真实 iPhone Safari 或真实设备 p75。

### `UI-SYSTEM-001I` 路由无障碍自动门禁（已执行；当前结果通过）

**范围**

- 在 fake/fixture 路由上评估 `@axe-core/playwright`（测试专用）和 `eslint-plugin-jsx-a11y`（静态提示）；不把它们加入产品 runtime，不上传 DOM、消息或录音。
- 覆盖 `/`、`/learn`、`/explore`、`/read`、文章阅读器、`/chat`、`/me` 和内容工作流的 light/dark、reduced-motion、错误/空态入口。
- 机器门禁只认 `critical/serious = 0`；`moderate` 必须登记原因、owner、回归测试和截止批次。键盘、读屏、forced-colors、200% zoom 和真实 iPhone 仍需人工证据。

**停止条件**：依赖许可证/版本无法锁定、扫描导致真实用户数据出网、或把 axe 结果误写成完整 WCAG 通过时停止；保持本地 primitives 与现有 Playwright/RTL。

**当前结果**：`tests/e2e/ui-system-accessibility.spec.ts` 在隔离端口使用 fake/fixture 与本机 Chromium fallback 执行 16/16（8 路由 × light/dark）扫描；每条路由先断言预期 heading，随后运行默认 motion 的 `wcag2a/wcag2aa` axe 检查，`critical/serious/moderate/minor` 均为 0。权威 artifact：`D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json`。这只证明当前 DOM 的自动门禁，不替代读屏、完整键盘、forced-colors、200% zoom、真实 iPhone Safari 或部署验收。此前首页 `.72` scroll-reveal opacity 造成的 contrast 失败已通过只使用 transform 的动效修复。

### `UI-SYSTEM-001J-final` 本地交互复测（生产预览待运行，部署复测待人工批准）

**范围**

- 在同一生产 build 条件下执行筛选、Popover 打开/关闭、消息发送/停止等真实交互，记录代表性 INP、长任务和 trace；补采集 CSS/JS transfer、资源瀑布和帧预算。
- 可选使用 Lighthouse CI/`web-vitals` 作为测试/诊断工具，但必须固定版本、artifact、路由模板和脱敏字段；不接 Sentry、LogRocket、FullStory 等托管遥测。
- 在部署预览环境重复 H 的匿名首页采样；生产/CDN、真实 iPhone Safari 和 PWA 安装由人工批准的发布验收执行。

**门禁**：LCP ≤2.5s、FCP ≤1.8s、TTFB ≤800ms、CLS <0.10、代表性交互 INP ≤200ms；任一超标标记 `partial`/`blocked`，先优化 server shell、字体、媒体 preload 和 client island，不先引入新动效 runtime。

001J-final 当前执行结果：交互性能 Playwright fixture 覆盖 `/learn` 筛选 Popover、`/explore` 筛选导航、`/chat/lucia` 发送/停止；使用完整 `before.txt`、预热后的隔离 Next dev server 和可注入批次名，桌面 9/9、移动 9/9 通过。18 个 artifact 中 14 个为 `pass`、4 个因 action latency 超过 200ms 为 `partial`；最大 action latency 262.7ms，Event Timing p75 最大 104ms，最大长任务 100ms，CLS 全为 0。历史 J-current/J-after 仍保留作对照；J-final 的权威 artifact 位于 `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\`。Lighthouse、部署预览、真实 iPhone Safari、CDN/字体、帧率和长运行内存仍未执行。

### 2.1 批次门禁与回滚表

| 批次 | 文件边界 | 输入/前置 | 必跑门禁 | 产物 | 回滚点 | 阻塞后续 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001A | 研究、ADR、token、`components.json` | 当前 HEAD + dirty 所有权核对 | 文档链接/许可证字段、diff check | `before.txt`、来源登记、token diff | 输入 HEAD | 是，缺证据不得复制组件 | 已实施，待独立 manifest |
| 001B | `src/shared/ui/primitives`、primitive tests、scoped CSS | 001A 通过 | typecheck、目标 lint、primitive Vitest、键盘行为 | unit log、组件截图、`acceptance.json` | 001A 回滚 ref | 是，页面不得绕过行为合同 | 已实施，待独立 manifest |
| 001C | public home、MediaLibrary、相关 tests | 001B 静态检查通过 | build、public-home tests、Playwright 1440/375、request log | screenshots、trace、bundle 记录 | 001B 回滚 ref | 否，D-F 可在其后独立继续 | 已实施，待独立 manifest |
| 001D | explore/read/article、相关 tests | 001C 通过；不改 chat/me 同文件 | target lint/typecheck、read/explore Vitest、Playwright | route screenshots、keyboard trace | 001C 回滚 ref | 仅阻塞依赖 D 的后续修复 | 已实施，待独立 manifest |
| 001E | chat surfaces/composer、conversation tests | 001C 通过；不替换 parser | conversation Vitest、desktop/mobile Playwright、diff check | stream/stop/retry trace | 001C 回滚 ref | 仅阻塞 chat 交接 | 已实施，待独立 manifest |
| 001F | me/profile/content workflow、相关 tests | 001C 通过；服务端门禁不变 | profile/workflow Vitest、AlertDialog/failure tests、target lint | confirmation/error screenshots | 001C 回滚 ref | 仅阻塞隐私/审核交接 | 已实施，待独立 manifest |
| 001G | 状态页、验收/差异台账 | D-F 结果齐全 | 全量 lint/test/e2e/build + baseline 分类 | manifest、handoff、全量日志 | 最后成功批次 | 是，未分类失败不得 review | 已完成，待用户/合并者复核 |
| 001H | 生产构建匿名首页性能基线 | G 全量门禁记录 | 隔离 `next start`、4× CPU/慢 4G、两视口各 5 次、Web Vitals/溢出/截图 | `performance.json`、截图、`acceptance.json`、manifest、handoff | G 最后成功批次 | 否；本地 `pass` 不得升级为部署/真实设备通过 | 已完成，本地生产预览 `pass` |
| 001I | 关键路由无障碍自动扫描与静态提示 | H artifact 已记录；测试依赖需人工批准 | axe critical/serious=0、jsx-a11y、键盘回归 | `D:\temp\sueno-ui-system-001\UI-SYSTEM-001I-final\axe-results.json` | H 最后成功批次 | 是，扫描失败不得升级 review | 已执行，16/16 通过；人工辅助技术仍待验收 |
| 001J-after（历史） | 本地交互复测（历史对照） | I 通过或明确跳过 | 交互 Event Timing/action latency、长任务、transfer | `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-after\` | I 最后成功批次 | 否，结果不再作为最新结论 | 历史优化后 18/18 fixture `pass`；provenance 不完整 |
| 001J-final | 本地交互复测（生产预览待运行） | I 通过或明确跳过 | 交互 Event Timing/action latency、长任务、transfer；Lighthouse/预览待批准 | `D:\temp\sueno-ui-system-001\UI-SYSTEM-001J-final\` interaction JSON、acceptance、manifest、handoff | I 最后成功批次 | 是，超预算需人工决策 | 18/18 本地 fixture 执行；14 `pass`、4 `partial`；J 总体 `partial`；部署/Lighthouse `not_run` |

回滚只允许由人工依据 `rollbackRef` 执行 `git revert <batch-commit>`；未提交批次写 `outputHead: uncommitted`，不能用其他分支 SHA 代替。发现目标文件有无法归属的并发修改时，runner 停止写入并把批次标为 `blocked`，不得自动合并或覆盖。

## 3. 无人值守执行协议

1. 开始前记录 `git status --short --branch`、HEAD、`git worktree list`；发现用户/并发修改时只读，不覆盖、不 reset、不清理。
2. 每批只修改任务范围内文件；文档、组件、页面和测试按批次提交，提交标题使用 `feat(ui): ...`、`test(ui): ...` 或 `docs(ui): ...`。
3. 单元/组件测试默认使用 fake；不读取真实 `.env` 以外的生产连接，不执行 `db:migrate`、采集、发布、删除、收费 Provider 或真实录音处理。
4. 每个长命令设置超时和日志文件；失败后最多重试一次。第二次失败保留日志、标记批次 `blocked`，继续执行不依赖该批次的静态文档/测试汇总。
5. 只允许在本地隔离端口运行 Playwright；如果 Browser plugin 不可用，明确记录“使用 Playwright fallback”，不把 Chromium mobile viewport 写成 iPhone Safari 通过。
6. 夜间结束时输出批次表：提交、修改文件、测试、未执行项、失败日志路径、回滚点、下一步。没有明确 done 的流、迁移或部署不得写成完成。

每批 runner 必须使用仓库外的互斥锁和独立端口，并记录创建的进程 PID；批次结束只清理本批创建且仍归属明确的进程。幂等的测试、构建或浏览器启动最多重试一次；断言、类型和权限失败不自动重试。日志必须脱敏 email、JWT、Bearer、service key、签名 query、原始对话和录音内容。默认网络策略为 deny，未知 host 立即 abort。

### 3.1 每批可复现的记录格式

runner 将日志和截图写到仓库外的临时目录，例如 `D:\temp\sueno-ui-system-001\<batch>\`，避免污染工作树。每个批次至少保留：

| 文件 | 内容 |
| --- | --- |
| `before.txt` | 分支、HEAD、`git status --short --branch`、`git worktree list` |
| `commands.txt` | 实际运行的命令、开始/结束时间和退出码 |
| `test.log` | typecheck/lint/Vitest/Playwright/build 原始输出或摘要哈希 |
| `screenshots/` | 至少一个桌面和一个移动视口；交互前后各一张（若该批涉及 UI） |
| `acceptance.json` | 机器检查结果：`pass`/`fail`/`not_run`、证据路径、失败原因 |
| `handoff.md` | 修改文件、回滚点、未执行项、下一批前置条件 |

日志目录不保存 `.env`、token、原始录音、完整私密对话、生产数据或长期签名 URL。单个长命令超时后只允许按原命令重试一次；第二次失败必须停止依赖该命令的批次，不得循环重试。

## 4. 性能与质量预算

预算是回归闸门，不是把当前 dev 采样冒充生产目标：

| 指标 | 目标 | 超标处理 |
| --- | --- | --- |
| 首屏 CLS | < 0.10；媒体、骨架和字体有稳定尺寸 | 检查 aspect-ratio、Image 尺寸和 skeleton 占位 |
| 首屏 INP | 本地目标 < 200ms，真实设备另测 | 移除 scroll setState、减少 client island、拆重组件 |
| 动画主线程 | 常规状态只改 transform/opacity，60fps 目标 | 回退 CSS，删除 layout/blur/filter 动画 |
| 公开页 client JS | 不高于拆分前生产值；优先下降 | 保留 server 文案/媒体，隔离 journey island |
| 全局 CSS | 不新增无界重复覆盖；新增选择器必须 scoped | 追加 token/layer，禁止页面级 raw override |
| 列表 DOM | 现阶段首批 18 项可保留；稳定超过 100 行再虚拟化 | 以 profiling 证据触发 TanStack Virtual |
| 网络错误 | 任何错误有可见原因和恢复动作 | 不用 spinner/Toast 掩盖；保留空/失败 DTO |

性能实验必须按[验收矩阵](../testing/2026-09-21-sueño-ui-system-001-acceptance-matrix.md)使用生产 build、固定浏览器/字体/locale、4× CPU + 慢 4G、至少 5 次 p75 采样，并保存 Web Vitals/Lighthouse/Playwright trace JSON。`INP` 绑定筛选、popover、发送/停止等交互样本；`首屏露出下一段` 绑定具体 heading/element 的 `IntersectionObserver` 或 bounding box，而不是人工感觉。

## 5. 验收标准

### 功能与状态

- [ ] 每个页面/状态最多一个填充色主操作；统计、标签、锁定状态不使用 button 语义。
- [ ] loading、empty、error、retry、success、cancel 都有可观察结果；动画结束不是成功条件。
- [ ] 消息流只有显式 `done` 才进入完成；旧 generation、重复提交和断流不会更新/重复写入当前事实。
- [ ] 用户完整表达前不纠错；跟读、打字、阅读、时长不写入错误能力板块；技术失败/低置信度不扣能力。
- [ ] 内容候选仍经过来源/权利、独立语言/教学/结构审核和显式发布；客户端不能绕过门禁。

### 无障碍与响应式

- [ ] 全部新增交互原生可聚焦；Tab 顺序符合视觉顺序；icon-only 有名称。
- [ ] Dialog/Sheet/Popover 的焦点、Escape、关闭恢复和滚动锁定通过。
- [ ] Tabs/Select/Command 支持键盘；live/status/error 不重复播报。
- [ ] light/dark 正文对比度至少 4.5:1，非文本边界至少 3:1；颜色不是唯一状态信号。
- [ ] `prefers-reduced-motion` 下内容和焦点可用，动画被跳过或缩短；不依赖 hover-only。
- [ ] 375×812、768×900、1024×900、1440×900 无横向溢出、裁切、遮挡或固定底栏覆盖焦点。

### 性能与工程

- [x] 公开页静态结构保持 server-first；client island 只包含实际交互。
- [x] MediaLibrary scroll/observer 生命周期稳定；加载更多无重复请求，失败可重试。
- [x] 未达到真实阈值不引入 virtual list、复杂 spring、WebGL、全局 blur 或第二套 primitives。
- [x] H 本地生产预览性能：HTTP、overflow、CLS、TTFB、桌面/移动 LCP/FCP 均通过；INP、传输大小、帧率、长运行内存、部署/CDN 和真实设备保持未验证。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、相关 `pnpm test:e2e`、`pnpm build`、`git diff --check` 有日志和结果；全量 lint 的 `.tmp-runtime` 结果按 baseline-known 记录。
- [x] 许可证来源、复制文件和版本记录完整；没有秘密、原始私密对话、录音、生产数据或签名 URL。

### 交接与限制

- [x] 状态页标明分支、HEAD、未提交状态、修改文件、测试、未执行检查和下一步，不借用其他分支完成宣称。
- [x] 真实部署、真实 Supabase、收费 Provider、真实 iPhone Safari 如未执行，明确写为未验证。
- [x] 每个批次有回滚点；夜间失败可由人工按最后成功提交恢复，不依赖隐式进程或临时数据。

### 5.1 机器验收矩阵

下表是夜间 runner 可以直接实现的断言；“未执行”不能折算为通过。

| 检查 | 断言 | 证据 |
| --- | --- | --- |
| 页面身份 | URL、标题和主要 landmark 与路由匹配 | Playwright URL/title/DOM snapshot |
| 非空与无 overlay | 主要 heading、内容表面和操作存在；不出现 Next/React error overlay | DOM snapshot + console |
| 响应式 | `scrollWidth === clientWidth`；无固定栏遮挡焦点 | 375/768/1024/1440 脚本结果 + screenshot |
| 键盘 | Tab 顺序可达；Escape 关闭浮层并恢复 trigger；Tabs/Select 无鼠标可完成 | Playwright keyboard trace |
| 状态完整 | loading、empty、error、retry、cancel、success 均有可见/可读结果 | fake fixture 状态断言 |
| 动效降级 | reduced-motion 下内容顺序、焦点和主流程不变；无持续装饰动画 | `prefers-reduced-motion` trace |
| 媒体性能 | 首页每个 viewport 只请求一个公开产品图；尺寸稳定 | request log + layout probe |
| 流式安全 | chat 没有显式 `done` 不显示完成；旧 generation 不更新当前状态 | parser/state-machine unit test |
| 业务边界 | 阅读/打字/跟读/时长不写口语证据；客户端不能 publish；技术失败不扣能力 | domain/application regression test |
| 工程门 | typecheck、目标 lint、定向测试和 build 退出码为 0；全量失败必须列出 | `commands.txt` + `acceptance.json` |

推荐 `acceptance.json` 的最小形状：

```json
{
  "batch": "UI-SYSTEM-001D",
  "status": "pass",
  "checks": [
    { "id": "responsive.no-overflow", "status": "pass", "evidence": "screenshots/375.png" },
    { "id": "keyboard.sheet-focus-return", "status": "not_run", "reason": "Browser plugin unavailable; fallback not configured" }
  ],
  "unverified": ["real iPhone Safari", "production deployment"]
}
```

## 6. 开始条件与停止条件

**开始条件**：用户确认本规格与计划作为 `UI-SYSTEM-001` 实施依据；当前 `PUBLIC-HOME-001` 的 dirty 文件所有权已核对；实现分支从目标基线单独创建。

**停止条件**：出现以下任一情况，暂停依赖该决策的批次并回交，而不是夜间自行扩大范围：

- 需要改变 API、数据库、评分、权限、角色事实、记忆共享或内容发布语义。
- 第三方组件许可证/来源无法证明，或无法满足焦点、键盘和 reduced-motion 合同。
- 需要生产数据、收费 Provider、真实部署或 iPhone Safari 才能证明关键结论。
- 当前工作树出现无法归属的并发修改，且继续会覆盖或重写它。

## 7. 用户验收路径

1. 打开 `/learn`：确认首先看到可用的视频/播客资料库，没有 Hero 或开始/继续学习 CTA。
2. 打开 `/read`：搜索、筛选、排序、保存和文章进入路径可用；阅读工具不遮挡正文。
3. 打开 `/explore`：搜索/视图切换/场景进入有清晰单一结果，统计不可点击。
4. 打开 `/chat/lucia`：发送、流式回复、停止、断流重试、消息滚动和语音/文字切换保持原有语义。
5. 打开 `/me` 与内容工作流：隐私删除/共享、审核和显式发布仍要求正确确认和服务端门禁。
6. 在 375px、1024px、1440px 视口、键盘导航、深浅色和 reduced-motion 下重复以上关键路径。

真实登录、生产内容、部署和 iPhone Safari 需要另行安排，不由夜间无人值守批次代验。
