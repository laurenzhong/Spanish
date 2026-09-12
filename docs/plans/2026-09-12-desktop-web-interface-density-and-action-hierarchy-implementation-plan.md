# 电脑端 Web 界面密度与操作层级收敛实施计划

- 日期：2026-09-12
- 上位任务：`ALPHA-033`
- 状态：待产品本人确认；确认后从 `UI-012` 开始
- 当前平台：Next.js 响应式 Web/PWA；本计划优先电脑端 Web
- 设计依据：[`电脑端 Web 界面密度与操作层级收敛设计`](../superpowers/specs/2026-09-12-desktop-web-interface-density-and-action-hierarchy-design.md)

## 1. 目标与执行方式

把已经确认的“统一密度规则后逐页收敛”拆成六个可独立实现、测试、提交和验收的任务。每次只领取一个任务 ID，不跨任务顺手重写其他页面；每项完成后推送实现提交，再同步 `PROJECT_STATUS.md` 并等待产品本人完成真实页面视觉与行为确认。

本计划不重新定义任何学习或数据语义。评分、证据、`mastery`/`confidence`、推荐、内容发布、角色记忆、RLS、会话所有权和 Provider 协议继续以现有服务端实现为准。页面只调整信息层级、控件呈现、按需展开、焦点和响应式布局。

## 2. 分支、依赖与停点

| 顺序 | 任务 | 目标分支 | 前置依赖 | 独立停点 |
| --- | --- | --- | --- | --- |
| 1 | `UI-012` Explore、场景详情、实战与复盘 | `codex/ui-012-explore-scenario-density` | 本设计与实施计划获批；SCN-001 至 SCN-005 已完成 | Explore 和场景链路单独验收，不进入学习页整体改造 |
| 2 | `UI-013` 学习首页与训练工作台 | `codex/ui-013-learning-workbench-density` | UI-012 完成并确认 | 学习入口与训练状态单独验收，不进入阅读页 |
| 3 | `UI-014` 阅读书架与文章阅读器 | `codex/ui-014-reading-density` | UI-013 完成并确认 | 阅读路径单独验收，不进入对话页 |
| 4 | `UI-015` 对话页面 | `codex/ui-015-conversation-density` | UI-014 完成并确认 | 对话路径单独验收，不进入画像与隐私页 |
| 5 | `UI-016` “我的”、设置与隐私 | `codex/ui-016-profile-density` | UI-015 完成并确认 | 个人数据页面单独验收，不提前改公共壳层 |
| 6 | `UI-017` 公共壳层、可收缩侧边栏与全站一致性 | `codex/ui-017-collapsible-shell` | UI-012 至 UI-016 全部完成并确认 | 执行全站门禁；仍不自动宣布发布候选 |

每个任务遵循同一提交顺序：先提交该任务的测试与实现并推送；随后在协调分支同步状态页，记录实现 Commit、修改文件、测试结果、限制和下一项。若实现中发现必须改变服务端 DTO、业务规则或数据模型，停止当前任务并补充独立设计，不把接口变更藏在视觉切片里。

## 3. 全任务共同实施规则

### 3.1 测试先行

1. 先在现有 RTL/Vitest 或 Playwright 文件中加入能在当前实现上失败的行为断言，覆盖重复入口、错误按钮语义、按需展开、焦点恢复、主题状态或遮挡问题。
2. 只修改使该失败用例通过所需的页面组件和 feature-specific CSS；不以删除断言、改成快照或放宽可访问性查询来通过。
3. 先运行受影响的 Vitest，再运行该页面的桌面 Playwright；修复回归后执行 `pnpm lint`、`pnpm typecheck` 和 `git diff --check`。
4. 在 1280×900、1440×900 的浅色和深色下人工检查；1024×900 检查无横向溢出；390×844 只做既有移动布局不明显退化的烟雾检查。
5. Playwright 断言真实结果、焦点、URL、展开状态和恢复动作；截图只作为人工对照证据，不代替行为断言。

