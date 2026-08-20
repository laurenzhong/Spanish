# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-20
- 当前里程碑：个人 Alpha 阶段 1——PWA 基础骨架
- 总体状态：设计与实施文档完成，应用代码尚未创建
- 协调分支：`main`
- 当前阻塞：无

## 新模型快速接手

进入仓库后按顺序执行：

1. 阅读 `AGENTS.md`，了解不可违反的产品、架构、测试和隐私规则。
2. 阅读本文件，确认任务 ID、状态、分支和下一步。
3. 只阅读当前任务引用的实施计划章节和相关规范，不必一开始加载所有文档。
4. 运行 `git status --short --branch` 和 `git log -5 --oneline --decorate`。
5. 确认没有其他模型正在处理同一任务后再修改文件。

如果用户只给出任务 ID，以下表格和对应计划章节就是任务范围。不得自行扩大到后续任务。

## 当前任务

### ALPHA-001：创建 Next.js/PWA 工程骨架

- 状态：`in_progress`
- 负责人：Codex
- 开始日期：2026-08-20
- 目标分支：`feat/alpha-001-nextjs-pwa-scaffold`
- 计划位置：`docs/plans/2026-08-20-personal-alpha-implementation-plan.md` 的“任务 1.1：创建 Next.js 工程”
- 前置依赖：阶段 0 文档与仓库约束，已完成

目标：

- 创建 Next.js App Router、React、TypeScript 严格模式和 Tailwind CSS 工程。
- 固定 pnpm 与 Node.js 大版本。
- 建立 `dev`、`lint`、`typecheck`、`test`、`test:e2e` 和 `build` 脚本。
- 建立最小测试配置，但不提前实现业务页面。
- 保留当前文档和 Git 历史。

验收条件：

- `pnpm install` 成功。
- `pnpm lint` 成功。
- `pnpm typecheck` 成功。
- `pnpm test --run` 成功。
- `pnpm build` 成功。
- 首页能在手机和桌面浏览器打开。
- 没有加入支付、AI 对话、数据库等后续阶段能力。

## 活跃分支任务

| 任务 ID | 状态 | 分支 | 负责人/模型 | 范围 | 依赖 |
|---|---|---|---|---|---|
| ALPHA-001 | in_progress | `feat/alpha-001-nextjs-pwa-scaffold` | Codex | Next.js/PWA 脚手架与质量脚本 | 无 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来三个任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | ALPHA-002 | 建立四栏产品壳层和“继续学习”静态首页 | ALPHA-001 合并并通过构建 |
| 2 | ALPHA-003 | 配置 Supabase、Drizzle 和第一版数据库迁移 | ALPHA-001 合并 |
| 3 | ALPHA-004 | 实现邮箱认证与 RLS 隔离测试 | ALPHA-003 完成 |

完整任务顺序以实施计划的“首批可执行任务顺序”为准。本文件只展示最近任务，不复制全部 backlog。

## 分支任务交接规则

- 每个分支只负责一个任务 ID；不要把多个后续任务顺手放进同一分支。
- 同一任务只能有一个 `in_progress` 分支。
- 协调者在 `main` 上分配任务、负责人和目标分支后，再交给其他模型。
- 分支模型不得重新排列全局任务队列，也不得修改其他模型的任务状态。
- 分支模型完成后应提供：修改文件、测试结果、Commit、已知限制和建议下一步。
- 合并者在合并后更新本文件：把任务标为 `done`、记录 Commit，并提升下一任务。
- 如果任务跨越多个会话或需要大量上下文，可新增 `docs/tasks/<TASK-ID>.md`；简单任务不要额外建日志。
- 发现范围或架构需要变化时，将任务标为 `blocked` 并记录原因，等待用户决定，不能自行扩大范围。

## 当前关键决定

- 目标用户：学过语法和词汇但无法自然开口的 A2–B1 学习者。
- 首发形态：手机优先的响应式 Web PWA。
- 技术路线：Next.js、React、TypeScript、Tailwind、Supabase、Drizzle、Zod、Vercel。
- 架构：模块化单体，不在 Alpha 提前拆微服务。
- 首页：只有一个主要入口“继续学习”。
- 听说是强核心；读写用于静默环境并需要后续口语验证。
- AI 社交世界首个主要好友：Lucía Martín，固定生活在马德里。
- Echo-Loop 只作为流程和可靠性参考，不复制 AGPL-3.0 实现代码。

权威细节见：

- `docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`
- `docs/plans/2026-08-20-personal-alpha-implementation-plan.md`
- `docs/architecture.md`
- `docs/content-authoring.md`
- `docs/testing-strategy.md`

## 最近完成

| 日期 | 结果 | Commit | 下一步影响 |
|---|---|---|---|
| 2026-08-20 | 完成并批准七节产品设计 | `6564952` | 可以编写个人 Alpha 实施文档 |
| 2026-08-20 | 完成实施计划、AGENTS、架构、内容、测试和 Echo-Loop 评审 | `494f270` | 可以开始 ALPHA-001 |

最近完成只保留约 10–15 项。更早历史通过 `git log` 和实施计划查询。

## 更新模板

开始任务时更新：

```text
任务：ALPHA-XXX
状态：in_progress
分支：feat/alpha-xxx-description
负责人/模型：名称
开始日期：YYYY-MM-DD
```

完成并合并后更新：

```text
状态：done
Commit：abcdef0
验证：执行的检查及结果
下一任务：ALPHA-YYY
```
