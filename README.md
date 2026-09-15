# Sueño — 西班牙语沉浸式口语学习平台

这是一个面向 A2–B1 西班牙语学习者的口语优先学习产品。它帮助已经认识不少单词、理解一定语法，却在真实交流中反应慢、造句困难或无法自然开口的人，把被动知识转化为可迁移的沟通能力。

当前仓库已进入个人 Alpha 实施阶段。产品首先服务项目所有者自己的学习；当前只推进 Next.js 响应式 Web/PWA，覆盖桌面浏览器与 iPhone Safari。Flutter 和原生应用保留为后续路线，不在本阶段同步实现。

## 核心体验

- 登录后打开“学习”直接看到视频与播客资料库，像桌面 YouTube/B站一样选择内容；不经过“开始学习”“继续学习”、Hero 或模式选择器。
- 围绕打招呼、建立关系、表达需要、维持对话和修复沟通等通用交际能力训练。
- 通过情境输入、独立输出、渐进提示、变式迁移和真实对话形成听说闭环。
- 在不方便发声时用听力、阅读和打字继续学习，之后补充口语验证。
- “阅读”集中承载文章、词汇、短语、文字考察和跨来源语料查询；阅读行为本身不计为口语证据。
- 用词汇与短语、交流运用、语音表达、跟读表现四个能力板块说明真实进步，而不是只展示经验值或打卡。
- 与长期 AI 好友 Lucía 在接近真实私信的环境中持续交流，并自然认识其他角色。
- 通过白名单 YouTube 频道、播客 RSS、文章 RSS 和专用适配器每日增量发现素材；自动化只进入候选库，所有者审核后才发布。

## 产品原则

- 开口优先，语境优先，证据优先。
- 不在用户说话过程中纠错。
- 不要求匹配唯一标准答案。
- 学习时长不参与能力评分。
- AI 好友首先像朋友一样回应，教学目标隐藏在后台。
- 技术失败和低置信度转写不能造成错误扣分。

## 个人 Alpha

Alpha 当前计划包含：

- 保留已审核的正式表达、场景和历史沉浸式内容包，不静默改写已有版本或证据。
- 可持续扩充的视频、播客和西语文章库，以及每日白名单候选供应链。
- 文章、媒体共用的词汇/短语出现索引、语料查询和纯文字词句考察。
- 听说核心训练、静默读写替代和抽样口语复核。
- Web 浏览器 TTS、录音、转写和基础评估。
- 四板块学习画像和有效学习热力图。
- Lucía、一个兴趣好友和一个生活关系角色。
- 长期关系记忆、好友介绍和隐私控制。
- Next.js PWA 在桌面浏览器与 iPhone Safari 上的核心学习闭环。

支付、通用内容管理后台、实时双向语音、大规模角色网络、微服务、本地离线 ASR、Flutter/原生移动客户端和商店发布属于后续路线。当前只允许所有者使用的轻量内容工作流；手机端通过 iPhone Safari 与添加到主屏幕后的 PWA 使用。

## 技术路线

- Web：Next.js、React、TypeScript、Tailwind CSS、PWA
- 手机网页：响应式布局、iPhone Safari、PWA 安全区与麦克风适配
- 服务端与数据：Next.js Route Handlers、Supabase PostgreSQL/Auth/Storage、Drizzle、Zod
- 接口边界：版本化 API 契约、共享内容源和稳定错误码
- 测试：Vitest、React Testing Library、Playwright；真实 iPhone Safari 人工验收
- 部署：Vercel 与 Supabase

Alpha 使用单仓库和远程模块化单体。训练、证据、画像、推荐、角色、记忆和供应商通过明确模块接口协作，不提前拆分独立服务。服务端规则、内容、API 协议和学习数据保持单一权威来源；版本化 API 继续保留，为未来恢复其他客户端提供边界。

