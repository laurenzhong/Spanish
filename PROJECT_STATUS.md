# PROJECT_STATUS.md

这是项目的实时状态与模型交接入口。它回答四个问题：现在处于哪个阶段、当前要做什么、谁在哪个分支负责、完成后下一步是什么。

- 最后更新：2026-08-20
- 当前里程碑：个人 Alpha 阶段 1——Web/PWA 与 Flutter 客户端基础骨架
- 总体状态：跨客户端 API 契约基线已完成实现和验证，等待分支复核与合并
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

### ALPHA-002B：建立版本化 API 契约与跨语言一致性样本

- 状态：`review`
- 负责人：Codex
- 目标分支：`feat/alpha-002b-api-contracts`
- 计划位置：`docs/plans/2026-08-20-personal-alpha-implementation-plan.md` 的“首批可执行任务顺序”第 3 项
- 前置依赖：ALPHA-002，已完成

目标：

- 建立 `/api/v1/` 对应的 OpenAPI 3.1 根文档和可复用 JSON Schema。
- 定义统一成功/失败包络、协议版本、分页结构和首批稳定错误码。
- 建立 `contracts/fixtures/v1/`，让 TypeScript 与 Dart 测试读取同一批有效和无效样本。
- 两端只建立协议 DTO、解析与错误映射，不接数据库、认证、真实 API 或业务评分。

验收条件：

- OpenAPI 文档引用的本地 Schema 全部存在且可以解析。
- 有效 fixtures 同时通过 JSON Schema、TypeScript 和 Dart 校验。
- 无效 fixtures 在两端被拒绝，并得到稳定的协议错误分类。
- TypeScript 与 Dart 对首批错误码、重试语义和协议版本解释一致。
- `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm build`、`flutter analyze` 和 `flutter test` 通过。

实现结果：

- 建立 OpenAPI 3.1.1 根文档、v1 Schema、协议注册表和共享 fixtures。
- 定义统一成功/失败包络、游标分页和 10 个稳定错误码及默认重试语义。
- TypeScript 与 Dart 都实现严格解析器，拒绝未知错误码、错误版本、未声明字段和无效分页数据。
- 共享 fixtures 同时覆盖有效响应、协议版本不兼容、供应商字段泄漏和无效游标。
- 验证通过：Web lint、typecheck、9 个单元/契约测试、6 个 Playwright E2E、生产构建；Flutter analyze 与 12 个测试。

## 活跃分支任务

| 任务 ID | 状态 | 分支 | 负责人/模型 | 范围 | 依赖 |
|---|---|---|---|---|---|
| ALPHA-002B | review | `feat/alpha-002b-api-contracts` | Codex | OpenAPI、JSON Schema、稳定错误码与跨语言 fixtures | ALPHA-002、ADR-0001 |

状态只使用：`ready`、`in_progress`、`blocked`、`review`、`done`。

## 接下来三个任务

| 顺序 | 任务 ID | 任务 | 开始条件 |
|---|---|---|---|
| 1 | ALPHA-003 | 配置 Supabase、Drizzle 和第一版数据库迁移 | ALPHA-002B 完成 |
| 2 | ALPHA-004 | 实现 Web/Flutter 会话与 RLS 隔离测试 | ALPHA-003 完成 |
| 3 | ALPHA-005 | 定义内容 Schema、Dart DTO 与幂等导入器 | ALPHA-004 完成 |

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
