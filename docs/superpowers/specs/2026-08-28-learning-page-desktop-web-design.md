# Sueño 学习页：桌面 Web「任务时间线 + 详情」设计

- 日期：2026-08-28
- 状态：设计草案，等待产品本人审阅
- 设计方向：F · 任务时间线 + 详情
- 优先平台：桌面 Web（1280px / 1440px），再降级到 1024px、768px 与移动 Web
- 关联研究：[桌面 Web 技术调研报告](./2026-08-28-learning-page-desktop-web-technical-research.md)
- 关联规范：`docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`

## 1. 目标与边界

### 目标

1. 让用户在桌面端打开 `/learn` 后，立即知道“当前沟通目标、进行到哪一步、下一步是什么”。
2. 用时间线解释听懂情境 → 自己表达 → 变式迁移的关系，不把训练做成题库或分数仪表盘。
3. 将证据强度、提示级别、口语/文字方式和隐私说明放在同一右侧详情区，保持主任务叙事连续。
4. 让开始、继续、重试、完成、取消等按钮都产生可观察且可恢复的结果。
5. 解决当前桌面布局的空列和宽度不一致问题，同时保持 Web 与 Flutter 共享状态语义而不共享 UI 代码。

### 不包含

- 不改变 `mastery`、`confidence`、证据追加模型或评估规则。
- 不新增支付、实时双向语音、开放角色网络、任意网页抓取或离线 ASR。
- 不把阅读、打字、学习时长写入口语能力证据。
- 不在本设计阶段直接实施业务代码；实现需另立计划并按一个任务 ID 交付。

## 2. 设计原则

- **唯一主动作**：每个页面状态只有一个视觉同权的主 CTA。
- **时间线优先**：状态顺序比统计数字更重要；当前节点必须可定位。
- **详情按需解释**：证据、提示、隐私和技术信息默认在右侧可见但不抢主叙事；低频细节可折叠。
- **完整表达后再反馈**：用户说话期间不展示纠错，不用实时分数打断表达。
- **技术失败不扣分**：转写、评估、权限和网络失败只进入恢复状态。
- **服务端为事实来源**：客户端只渲染服务端 DTO 和训练状态机结果，不能自行计算能力事实。
- **桌面高效、移动降级**：桌面使用固定左侧导航和右侧详情；窄视口将详情折叠到当前节点下方。

## 3. 桌面信息架构

### 3.1 Shell

| 区域 | 1280px / 1440px 行为 | 768px–1023px | 移动 Web |
| --- | --- | --- | --- |
| 左侧导航 | 固定 232–248px；Logo、学习/阅读/探索/对话/我的；当前态同时用文字、背景和线性图标表达 | 收窄到 88px 图标栏或转为顶部折叠菜单，保持语义顺序 | 使用现有五项底部导航 |
| 页面内容 | `max-width: 1180–1240px`，12 列 Grid，左右 gutter 36–76px | 单列主内容，详情改为折叠区 | 单列，主 CTA 固定在内容底部安全区内 |
| 页面标题 | 标题、沟通目标、当前节点计数；顶部不再放无关统计 | 同上但压缩间距 | 标题与计数上下排列 |

### 3.2 `/learn` 首页

桌面默认使用 12 列：

```text
┌────────────── 左侧导航 232–248 ──────────────┐
│ 页面标题（12 列）                             │
│                                               │
│  主时间线 / 当前任务（8 列） │ 详情（4 列）  │
│  当前节点 + 唯一 CTA          │ 证据/提示/隐私 │
│                                               │
│  辅助入口（12 列，低权重）                    │
└───────────────────────────────────────────────┘
```

- 有稳定断点：主区标题为“从问候到自然追问”等真实沟通目标，当前节点高亮，CTA 为“继续学习”。
- 无学习记录：时间线显示 3 个尚未开始节点，首节点高亮，CTA 为“开始第一次练习”；不要求选择时长、模式或内容类型。
- 无证据 DTO：详情区显示解释性空状态（“完成一次口语练习后，这里会显示可追溯证据”），不绘制 0 分雷达图，不保留空白列。
- 文章库不可用：展示非交互空状态；只有存在已发布文章时才渲染可点击文章入口。
- Lucía / 探索入口放在主任务下方，使用低权重列表项而不是第二个主按钮。