### 3.2 页面共同验收

- 一个页面或单一决策区最多一个填充色主操作，同一区域默认最多两个直接可见的次要操作。
- 页面标题 28–32px、分区标题 18–20px、正文 14–16px；场景实战消息 17–18px；辅助信息不低于 12px。
- 主操作可见高度 40–44px、普通按钮 36–40px、紧凑筛选 32–36px；图标本体 18–20px且具备接近 44px 的点击区域。
- 数量、标签、状态不使用按钮语义，不进入 Tab 顺序；图标按钮必须有可访问名称。
- 浅色与深色分别检查文字、背景、边框、选中、悬停、聚焦和禁用状态，普通正文满足 4.5:1、重要控件边界和图标满足 3:1。
- 空、加载、失败和恢复状态只保留一个明确结论与一个恢复动作；不能出现可点击但没有真实结果的伪按钮。
- 固定区、sticky 区、弹层和输入区不遮挡正文或焦点，也不造成文字裁切和横向滚动。

## 4. UI-012：Explore、场景详情、实战与复盘

### 4.1 范围与文件

目标：让 Explore 首屏只支持“搜索、让系统选择、浏览一种内容”三个自然决策，并把场景详情、实战和复盘收敛成单一主动作链路。

计划修改：

- `app/(product)/explore/page.tsx`
- `app/(product)/explore/explore-page-content.tsx`
- `app/(product)/explore/explore-library-panel.tsx`
- `app/(product)/explore/scenario-suggestion-panel.tsx`
- 必要时调整 `app/(product)/explore/personal-scenario-generator.tsx` 的按需入口，不改变生成协议
- `src/modules/scenario-practice/ui/scenario-detail.tsx`
- `src/modules/scenario-practice/ui/save-expression-button.tsx`
- `src/modules/scenario-practice/ui/scenario-practice-workbench.tsx`
- `src/modules/scenario-practice/ui/scenario-review.tsx`
- `app/(product)/learn/learn-page-content.tsx`：只承接从 Explore 移出的练习历史入口，不在本任务改造学习首页主体
- `app/globals.css`
- `tests/unit/explore-page.test.tsx`
- `tests/unit/scenario-practice-workbench.test.tsx`
- `tests/unit/scenario-review.test.tsx`
- `tests/e2e/explore-page.spec.ts`
- `tests/e2e/scenario-practice.spec.ts`

不修改 Explore Dashboard、建议算法、场景 Provider、会话持久化、证据写入、复现排程和私人场景所有权规则。

### 4.2 测试先行步骤

1. Explore 组件测试先断言：可见页头不再出现“探索真实表达/练习历史”；第一行只有全宽搜索框；第二行是三个等权紧凑建议选项；“选择辅助”和问题式说明不再可见。
2. 增加内容视图断言：默认只展示“场景”，切换“表达/内容包”才渲染对应内容；五类来源与沟通目标进入单一“筛选”弹层；关闭后焦点返回筛选按钮；已选条件显示为可移除标签。
3. 增加统计语义断言：匹配数量为非交互 `status`/文本，不是按钮或链接；深浅主题都使用独立可读的统计胶囊样式。
4. 增加列表增长断言：表达首次最多显示 12 条，只有一个“显示更多”；搜索、内容视图或筛选改变后恢复首批数量。
5. 场景详情测试先断言：页面只有一个“开始实战”；每条表达只有书签图标动作而不是整栏按钮；右侧栏不使用覆盖正文的悬浮开始条。
6. 场景实战测试先断言：默认显示文字输入；麦克风只负责切换输入模式；常用表达和提示按需打开；未满足结束条件时不存在禁用的整栏完成按钮，满足后才出现“完成练习”。
7. 复盘测试先断言：完整对话和关键反馈默认可见；筛选、复现时间、收藏和教学详情按需展开；失败重试仍保持现有幂等和证据规则。

