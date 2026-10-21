# UI 组件与动效缺口审计（2026-10-10）

> **同日后续修订（2026-10-10 晚）**：本报告 §0 记录的两处"工作树 vs HEAD"差异已由产品本人结清并落地——
> ① `/learn` 的筛选/排序工具栏**恢复**（并补上排序自动提交、显式 `aria-label`），难度分档从 A2/B1 扩展为 **A1/A2/B1/B2**（含 `drizzle/0041_media_cefr_four_levels.sql`，**该迁移已于 2026-10-11 只读实测确认应用到目标库**：`drizzle.__drizzle_migrations` 行 id 46、`created_at` 1791647744830、存储 hash 等于文件 sha256，线上约束为 `cefr IS NULL OR cefr = ANY (ARRAY['A1','A2','B1','B2'])`，无 pending 迁移）；
> ② 8 个 primitive 恢复消费者（`media-library-toolbar` 使用 popover/select），`alert-dialog` 经 `confirm-action-dialog` 接入 3 个 profile 数据控制组件；
> ③ `/read/vocabulary` 三视图切换已实现（以 `nav` + 链接 + `aria-current`，非 `role="tab"`）。
> 详见 `docs/tasks/UI-SYSTEM-002.md`。下文保留审计当时的结论，用于对照。

只读审计。回答一个问题：**当前网站还需要增加哪些 UI 组件与特效？**

- 审计对象：`app/`、`src/**/ui/`、`app/globals.css`、`src/shared/ui/`
- 基准：**`HEAD`（`codex/disable-legacy-readlang`，`327f6e9`）**，并显式标注工作树在途改动造成的差异
- 方法：静态代码审计（read/grep/glob + `git grep HEAD`）。**未启动浏览器、未跑真机、未跑测试**
- 执行者：DSH Lead 会话；四路并行审计（学习/媒体、对话、阅读/画像、设计系统）+ Lead 逐条复核

---

## 0. 重要更正（先读这一节）

首轮并行审计在工作树里 `grep "shared/ui/primitives"` 得到 0 匹配，据此得出"8 个 primitives 全是死代码"。**这个结论对工作树成立，对 HEAD / `main` 不成立**：

| 状态 | 引用 `src/shared/ui/primitives` 的文件 |
| --- | --- |
| `HEAD` | `src/modules/media/ui/media-library-toolbar.tsx`（`Popover*`、`Select`） |
| `origin/main` | 同上 |
| 当前工作树 | **0**——该文件被在途改动改写成 `return null`（`git diff HEAD`：-56/+7 行） |

因此准确表述是：**8 个 primitive 中 6 个（alert-dialog / sheet / tabs / tooltip / skeleton / scroll-area）在 HEAD 与 main 上零引用；popover 与 select 各有唯一一个消费者 `media-library-toolbar.tsx`，而该消费者正在被本工作树的在途改动剥离。**

这条更正同时说明：本工作树有 **599** 项未提交改动、仓库有 **60 个 git worktree** 并行作业，任何"组件缺失"的判断都必须以 HEAD 复核，否则会把别人的在途编辑误判为产品缺口。

---

## 1. 结论

网站不缺装饰性特效，缺的是三件事：

1. **一套真正被采用的组件基础设施**——primitives 已实现且质量合格，但采用率停在 1/8；同时存在 8 个 267 行的配套 CSS 与 8 个 `sueno-*` keyframes 处于同样未采用状态。
2. **四类决定产品可信度的交互**——真实麦克风电平、破坏性操作确认/撤销、错误恢复入口、离线兜底。
3. **与已批准视觉规范对齐的按压与进入动效**——规范写好但基本未实现（全站仅 1 条 `:active`）。

---

## 2. P0：系统级缺口

### 2.1 采用 primitives，而不是新建组件

`src/shared/ui/primitives/` 的 `alert-dialog` / `sheet` / `popover` / `tabs` / `tooltip` / `select` / `skeleton` / `scroll-area` 已实现焦点陷阱、Escape、滚动锁、焦点归还（`primitives/utils.ts:48`），`primitives/README.md:11` 明确要求"功能模块必须通过本目录消费"。现实：

