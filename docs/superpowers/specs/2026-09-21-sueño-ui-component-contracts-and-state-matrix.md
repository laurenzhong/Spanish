# Sueño UI 页面与组件契约、状态矩阵

- 日期：2026-09-21
- 关联任务：`UI-SYSTEM-001`
- 关联决策：[ADR-0010](../../adr/0010-sueño-ui-composition-and-motion.md)
- 关联研究：[UI 组合层与动效规范技术调研](2026-09-21-sueño-ui-composition-and-motion-technical-research.md)
- 状态：实施合同；不是已完成页面清单

## 1. 使用方式

这份文档把“页面/组件优化方案”写成可实现的边界。每个页面先满足 landmark、状态和业务不变量，再选择 registry 参考。`src/shared/ui/primitives` 不接收业务事实；`src/modules/*/ui` 负责 DTO 到文案、状态和动作的组合；Route Handler/application/domain 仍是权限、评分、记忆和发布事实的唯一来源。

任何新组件都要在任务卡中登记：`owner`、`source`、`props/events`、ARIA 契约、状态测试 ID、回滚方式。不存在真实动作的统计、状态标签或锁定提示不能使用 button 语义。

组件来源还必须标注 `kind`：`copied-source`、`runtime-dependency`、`platform-api` 或 `reference-only`。商业/闭源/托管候选只能在价格/许可、DPA/数据流、版本/CVE、bundle/SSR、无障碍、删除/导出、退出回退和 owner 证据齐全后升级为运行时；否则不能进入页面 bundle。平台原生 Web API 是默认回退，夜间任务不注册试用、不发送遥测，也不把供应商演示页当成兼容性证明。

## 2. 页面信息架构与断点

### 2.1 共用 layout

| 断点 | 内容宽度/边距 | 导航 | 安全区与滚动 |
| --- | --- | --- | --- |
| 320–374 | 单列，左右 16px，正文 35–52 字符 | 移动底栏 ≤5 项；底部加 `env(safe-area-inset-bottom)` | `min-height: 100dvh`；正文 `scroll-padding-block` 预留 header/bottom bar |
| 375–430 | 单列，左右 16–20px；控件允许换行 | 同上；icon-only hit area ≥44px | 不依赖 hover；横向内容只在明确的 tab/list 轨道内滚动 |
| 431–767 | 单列或双列工具区，最大正文 60 字符 | 移动底栏保持稳定 | Sheet/Drawer 不遮住键盘焦点，关闭恢复 trigger |
| 768–1023 | 内容 max 960px，左右 24–32px | 桌面侧栏或折叠侧栏 | 侧栏不覆盖 main；表格/工具栏允许第二行 |
| 1024–1439 | 内容 max 1200px，左右 32–48px | 桌面侧栏 + 页面上下文工具 | 长文正文 max 70 字符；固定 UI 通过 scroll padding 避让 |
| ≥1440 | 内容 max 1440px；密度不随宽度无限放大 | 侧栏、主内容、可选详情 rail | 不使用全屏装饰背景取代内容层级 |

所有按钮/链接/选择控件的可操作目标至少 44×44 CSS px；若视觉图标更小，扩大 hit area 而不改变布局边界。正文、空态和错误文案允许中西文混排、长词和换行，不能以 `white-space: nowrap` 隐藏必要信息。

### 2.2 路由 landmark

| 路由 | DOM/landmark 顺序 | 移动优先的主要决策区 |
| --- | --- | --- |
| `/learn` | `header`（页名/搜索）→ `main`（媒体列表）→ `nav`（底栏） | 搜索/筛选 → 选媒体；不加 Hero/开始 CTA |
| `/learn/media/[stableKey]` | `header`（返回/标题）→ `main`（播放器→字幕→说明）→ Sheet/底栏 | 播放/暂停、字幕当前句、词语解释 |
| `/explore` | `header`（搜索/视图）→ `main`（场景列表/详情） | 找到场景 → 进入练习；统计仅展示 |
| `/read` | `header`（搜索/筛选）→ `main`（文章行）→ Sheet | 搜索/筛选 → 打开文章 |
| `/read/article/*` | `header`（来源/返回）→ `main`（正文）→ 词语/朗读工具 | 阅读正文 → 解释/保存，不挡正文 |
| `/chat` | `header`（角色/线程）→ `main`（消息 scroller）→ `form`（composer） | 发送/停止/重试；联系人操作进 Drawer |
| `/me` | `header`（账户）→ `main`（能力/隐私） | 看事实 → 执行隐私操作并确认 |
| `/me/content-workflow` | `header`（工作流）→ `main`（候选/审核/版本） | 审核维度 → 服务端确认发布/撤下 |
| `/` | `header`（公开导航）→ `main`（hero/旅程/证明/隐私/CTA）→ `footer` | 了解产品 → 登录后进入真实学习 |