### 3.3 `/learn/practice` 训练工作台

训练页使用同一主列宽，避免当前 context 约 901px、workbench 约 760px 的错位：

```text
┌──────────── 页面标题 + 第 n / 4 句 ────────────┐
│ 时间线：已完成 → 当前 → 待解锁（主区）        │
├───────────────────────────────────────────────┤
│ 情境输入（西语 + 翻译 + 意图 + TTS）           │
│ 训练工作台（录音 / 文字 / 提示 / 反馈 / 错误）  │
├───────────────────────┬───────────────────────┤
│ 当前节点说明/下一步    │ 详情 rail              │
│                         │ 证据 · 提示 · 隐私    │
└───────────────────────┴───────────────────────┘
```

- 情境输入、工作台和反馈容器共享同一 `--learn-main-column` 宽度。
- `showing-feedback`、`completed`、`recoverable-error` 在工作台内替换，不把恢复动作移到页面底部孤立卡片。
- 右侧详情 rail 不显示实时严格发音分数；只显示服务端已确认的证据强度、提示级别、输出方式和隐私说明。

## 4. 视觉语言与设计令牌

### 4.1 主题

主主题延续已确认的 Warm Editorial Conversation Workspace：暖米白纸面、深墨色正文、低饱和赤陶色主动作、灰绿色辅助信息。深色主题使用对应的去饱和色值，不能简单反色。

```css
--learn-bg: #f2eee6;
--learn-surface: #fffdf8;
--learn-surface-muted: #f8f3ea;
--learn-ink: #1d2e28;
--learn-muted: #718077;
--learn-border: #d9d1c3;
--learn-primary: #c66b49;
--learn-primary-strong: #a95538;
--learn-success: #557866;
--learn-warning: #b9782d;
--learn-danger: #a84d43;
--learn-focus: #2f6f92;
```

### 4.2 密度、字体与容器

- 采用 4/8px 间距节奏：8、12、16、24、32、48、64。
- 正文 16px 起，行高 1.5–1.7；桌面正文行长控制在 60–75 字符。
- 标题使用紧凑但不强制不换行的字距；中文和西语句子允许自然换行。
- 卡片圆角 12–16px；不使用厚重拟物阴影；主要层级由留白、边框和字重建立。
- 交互目标至少 44×44px；图标使用统一线性 SVG，装饰图标 `aria-hidden`。

### 4.3 时间线样式

- 已完成节点：灰绿色圆点 + “已完成”文字 + 时间/可信度辅助信息。
- 当前节点：赤陶色圆点、左侧 2px 强调线、标题字重 700；不只依赖颜色表达当前态。
- 待解锁节点：低对比边框和“完成当前步骤后解锁”文字；不做成可点击假按钮。
- 时间线切换使用 160–220ms opacity/transform；`prefers-reduced-motion: reduce` 时立即呈现最终状态。

## 5. 页面状态与按钮行为

### 5.1 `/learn` 状态

```text
booting → no-record | resume-ready | resume-stale | data-unavailable
```

| 状态 | 主区 | 详情 rail | 主 CTA | 点击后 |
| --- | --- | --- | --- | --- |
| `booting` | skeleton 保留时间线和主按钮尺寸 | skeleton | disabled | 不产生导航或数据写入 |
| `no-record` | 首节点高亮，后续节点待解锁 | 解释性空状态 | 开始第一次练习 | 进入现有 `/learn/practice`，由训练状态机创建尝试 |
| `resume-ready` | 恢复到真实 checkpoint 节点 | 最近证据、提示和隐私摘要 | 继续学习 | 显示恢复中 → 跳转/加载对应节点 |
| `resume-stale` | 显示过期原因和重新开始策略 | 不显示旧证据为当前状态 | 重新开始当前目标 | 清除/迁移策略由 application 决定，UI 不静默覆盖 |
| `data-unavailable` | 主任务不伪造 | 错误原因 + 重试 | 重试加载 | 重新请求 DTO；失败仍停留在可恢复错误 |

### 5.2 训练状态映射