### 4.3 实现步骤

1. 重组 `ExplorePageContent`：保留仅供辅助技术使用的 `h1`，搜索行与三项建议行上下排列，内容视图成为结果区唯一的一级切换。
2. 精简 `ScenarioSuggestionPanel`：去掉标题、问题句和逐项说明，只保留名称、图标、选中态；建议结果只保留“开始练习”“换一个”和一行选择理由。
3. 重组 `ExploreLibraryPanel`：来源和沟通目标进入筛选弹层；匹配数改为非交互数量胶囊；场景使用紧凑横向卡片，表达使用单/双行列表，内容包只在对应视图出现。
4. 练习历史路由继续保留；从 Explore 顶部移除入口，并在学习首页现有记录区域增加一个低权重入口，确保功能没有被视觉删除。
5. 把场景详情改为主内容与约 280px 右侧栏；1024px 时侧栏并入标题下方。目标使用紧凑编号列表，表达收藏改成书签图标，虚构资源说明保留为一行事实提示。
6. 重排 `ScenarioPracticeWorkbench` 的标题、目标栏、对话滚动区和 composer；返回动作先走现有稳定断点/暂停逻辑；输入区固定在工作区底部但不得覆盖对话或伸入产品侧栏。
7. 将表达、语音和键盘三个同权操作改为“默认文字输入 + 输入框内麦克风模式 + 按需常用表达”；保持录音、取消、过期 generation 和失败恢复逻辑不变。
8. 精简复盘默认表面，使用原生可访问 disclosure 承载低频详情；不隐藏高风险说明、技术失败标记或完整用户轮次。
9. 在 `app/globals.css` 中只改 Explore/Scenario 专用选择器，并补齐深色、键盘、reduced-motion、1024/1280/1440 和移动降级规则。

### 4.4 Playwright 与完成条件

- `tests/e2e/explore-page.spec.ts` 覆盖搜索、三种建议、换一个、内容视图、筛选打开/关闭与焦点恢复、表达显示更多、私人生成入口和深链恢复。
- `tests/e2e/scenario-practice.spec.ts` 覆盖详情唯一 CTA、文字/语音切换、输入不裁切、条件变化、完成按钮出现时机、进入复盘和错误恢复。
- 1280×900 与 1440×900 分别检查浅色/深色；1024×900 无横向溢出和固定区遮挡；390×844 保持现有可用路径。
- Explore 默认可操作元素应明显少于审计基线 49 个；不把固定数量作为脆弱断言，但必须记录改造前后同口径计数。
- 提交标题建议：`feat: streamline explore and scenario workspace`。推送后停止，更新状态页并等待视觉确认。

## 5. UI-013：学习首页与训练工作台

### 5.1 范围与文件

计划修改：

- `app/(product)/learn/learn-page-content.tsx`
- `src/modules/training/ui/fake-training-loop.tsx`
- `app/globals.css`
- `tests/unit/learn-page.test.tsx`
- `tests/unit/fake-training-loop.test.tsx`
- `tests/e2e/learn-page.spec.ts`
- `tests/e2e/training-loop.spec.ts`

不修改首页唯一主动作推荐规则、训练状态机、checkpoint Schema、generationId、评估、证据或画像更新。

### 5.2 测试与实现步骤

1. 先增加新用户与有断点两类断言：页面分别只有“开始第一次练习”或“继续学习”一个最高权重动作，不要求先选时长、模式或内容类型。
2. 增加首屏密度断言：主任务位于首屏上半区；当前目标和三步流程为紧凑进度；详细步骤默认不展开；阅读、关系、探索和练习历史入口不使用填充色主按钮。
3. 增加无证据空状态断言：只显示一个结论和下一动作，不重复渲染“完成后会出现”的说明卡或信息条。
4. 训练工作台测试复用 UI-012 的消息字号、composer、提示和按钮分级断言，同时保留合法/非法状态、失败、取消和过期回调覆盖。
5. 重排 `LearnPageContent` 的主任务、时间线和详情 rail；移除重复说明和同结果入口，但保留断点与到期复现的真实优先级。
6. 在 `FakeTrainingLoop` 中只改变呈现层：压缩顶部、提示、输入模式和反馈容器；副作用及状态转移保持原样。
7. 更新 Learn/Training 专用 CSS，使 1280/1440 主列宽度、留白和按钮高度符合共同规则，1024px 不出现 rail 挤压或横向滚动。