- **5 处破坏性操作仍用原生 `window.confirm()`**：`chat-thread.tsx:671`、`chat-thread.tsx:684`、`account-data-controls.tsx:55`、`memory-data-controls.tsx:62`、`voice-data-controls.tsx:82`（`git grep -c window.confirm HEAD` = 5）。
- `alert-dialog` / `sheet` / `tabs` / `tooltip` / `skeleton` / `scroll-area` 在 HEAD 上零引用。
- 未合并的 `e15c844`（见 §6）里已经写好了 `src/shared/ui/confirm-action-dialog.tsx`（82 行）与 `tests/unit/ui-primitives.test.tsx`（178 行），本分支没有。

### 2.2 Toast / 撤销（完全不存在）

`git grep -i "toast\|snackbar" HEAD -- src app` = **0**。确认反馈是 20 多处内联 `role="status"` 文本，多数永不消失（`saved-items-library.tsx:265`），只有 `read-shelf.tsx:234-237` 手写了一个 2.2 秒自动消失的孤例（低于 3–5 秒的常规下限）。配套：删除均为立即永久删除、无撤销，且行被卸载后无焦点转移。

### 2.3 真实麦克风电平

`git grep "AnalyserNode\|getByteFrequencyData" HEAD -- src app` = **0**。录音"波形"是固定高度的装饰动画：`voice-composer.tsx:186`（7 条）、`fake-training-loop.tsx:794`（18 条），CSS 见 `globals.css:5494-5504`、`globals.css:6644-6655`。视听产品无法确认麦克风是否在采集。

### 2.4 错误 / 离线兜底

`git ls-tree HEAD app` 中不存在 `not-found.tsx` / `global-error.tsx` / `template.tsx` / 离线页；`git grep "serviceWorker\|beforeinstallprompt\|startViewTransition" HEAD` = **0**；`public/` 无 service worker。而 `connectivity-banner.tsx:27` 向用户承诺"已保存的页面仍可查看"。

### 2.5 图标层

56 处内联 `<svg>` 分散在 20 多个组件里，`surface-state.tsx:12-32` 直接用 `…` `○` `!` `↯` 文本字符充当状态图标。缺一个共享图标组件（统一 stroke、统一 aria 语义）。

---

## 3. P1：场景级缺口

| 场景 | 缺口 | 证据（HEAD） |
| --- | --- | --- |
| 媒体学习 | 播放错误无重试入口；`.media-player-retry` 是死 CSS | `globals.css:11905-11918`（无 TSX 引用） |
| 媒体学习 | 进度冲突文案"请刷新后继续"无控件 | `media-learning-workbench.tsx:250` |
| 媒体学习 | 倍速只在 Plyr 设置菜单内；无单句循环；字幕跟随不可关闭；"当前片段"卡片只有骨架渲染 | `media-plyr.ts:59`、`segment-transcript.tsx:41`、`learn/media/[stableKey]/loading.tsx:15` |
| 训练 | 转写/评估阶段无取消与超时 | `fake-training-loop.tsx:811-822` |
| 对话 | 消息无进入/按压动效；无逐条重试；离线队列无可见状态；无记忆权限内联提示；`/chat` 右栏 `return null` | `chat-thread.tsx:96`、`chat/page.tsx:14` |
| 对话 | 流式回复无 `role="log"`/`aria-busy`，活动区域随每次 delta 重建 | `chat-thread.tsx:755`、`chat-thread.tsx:798` |
| 阅读/词汇 | `/read/vocabulary` 三视图（study / frequency / lexicon）只能靠手改 URL 切换 | `read/vocabulary/page.tsx:104-127` |
| 我的 | mastery 与 confidence 只有两个数字，无成对可视化；`previousMastery` 有数据但无变化指示 | `four-capability-panel.tsx:34,39` |
| 我的 | 热力图单元 14×14px、84 个 tab 停靠点，移动端不可点 | `globals.css:6216-6221` |
| 通用 | 破坏性操作后无焦点归还；列表无批量选择；无 toast 承载保存/删除结果 | 见 §2.2 |

