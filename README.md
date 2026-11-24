# Sueño · 西班牙语沉浸式口语学习平台

Sueño 面向已有西语基础的 A2–B1 学习者。你可以用真实视频、播客和文章积累表达，在场景实战和与 AI 好友 Lucía 的对话里练习把意思说完整。

Sueño 当前提供响应式 Web/PWA。使用邮箱六位验证码登录，启用 Supabase 注册的环境允许新邮箱请求验证码时创建账号。直接登录后默认打开影音资料库。Flutter 代码保留在 `apps/mobile`，功能同步暂停。iPhone Safari/PWA 的真机验收见项目状态。[认证与会话](docs/authentication.md) · [项目状态](PROJECT_STATUS.md)

## 登录后可以做什么

| 入口 | 当前功能 |
| --- | --- |
| 学习 · `/learn` | 直接挑选已发布的视频或播客，按主题、难度等筛选或换一批。打开内容后可逐句播放、点词、查看可用的双语字幕和恢复播放位置。有系列的内容可查看选集。 |
| 阅读 · `/read` | 阅读文章、划词查义和记录笔记。用高频词表和双向默写练单词，用短语手册练日常表达，在语料页对照真实用例并回到出处。个人书架收纳已保存内容和私人 AI 故事。 |
| 探索 · `/explore` | 浏览公开场景与表达，或生成私人场景。与临时人物进行多轮文字或语音实战，结束后查看复盘和练习历史。 |
| 对话 · `/chat` | 与长期 AI 角色 Lucía 发文字或语音消息。可按需使用翻译、朗读和 AI 助手，助手能给回复建议、检查草稿和分析句子。 |
| 我的 · `/me` | 查看四板块能力和活动热力图，调整偏好、关系和语音隐私，按需删除个人学习数据。 |

能力画像分为词汇与短语、交流运用、语音表达、跟读表现。口语和交流评估在用户完成表达后进行，接受符合语境的自然替代表达。浏览、查词、收藏、朗读和个人自查不写入能力评分。文字不能提供发音证据，跟读证据只用于跟读表现，低置信度转写和技术失败不产生负面证据。[架构边界](docs/architecture.md)

授权所有者可使用“我的”中的内容工作流审核候选、显式发布或撤下。白名单内容供应和发布模式见[内容采集运行手册](docs/operations/content-acquisition-runbook.md)。

## 本地开发

使用 Node.js 24.x 和 `package.json` 指定的 pnpm 版本（当前为 11.19.0）。应用使用 Next.js、React、TypeScript 和 Tailwind CSS，服务端通过 Drizzle 访问 Supabase PostgreSQL，使用 Supabase Auth 管理会话。

首次配置时从 `.env.example` 创建本地 `.env`，填入独立开发或测试项目的配置。

- `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 用于邮箱 OTP。Supabase 项目需启用注册，并配置发送六位验证码的邮件模板。
- `DATABASE_URL` 用于应用访问数据库。迁移连接和已有内容的校验、导入见下方文档。空库需准备已发布数据才会有真实影音和文章可浏览。
- `MINIMAX_API_KEY` 用于全站合成朗读。Web/PWA 统一调用鉴权的 `/api/v1/tts`，使用 MiniMax `speech-2.8-turbo` 和 `Spanish_SereneWoman`。其他语音或 AI 功能的配置见 `.env.example`。

配置示例和权限边界见[环境变量模板](.env.example)、[认证与会话](docs/authentication.md)、[数据库与迁移](docs/database.md)、[版本化内容源](content/README.md)和[统一朗读 ADR](docs/adr/0019-unified-minimax-read-aloud.md)。

```powershell
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。配置好 Auth 和数据库后，用测试邮箱登录，确认进入“学习”，再切换“阅读”“探索”“对话”和“我的”。

## 检查

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:contracts
pnpm db:check
pnpm test:e2e
pnpm build
```

Playwright 使用本机 Google Chrome，默认启动隔离服务 `127.0.0.1:3101`，构建目录为 `.next/e2e`。需要更换端口时设置 `PLAYWRIGHT_PORT`。本地 E2E 使用测试会话和 fake，真实供应商、数据库权限和 iPhone Safari/PWA 验收分别记录。[测试与质量策略](docs/testing-strategy.md)

## 文档

- 开发协作与当前任务 [AGENTS.md](AGENTS.md) · [PROJECT_STATUS.md](PROJECT_STATUS.md)
- 产品功能、运营手册、发布范围和历史设计 [文档索引](docs/README.md)
- 版本化接口 [API 契约](contracts/README.md)
