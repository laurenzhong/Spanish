# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-20
- 当前里程碑：个人 Alpha 阶段 1——PWA 基础骨架
- 总体状态：Next.js/PWA 基础工程完成，准备建立产品壳层
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

### ALPHA-002：建立四栏产品壳层和“继续学习”静态首页

- 状态：`ready`
- 负责人：未分配
- 目标分支：`feat/alpha-002-product-shell`
- 计划位置：`docs/plans/2026-08-20-personal-alpha-implementation-plan.md` 的“任务 1.2：建立产品壳层”
- 前置依赖：ALPHA-001，已完成

目标：

- 建立“学习、探索、对话、我的”四个手机优先页面。
- 创建共享 App Shell 和底部导航，页面只负责组装。
- 学习首页只提供一个主要入口“继续学习”。
- 为页面建立最小加载、空和失败状态表现。
- 保持静态数据，不提前接入认证、数据库或 AI。

验收条件：

- 四个页面可以通过底部导航到达。
- 当前导航项具有可访问的选中状态。
- 学习首页只有“继续学习”作为主要动作，不出现时间或模式选择器。
- 手机和桌面视口都能正常使用。
- 组件测试和关键导航 E2E 通过。
- `pnpm lint`、`pnpm typecheck`、`pnpm test --run` 和 `pnpm build` 通过。

## 活跃分支任务

| 任务 ID | 状态 | 分支 | 负责人/模型 | 范围 | 依赖 |
|---|---|---|---|---|---|
| ALPHA-002 | ready | `feat/alpha-002-product-shell` | 未分配 | 四栏产品壳层与静态学习首页 | ALPHA-001 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来三个任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | ALPHA-003 | 配置 Supabase、Drizzle 和第一版数据库迁移 | ALPHA-001 合并 |
| 2 | ALPHA-004 | 实现邮箱认证与 RLS 隔离测试 | ALPHA-003 完成 |
| 3 | ALPHA-005 | 定义内容 Zod Schema 和幂等导入器 | ALPHA-003 完成 |

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
| 2026-08-20 | 完成 Next.js/PWA 脚手架、测试基线和响应式验证页 | `dba8bfb` | 可以开始 ALPHA-002 |

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