---

## 4. P2：动效缺口

对照 `docs/superpowers/specs/2026-08-22-frontend-visual-design-plan.md:191-203` 的规范逐条对账：

| 规范要求 | 实现状态 | 证据 |
| --- | --- | --- |
| 按钮按下 `scale(0.98)` | 未实现，全站仅 1 条 `:active`（且不在核心页） | `globals.css:4791` |
| 列表 stagger 40ms、最多 4 项 | 未实现 | 仅零星 `animation-delay` |
| 页面进入 `opacity + translateY(8px)` 240ms | 仅 1 处使用 `page-enter` | `globals.css:3482` |
| 新消息从 8px 下方进入 | 未实现，`.conversation-message` 无入场动画 | `globals.css`（无对应 keyframe） |
| 状态变化平滑过渡 | 提示/翻译/恢复条瞬变 | `globals.css:11037-11083` |
| `prefers-reduced-motion` 兜底 | **CSS 侧已兜住**（全局 `*` + `!important`，`globals.css:8234-8243`）；**JS 侧完全未兜**（0 处 `matchMedia("(prefers-reduced-motion")`，含 5 处 rAF 与 2 处 `scrollTo({behavior:"smooth"})`） | `chat-thread.tsx:172`、`media-library.tsx:262` |
| 动效令牌统一 | 未统一：29 个 keyframes、66 处 `transition` 仅 18 处用 `var(--motion-*)`；缓动散落在 3+1 处 | `globals.css:3414`、`7354`、`13873`、`12577` |

---

## 5. 设计系统层事实（CSS 结构）

`app/globals.css` 是仓库唯一样式表：14,396 行 / 558,720 B。

- **7 个 `:root` 令牌块**：L4、L1552、L3390、L3418（唯一的 dark 块）、L7342、L13872、L14129（reduced-motion）。其中 **L4–19 与 L1552–1566 的 13 个变量被 L3390 完全覆盖**（同名、同特异性、后者生效）→ 可证无副作用的死代码。文件开头 20 行声明的是蓝色主题，实际生效的是 L3390 的暖米白/赤陶主题；这是本仓库最容易读错主题的地方。
- **11 个局部子系统令牌**，含逐字重复：`--learn-bg…`（L13239–13246 与 L13545–13552）、`--public-*`（L12783–12789 与 L12985–12991）。
- **同名反义变量**：`--learn-surface/-line/-muted` 在 `.learn-page` 中是浅色纸面，在 `.product-shell:has(.media-library)` 中是深色工作区。
- **使用但从未定义**：`--font-serif`（9 处）、`--shadow-lg`（1 处）→ 相关规则实际回退到继承值 / 无阴影。
- **定义但从未使用**：`--learn-paper`（L6330、L6990）、`--motion-instant` / `--motion-slow`（L13890、L13893）、`--space-2…8`（仅 `--space-3` 被用 1 次）。
- **整块死系统**：`.public-home__*` 在 HEAD 的 CSS 中出现 **259** 次、在任何 TSX/测试中出现 **0** 次；配套 `--public-*`（7 个变量、定义两遍）共 103 处使用，全部落在 L12794–13139 连续区间内，是自包含死岛。现役首页使用 `.landing-*`（`app/public-home-experience.tsx:8`）。`.learn-page` 另有 37 个选择器 0 引用。
- **Tailwind v4 已 `@import`（L1）但 0 处使用工具类**；其 preflight 复位被现有规则依赖，移除属高风险，需独立视觉回归。
- 其他死代码：`src/shared/ui/theme-initializer.tsx`（0 引用，`app/layout.tsx:35-40` 已内联同一段脚本）；`tests/unit/desktop-navigation.test.tsx:35-52` 断言了一个组件未实现的桌面导航折叠开关（是否失败未验证）。

## 6. 明确不要做（守住 Alpha 与已批准规范）

