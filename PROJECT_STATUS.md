# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-21
- 当前里程碑：个人 Alpha 阶段 2——认证、数据库与内容导入
- 总体状态：版本化内容 Schema、跨端 DTO 与幂等导入器已合并；正在整理最小核心表达开发内容
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

### ALPHA-006：导入 8–12 条最小核心表达用于开发

- 状态：`review`
- 负责人：Codex
- 目标分支：`feat/alpha-006-core-content`
- 计划位置：`docs/plans/2026-08-20-personal-alpha-implementation-plan.md` 的“任务 2.4：整理首批内容”
- 前置依赖：ALPHA-005，已完成（`bb6979f`）

目标：

- 从用户提供的 554 条西班牙语短句中选择 8–12 条可迁移核心表达。
- 为每条表达补全目标语块、替换槽位、中文教学说明、发音提示、变体、标签权值和独立输出任务。
- 维持未审核内容的 `draft` 与 `pending` 审核状态，不发布到生产可见内容。

验收条件：

- `content/bundles/alpha-core-v1.json` 包含 8–12 条版本化草稿表达，覆盖核心沟通能力。
- 每条表达具有至少两个变体、两个替换示例、评分标签、三级提示和迁移任务。
- 内容包可通过 `pnpm content:validate`；可在配置测试数据库后由幂等导入器导入。
- 所有内容明确为未审核开发草稿，不绕过审核、版权或发布规则。

边界：

- 不扩展为 40–60 条正式 Alpha 内容；完整审核内容属于后续整理工作。
- 不实现完整内容管理后台、在线协作审核、自动发布或探索页读取。
- 不用本地 HTML 的内容声称已获得母语者或教学审核。

## 活跃分支任务

| 任务 ID | 状态 | 分支 | 负责人/模型 | 范围 | 依赖 |
|---|---|---|---|---|---|
| ALPHA-006 | in_progress | `feat/alpha-006-core-content` | Codex | 8–12 条最小核心表达、草稿内容包与内容验证 | ALPHA-005 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来三个任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | ALPHA-007 | 实现 TypeScript/Dart 训练编排器及共同样本测试 | ALPHA-006 完成 |
| 2 | ALPHA-008 | 用 fake 评估器接通首个 Web/Flutter 训练微循环 | ALPHA-007 完成 |
| 3 | ALPHA-009 | 添加训练断点保存和恢复 | ALPHA-008 完成 |

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
- 首发形态：Next.js 完整 Web/PWA + Flutter iOS 同步个人 Alpha。
- 后续客户端：Flutter 同一代码线扩展 Android、Windows、macOS。
- 技术路线：Next.js/React/TypeScript Web，Flutter/Dart 客户端，Supabase、Drizzle、Zod、Vercel 远程模块化单体。
- 架构：单仓库、两条客户端代码线、版本化 API 和共同 JSON fixtures；不在 Alpha 提前拆微服务。
- iOS 不采用 Capacitor WebView；必要平台能力使用少量 Swift 桥接。
- 当前有 iPhone、无 Mac；iOS 编译、签名和真机音频验收尚不具备本地条件。
- 首页：只有一个主要入口“继续学习”。
- 听说是强核心；读写用于静默环境并需要后续口语验证。
- AI 社交世界首个主要好友：Lucía Martín，固定生活在马德里。
- Echo-Loop 当前只作为流程、Flutter 边界和可靠性参考；未来源码复用必须先记录作者授权范围、其他贡献者权利和许可义务。

权威细节见：

- `docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`
- `docs/superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md`
- `docs/adr/0001-nextjs-web-flutter-clients.md`
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
| 2026-08-20 | 完成 Web 与 Flutter 四栏产品壳层、平台 fake 和跨端测试基线 | `8420974` | 可以开始 ALPHA-002B |
| 2026-08-20 | 完成版本化 API 契约、稳定错误码和 TypeScript/Dart 共同 fixtures | `8342334` | 可以开始 ALPHA-003 |
| 2026-08-20 | 完成 31 张首批表、Drizzle Schema、空库迁移测试和数据库文档 | `b3b32e0` | 可以开始 ALPHA-004 |
| 2026-08-20 | 完成 Web/Flutter 邮箱 OTP、可靠 Token Gate、服务端鉴权和 RLS 隔离 | `d3171bb` | 可以开始 ALPHA-005 |
| 2026-08-21 | 完成版本化内容 Schema、跨端 DTO、严格校验与幂等事务导入 | `bb6979f` | 可以开始 ALPHA-006 |

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