### 5.3 Playwright 与停点

- 覆盖首次练习、恢复断点、到期复现、三级提示、文字降级、刷新恢复、失败重试和键盘提交。
- 断言唯一主 CTA、详情按需展开、训练输入不裁切、状态变化后焦点合理。
- 提交标题建议：`feat: streamline learning workspace`。推送、同步状态后停止。

## 6. UI-014：阅读书架与文章阅读器

### 6.1 范围与文件

计划修改：

- `app/(product)/read/page.tsx`
- `app/(product)/read/read-shelf.tsx`
- `app/(product)/read/article/[articleId]/article-reader.tsx`
- `app/globals.css`
- `tests/unit/read-page.test.tsx`
- `tests/unit/article-library.test.tsx`
- `tests/unit/article-reader.test.tsx`
- `tests/e2e/product-shell.spec.ts` 中现有阅读路径
- `tests/e2e/article-transfer.spec.ts`

不新增网站抓取、音频上传、公开发布或新的阅读证据语义；阅读与打字仍不增加口语能力。

### 6.2 测试与实现步骤

1. 先增加书架顶栏断言：第一行只显示“公共文章/我的文章”和非交互“105 篇”同类数量胶囊；未完成的 Web Sites 不占主标签，但其路由/诚实空状态仍保留。
2. 增加工具栏断言：第二行只有搜索、紧凑排序、筛选和“添加内容”；“Generate Story/Upload Text or Audio”不再成为两个高权重按钮，菜单只呈现真实可用项，不为未实现上传生成伪动作。
3. 增加卡片语义断言：整行标题区域可进入文章，不重复“打开文章”；保存是有可访问名称的书签图标；生成文章的删除继续明确确认或保持现有安全行为。
4. 将页码回归改为单一“显示更多”：服务端按经过边界限制的可见数量重新获取从首条开始的同一过滤结果，URL 保留搜索/筛选/排序状态；不扩展现有内容 API，也不改变仓库游标语义。
5. 搜索、筛选、排序或来源切换时把可见数量恢复为 12；没有更多内容时不渲染禁用的假按钮。
6. 统一书架中文控件文案，西语只用于文章内容、来源专名和教学需要。
7. 文章阅读器以正文为唯一主表面；朗读、解释、词典、保存和口语迁移归入紧凑工具栏，只有当前工具展开；来源、版权和阅读状态保留但降低视觉权重。
8. 保持词语/句子选择、流式 `done`、失败重试、保存和阅读断点逻辑不变；更新测试确保收敛布局没有破坏这些行为。

### 6.3 Playwright 与停点

- 覆盖来源切换、搜索、排序、筛选、显示更多、整卡进入、收藏、阅读断点、词语/句子解释、工具焦点恢复和口语迁移。
- 1280/1440 深浅色检查数量胶囊、工具栏和阅读侧栏；1024px 不裁切工具标签或正文；390px 保持抽屉路径。
- 阅读书架默认可操作元素应明显少于审计基线 61 个，并记录同口径前后计数。
- 提交标题建议：`feat: streamline reading workspace`。推送、同步状态后停止。

## 7. UI-015：对话页面

### 7.1 范围与文件

计划修改：

