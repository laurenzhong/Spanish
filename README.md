# Sueño — 西班牙语沉浸式口语学习平台

这是一个面向 A2–B1 西班牙语学习者的口语优先学习产品。它帮助已经认识不少单词、理解一定语法，却在真实交流中反应慢、造句困难或无法自然开口的人，把被动知识转化为可迁移的沟通能力。

当前仓库已进入个人 Alpha 实施阶段。产品设计已经逐节确认，Next.js/PWA 基础工程已经建立；架构现已确定为“Next.js 完整 Web 产品 + Flutter 多平台客户端”，Web 与 iOS 从 Alpha 开始同步推进。

## 核心体验

- 首页按学习状态显示真实的唯一主动作：新用户“开始第一次练习”，有稳定断点的用户“继续学习”；不强制先选择时长和模式，必要的调整入口以低干扰方式提供。
- 围绕打招呼、建立关系、表达需要、维持对话和修复沟通等通用交际能力训练。
- 通过情境输入、独立输出、渐进提示、变式迁移和真实对话形成听说闭环。
- 在不方便发声时用听力、阅读和打字继续学习，之后补充口语验证。
- 在独立的“阅读”页面阅读可核验来源的西语刊物、生活和工作文章，支持断点、词语辅助、保存和可选口语迁移；阅读行为本身不计为口语证据。
- 用学习证据、八维能力图和场景状态说明真实进步，而不是只展示经验值或打卡。
- 与长期 AI 好友 Lucía 在接近真实私信的环境中持续交流，并自然认识其他角色。

## 产品原则

- 开口优先，语境优先，证据优先。
- 不在用户说话过程中纠错。
- 不要求匹配唯一标准答案。
- 学习时长不参与能力评分。
- AI 好友首先像朋友一样回应，教学目标隐藏在后台。
- 技术失败和低置信度转写不能造成错误扣分。

## 个人 Alpha

Alpha 计划包含：

- 40–60 条正式训练表达。
- 8–12 个沉浸式内容包。
- 首批可持续扩充的西语阅读文章库（原创、公共领域、开放许可或明确授权来源）。
- 听说核心训练、静默读写替代和抽样口语复核。
- Web 浏览器 TTS、Flutter 平台语音接口、录音、转写和基础评估。
- 八维学习画像、有效学习热力图和唯一下一动作推荐。
- Lucía、一个兴趣好友和一个生活关系角色。
- 长期关系记忆、好友介绍和隐私控制。
- Next.js PWA 与 Flutter iOS 客户端的核心学习闭环。

支付、完整内容后台、实时双向语音、大规模角色网络、微服务、完整离线 ASR，以及 Android/Windows/macOS 的发布打磨属于后续路线。Flutter iOS 客户端不再延后，但当前没有 Mac，因此 iOS 编译、签名和真机音频验收需要后续补齐 Mac/Xcode 环境。

## 技术路线

- Web：Next.js、React、TypeScript、Tailwind CSS、PWA
- 多平台客户端：Flutter、Dart；iOS Alpha，后续 Android、Windows、macOS
- 服务端与数据：Next.js Route Handlers、Supabase PostgreSQL/Auth/Storage、Drizzle、Zod
- 跨端一致性：版本化 API 契约、共享内容源和 JSON 一致性样本
- 测试：Vitest、React Testing Library、Playwright、Flutter test
- 部署：Vercel；iOS/macOS 构建最终需要 Mac/Xcode

Alpha 使用单仓库和远程模块化单体。训练、证据、画像、推荐、角色、记忆和供应商通过明确模块接口协作，不提前拆分独立服务。Web 与 Flutter 不强行共享 UI 源码；服务端规则、内容、API 协议和学习数据保持单一权威来源。

## 文档

