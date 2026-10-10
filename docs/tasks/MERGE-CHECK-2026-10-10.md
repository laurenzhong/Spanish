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

## 2.1 逐文件三方分析结果（本次已核实）

方法：对每个 add/add 文件运行 `git diff origin/main:<file> HEAD:<file>` 并读取差异；两侧版本都用 `git cat-file -e` 确认过确实不存在于共同祖先（是真 add/add，不是误报）。

### 可以明确判定的（7 个 add/add 文件全部）

| 文件 | 差异 | 判定 | 依据 |
|---|---|---|---|
| `src/modules/conversation/application/proactive-runner-utils.ts` | `+43` 行、**无删除** | **取本分支** | 本分支版本是 main 版本的严格超集：保留原有 `formatNaturalDate`/`parseLuciaProactiveUserIds`，新增 `LuciaProactiveSlot`、`getLuciaProactiveSlots`、`getDueLuciaProactiveSlots`（三段稳定时间窗 + 按用户/日期的稳定散列） |
| `scripts/run-lucia-proactive.ts` | `+29/-20` | **取本分支** | 同一功能的演进版：单条 `daily_share` 改为按 `getDueLuciaProactiveSlots` 逐槽生成；结果形状随之简化（去掉 `detail`） |
| `.github/workflows/lucia-proactive-daily.yml` | `+7/-5` | **取本分支** | 调度由每天一次 `15 1 * * *` 改为每 15 分钟轮询、由用户槽位决定是否发送；端点变量不再写默认值（改为必须显式配置） |
| `tests/unit/lucia-proactive-runner.test.ts` | `+9/-1` | **取本分支** | main 的 3 个用例在本分支版本中原样保留，仅新增「stable multiple daily slots」用例 |
| `app/api/v1/media/[stableKey]/stream/route.ts` | `+26/-3` | **取本分支** | main 版本保留，本分支新增 `resolveOfficialPodcastSource` 官方 RSS 回退分支 |
| `tests/unit/media-stream-route.test.ts` | `+33` 行、**无删除** | **取本分支** | main 的用例全部保留，新增「stored URL 失效时回退到发布方 RSS enclosure」用例 |
| `tests/unit/media-word-timeline.test.ts` | `+38/-30` | **取本分支** | 同一测试的重写版（改用 `@/src/modules/media/domain` 入口加 `@vitest-environment node`），main 侧断言集合被覆盖而非丢失 |

> 结论：这 7 个文件**不需要真正的人工合并**，直接取本分支版本即可；风险点只有一个——main 的 Lucía 主动消息链路是「每天一条」，本分支是「每天多槽轮询」，取本分支意味着**行为升级**，需要产品本人确认这个升级是有意为之（本分支状态页已记录多槽设计与实现）。

### `app/globals.css`（冲突但可安全解决）

main 侧对该文件只有 **+22/-1**：`@import "plyr/dist/plyr.css";` 一行，加 `.audio-player-adapter > audio` / `.video-player-adapter > video` 与 `.media-detail__player .plyr` 等播放器可见性规则。实测本分支当前文件**已包含这些内容**（第 2 行 import、第 11629 行起的播放器规则），main 的补丁对该文件既不能正向也不能反向套用（因为本分支已把同一改动吸收进去，且上下文行号已大幅位移）。

判定：**直接采用本分支版本**即可，不需要手工拼接；合并后用一次播放器页面冒烟确认 `.plyr` 可见性规则仍在。

### `PROJECT_STATUS.md`（冲突但可安全解决）

两边都只做「在顶部追加条目」。判定：**两边条目全部保留**，按时间倒序排列，不改写任何一方的历史记录文字。

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
git diff origin/main:<file> HEAD:<file>        # 逐文件判定用（两侧版本差异）
git worktree add ../merge-check -b merge-check HEAD   # 真正试合并时才需要
```

> 注意：`git merge-tree --write-tree` 会在仓库对象库里写入合并结果对象，但**不改工作树、不改当前分支、不生成提交**；本机多会话共享工作树时，这是安全的预检方式。

## 6. 本次预检的边界

- 只做了「读」：`git fetch`、`git merge-tree`、`git diff`、`git cat-file`。**未合并、未解冲突、未改动工作树、未改 `main`。**
- 第 2.1 节的判定基于两侧文件内容比较，**未在本机跑合并后的测试**（需要干净 worktree + `pnpm install`，本机共享工作树不适合直接做）。因此这些判定是「建议」，合并后仍需按第 3 节跑门禁。
- `docs/architecture.md`、`package.json`、`docs/superpowers/specs/2026-08-28-lucia-relationship-growth-and-proactive-messaging-design.md`、`contracts/openapi/v1/openapi.json` 等 content 冲突本次未逐行展开，需要对应作者在合并时处理。