- **雷达图**：`globals.css:8121` 已 `display: none`，四板块已取代八维主展示（ADR-0008），不复活。
- **游戏化**：confetti、奖励弹窗、连续打卡——规范明令禁止。
- **视差 / 粒子 / 滚动劫持**：现首页为纯 CSS + 一个 IntersectionObserver（`public-home-motion.tsx:19`），已合规。
- **页面转场库 / View Transitions**：个人 Alpha 收益低。
- **通知中心、命令面板**：不属于当前五入口信息架构。

---

## 7. 与 `UI-SYSTEM-001` 的关系（重要）

仓库的"UI 系统"并非未做过：提交 **`e15c844`「feat(ui): complete local UI system implementation」**（46 文件 / +3560 −336）包含：

- `src/shared/ui/primitives/*`（本分支已在 `3f391c0` 拿到，仅 `tabs.tsx` 差 1 行）
- `src/shared/ui/confirm-action-dialog.tsx`（替换 `window.confirm`）
- `src/modules/conversation/ui/chat-surface.tsx`、`prompt-bar.tsx`
- `app/public-home-experience.tsx` 重写 + **两张落地页预览图**
- `docs/tasks/UI-SYSTEM-001.md`、被 primitives README 引用却在本分支缺失的 spec、验收矩阵、runbook、实施计划
- `tests/unit/ui-primitives.test.tsx`、两个 e2e 无障碍/性能 spec

该提交**不在 `main`、不在当前分支**，只存在于 `codex/perf-navigation-001` 及其派生分支（对应工作树 `D:/workspace-worktrees/perf-navigation-001`）。

由此产生两个直接后果：

1. **落地页两张预览图缺失是真实缺陷**：`app/public-home-experience.tsx:34-36` 引用 `/public-home/media-learning-workbench-public.png`（`loading="eager"` + `fetchPriority="high"`）与 `...-mobile-public.png`，但两文件在 HEAD 与工作树都不存在，仓库也没有生成脚本 → 首屏主视觉永远 404。**已在本次审计中从 `e15c844` 恢复（blob 哈希逐一核对，见 §7）。**
2. **"补组件"与"合并已完成的 UI 系统"是两条路线**，需要产品本人先选一条，再开工；否则会出现第三份重复实现。

---

## 8. 本次已执行的改动

| 文件 | 改动 | 验证 |
| --- | --- | --- |
| `public/public-home/media-learning-workbench-public.png` | 从 `e15c844` 恢复（53,793 B，1353×760，与 `<img width/height>` 一致） | `git hash-object` = `f534d61a…`（与 blob 一致）；`read_image` 目视确认为媒体学习工作台截图 |
| `public/public-home/media-learning-workbench-mobile-public.png` | 从 `e15c844` 恢复（25,905 B） | `git hash-object` = `79201a79…`（与 blob 一致） |

两文件已暂存（`A`），**未提交**：当前分支 `codex/disable-legacy-readlang` 属其他任务，且工作树含 599 项他人改动。提交命令（由分支负责人执行）：

```powershell
git commit -m "fix: restore public landing preview screenshots" -- public/public-home
```

---

## 9. 未验证 / 限制

- 未启动 dev server 或浏览器：**未做渲染态、对比度、真机与 iOS Safari 验证**；Plyr 控件在 iOS 上的可达性、误触率、真实减少动效下的表现均为推断。
- 未运行任何测试；`tests/unit/desktop-navigation.test.tsx:35-52` 断言了一个组件未实现的折叠开关（实测是否失败未验证）。
- 工作树有 599 项在途改动、60 个 worktree 并行作业：**本报告的缺口清单以 HEAD 为准**；工作树差异（尤其 `media-library-toolbar.tsx` 被剥离、`app/globals.css` 53/+33/−）属于在途状态，不作为产品结论。
- 类名使用量为 `className` 字面量 grep，动态拼接可能漏计。
- Tailwind v4 已在 `globals.css:1` 导入但 0 处使用工具类；其 preflight 复位被现有规则依赖，**移除属高风险**，本报告不建议在未做视觉回归前处理。