- `app/(product)/chat/page.tsx`
- `app/(product)/chat/[characterId]/page.tsx`
- `src/modules/conversation/ui/conversation-contact-rail.tsx`
- `src/modules/conversation/ui/chat-thread.tsx`
- 必要时调整 `src/modules/conversation/ui/conversation-search.tsx` 和 `voice-composer.tsx` 的按需入口
- `app/globals.css`
- `tests/unit/conversation-contact-rail.test.tsx`
- `tests/unit/conversation-thread.test.tsx`
- `tests/unit/chat-character-page.test.tsx`
- `tests/e2e/conversation.spec.ts`
- `tests/e2e/product-shell.spec.ts` 中好友申请/介绍路径

不修改角色圣经、好友申请状态机、关系记忆、消息持久化、流式 `done`、安全门禁或 Provider 选择。

### 7.2 测试与实现步骤

1. 先断言桌面只保留联系人列、当前对话和输入区三层；联系人不足时不显示搜索；待处理入口只在确有事项时显示数量。
2. 增加角色页头断言：默认只显示头像、姓名和关系状态；资料、清理、搜索和其他低频操作进入一个上下文菜单，菜单关闭后焦点恢复。
3. 增加空会话和故障断言：空会话只有一句自然开场；历史/数据库不可用合并为一个错误状态和一个重试动作；输入区同步禁用，不能表现为可发送。
4. 增加消息操作断言：翻译、引用、删除和撤回只在选中具体消息后出现；未完成流不生成完整助手消息或关系记忆。
5. 精简联系人 rail 的固定说明和重复入口；保留 Lucía 审批、会话存在性与角色切换的真实状态。
6. 精简 `ChatThread` 页头、消息信息和 composer，消息正文使用 15–17px、时间与辅助状态 12–13px；不改变流和重试状态机。
7. 更新对话专用 CSS，确保长历史独立滚动、输入区稳定、消息操作不挤压正文，并保留桌面与移动联系人差异。

### 7.3 Playwright 与停点

- 覆盖角色切换、好友审批、发送、Enter/Shift+Enter、停止、首包失败、断流重试、长历史稳定、消息选中操作、搜索深链和数据库不可用。
- 1280/1440 深浅色检查三层结构与唯一主要发送动作；1024 和 390 不出现输入遮挡或横向溢出。
- 提交标题建议：`feat: streamline conversation workspace`。推送、同步状态后停止。

## 8. UI-016：“我的”、设置与隐私

### 8.1 范围与文件

计划修改：

- `app/(product)/me/page.tsx`
- `src/modules/profile/ui/profile-sections.tsx`
- `src/modules/profile/ui/profile-overview-panel.tsx`
- `src/modules/profile/ui/learning-heatmap.tsx`
- 必要时调整 `preferences-panel.tsx`、`provider-settings-panel.tsx`、`memory-data-controls.tsx`、`voice-data-controls.tsx` 和 `account-data-controls.tsx` 的标题与操作层级
- `app/(product)/help/page.tsx`：只应用共同字号与按钮分级
- `app/globals.css`
- `tests/unit/profile-page.test.tsx`
- `tests/unit/profile-overview-panel.test.tsx`
- `tests/unit/learning-heatmap-panel.test.tsx`
- `tests/e2e/product-shell.spec.ts` 中画像、关系和数据删除路径

不修改画像算法、证据查询、活动时长口径、关系共享、数据删除顺序、Provider 设置含义或权限。

### 8.2 测试与实现步骤

1. 先断言四个分区为紧凑标签导航，切换后只渲染当前分区，hash 与浏览器返回继续同步；账户资料编辑不在页面内重复出现。
2. 增加页面级错误合并测试：多个数据源失败时只显示一个结论和一个重试动作，不平铺多个同权错误卡。
3. 增加无证据断言：顶部只显示“0/8 已验证维度”和唯一第一次练习入口；不渲染八个“数据不足”按钮；没有活动时不渲染完整空热力图。
4. 增加有证据断言：能力使用紧凑行；只有存在详情时才是按钮；代表性尝试、证据表和算法说明默认折叠；产生活动后才显示 12 周热力图。
5. 精简页面可见标题与解释，保留掌握度/可信度分离、删除影响、关系共享和录音数据等必要事实。
6. 数据删除、关系记忆、语音数据和账户删除继续独立分区，危险操作不进入通用 overflow，也不弱化确认步骤。
7. 更新 Profile/Privacy 专用 CSS，使空数据首屏不出现大片无效控件，有数据时仍保持可扫描；帮助和设置页应用相同字号与按钮规则。