沿用现有 `TrainingStatus` 和 `TrainingEvent`，只改变呈现方式：

| 状态 | 工作台表现 | 可用动作 |
| --- | --- | --- |
| `presenting-input` | TTS 播放状态 + “先听一遍” | 播放/停止（不出现纠错） |
| `awaiting-output` | 录音与文字两个等权输入方式；提示 drawer 收起 | 开始录音、用文字回答、打开提示 |
| `recording` | 红点、计时、波形；提示“完整说完，再结束” | 完成录音、取消并改用文字 |
| `transcribing` / `evaluating` | 稳定 skeleton 或阶段文案；按钮 disabled | 取消（若副作用支持） |
| `showing-feedback` | 同一容器替换为沟通结果、证据强度和下一步 | 练习变式、完成这句 |
| `completed` | 已保存徽标 + 下一句 | 下一句 |
| `recoverable-error` | 工作台顶部 `role=alert`，错误原因、无负面证据说明和重试 | 再试一次；必要时返回文字 |

### 5.3 关键点击结果

| 控件 | 点击前 | 点击后即时反馈 | 成功 | 失败/取消 |
| --- | --- | --- | --- | --- |
| 继续学习 | `resume-ready` | 主按钮进入 loading，时间线当前节点保持 | 恢复 checkpoint | 显示“断点暂不可用”并给出重新开始/重试 |
| 开始第一次练习 | `no-record` | 创建中，保持布局尺寸 | `/learn/practice` 的 `presenting-input` | 停在当前页并显示可重试错误 |
| 开始录音 | `awaiting-output` | 立即切换 `recording` | `transcribing` | 权限拒绝 → 显示文字入口；不扣分 |
| 用文字回答 | `awaiting-output` | textarea 获得焦点，提交按钮按内容启用 | `evaluating` → 反馈 | 保留草稿；超时可重试 |
| 提示 1/2/3 | `awaiting-output` | drawer 展开，`aria-pressed` 更新 | hint 内容可读 | 无提示内容时显示明确空状态 |
| 再试一次 | `recoverable-error` | 旧错误收起，显示处理状态 | 回到失败前可恢复节点 | 新错误仍为 `recoverable-error`，不产生重复证据 |
| 完成这句 | `showing-feedback` | 保存中 | `completed` + 创建稳定断点 | 保存失败停在可重试状态 |

## 6. 数据与组件边界

### 6.1 建议的服务端 DTO 边界

实现时由 application 层产出 `LearnDashboardDTO`（名称可在实施计划中调整），Route Handler 只负责鉴权、Zod 校验和协议转换。DTO 至少包含：

```ts
type LearnDashboardDTO = {
  state: "no-record" | "resume-ready" | "resume-stale" | "data-unavailable";
  primaryAction: "start-first-practice" | "resume-practice" | "retry-load" | "restart-goal";
  goal: { key: string; title: string; reason: string } | null;
  checkpoint: { contentKey: string; stage: string; position: number; total: number } | null;
  timeline: Array<{ key: string; label: string; status: "completed" | "current" | "locked"; detail: string }>;
  evidenceSummary: { available: boolean; coverageLabel: string; confidenceLabel: string } | null;
  availability: { reading: "available" | "empty" | "unavailable"; conversation: "available" | "unavailable" };
};
```

客户端不接受 `mastery`、`confidence` 或证据事件写入字段作为用户可编辑输入；服务端重新校验所有事实。

### 6.2 React 组件建议

- `LearnDesktopShell`：只负责布局区域，不读取数据库。
- `LearnTimeline`：渲染节点和当前态，接受 DTO，不自行排序或计算能力。
- `LearnDetailRail`：渲染 evidence/hint/privacy/availability，支持折叠。
- `LearnPrimaryAction`：根据 `primaryAction` 映射可访问按钮、loading/disabled 状态。
- `TrainingWorkbench`：复用现有训练状态机，统一输入、反馈和错误容器宽度。
- `TrainingTimeline`：从训练状态派生 UI 节点，不替代服务端评分。

React 组件不直接访问数据库；Route Handler 不承载训练编排；复杂异步继续由现有纯状态机和可取消副作用处理。