自动内容供应继续运行在同一仓库和模块化单体边界内：`content-acquisition` 负责来源、候选和处理编排，`media` 负责视频/播客版本与播放，`lexicon-corpus` 负责词句和语料。长任务由定时 CI runner 调用 TypeScript CLI，不在 Vercel 请求中运行，也不提前引入微服务或消息队列。

## 文档

- [当前任务与项目状态](PROJECT_STATUS.md)
- [完整产品设计](docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- [Web 优先的个人学习产品与场景实战设计](docs/superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)
- [自动内容供应与词句学习重构设计](docs/superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)
- [自动内容供应与词句学习重构实施计划](docs/plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md)
- [Web/PWA 场景学习闭环实施计划](docs/plans/2026-09-11-web-first-scenario-practice-implementation-plan.md)
- [阅读库与西语文章内容体系设计](docs/superpowers/specs/2026-08-26-reading-library-and-article-content-design.md)
- [UI-009：Readlang 阅读工作台技术设计](docs/superpowers/specs/2026-08-26-readlang-reading-workbench-technical-design.md)
- [Web UI 设计研究与页面方案](docs/superpowers/specs/2026-08-26-web-ui-design-research-and-scheme.md)
- [探索页桌面 Web 技术调研](docs/superpowers/specs/2026-08-28-explore-page-desktop-web-technical-research.md)
- [探索页桌面 Web 视觉与交互方案](docs/superpowers/specs/2026-08-28-explore-page-desktop-web-design.md)
- [探索页桌面 Web 实施计划](docs/plans/2026-08-28-explore-page-desktop-web-implementation-plan.md)
- [电脑端 Web 界面密度与操作层级收敛设计](docs/superpowers/specs/2026-09-12-desktop-web-interface-density-and-action-hierarchy-design.md)
- [电脑端 Web 界面密度与操作层级收敛实施计划](docs/plans/2026-09-12-desktop-web-interface-density-and-action-hierarchy-implementation-plan.md)
- [媒体详情与视频学习器视觉设计](docs/superpowers/specs/2026-09-15-media-detail-learning-workbench-design.md)
- [媒体详情与视频学习器实施计划](docs/plans/2026-09-15-media-detail-learning-workbench-implementation-plan.md)
- [历史：Web 与 Flutter 多平台架构设计](docs/superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md)
- [个人 Alpha 实施计划](docs/plans/2026-08-20-personal-alpha-implementation-plan.md)
- [架构边界](docs/architecture.md)
- [数据库与迁移](docs/database.md)
- [认证与会话](docs/authentication.md)
- [跨客户端 API 契约](contracts/README.md)
- [ADR-0002：个人 Alpha 改为 Web/PWA 优先](docs/adr/0002-web-pwa-first-personal-alpha.md)
- [ADR-0008：内容驱动学习入口与自动采集审核链路](docs/adr/0008-content-led-learning-and-automated-ingestion.md)
- [历史 ADR-0001：Next.js Web 与 Flutter 客户端](docs/adr/0001-nextjs-web-flutter-clients.md)
- [内容制作与审核规范](docs/content-authoring.md)
- [测试与质量策略](docs/testing-strategy.md)
- [Echo-Loop 参考评审](docs/references/echo-loop-review.md)
- [编码代理工作规范](AGENTS.md)

## 参考项目

[Echo-Loop](https://github.com/echo-loop/Echo-Loop) 对自动学习闭环、流程状态机、断点续学、复习事件、流式聊天可靠性和测试组织提供了有价值的参考。

本项目与它的产品核心不同：Echo-Loop 围绕一段音频练透，本项目围绕交际目标、自由表达和长期 AI 社交关系建立可迁移口语能力。Echo-Loop 使用 AGPL-3.0；当前仓库没有复制其实现代码或资源。用户说明自己曾参与该项目并得到作者允许，未来如需源码复用，将先把授权范围、涉及文件、其他贡献者权利和发布义务记录清楚，再单独实施。

## 开发状态

实时进展、活动分支、当前验收条件和接下来三个任务统一记录在 [PROJECT_STATUS.md](PROJECT_STATUS.md)。其他模型进入仓库后应先阅读该文件和 `AGENTS.md`。

基础工程已经包含 Next.js App Router、React、TypeScript、Tailwind CSS、Vitest 和 Playwright。响应式 Web/PWA 产品壳层保留“学习、阅读、探索、对话、我的”五项导航；“学习”已是视频/播客资料库，词汇、短语和语料将在后续任务纳入“阅读”。Flutter 代码保留但暂停同步。

本地环境要求：

- Node.js 24.x，仓库通过 `.nvmrc` 和 `engines` 固定大版本。
- pnpm 11.x，精确版本记录在 `package.json`。
- 执行 E2E 时需要本机安装 Google Chrome。
- `pnpm test:e2e` 默认使用隔离的 `127.0.0.1:3100` 和 `.next/e2e` 构建目录，不会抢占正在运行的 3000 开发服务；如需更换端口可设置 `PLAYWRIGHT_PORT`。
- iPhone Safari 的麦克风、键盘、安全区、前后台恢复和 PWA 主屏模式需要真实设备验收。

首次运行：

```powershell
pnpm install
pnpm dev
```

Web 登录需要在本地 `.env` 中配置公开的 Supabase 项目 URL 和 publishable key：

Language Reactor 来源需要先应用数据库迁移，再运行一次所有者来源注册：

```powershell
pnpm db:migrate
pnpm content:register-language-reactor
pnpm content:acquire -- --source language-reactor.podcast-mix-es --limit 20
pnpm content:acquire -- --source language-reactor.youtube-mix-es --limit 20
```

已明确授权的 Language Reactor 播客可在发布后复制到 Supabase Storage，使用稳定本站对象 URL 播放：

```powershell
pnpm content:host-language-reactor-audio
```

该脚本需要服务端 `SUPABASE_SECRET_KEY`（或旧版 `SUPABASE_SERVICE_ROLE_KEY`）；它不会下载 YouTube 视频。

采集只会生成候选并自动推进到审核待命；在 `/me/content-workflow` 完成审核并显式发布后，内容才会出现在 `/learn`。播客 enclosure 仍需通过无凭据 HTTPS、主机白名单、HEAD 类型/大小和有效期检查。

普通用户入口是邮箱六位 OTP；密码登录只保留给预建测试账号，不在普通入口并列展示。完整配置、安全边界和本地测试说明见 [认证与会话](docs/authentication.md)。

质量检查：

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:contracts
pnpm db:check
pnpm test:e2e
pnpm build
```

数据库 Schema 变更使用 `pnpm db:generate` 生成向前迁移；只有在明确配置本地或测试 PostgreSQL 连接后才运行 `pnpm db:migrate`。真实连接信息只放在未提交的本地 `.env` 中。

版本化内容在写库前先校验，正式语料从 ALPHA-006 开始放入 `content/bundles/`：

```powershell
pnpm content:validate -- content/bundles/alpha-core-v1.json
pnpm content:import -- content/bundles/alpha-core-v1.json
```

内容契约、幂等与版本规则见 [版本化内容源](content/README.md) 和 [内容制作规范](docs/content-authoring.md)。

只有任务明确修改暂停维护的 Flutter 代码时，才额外运行：

```powershell
cd apps/mobile
flutter analyze
flutter test
```

完整路线以实施计划为准，实时任务以 `PROJECT_STATUS.md` 为准。

## 开发协作

开始任何编码任务前先阅读 [AGENTS.md](AGENTS.md) 和 [PROJECT_STATUS.md](PROJECT_STATUS.md)。每次只完成一个任务 ID，保留用户及其他模型已有改动，并把评分、隐私、角色一致性和失败降级作为核心质量要求。
