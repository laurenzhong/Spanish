# 探索页桌面 Web 技术调研

- 日期：2026-08-28
- 状态：设计研究稿，等待产品确认后进入实现计划
- 范围：Next.js/PWA 桌面 Web `/explore`；移动端只记录适配约束
- 目标：为“沟通目标 + 表达资料库 + 沉浸内容包”建立可持续的发现、筛选、回访和进入训练的桌面信息架构

## 1. 研究方法

本轮只读观察公开页面和仓库现有实现，记录可验证的结构，不复制品牌文案、插画、源码或独特视觉资产。观察日期为 2026-08-28。

### 1.1 公开产品与来源

| 来源 | 可观察重点 | 对 Sueño 的启发 |
| --- | --- | --- |
| [Duolingo](https://www.duolingo.com/) | 单一开始入口、课程路径、低决策首页；游戏化进度 | 探索页不应取代首页的唯一主动作；目标入口要可直接回到训练 |
| [Babbel](https://www.babbel.com/) | “真实交流”叙事、按生活目标组织课程、工具分层 | 用沟通意图和场景命名，而不是语法章节 |
| [Busuu](https://www.busuu.com/) | 真实世界语料、短课、社区反馈并列 | 内容卡应说明语境和输出结果；不伪装为真人社区 |
| [Memrise](https://www.memrise.com/en/learn-spanish) | 主题、短练习、母语视频和复习回路 | 以主题与场景浏览，短语复习嵌入上下文 |
| [ELSA Speak](https://elsaspeak.com/) | 直接强调开口、个性化路径、即时但分层的反馈 | 卡片主 CTA 指向“说出来的动作”，不在探索页显示实时分数 |
| [Tandem](https://tandem.net/) | 联系人、最近话题、文字/语音入口 | 关系入口保持独立；探索页只提供进入对话的明确路径 |
| [LingQ](https://www.lingq.com/en/learn-spanish-online/) | 内容类型分组和库式浏览 | “全部内容”需要筛选、排序和空状态，而非无限卡片 |
| [Readlang](https://readlang.com/) | 阅读时词语辅助和上下文保存 | 表达卡可提供短语保存，但不把阅读行为当口语证据 |
| [Readwise Reader](https://readwise.io/read) | 统一收件箱、标签、继续阅读、搜索 | 需要“继续探索”和来源/版本信息，帮助回访 |
| [BBC Learning English](https://www.bbc.co.uk/learningenglish) | 等级、主题、技能和最新内容并列 | 目标索引、难度和技能标签应是可扫描元数据 |
| [Echo-Loop](https://github.com/echo-loop/Echo-Loop) | 状态机、断点、显式完成终态 | 从探索进入训练必须保存稳定断点，失败不能假装完成 |
| 当前 `/explore` | 五个目标列表、一个草稿内容包、内容整理中空状态 | 骨架正确，但缺少搜索/筛选、回访、详情和状态分层 |

### 1.2 UI/UX Pro Max 数据库交叉检查

- `editorial-grid-magazine`：建议使用非对称网格、分隔线和编辑式层级；适合内容发现，但需保持移动重排。
- `Swiss Modernism 2.0`：12 列网格、数学间距、低阴影，适合工具型内容库。
- `Stagger List` 与 `Scroll Reveal`：列表进入动效建议 250–400ms、8–16px 位移；需提供无动效最终态。
- 可访问性规则：筛选 chip 使用原生 button + `aria-pressed`，所有控件有可见焦点；sticky rail 不得遮挡键盘焦点。
- 字体建议：Plus Jakarta Sans 作为拉丁字体，Noto Sans SC 作为中文字体；维持现有设计系统，不引入儿童化字体。

## 2. 研究结论

### 2.1 用户心智模型

探索页不是“第二个学习首页”，也不是开放社交广场。用户来这里通常有三种意图：

1. 我想练一个沟通动作（问候、表达需要、修复沟通等）。
2. 我想找一个有完整语境的内容包。
3. 我想回到上次看过或没完成的内容。

因此桌面 IA 应为：`意图索引 → 内容集合 → 详情/下一步`，而不是单层卡片墙。

### 2.2 设计机会

- 顶部增加一句“我现在想说……”的轻量输入，作为搜索和意图过滤的入口；它不是聊天机器人，不直接生成未经校验的内容。
- 五个沟通目标保留为可扫描的索引，目标卡展示已发布数量、最近一次练习和“回到训练”路径。
- 内容包使用“继续 / 推荐 / 全部”三段式分组，卡片提供等级、技能、时长、来源和审核状态。
- 选中卡片后使用条件详情 rail，而不是立刻离开页面；rail 显示学习目标、内容版本、口语迁移入口和保存状态。
- 草稿、内容整理中、来源缺失和服务失败必须是非交互状态；不可用时给出解释和可恢复动作。

### 2.3 明确不采用

- 不用经验值、连胜、宝石或“完成百分比”制造虚假能力感。
- 不把未审核内容伪装成可点击卡片，不提供任意 URL/RSS/Newsletter 导入。
- 不在探索页加入开放用户匹配、公开动态、实时双向语音或角色商城。
- 不让 AI 自由生成并直接写入课程、画像、人物圣经或关系记忆。
- 不用大面积玻璃拟态、霓虹渐变或游戏化弹跳动效覆盖内容层级。

## 3. 推荐桌面方案：目标索引 + 内容网格 + 条件详情 rail

### 3.1 12 列网格

| 区域 | 桌面宽度 | 责任 |
| --- | --- | --- |
| 侧栏 | 232–248px | 品牌、五项导航、账户入口 |
| 主内容 | 8 列 | 页面标题、意图输入、目标索引、内容卡网格 |
| 详情 rail | 4 列，选中后出现 | 当前卡片详情、版本、进入训练/阅读/对话 |
| 最大内容宽 | 1180–1240px | 1440px 以上保留留白，不无限拉伸 |

Rail 没有选中内容时不渲染，避免空白的“仪表盘感”；1024–1199px 时 rail 改为抽屉或折叠到卡片下方。

### 3.2 页面顺序

1. 页面眉题 `表达资料库`、标题“找到你现在最想说的话”和一句解释。
2. 意图输入：placeholder“例如：我想在咖啡馆自然认识新朋友”，提交后只做本地/服务端已知目标匹配；无匹配时展示可解释空状态。
3. 最近/继续条：只在存在真实进度时出现，最多 3 项。
4. 沟通目标索引：五个目标，当前目标用背景、文字和线性图标同时表达。
5. 内容包区域：`已发布`、`内容整理中`、`已保存` 等状态分组；每组有计数和筛选。
6. 条件详情 rail：标题、摘要、技能标签、难度、来源/审核、内容版本、真实下一动作。

### 3.3 卡片字段

必需字段：`title`、`summary`、`level`、`skills`、`durationLabel`、`status`、`version`、`updatedAt`、`route`。可选字段：`progress`、`saved`、`source`、`thumbnail`。

UI 不直接消费数据库行；建议由 Explore Dashboard DTO 聚合真实状态：

```ts
type ExploreCardStatus = "published" | "draft" | "unavailable" | "in_progress";

type ExploreCardDto = {
  id: string;
  title: string;
  summary: string;
  level: "A1" | "A2" | "B1";
  skills: Array<"listen" | "read" | "speak" | "write">;
  durationLabel: string;
  status: ExploreCardStatus;
  version: string;
  updatedAt: string;
  route?: string;
  progress?: { completedSteps: number; totalSteps: number };
  saved: boolean;
};
```

`draft`、`unavailable` 不提供进入训练的主按钮；`in_progress` 只能指向可恢复断点；只有 `published` 才能进入内容包体验。

## 4. 交互、动效与排版

### 4.1 排版

- 页面 H1：桌面 40/48px，700；移动 30/38px。
- 区块 H2：24/32px；卡片标题 18/26px；正文 15–16/24px。
- 拉丁字体 Plus Jakarta Sans；中文 Noto Sans SC；正文宽度 60–75 字符。
- 使用 `eyebrow + H1 + deck` 建立编辑节奏；分组之间用 1px 分隔线和留白，不用重复阴影。

### 4.2 颜色与表面

沿用现有暖编辑式令牌：`#F6F1E8` 背景、`#FFFDF8` 表面、`#1D2521` 墨色、`#B85B45` 赤陶主色、`#56706B` 灰绿色辅助色。详情 rail 使用 raised surface；卡片优先边框和纸面差异，避免玻璃模糊。

### 4.3 动效

- 首屏目标索引：opacity + 8px y，250–350ms，`power1.out`。
- 卡片 hover：translateY(-2px) + border/accent 变化，160–200ms；不改变布局尺寸。
- rail 打开：opacity + translateX(8px)，180–240ms；关闭更短。
- 不对长段落逐字动画；不 pin 页面；`prefers-reduced-motion: reduce` 时直接显示最终状态。
- 卡片网格使用稳定 `data-card-id`，避免 React 重渲染时动画错位。

## 5. 状态与错误恢复

| 状态 | 视觉 | 行为 |
| --- | --- | --- |
| loading | 目标索引和卡片骨架 | 保留布局高度，不能闪烁空白 |
| empty | “还没有发布内容包”说明 | 提供“从沟通目标开始”真实链接 |
| draft | 中性状态标签“内容整理中” | 非交互，说明审核状态 |
| unavailable | 警告标签 + 来源/配置缺失说明 | 若可重试显示重试；不可重试不显示按钮 |
| network error | 角色/内容区域错误面板 | 保留已加载内容，提供重试，不伪造结果 |
| in progress | 进度条 + “继续” | 只恢复稳定断点，不重新创建证据 |
| no intent match | 输入下方解释 | 推荐最近目标，不让模型自由编造课程 |

## 6. 可访问性与性能门槛

- 所有目标/筛选 chip 使用 button 或 link，`aria-pressed` 与可见选中态一致。
- 键盘顺序严格遵循“输入 → 目标 → 卡片 → rail”；焦点环 2px、对比度至少 3:1。
- sticky rail 使用 `scroll-padding`，不能遮挡焦点；提供 skip link 到主内容。
- 交互命中区至少 44×44px；卡片内不要嵌套可点击 link。
- 首屏只加载首批卡片，缩略图预留尺寸；长列表可分页或虚拟化，但初版优先分页。
- 目标是首屏 2 秒内可交互；动效不得阻塞导航和阅读顺序。

## 7. 实施边界与验收

本稿只授权后续设计与实现计划，不改变评分、证据、画像、关系记忆、RLS 或供应商契约。进入实现前需确认：

1. Explore Dashboard DTO 是否由 application 层提供；客户端不拼数据库行。
2. 已发布内容包的真实数量、版本和来源字段是否可用。
3. 意图输入第一版只匹配已知目标，还是需要独立搜索 endpoint。
4. rail 在 1024px 断点采用抽屉还是卡片下方展开。

实现验收至少包含：目标筛选、真实链接、draft 非交互、published 进入内容包、in_progress 恢复断点、失败重试、键盘焦点、`prefers-reduced-motion` 和 320–1440px 无横向滚动。

## 8. 参考

- [Sueño Web UI 设计研究与页面方案](./2026-08-26-web-ui-design-research-and-scheme.md)
- [Sueño 产品设计](./2026-08-20-spanish-speaking-learning-platform-design.md)
- [UI-UX Pro Max style database](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [Next.js App Router loading UI](https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming)