### 8.3 Playwright 与停点

- 覆盖 0/8 空状态、有证据能力行、热力图出现条件、分区切换/返回、关系授权、记忆删除、语音数据删除、账户删除和失败重试。
- 1280/1440 深浅色检查空态和隐私危险操作；1024/390 保持确认流程可见且不溢出。
- “我的”空数据默认可操作元素应明显少于审计基线 115 个，并记录同口径前后计数。
- 提交标题建议：`feat: streamline profile and privacy workspace`。推送、同步状态后停止。

## 9. UI-017：公共壳层、可收缩侧边栏与全站一致性

### 9.1 范围与文件

计划修改：

- `src/shared/ui/app-shell.tsx`
- `src/shared/ui/bottom-navigation.tsx`
- `src/shared/ui/account-menu.tsx`
- 必要时新增聚焦单一职责的 `src/shared/ui/desktop-navigation.tsx`
- `src/shared/ui/theme-toggle.tsx`
- `app/(product)/layout.tsx`：只在壳层接线需要时调整，不改变鉴权恢复
- `app/globals.css`
- `tests/unit/product-layout.test.tsx`
- `tests/unit/bottom-navigation.test.tsx`
- 必要时新增 `tests/unit/app-shell.test.tsx`
- `tests/e2e/product-shell.spec.ts`
- UI-012 至 UI-016 的关键页面 Playwright 文件，用于全站一致性回归

不修改移动底部导航语义、认证、账号数据、主题值协议或学习数据。

### 9.2 测试先行步骤

1. 先增加桌面侧栏断言：展开宽度 200–208px、收缩宽度 68–72px；收缩后只显示图标和现有字标字体的 `S`，导航名称通过工具提示/可访问名称提供。
2. 增加初始状态断言：无本地偏好时，1280px 及以上展开、1024–1279px 收缩；已有用户选择时始终优先使用本地值。
3. 增加持久化与 hydration 断言：切换后写入版本化本地 key，刷新保持；服务端首屏不因直接读取 `window` 产生 hydration mismatch；无存储或损坏值时安全回退。
4. 增加布局断言：收缩/展开会重排主内容，不只隐藏文字；按钮位置稳定；当前导航仍有 `aria-current`；Tab、Enter 和 Space 可完成切换，焦点始终可见。
5. 增加断点断言：小于桌面断点只显示移动底部导航，不同时显示侧栏；移动安全区和五项语义不变。
6. 增加主题与减弱动效断言：侧栏、工具提示、账户菜单和焦点环在深浅色均可读；`prefers-reduced-motion` 下取消非必要宽度/位移动画。

### 9.3 实现步骤

1. 从 `BottomNavigation` 中分离桌面导航呈现与移动底栏呈现，继续共用同一导航配置和当前路由判断，避免两套语义漂移。
2. 在客户端壳层中维护 `expanded/collapsed`，使用版本化本地 key；首次挂载按 `matchMedia('(min-width: 1280px)')` 决定默认值，用户选择后不再被窗口变化覆盖。
3. 在 Logo 旁加入唯一收缩按钮，容器 32–36px、点击区接近 44px，提供 `aria-label`、`aria-expanded` 和标题提示；删除“开始/发现/账户”等无导航价值分组标题。
4. 收缩态只显示图标和 `S` 紧凑标记；账户菜单改为适合收缩态的头像触发器，不重复显示账户信息；展开态仍保持当前资料入口。
5. 以 CSS 变量控制侧栏宽度和主内容偏移；每个目标宽度都实际重排，不使用覆盖主内容的浮层侧栏。
6. 对登录、帮助、偏好和隐私页面做一次共同字号、按钮、焦点和主题复核；只修共同壳层或令牌问题，不重新打开已完成页面的功能设计。

