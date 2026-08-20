# Spanish — 西班牙语沉浸式口语学习平台

这是一个面向 A2–B1 西班牙语学习者的口语优先学习产品。它帮助已经认识不少单词、理解一定语法，却在真实交流中反应慢、造句困难或无法自然开口的人，把被动知识转化为可迁移的沟通能力。

当前仓库处于个人 Alpha 的设计与实施准备阶段。产品设计已经逐节确认，下一步按实施计划搭建手机优先的 Web PWA。

## 核心体验

- 打开产品直接“继续学习”，不要求先选择时长和模式。
- 围绕打招呼、建立关系、表达需要、维持对话和修复沟通等通用交际能力训练。
- 通过情境输入、独立输出、渐进提示、变式迁移和真实对话形成听说闭环。
- 在不方便发声时用听力、阅读和打字继续学习，之后补充口语验证。
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
- 听说核心训练、静默读写替代和抽样口语复核。
- 浏览器 TTS、语音录制、转写和基础评估。
- 八维学习画像、有效学习热力图和唯一下一动作推荐。
- Lucía、一个兴趣好友和一个生活关系角色。
- 长期关系记忆、好友介绍和隐私控制。

支付、完整内容后台、实时语音、大规模角色网络、微服务和原生 iOS 属于后续路线，不在 Alpha 首批实现。

## 技术路线

- Next.js、React、TypeScript
- Tailwind CSS
- Supabase PostgreSQL、Auth、Storage
- Drizzle ORM
- Zod
- Vitest、React Testing Library、Playwright
- Vercel

Alpha 使用模块化单体。训练、证据、画像、推荐、角色、记忆和供应商通过明确模块接口协作，不提前拆分独立服务。

## 文档

- [完整产品设计](docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- [个人 Alpha 实施计划](docs/plans/2026-08-20-personal-alpha-implementation-plan.md)
- [架构边界](docs/architecture.md)
- [内容制作与审核规范](docs/content-authoring.md)
- [测试与质量策略](docs/testing-strategy.md)
- [Echo-Loop 参考评审](docs/references/echo-loop-review.md)
- [编码代理工作规范](AGENTS.md)

## 参考项目

[Echo-Loop](https://github.com/echo-loop/Echo-Loop) 对自动学习闭环、流程状态机、断点续学、复习事件、流式聊天可靠性和测试组织提供了有价值的参考。

本项目与它的产品核心不同：Echo-Loop 围绕一段音频练透，本项目围绕交际目标、自由表达和长期 AI 社交关系建立可迁移口语能力。Echo-Loop 使用 AGPL-3.0；本仓库只参考通用设计原则，不复制其实现代码或资源。

## 开发状态

目前尚未创建应用脚手架。实施从以下任务开始：

1. 创建 Next.js/PWA 工程和质量脚本。
2. 建立“学习 / 探索 / 对话 / 我的”产品壳层。
3. 配置 Supabase、Drizzle、认证和 RLS。
4. 建立内容 Schema 和幂等导入器。
5. 实现纯 TypeScript 训练状态机。

工程创建后，本地命令将统一为：

```powershell
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:e2e
pnpm build
```

在脚手架完成前，上述命令不会生效；当前工作的权威入口是实施计划。

## 开发协作

开始任何编码任务前先阅读 [AGENTS.md](AGENTS.md)。每次只完成一个可验证切片，保留用户已有改动，并把评分、隐私、角色一致性和失败降级作为核心质量要求。
