# Sueño 学习页：桌面 Web 技术调研报告

- 日期：2026-08-28
- 状态：研究完成，等待桌面 Web 设计方向确认
- 范围：登录后的 `/learn` 学习工作台，以及进入 `/learn/practice` 后的训练工作台
- 目标：先记录可验证的产品/工程模式，再决定布局、样式和按钮状态设计
- 非目标：本报告不修改评分算法、证据模型、记忆权限、供应商选择或 Alpha 范围

## 1. 调研方法

本轮采用两类只读来源：

1. 公开产品页面的桌面 Web DOM、导航层级、可观察 CTA、状态文案和功能分组。
2. 公开开源仓库的 README、目录树和关键实现文件，重点检查状态机、进度模型、阅读标注和数据访问边界。

公开产品页面只提炼可观察模式，不复制品牌文案、插画、源码或视觉资产。无法访问或需要登录的页面不作为确定性证据；该限制会在来源表中注明。

## 2. 来源与可观察结论

| 来源 | 可观察结构/工程事实 | 对 Sueño 的启发 | 明确不照搬 |
| --- | --- | --- | --- |
| [Duolingo](https://www.duolingo.com/) | 公开首页提供单一“开始”入口；课程入口按语言分组；以短单元和个性化路径叙述降低首次决策。 | 学习首页必须只有一个视觉同权主动作；调整入口放到次级层。 | 连胜、经验值和游戏奖励不能替代口语证据。 |
| [Babbel](https://www.babbel.com/) | 顶部导航保留语言、登录和注册；语言选择独立成列表；强调真实会话、实时反馈、进度追踪和多种练习工具。 | 将“当前交际目标”“反馈可靠度”“下一步”分开表达；进度是可解释状态，不是装饰。 | 不在登录后首页重复放多个同权“开始学习”按钮。 |
| [Busuu](https://www.busuu.com/en) | 首屏提供 Learn for free；随后按“我想学什么”列出语言；内容按 real people / real support / real-life skills 组织，并用轮播展示例子。 | 首页辅助模块应按沟通目标和关系练习分组；示例内容可以轮播或折叠，但不能伪装成已发布内容。 | 不引入开放社交网络或社区评分作为 Alpha 依赖。 |
| [Memrise](https://www.memrise.com/) | 持久导航包含 Languages、Courses、Phrasebooks；按学习原因分组；How It Works 使用 tab/tabpanel 顺序解释“目标→相关短语→真实语音→练习→现实沟通”。 | 对 Sueño 采用渐进式披露：先显示当前任务，再按需展开提示、证据和静默模式。 | 不用营销页的多轮 carousel 代替实际训练状态机。 |
| [ELSA Speak](https://elsaspeak.com/) | 公开页围绕个性化路径、角色扮演、即时反馈、进步追踪组织功能；“Practice Now”与下载 CTA 并列。 | 口语反馈和能力图应是独立可解释模块，不能埋在营销式卡片里。 | 登录后学习页仍只保留一个主动作，避免双 CTA。 |
| [Echo-Loop](https://github.com/echo-loop/Echo-Loop) | Flutter/Riverpod；`StudyScreen` 明确从上到下分为 AppBar、统计 chips + 7 天图、Ready to Review、Upcoming Reviews（默认折叠）、First Study、Completed（默认折叠）。`StudyTask` 稳定排序为 review-ready → review-upcoming → first-study；`LearningProgress` 保存 stage/sub-stage、句子索引、暂停、复习时间和断点。 | 任务列表应从领域进度模型派生并稳定排序；次级区块默认折叠；桌面可以显示证据摘要，但不能凭 UI 推导能力事实。 | 不复制其“整段音频练透”产品核心，也不复制源码/资源。 |
| [wallabag](https://github.com/wallabag/wallabag) | 阅读保存、正文抽取、标注和搜索分为控制器、repository、实体和 API；标注有独立权限校验。 | 阅读/标注工作台需要独立数据边界和失败状态；保存位置不能只存在客户端。 | 不把任意网页抓取提前放入 Alpha。 |
| [Readest](https://github.com/readest/readest) | 支持全文搜索、批注、高亮、书签、分屏阅读、主题、TTS、跨端同步、键盘导航和屏幕阅读器。 | 桌面阅读/学习工具栏应上下文出现；位置、保存和同步状态要可观察。 | 阅读工具不应升级为口语证据。 |
| [Omnivore](https://github.com/omnivore-app/omnivore) | Node.js/TypeScript Web；Next.js、SWR、Radix；自动保存长文位置；高亮/笔记/搜索；Web、iOS、Android、PWA；支持离线。 | 断点写入要幂等，UI 显示 saving/saved/error；命令式搜索和键盘导航适合桌面。 | 不增加 Newsletter/RSS/外部 URL 导入范围。 |
| [Linear](https://linear.app/) | 桌面工作台使用持久左侧栏、Search workspace、Inbox/My issues 等分组；详情页有 Activity 时间线和 Properties 侧栏。 | Sueño 可采用持久左侧导航；证据时间线作为次级明细，而不是首页主任务。 | 不把学习页做成复杂项目管理面板。 |

## 3. 当前 Sueño 桌面基线（实测）

测试页面：`http://localhost:3000/learn`、`http://localhost:3000/learn/practice`；视口：1280 × 720。

### 3.1 `/learn`

- 左侧导航宽度约 236px，产品内容区宽度约 1,029px。
- `.learn-page` 在桌面断点使用 `minmax(0, 1fr) minmax(260px, 0.38fr)`，但当前页面没有可填充的真实证据侧栏。
- 主 `.focus-card` 实际宽约 526px，右侧空列没有内容，造成“主任务卡被压窄、右半屏闲置”。
- 首页有一个真实主 CTA（新用户为“开始第一次练习”，有断点为“继续学习”），这一点符合产品不变量。
- 阅读库卡片明确为不可用空状态；Lucía 和探索卡片为真实链接；辅助卡片的真实性边界正确。
- 头像入口只负责跳转 `/me`，不应与主学习动作争夺视觉权重。

### 3.2 `/learn/practice`

- `.training-loop` 宽约 901px，但 `.training-loop__workbench` 约 760px 且左对齐。
- 内容上下文、工作台和错误卡片宽度不一致，造成右侧空白和“训练操作被压在左下角”的感觉。
- 当前页面的失败状态文案正确：技术步骤失败时显示“没有产生负面能力记录”，提供“再试一次”，不污染能力评分。
- 状态机已经存在并覆盖：`loading-context`、`presenting-input`、`awaiting-output`、`recording`、`transcribing`、`evaluating`、`showing-feedback`、`transitioning`、`completed`、`recoverable-error`。
- 每次异步副作用带 `generationId`；客户端副作用具备取消；断点通过浏览器 checkpoint store 保存和恢复。

### 3.3 当前问题的分类

| 类别 | 证据 | 根因判断 |
| --- | --- | --- |
| 空间利用率 | 首页主卡 526px，右侧无内容；训练工作台 760px 左对齐 | 栅格为“有侧栏时的模板”，但空状态仍占位；容器与子模块宽度缺少统一规则 |
| 信息层级 | 主任务、辅助卡片和提示条在同一纵向流中，首屏没有桌面证据摘要 | 桌面断点只改变列数，没有重新定义“任务→证据→辅助”的层级 |
| 状态可见性 | 训练失败可恢复，但错误卡片位于下方，主上下文与恢复动作距离大 | 状态机正确，视觉编排未将 recoverable-error 提升为工作台主状态 |
| 点击真实性 | 真实路由和失败恢复已经存在；阅读库不可用时为非链接空状态 | 交互语义基本正确，仍需统一 loading/saved/error 的反馈模式 |
| 跨端语义 | Web 使用左侧栏、移动使用底栏；训练状态由服务端/领域模型定义 | 下一步应共享 DTO/状态语义，不共享 UI 代码 |

## 4. 桌面 Web 技术推论（暂不等于最终设计）

### 4.1 容器与栅格

- 桌面 shell 保留约 232–248px 左侧导航；主内容使用 `max-width: 1180–1240px`，不要把空侧栏作为固定占位。
- `/learn` 使用 12 列 CSS Grid：默认 `focus 8 + evidence 4`；当 evidence DTO 为空时，focus 自动跨 12 列，而不是渲染空列。
- `/learn/practice` 使用统一内容列宽：context、workbench、feedback 共享同一个最大宽度；需要侧栏时通过明确的 `grid-template-columns` 加入，不让子模块各自设置不同 max-width。
- 桌面 1024–1199px 先收窄导航与间距；低于 960px 再退化为单列；移动端另行实现底部导航。

### 4.2 首页状态模型

页面只根据服务端/断点 DTO 进入以下可观察状态：

```text
booting → no-record / resume-ready / resume-stale / data-unavailable
```

- `no-record`：唯一主动作“开始第一次练习”。
- `resume-ready`：唯一主动作“继续学习”，显示真实断点句/阶段。
- `resume-stale`：显示断点已过期的解释和明确恢复策略，不伪造“继续”。
- `data-unavailable`：显示可重试的加载错误，不生成假进度。

### 4.3 训练按钮与状态映射

| 用户动作 | 前端即时反馈 | 成功结果 | 失败/取消结果 | 数据约束 |
| --- | --- | --- | --- | --- |
| 开始第一次练习 | disabled + loading label | 进入 `presenting-input` | 恢复到可开始状态并显示重试 | 由训练状态机创建 attempt/generation；不要求先选时长/模式 |
| 继续学习 | 先显示 checkpoint 恢复状态 | 按稳定句/阶段恢复 | checkpoint 无效时进入可解释空/错误状态 | 只能使用真实 checkpoint，不由客户端自造进度 |
| 开始录音 | 权限/录音中状态 | `recording` → `transcribing` | 麦克风拒绝切换文字入口 | 技术失败不产生负面能力证据 |
| 用文字回答 | 显示 textarea 和提交状态 | `evaluating` → 反馈 | 超时保留草稿，可重试 | 打字不增加发音/语流证据 |
| 提示 1/2/3 | drawer 展开，`aria-pressed` 更新 | 当前 hintLevel 只增不减 | 无内容时显示可恢复提示 | 提示级别写入尝试记录，降低证据强度但不制造成功 |
| 再试一次 | 只重试失败 generation | 回到失败前可恢复状态 | 取消时保留当前断点 | 旧 generation 回调不得更新当前状态 |
| 完成这句 / 下一句 | 显示保存中 → 已保存 | 创建稳定断点并推进 | 保存失败停在可重试状态 | 没有 `done` 的流不能算完成；写操作需幂等 |

## 5. 设计前的决策门

本轮研究建议优先进入桌面 Web 设计的默认基线：

1. 持久左侧导航 + 12 列内容网格。
2. 首页“唯一主任务 + 条件证据侧栏”；无证据时自动扩展主任务，不保留空列。
3. 训练页采用单一工作台宽度，错误/反馈状态在同一视觉容器内替换，不让恢复动作漂移到窄列下方。
4. 桌面优先定义 1280px 和 1440px 两个关键视口，再补 1024px、768px 和移动端语义降级。
5. 所有可点击控件都必须绑定真实路由或状态事件，并有 loading、success、error、cancel 的明确结果。

这五点是研究推论，不是已经批准的最终 UI 方案。下一步需要产品本人确认是否按此进入“桌面 Web 布局与样式设计”阶段；确认后再生成正式设计 spec、按钮状态图和视觉预览图例。

## 6. 参考来源

- [Duolingo](https://www.duolingo.com/)
- [Babbel](https://www.babbel.com/)
- [Busuu](https://www.busuu.com/en)
- [Memrise](https://www.memrise.com/)
- [ELSA Speak](https://elsaspeak.com/)
- [Echo-Loop](https://github.com/echo-loop/Echo-Loop)
- [wallabag](https://github.com/wallabag/wallabag)
- [Readest](https://github.com/readest/readest)
- [Omnivore](https://github.com/omnivore-app/omnivore)
- [Linear](https://linear.app/)
- 当前仓库：`app/(product)/learn/learn-page-content.tsx`、`src/modules/training/ui/fake-training-loop.tsx`、`src/modules/training/domain/training-state.ts`、`src/modules/training/domain/training-event.ts`、`app/globals.css`