## 7. 异步、竞态与恢复

- 每次录音、转写、评估继续携带 `attemptId`/`generationId`；旧 generation 的回调被状态机忽略。
- `transcribing`、`evaluating` 必须有可见进行中状态，不能只显示空白或无限 spinner。
- 没有显式 `done` 的流不能显示“已完成”；消息/证据/记忆持久化只在完整完成后发生。
- 重试遵循幂等策略：不重复创建证据、关系记忆或供应商费用；客户端保留草稿和稳定 checkpoint。
- 组件卸载时取消录音、TTS、定时器和 AbortController；谁创建资源谁负责释放。
- 网络或 provider 失败使用明确稳定错误码；观测写入失败不改变业务结果。

## 8. 可访问性与响应式验收

- 键盘顺序为：跳过链接 → 页面标题 → 当前时间线节点 → 主 CTA → 详情 rail → 辅助入口。
- 动态状态使用单一 `aria-live`/`role=status`；错误使用 `role=alert`，不重复播报同一消息。
- 当前、已完成、待解锁不能只靠颜色区分，必须有文字或图标语义。
- 所有 icon-only 控件有 `aria-label`；提示 drawer 暴露 `aria-expanded` / `aria-pressed`。
- 深浅主题正文对比度 ≥4.5:1，边框和焦点环独立验证。
- 1280px、1440px 无横向滚动；1024px 详情 rail 可降为顶部折叠；768px 以下主 CTA 保持在可见安全区。
- `prefers-reduced-motion` 下不依赖动画完成状态；动态字体放大不截断西语或中文内容。

## 9. 测试计划

### 单元/组件

- `LearnDashboardDTO` 的四种状态和唯一主 CTA 映射。
- 时间线 completed/current/locked 的渲染和可访问名称。
- 详情 rail 空状态、证据可用、数据不可用和折叠状态。
- 主 CTA loading/disabled/success/error/cancel 状态。
- 提示逐级展开、键盘焦点和 `aria-pressed`。
- 训练工作台状态机合法、非法、失败、取消和过期 generation 回调。

### E2E

1. 新用户 `/learn` → 开始第一次练习 → `presenting-input`。
2. 断点用户 `/learn` → 继续学习 → 恢复当前时间线节点。
3. 麦克风拒绝 → 文字回答 → 草稿保留 → 评估失败 → 重试。
4. 完成一句 → 已保存 → 下一句；重复点击不产生重复证据。
5. 1280/1440/1024/768 视口无横向滚动；详情 rail 按断点正确折叠。
6. 深色主题、键盘导航、`prefers-reduced-motion` 和屏幕阅读器状态播报。

### 性能与隐私

- 已登录学习首页尽量在 2 秒内可交互；动态 rail 使用 skeleton 预留空间，避免 CLS。
- 普通录音评估完成后删除；日志不包含原始音频、完整转写、私密对话或签名 URL。
- 真实 provider 不进入默认测试；使用 fake adapter 和固定状态回放。

## 10. 视觉预览

交互式预览：`http://localhost:62181/?key=60c19235015c62b863a74d3283896b67e2c5668103b280e4de3af1d753ccd896`

预览中的 F 方案仅模拟布局和状态文案；按钮点击不会触发真实训练、数据库写入或供应商调用。正式实现前应由产品本人确认：

- 时间线是否比任务队列更容易理解“当前要做什么”。
- 右侧详情是否需要默认展开，还是只展开“当前证据”。
- 暖米白纸面主题在桌面长时间学习时是否舒适；深色主题是否需要更高对比度。

## 11. 自审结果

- 未发现 `TODO`、`TBD` 或未定义的占位接口。
- 所有主 CTA 均有状态、成功和失败结果；未发布/不可用内容没有伪装为按钮。
- 设计保持现有训练状态机、`generationId`、断点、证据和隐私不变量，没有把 UI 事实升级为服务端事实。
- 桌面空列问题通过条件 rail 和统一主列宽解决；移动端只定义语义降级，不共享 React UI 代码。
- DTO 是实施建议，不代表当前仓库已有 API；进入实施前需在应用层、契约 Schema 和测试 fixture 中确认命名与字段。