## 3. Token contract

采用 primitive → semantic → component 三层。组件中不写页面级 raw hex；主题差异在 semantic 层完成。

```css
:root {
  /* primitive */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
  --z-base: 0; --z-sticky: 20; --z-popover: 40; --z-sheet: 60; --z-dialog: 80; --z-toast: 100;
  --control-min: 44px;
  --motion-instant: 80ms; --motion-fast: 160ms; --motion-standard: 240ms; --motion-slow: 360ms;
  --motion-ease-enter: cubic-bezier(.16, 1, .3, 1);
  --motion-ease-exit: cubic-bezier(.7, 0, .84, 0);
  /* semantic */
  --surface-page: var(--background); --surface-raised: var(--card);
  --text-primary: var(--foreground); --text-secondary: var(--muted-foreground);
  --focus-ring: var(--ring); --overlay-scrim: rgb(0 0 0 / 48%);
  --status-info: var(--primary); --status-error: var(--destructive);
}

@media (prefers-reduced-motion: reduce) {
  :root { --motion-fast: 1ms; --motion-standard: 1ms; --motion-slow: 1ms; }
}
```

组件层只定义局部别名，例如 `--sheet-shadow`、`--media-card-aspect`，不能新建第二套颜色或 duration。焦点指示器至少 2px perimeter、与相邻状态达到 3:1；正文正常文字目标 4.5:1。`forced-colors: active` 时不能依赖 background 色区分 selected/error，必须保留边框、文字或原生状态。

## 4. Shared primitive contract

### 4.1 通用规则

- 优先原生 `button`、`a`、`input`、`select`；icon-only 控件必须有 `aria-label`，装饰图标 `aria-hidden="true"`。
- `data-state="open|closed|active|inactive|loading|error"` 只表达可观察 UI 状态；不承载 mastery、confidence、publishable 或权限事实。
- modal/sheet 必须有可访问标题；打开时焦点进入，Tab 被限制在容器内，Escape/取消关闭并恢复 trigger；body 滚动锁定必须在卸载时恢复。
- popover 外点关闭不能吞掉 trigger 自身点击；tooltip 不能成为唯一信息来源，不能抢焦点。
- live region 只保留一个页面级 `role="status"`/`aria-live="polite"` 出口；错误使用邻近 `role="alert"`，不重复播报每个 token。

### 4.2 API/事件表

| 组件 | 最小 props | 事件/语义 | 测试 ID |
| --- | --- | --- | --- |
| `Popover` | `open?`, `defaultOpen?`, `onOpenChange?`, `align?` | trigger `aria-expanded/controls`; Escape/外点关闭；不自动提交业务 | `primitive.popover.*` |
| `Select` | 原生 `value/defaultValue/onChange`, `disabled?` | 原生 option/键盘/表单语义；错误由 feature 层关联 `aria-describedby` | `primitive.select.*` |
| `Tabs` | `defaultValue`, `value?`, `onValueChange?` | `tablist/tab/tabpanel`；Arrow/Home/End；selected 非颜色唯一 | `primitive.tabs.*` |
| `Sheet` | `side`, `open?`, `onOpenChange?` + `SheetTitle` | `dialog aria-modal`; Escape/遮罩/关闭恢复；锁滚动 | `primitive.sheet.*` |
| `AlertDialog` | `open?`, `onOpenChange?` + title/description | destructive action 必须明确 Cancel/Action；遮罩阻断背景 | `primitive.alert-dialog.*` |
| `Tooltip` | `delayDuration?` + named trigger | hover/focus 可见，blur/leave 关闭；不承载关键操作 | `primitive.tooltip.*` |
| `Skeleton` | `className?`, stable dimensions | 只表示 loading，不隐含成功；关闭 reduced-motion pulse | `primitive.skeleton.*` |
| `ScrollArea` | `orientation?`, children | 只在确有第二滚动轴时使用；键盘/触控可滚动 | `primitive.scroll-area.*` |
| `MessageScroller` | `items`, `isStreaming`, `onRetry?`, `onNewMessage?` | `aria-live` 只播报完成/错误摘要；generation 由 feature 层校验 | `chat.message-scroller.*` |
| `PromptBar` | `value`, `disabled`, `phase`, `onSubmit`, `onCancel` | submit/cancel 是真实事件；未完成表达不触发纠错 | `chat.prompt-bar.*` |

