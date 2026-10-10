# 合并前检查单（`codex/disable-legacy-readlang` → `main`）

生成时间：2026-10-10 22:5x
生成方式：`git fetch origin main` + `git merge-tree --write-tree HEAD origin/main`（**纯内存试合并，未改工作树、未改索引、未提交任何东西**）
被测状态：`HEAD = 8fc7d1f`，`origin/main = e5508ad`

## 1. 分歧规模

| 指标 | 值 |
|---|---|
| 共同祖先 | `26e5c63`（2026-09-24 `docs: record content pipeline verification (#64)`） |
| 本分支独有提交 | **98** |
| `main` 独有提交 | **30**（最近的 PR `#73`–`#75`：Lucía 主动消息 provider 修复、跨文字系统泄漏拦截） |
| 本分支改动文件（相对共同祖先） | 361 |
| `main` 改动文件 | 48 |
| 两边都改过的文件 | 37（其中 12 个两边内容一致，可安全自动合并） |

结论：这是一次**长分支合并**，`main` 在分歧期间已前进 30 个提交，不能指望无冲突合并。

## 2. 试合并冲突清单（18 个文件）

| 文件 | 冲突类型 | 归属 | 处理建议 |
|---|---|---|---|
| `app/globals.css` | content | 双方都改（本分支：五处滑动下划线、阅读区/学习频道/我的排版；main：其他） | 逐块合并，保留两边意图；样式冲突不涉及逻辑，重跑视觉断言即可 |
| `PROJECT_STATUS.md` | content | 双方都写交接 | 以时间为序**两边条目都保留**，不删任何一方记录 |
| `package.json` | content | 依赖版本推进 | 取两边要求的并集，随后必须重跑 `pnpm install` 并提交 lockfile |
| `docs/architecture.md` | content | 双方都改文档 | 两边段落都保留并核对小节顺序 |
| `.github/workflows/lucia-proactive-daily.yml` | **add/add** | 两边各自新增同名文件 | 必须人工判定哪一份是权威，或合并两份步骤 |
| `scripts/run-lucia-proactive.ts` | **add/add** | 同上 | 同上 |
| `src/modules/conversation/application/proactive-runner-utils.ts` | **add/add** | 同上 | 同上 |
| `tests/unit/lucia-proactive-runner.test.ts` | **add/add** | 同上 | 取并集（两边的用例都要留） |
| `src/modules/conversation/application/stream-reply.ts` | content | 双方都改流式回复 | 需 Lucía/对话作者判定语义，不要机械取一边 |
| `src/modules/conversation/domain/proactive-message.ts` | content | 同上 | 同上 |
| `src/modules/conversation/repositories/drizzle-proactive-message-repository.ts` | content | 同上 | 同上，注意迁移与列名一致 |
| `tests/unit/proactive-message.test.ts` | content | 同上 | 同上 |
| `tests/unit/conversation.test.ts` | content | 同上 | 同上 |
| `app/(product)/learn/media/[stableKey]/page.tsx` | content | 媒体详情页 | 媒体作者判定；注意 E2E 夹具页面 |
| `app/api/v1/media/[stableKey]/stream/route.ts` | **add/add** | 新增流路由 | 判定权威实现，保留 Range/重定向语义 |
| `src/modules/media/domain/word-timeline.ts` | content | 词级时间轴 | 保留本分支的 offset-only 兼容与 main 的修复 |
| `tests/unit/media-stream-route.test.ts` | **add/add** | 路由测试 | 并集 |
| `tests/unit/media-word-timeline.test.ts` | **add/add** | 时间轴测试 | 并集 |

**语义风险最高的是 4 个 add/add 源码/工作流文件**：两边各自新增了同名文件，git 无法判断谁权威，必须由对应功能的作者决定（`main` 侧是 PR `#73`–`#75` 的 Lucía 主动消息链路）。

## 3. 合并前必须完成的检查（建议顺序）

1. 在**干净检出**上复现试合并：`git worktree add ../merge-check -b merge-check HEAD` → 在该 worktree 内 `git merge origin/main`。
2. 解决第 2 节冲突；`package.json`/`pnpm-lock.yaml` 解决后重跑 `pnpm install`。
3. `pnpm lint`、`pnpm typecheck`、`pnpm test --run`（本机已知并行 worker OOM，用单 worker 或 `--max-old-space-size`）、`pnpm build`。
4. 受影响路径 E2E：`podcast-learning`、`video-learning`、`product-shell`、`lexicon-library`、`learn-page`、`conversation`。
5. 内容与数据库门禁：`pnpm db:check`；若含迁移，确认 `drizzle` journal 一致（见 `docs/tasks/MIG-RECONCILE-001.md`）。
6. 合并后立刻跑一次 `pnpm build` 与首屏冒烟，再更新 `PROJECT_STATUS.md` 的合并记录。

## 4. 本次工作的定位

本分支上属于本轮会话的改动（滑动下划线五处、首页可点区域、首页既有失败测试修正、两个复核包、真机验收清单与证据截图）**彼此独立、不与 main 的 30 个提交争抢同一逻辑**；唯一需要人工介入的共享文件是 `app/globals.css` 与 `PROJECT_STATUS.md`，两者都是「两边都保留」型冲突。

## 5. 复现命令

```powershell
git fetch origin main
git merge-tree --write-tree HEAD origin/main   # 只看冲突，不落地
git worktree add ../merge-check -b merge-check HEAD   # 真正试合并时才需要
```

> 注意：`git merge-tree --write-tree` 会在仓库对象库里写入合并结果对象，但**不改工作树、不改当前分支、不生成提交**；本机多会话共享工作树时，这是安全的预检方式。