### 9.4 全站验证与停点

先运行聚焦检查：

```powershell
pnpm exec vitest run tests/unit/product-layout.test.tsx tests/unit/bottom-navigation.test.tsx tests/unit/app-shell.test.tsx --pool=threads --maxWorkers=1
pnpm exec playwright test tests/e2e/product-shell.spec.ts --project=desktop-chromium --workers=1
pnpm lint
pnpm typecheck
```

如果实施时没有新增 `tests/unit/app-shell.test.tsx`，从命令中移除该路径并在状态页说明覆盖落在何处。随后运行 ALPHA-033 的全量门禁：

```powershell
pnpm test --run
pnpm test:e2e
pnpm build
git diff --check
```

最终人工矩阵：

| 视口 | 主题 | 必查页面/行为 |
| --- | --- | --- |
| 1440×900 | 浅色、深色 | 五个产品页、侧栏展开/收缩、账户菜单、唯一主动作、数量胶囊 |
| 1280×900 | 浅色、深色 | 首次默认展开、页面密度、固定区不遮挡、焦点顺序 |
| 1024×900 | 浅色、深色 | 首次默认收缩、主内容重排、无横向溢出 |
| 390×844 | 浅色、深色 | 仅移动底栏、输入/抽屉/确认流程不退化 |

提交标题建议：`feat: add collapsible desktop navigation`。推送并同步状态后，产品本人仍需以真实登录和真实数据复核页面利用率、字号、按钮层级和完整功能；自动化全绿不自动把 ALPHA-033 变成发布候选。

## 10. 风险与控制

| 风险 | 控制方式 |
| --- | --- |
| 为减少按钮而隐藏真实功能 | 每个被移除的入口先确认是否有唯一替代路径；路由与服务端能力不直接删除 |
| 视觉改动破坏状态机或证据 | 组件只改变呈现；原有状态机、generation、幂等和证据测试必须继续通过 |
| CSS 全局回归 | 优先 feature-specific 选择器；公共令牌只在 UI-017 统一修改并跑全站矩阵 |
| 深色主题再次出现撞色 | 每项在浅色/深色分别验证统计、选中、禁用、聚焦与错误状态 |
| “显示更多”改变数据语义 | Explore 使用已有客户端投影分批；阅读书架使用同一服务端过滤结果扩大可见数量，不更改内容契约 |
| 侧栏本地状态导致 hydration 抖动 | 服务端输出稳定壳层，客户端挂载后应用本地选择；补 hydration 与损坏存储回归 |
| 空状态为了简洁而不诚实 | 仍明确说明真实不可用/无数据，并只给一个可执行恢复动作 |
| 任务范围再次膨胀 | 一次一个任务 ID；发现 DTO、数据库或业务语义变化立即停下并另立任务 |

## 11. 完成定义

- UI-012 至 UI-017 均分别实现、测试、推送、记录状态并经产品本人确认。
- 用户指出的页头、说明块、撞色数量、长列表、按钮和字号问题消失，同类页面也按共同规则收敛。
- Explore、阅读和“我的”的默认可操作元素数量明显下降，但核心功能仍可从唯一、可理解的路径进入。
- 侧栏收缩状态、断点默认值、键盘、主题和本地持久化符合设计。
- 所有关键状态、错误恢复、取消、过期回调、数据隔离和证据不变量继续通过行为测试。
- 全量门禁与真实登录人工复核均被如实记录；iPhone Safari/PWA 真机与 Flutter 仍按现有延期范围说明，不能被桌面结果替代。
- 只有产品本人确认没有剩余未记录的 P0/P1 功能或视觉缺陷后，才重新判断 ALPHA-033 是否满足发布候选条件。