## 5. 状态矩阵

| 表面 | loading | empty/unavailable | error/retry | success/cancel | 业务边界 |
| --- | --- | --- | --- | --- | --- |
| 媒体库 | 18 项尺寸匹配 skeleton | 说明没有可用媒体/配置原因；不出现开始 CTA | 邻近列表说明原因 + 重试 | 加载更多追加一次；取消不丢已有列表 | 播放/时长不计能力 |
| 媒体详情 | 播放器/字幕固定尺寸占位 | 无字幕明确“尚无字幕”，不伪造 | 播放/词解释分别可重试 | seek/暂停可中断；不以动画结束写证据 | 技术失败/低置信度不扣分 |
| 探索 | 列表 skeleton | 无可用场景/权限说明 | 搜索/目录重试 | 进入场景后由服务端确认 | 统计不可点击、锁定不是假 CTA |
| 阅读 | 文章行 skeleton | 无文章/无结果可清除筛选 | API 错误可重试 | 保存/删除显示服务端结果 | 阅读/打字不写口语证据 |
| 对话 | 消息占位 + 可发送/停止状态 | 没有线程时提供真实新建入口 | 断流/超时显示重试；不重复写消息 | 只有 `done` 标记完成；取消标明未完成 | 旧 generation 不更新当前状态 |
| 我的 | 能力/隐私行 skeleton | 数据未配置时解释不可用原因 | profile/heatmap 分别重试 | 删除/共享需确认并显示服务端结果 | 客户端不写画像/记忆权限 |
| 内容工作流 | 候选/审核维度 skeleton | 无候选说明来源/筛选 | 权利/结构/审核失败保留原因 | publish/retract 只显示服务端结果 | 客户端不能制造 publishable |

## 6. 动效状态矩阵

| 组件 | Enter | Exit | Interrupt/cancel | Reduced motion fallback |
| --- | --- | --- | --- | --- |
| Popover/Tooltip | opacity + translateY 2–4px，`fast` | exit 60–70% enter | 外点/Escape 立即关闭，最终状态由 state 控制 | 只切换可见性，不位移 |
| Sheet/Dialog | opacity + 对应方向 translate，`standard` | 更快离场 | 新的 open/close 取代旧 transition；焦点立即回 trigger | 无滑入，保留遮罩/焦点 |
| Tabs/text swap | opacity cross-fade，内容先后顺序不变 | 旧内容不阻塞新内容 | 快速切换取消上一次动画 | 直接显示新 panel |
| Skeleton | 轻量 pulse，不能改变尺寸 | 数据 ready 后 cross-fade | 请求取消保留空/错误状态 | 静态色块 |
| 媒体卡/按钮 | color/opacity，最多 1 个关键元素 | 无布局位移 | pointer/keyboard 立即可用 | 无 hover/scale |
| 流式消息 | token 直接追加；typing 仅装饰 | done 后稳定 | stop/timeout 取消装饰和请求；不靠 animation end | 不显示持续 typing 动画 |

## 7. 页面边界测试

每个页面至少覆盖：中西文长文案、无数据、慢网/离线、请求取消、重复点击、远端图片失败、深浅色、`prefers-reduced-motion`、`forced-colors`、200% 缩放和 320/375/390/430/768/1024/1440 宽度。Chromium mobile viewport 只能作为实验室证据，不能写成 iPhone Safari 通过。

组件源码来源、许可证、测试 ID 和回滚点见研究规格的供应链合同；批次证据格式见夜间计划与 [验收矩阵](../../testing/2026-09-21-sueño-ui-system-001-acceptance-matrix.md)。