- [当前任务与项目状态](PROJECT_STATUS.md)
- [完整产品设计](docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- [阅读库与西语文章内容体系设计](docs/superpowers/specs/2026-08-26-reading-library-and-article-content-design.md)
- [Web UI 设计研究与页面方案](docs/superpowers/specs/2026-08-26-web-ui-design-research-and-scheme.md)
- [Web 与 Flutter 多平台架构设计](docs/superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md)
- [个人 Alpha 实施计划](docs/plans/2026-08-20-personal-alpha-implementation-plan.md)
- [架构边界](docs/architecture.md)
- [数据库与迁移](docs/database.md)
- [认证与会话](docs/authentication.md)
- [跨客户端 API 契约](contracts/README.md)
- [ADR-0001：Next.js Web 与 Flutter 客户端](docs/adr/0001-nextjs-web-flutter-clients.md)
- [内容制作与审核规范](docs/content-authoring.md)
- [测试与质量策略](docs/testing-strategy.md)
- [Echo-Loop 参考评审](docs/references/echo-loop-review.md)
- [编码代理工作规范](AGENTS.md)

## 参考项目

[Echo-Loop](https://github.com/echo-loop/Echo-Loop) 对自动学习闭环、流程状态机、断点续学、复习事件、流式聊天可靠性和测试组织提供了有价值的参考。

本项目与它的产品核心不同：Echo-Loop 围绕一段音频练透，本项目围绕交际目标、自由表达和长期 AI 社交关系建立可迁移口语能力。Echo-Loop 使用 AGPL-3.0；当前仓库没有复制其实现代码或资源。用户说明自己曾参与该项目并得到作者允许，未来如需源码复用，将先把授权范围、涉及文件、其他贡献者权利和发布义务记录清楚，再单独实施。

## 开发状态

实时进展、活动分支、当前验收条件和接下来三个任务统一记录在 [PROJECT_STATUS.md](PROJECT_STATUS.md)。其他模型进入仓库后应先阅读该文件和 `AGENTS.md`。

基础工程已经包含 Next.js App Router、React、TypeScript、Tailwind CSS、Vitest 和 Playwright。Web 与 Flutter 的产品壳层按“学习、阅读、探索、对话、我的”五项语义演进；当前视觉是 Alpha 基线，阅读库与阅读器仍处于设计审阅阶段，后续会在真实体验中继续打磨。

本地环境要求：

- Node.js 24.x，仓库通过 `.nvmrc` 和 `engines` 固定大版本。
- pnpm 11.x，精确版本记录在 `package.json`。
- Flutter 客户端固定使用 Flutter 3.47.1 / Dart 3.13.1，版本文件位于 `apps/mobile/`。
- 执行 E2E 时需要本机安装 Google Chrome。
- `pnpm test:e2e` 默认使用隔离的 `127.0.0.1:3100` 和 `.next/e2e` 构建目录，不会抢占正在运行的 3000 开发服务；如需更换端口可设置 `PLAYWRIGHT_PORT`。
- iOS/macOS 编译、签名和真机调试需要 Mac 与 Xcode；Windows 只能完成 Flutter 公共代码和非 iOS 测试。

首次运行：

```powershell
pnpm install
pnpm dev
```

Web 登录需要在本地 `.env` 中配置公开的 Supabase 项目 URL 和 publishable key。Flutter 使用同一项目，但通过 `--dart-define` 注入，不读取 Web 的 `.env`：

```powershell
flutter run `
  --dart-define=SUPABASE_URL=https://your-project.supabase.co `
  --dart-define=SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

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

Flutter 公共代码检查：

```powershell
cd apps/mobile
flutter analyze
flutter test
```

完整路线以实施计划为准，实时任务以 `PROJECT_STATUS.md` 为准。

## 开发协作

开始任何编码任务前先阅读 [AGENTS.md](AGENTS.md) 和 [PROJECT_STATUS.md](PROJECT_STATUS.md)。每次只完成一个任务 ID，保留用户及其他模型已有改动，并把评分、隐私、角色一致性和失败降级作为核心质量要求。
