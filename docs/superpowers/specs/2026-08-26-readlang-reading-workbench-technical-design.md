# UI-009：Readlang 阅读工作台技术设计

- 日期：2026-08-26
- 任务：UI-009 阅读库与规范化阅读器
- 状态：设计已确认，待实现
- 参考页面：[Readlang Spanish public library](https://readlang.com/es/library)、[Readlang article reader](https://readlang.com/library/6a8970cc201825d7541080f8/from/0)
- 相关现有设计：[阅读库与西语文章内容体系](./2026-08-26-reading-library-and-article-content-design.md)、[Web UI 设计研究与页面方案](./2026-08-26-web-ui-design-research-and-scheme.md)

## 1. 决策摘要

本设计采用“功能和信息架构高保真、视觉与交互按 Sueño 约束重做”的策略。

复刻的核心是：文章书库、搜索/排序/筛选、稳定的文章条目密度、正文中的词语级交互、右侧辅助工作区、阅读进度和朗读控制。不会复制 Readlang 的品牌、社区投票、未经授权的文本导入、付费升级入口或移动端缩放问题。

阅读页面从当前的纵向堆叠改为阅读工作台：正文是唯一视觉主角，辅助工具贴近正文但不遮挡正文，阅读到口语迁移降为文章末尾的次级动作。阅读、打字、词语查询、TTS 和跳过迁移仍不能写入口语能力证据。

## 2. Readlang 调研证据

### 2.1 书库页面

调研 URL：`https://readlang.com/es/library`。默认 Edge 扩展视口为 1290 × 847，页面实际使用的内容列宽约 902px，居中于 x=186。

| 区域 | 可观察结构 | 对 Sueño 的启示 |
| --- | --- | --- |
| 顶部导航 | 绿色品牌栏、Home/Library/Word List/Practice/Chat、语言选择和 Web Reader 入口 | 阅读属于独立工作流；Sueño 保留五项产品导航，不新增词语一级导航 |
| 内容子导航 | My Texts、Public Texts、Web Sites | 可以区分“公共文章”和“个人保存”；Sueño 暂不实现任意 Web Sites/RSS 导入 |
| 工具行 | Generate Story、Upload Text or Audio、标题/作者搜索、Hot/Top/New 排序、Filters | 搜索和排序应在文章列表上方形成一个稳定工具带；上传和生成若没有真实后端不能占位 |
| 文章条目 | 高约 136px；左侧约 110px 类型色带；右侧标题、来源、作者、CEFR、词数、进度条、Read later、投票数 | 条目应优先支持扫描和继续阅读；Sueño 将投票改为真实阅读状态/保存动作 |
| 响应式 | 390px 视口下内容列约 363px，按钮文字被压缩为图标；信息密度仍偏桌面 | Sueño 重新定义手机布局，保证文字、命中区和状态不被缩放压缩 |

### 2.2 文章阅读器

调研 URL：`https://readlang.com/library/6a8970cc201825d7541080f8/from/0`。桌面视口下：

- 整体页面固定在视口内，左侧阅读容器约 865px，右侧侧栏约 425px。
- 顶部标题栏高约 46px；正文窗口约 695px 宽，正文段落约 689px 宽。
- 正文使用 Jost，观测字号 25px、行高 40px；段落间距约 25px。
- 底部控制栏高约 62px，包含上一页、当前位置/百分比、朗读、下一页和 Continue。
- 右侧侧栏固定在 x=865，顶部同样有标题栏；内容区可滚动。

阅读器顶部的可观察能力：返回、文章标题、streak、菜单和显示/隐藏侧栏。侧栏标签为 Explain、Dictionary、Guide、Words、Settings。

### 2.3 词语交互

正文被拆成带 `data-p` 位置的词语 `<span>`。点击词语后，正文中显示当前选择，侧栏 Explain 立即出现：

1. 词语、发音和编辑入口。
2. 词语在当前上下文中的解释。
3. 可选翻译按钮。
4. 报告错误解释和切换解释语言入口。

这说明“辅助贴着正文发生”比把词语能力放在文章末尾更适合学习阅读。Sueño 采用相同的信息关系，但服务端只返回经过校验的内部辅助结果；供应商失败时保留正文阅读。

### 2.4 Dictionary、Guide、Words、Settings

- **Dictionary**：源语言和第一语言选择、词典结果 iframe/外部结果、在新窗口打开。Sueño Alpha 不嵌入不受控的第三方 iframe；先提供内部词语辅助和可选外部链接。
- **Guide**：文章背景、人物/地点/事物词汇表、随阅读解锁的分段摘要。Readlang 未登录时显示升级按钮；Sueño 不显示付费墙，若没有内容则显示“辅助尚未准备好”。
- **Words**：批量选择、排序、分页、发音、收藏和词语表。Sueño 将保存短语与高亮作为文章私有阅读状态，暂不创建独立 `/review` 一级导航。
- **Settings**：字号、行距、列宽、字体、E-Ink/浅色/深色、对齐、句子断点、翻译行为、短语合并、自动高亮和朗读/自动发音速度。Sueño Alpha 首版只保留字号、行距、列宽、主题、翻译辅助开关和 TTS 速度，避免设置面板压过正文。

### 2.5 移动端证据与取舍

在 390 × 844 视口下，Readlang 阅读器正文列约 334px，观测字号 20px、行高 32px；侧栏以 x=390 的 off-canvas 方式隐藏，点击图标后移动到视口内。书库条目约 363px 宽，但顶栏操作会收缩为图标，阅读器侧栏内容存在明显缩放和可读性问题。

因此 Sueño 的手机策略是“正文优先 + 底部抽屉”，而不是复制其固定桌面列：正文至少保留 16px 两侧内边距、44px 控件命中区、可见焦点和安全区；侧栏打开时使用 `dialog`/`aria-modal` 语义并支持关闭键。

调研截图保存在：

- [书库桌面版](../../references/readlang-research/library-desktop.png)
- [阅读器单词解释桌面版](../../references/readlang-research/reader-word-explanation-desktop.png)
- [阅读器移动版](../../references/readlang-research/reader-mobile.png)
- [阅读器移动侧栏](../../references/readlang-research/reader-mobile-sidebar.png)
- [书库移动版](../../references/readlang-research/library-mobile.png)

## 3. 目标体验与非目标

### 3.1 目标

- 用户打开 `/read` 后无需先选择模式，立即看到一篇可读文章。
- 有真实断点时主动作唯一且为“继续阅读”；没有断点时主动作打开精选文章。
- 用户在正文中点击词语或选择短语即可获得辅助、保存短语或添加高亮。
- 阅读器在桌面保持正文主列和辅助侧栏，在手机保持正文主列和底部辅助抽屉。
- 刷新、断网和文章版本变化都能诚实恢复或提示，不能静默丢失标注。
- 阅读状态与 `evidence_events`、`mastery`、`confidence` 和口语证据隔离。

### 3.2 非目标

- 不实现任意 URL、RSS、Newsletter、浏览器扩展或本地 EPUB 导入。
- 不复制 Readlang 的社区投票、用户生成故事、付费升级或实时社交能力。
- 不把词语点击、阅读时间、打字草稿或 TTS 播放当作发音、语流或真实口头反应证据。
- 不在 React 组件中直接访问数据库，不把第三方 HTML 直接注入客户端。

## 4. 页面信息架构

### 4.1 `/read` 书库

```text
阅读
├─ 页头：标题、安静输入说明、回到今天
├─ 继续阅读（有断点才显示）
├─ 工具带
│  ├─ 标题/摘要/来源搜索
│  ├─ 全部 / 已保存 / 阅读中 / 已读
│  ├─ 主题、CEFR、时长、内容形式筛选
│  └─ 排序：推荐、最新、阅读时间
├─ 今日精选（少量编辑精选）
├─ 按主题浏览
└─ 文章结果列表/分页
```

文章条目采用高信息密度横向布局：类型色带、标题、来源/作者、CEFR、预计时间、主题和一条细进度线。保存、打开、继续必须对应真实状态变化；内容整理中、审核中仅为非交互状态标签。

### 4.2 `/read/article/[articleId]` 阅读工作台

```text
顶部栏：返回书库 | 文章标题 | 版本/在线状态 | 阅读设置
进度带：当前段落/阅读百分比（阅读活动，不是能力分数）
文章头：标题、摘要、来源、作者、日期、版权/原文链接
工作台：
  ├─ 正文主列（65–75ch，语义化段落和词语节点）
  └─ 辅助侧栏（桌面）/底部抽屉（手机）
       ├─ 解释：选词释义、词性、发音、保存、高亮
       ├─ 段落辅助：中文摘要或简单西语解释
       ├─ 已保存：当前文章短语/高亮/笔记
       └─ 设置：字号、行距、列宽、主题、TTS 速度
底部控制：朗读全文、朗读当前段、停止/重试
文章末尾：个人笔记 → 可选“读到口语”迁移
```

口语迁移卡片保留现有 READ-004 行为，但视觉权重低于正文：选择摘要、观点、个人迁移或角色对话后才出现草稿和“进入口语复核”；保存草稿和跳过都不创建尝试或证据。

## 5. 组件与模块边界

### 5.1 Web 组件

沿用现有路由和领域投影，拆分当前过大的 `ArticleReader`：

| 组件 | 责任 | 不负责 |
| --- | --- | --- |
| `ReadLibraryShell` | 组合页头、继续阅读、工具带和结果状态 | 数据库访问、保存写入 |
| `ReadLibraryToolbar` | 搜索、筛选、排序、URL 参数同步 | 文章过滤业务规则 |
| `ArticleListItem` | 文章元数据、真实进度和打开/继续/保存动作 | 生成假进度 |
| `ReaderTopbar` | 返回、标题、在线状态、设置入口 | 文章内容加载 |
| `ReaderProgress` | 段落位置和阅读百分比 | 能力评分 |
| `ReaderDocument` | 段落、词语节点、选区和键盘焦点 | 词典供应商调用 |
| `ReaderAssistPanel` | 桌面侧栏 tabs 和手机抽屉 | 直接写数据库 |
| `ReaderSelectionPopover` | 当前词语/短语的辅助、保存和高亮动作 | 评分或长期记忆 |
| `ReaderNotes` | 私有笔记编辑和保存状态 | 教学画像 |
| `ArticleTransferCard` | READ-004 迁移选择、草稿、跳过和深链 | 训练评估实现 |

建议文件边界：

- `app/(product)/read/page.tsx`：服务端获取列表 DTO 和页面组合。
- `app/(product)/read/read-library-shell.tsx`：客户端筛选、继续阅读和结果状态。
- `app/(product)/read/article/[articleId]/page.tsx`：服务端获取规范化文章。
- `app/(product)/read/article/[articleId]/article-reader.tsx`：只保留阅读器编排；继续拆分表中子组件。
- `src/modules/content/domain/article.ts`：文章投影和版本边界保持权威。
- `src/modules/content/domain/article-transfer.ts`：迁移任务保持现有四种类型。
- `src/modules/providers/tts/`：浏览器 TTS 接口和错误映射。

### 5.2 服务端边界

Route Handler 只做鉴权、Zod 校验、application 调用和 DTO 转换。文章列表不得返回正文；文章 detail 只返回已发布且版权清晰的版本。用户阅读私有数据接入时由 content application 调用 repository，并用当前用户身份做所有权检查；客户端不得直接写 `evidence_events`、画像或关系记忆。

## 6. 状态与数据流

### 6.1 阅读器 UI 状态

```text
idle
 ├─ hydrate-reading-state → hydrated
 ├─ hydrate-failed → usable-with-warning
 └─ article-version-mismatch → migration-notice

hydrated
 ├─ select-token → assist-open
 ├─ open-settings → settings-open
 ├─ start-tts → speaking
 ├─ offline → offline-recoverable
 └─ scroll/advance → persist-position

assist-open
 ├─ save-phrase/highlight → saved or save-error
 ├─ close → hydrated
 └─ provider-failure → assist-error（正文仍可读）

speaking
 ├─ done → hydrated
 ├─ cancel → hydrated
 └─ error → tts-error（可重试）
```

每次 TTS、词语辅助和私有写入带有当前文章 `stableKey`、`version`、`contentHash`；异步回调必须检查 generation/attempt token，旧请求不能覆盖当前选词或当前文章。

### 6.2 阅读状态边界

当前 Alpha 继续使用 Web localStorage，键名按文章 `stableKey` 隔离；状态至少包括：版本、内容哈希、段落位置、保存短语、范围高亮、笔记、迁移草稿。后续接入服务端表时，使用相同版本边界和 RLS，客户端缓存只能作为恢复缓存，不能成为能力事实。

文章版本变化时：

1. 新版本内容正常展示。
2. 旧版本状态不覆盖新版本状态。
3. 页面提示重新定位/迁移，保留旧版本标注供后续处理。
4. 不能把旧字符范围静默套用到新正文。

## 7. 视觉与响应式规格

### 7.1 设计令牌

- 使用现有 Sueño 令牌：`--background`、`--surface`、`--surface-soft`、`--foreground`、`--muted`、`--border`、`--accent`、`--terracotta`。
- 正文不使用卡片包裹；辅助面板可使用单层边框和浅背景。
- 文章卡片圆角不超过现有设计系统上限；不复制 Readlang 的渐变大色块。
- 正文字号默认 `1.18–1.25rem`，行高 `1.8–1.9`；窄栏宽度 `65–75ch`。
- 交互控件最小命中区 44px；icon-only 控件必须有可访问名称和 tooltip。

### 7.2 断点

| 视口 | 书库 | 阅读器 |
| --- | --- | --- |
| 320–699px | 单列条目，筛选可横向滚动或折叠；条目标题允许两行 | 正文单列；辅助改为底部抽屉；底部动作固定在安全区内 |
| 700–959px | 两列或宽单列，继续阅读横向布局 | 正文 + 240px 辅助栏，空间不足时自动改抽屉 |
| 960px 以上 | 三列文章卡或高密度列表 | 正文 `minmax(0, 1fr)` + 280–320px 辅助栏；侧栏 sticky |

不得出现横向滚动、标题遮挡、进度条改变布局高度或文本超出父容器。`prefers-reduced-motion` 下关闭面板滑入和 TTS 进度动画。

## 8. 可访问性与隐私

- 正文使用 `article`、`h1`、`p`、`button`/`a` 语义；词语节点可通过键盘聚焦和 Enter/Space 打开辅助。
- 辅助侧栏 tabs 使用 `role=tablist/tab/tabpanel`；手机抽屉使用 `dialog`、焦点移入、Escape 关闭和返回焦点。
- 进度条标注“文章阅读进度”，不得使用“能力进度”或相似文案。
- 离线、TTS、词语辅助和保存失败使用 `role=status`/`role=alert`，不阻塞正文。
- 私有短语、高亮和笔记默认只对当前用户可见；不共享给角色，不写入关系记忆。
- 日志只记录 request ID、文章版本和错误类别，不记录全文、选词正文、笔记或外部签名 URL。

## 9. 测试与验收矩阵

### 9.1 组件/领域

- 真实断点存在时只显示“继续阅读”；无断点时显示精选首篇动作。
- 搜索、主题、CEFR、时长和阅读状态筛选能保持 URL 可回放。
- 选词后打开辅助；关闭、键盘操作和重复保存不会丢失正文位置。
- TTS 成功、取消、失败和不支持都回到可读正文状态。
- localStorage 损坏、离线、恢复和版本哈希变化有明确提示。
- 阅读完成、打字草稿、保存短语、高亮、笔记和跳过迁移不创建口语证据。
- 主动进入口语复核时保留文章 ID、版本和迁移类型，并复用现有训练状态机。

### 9.2 Web E2E

1. `/read` → 打开精选 → 记录断点 → 刷新 → 恢复位置。
2. 搜索/主题/状态筛选 → 无结果 → 返回全部。
3. 文章 → 点击词语 → 保存短语/高亮 → 关闭辅助。
4. 文章 → 打开设置 → 改字号/行距/主题 → 刷新仍可读。
5. 文章 → 断网 → 继续阅读 → 恢复网络。
6. 文章 → 跳过迁移，断言没有失败文案和口语证据。
7. 文章 → 进入口语复核，断言 URL 带文章版本和迁移类型。
8. 视口 320、375、414、768、1024、1440px 检查无横向溢出和遮挡。

### 9.3 跨端

Flutter `ArticleReaderPage` 使用相同文章 DTO、版本哈希、阅读状态和错误语义；Dart 测试读取共享 fixtures。Windows 环境通过 `flutter analyze`/`flutter test` 只能表述公共代码通过，不能表述 iOS 真机或 Xcode 验证通过。

## 10. 实施顺序

1. **UI-009a 视觉壳层**：重构 `/read` 工具带、继续阅读和文章条目；补齐加载/空/错误状态。
2. **UI-009b 阅读工作台**：拆分 `ArticleReader`，实现正文主列、桌面辅助侧栏和手机抽屉。
3. **UI-009c 词语/段落辅助**：将选词节点、辅助 tabs、保存短语和高亮连接到现有本地状态边界。
4. **UI-009d 设置/TTS/恢复**：字号、行距、主题、列宽、TTS 速度、离线和版本提示。
5. **UI-009e 迁移与回归**：保留 READ-004 口语迁移入口，更新 RTL/Playwright/Flutter 测试。

UI-009 不提前实现 READ-005 的外部来源导入或服务端私有阅读表；若依赖尚未完成，使用现有 DTO 和本地恢复缓存完成视觉与行为验收，并把服务端同步作为后续增量。

## 11. 验收标准

- 书库和阅读器信息层级清楚，正文不再被迁移卡、笔记和工具按钮分割成一条长卡片流。
- 桌面端正文和辅助栏均可用；移动端正文可连续阅读，辅助工具不造成缩放、遮挡或横向滚动。
- Readlang 调研中确认的核心功能均有真实动作：搜索、筛选、打开、继续、选词辅助、保存、高亮、设置、朗读和进度。
- 没有假导入、假投票、假能力进度或未实现的付费入口。
- 所有阅读失败和恢复路径可观察、可重试且不污染口语能力事实。
- 相关测试、文档、Schema 和实现范围保持一致；完整质量命令按 UI-011 的跨模块门禁执行。

## 12. 自审结论

- 无 `TODO`、`TBD` 或未定义的实现占位。
- Readlang 的观察事实与 Sueño 的产品决定分开记录，没有把参考站行为误写成授权或必须实现的功能。
- 保留了现有 `ArticleCardProjection`、`ArticleReaderProjection`、`article-transfer` 和 TTS 边界，没有新增服务边界。
- 明确了 READ-005 依赖和“不提前实现任意导入/服务端阅读表”的范围。
- 明确覆盖错误、取消、离线、版本迁移、低置信度/技术失败不污染能力证据和跨端测试限制。
