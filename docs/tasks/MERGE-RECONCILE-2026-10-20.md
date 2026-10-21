# MERGE-RECONCILE-2026-10-20：把共享分支并入 main 的对账与试合并方案

- 状态：方案完成（`review`），未执行合并
- 作者：DSH Lead（只读盘点 + 干净 worktree 试合并）
- 关联：`PROJECT_STATUS.md` 的 `WORKSPACE-CHECKPOINT-001`、`OPS-CI-003`、`MEDIA-WORD-004`；旧记录 [MERGE-OPS-2026-10-10](MERGE-OPS-2026-10-10.md)

## 1. 目的与边界

解决主线程（`origin/main`）与共享分支（`codex/disable-legacy-readlang`）的长期分叉：共享分支 2026-10-16 之后的产品成果已在 `WORKSPACE-CHECKPOINT-001` 提交并推送，但 main 仍缺 TTS 朗读、阅读/词汇/语料、媒体系列、四板块画像等大量产品代码；同时共享分支缺 main 在 10-10 之后合入的播放器、播客源解析、词级时间轴、Lucía 主动消息与每日管线修复。

本文只做两件事：给定分叉事实、给定可执行的合并步骤与冲突处理策略。**未执行合并、未改写 main、未推送合并结果、未跑迁移或 provider。**

## 2. 分叉事实（2026-10-20 22:55 实测）

- merge-base：`946eedb`（2026-10-10 23:05）。
- `origin/main`：76 个提交不在共享分支；自 base 改动 77 个文件。main 上已有部分产品代码（Plyr 播放器、播客官方源解析、封面自托管、精确词级时间轴、Lucía 主动消息多槽与 safety-gate 重试、每日内容退出码修复、超时 180 分钟、PR #80 词时修复）。
- 共享分支：193 个提交不在 main；自 base 改动 819 个文件。含 main 缺少的 TTS 统一朗读、短语 v3、语料工作台/API、词汇 Tatoeba/朗读、媒体系列目录与播放后推荐、学习页性能/骨架、聊天气泡与 durable reply sources、表达辅助、四板块画像等。
- `git diff origin/main..HEAD`：**830 files changed, 236,099 insertions, 7,399 deletions**（含 Tatoeba 词表等数据资产）。
- 双方都改过的文件：**57 个**（真正的语义冲突面）。
- 两个 workflow 文件在分支上是旧版本（分支相对 main 只有删除），合并时自动保留 main 版本；合并后必须确认 `timeout-minutes: 180`、Lucía checkout pin、每日退出码修复仍在。

## 3. 试合并结果（已 abort，无残留）

方法：`git worktree add --detach ... origin/main` → `git merge --no-commit --no-ff codex/disable-legacy-readlang` → 记录冲突后 `git merge --abort` 并删除 worktree。

结果：**32 个冲突文件**（其余自动合并）：

```
PROJECT_STATUS.md
app/globals.css
contracts/schemas/v1/media-playback-response.schema.json
docs/superpowers/specs/2026-08-28-lucia-relationship-growth-and-proactive-messaging-design.md
package.json
src/modules/content-acquisition/application/content-media-runtime.ts
src/modules/content-acquisition/publishers/runtime-registry.ts
src/modules/conversation/application/generate-proactive-message.ts
src/modules/conversation/domain/proactive-message.ts
src/modules/conversation/ui/voice-composer.tsx
src/modules/media/application/publish-acquired-podcast.ts
src/modules/media/application/publish-acquired-video.ts
src/modules/media/domain/media.ts
src/modules/media/domain/word-timeline.ts
src/modules/media/repositories/drizzle-media-repository.ts
src/modules/media/storage/artwork-storage.ts
src/modules/media/storage/podcast-source-resolver.ts
src/modules/media/storage/resumable-audio-download.ts
src/modules/media/ui/media-library.tsx
src/modules/media/ui/segment-transcript.tsx
src/modules/providers/stt/minimax-transcription.ts
src/modules/providers/stt/transcription.ts
tests/database/media-persistence.test.ts
tests/database/podcast-acquisition-publish.test.ts
tests/database/video-acquisition-publish.test.ts
tests/e2e/learn-page.spec.ts
tests/unit/content-media-runtime-word-timeline.test.ts      (add/add)
tests/unit/learn-page.test.tsx
tests/unit/media-library.test.tsx
tests/unit/media-transcript-words.test.ts                    (add/add)
tests/unit/podcast-source-resolver.test.ts                   (add/add)
tests/unit/proactive-message.test.ts
```

## 4. 冲突分组与解决策略

原则：**禁止整树 `--ours`/`--theirs`**；逐文件判断"哪边是更新实现、哪边是另一套需求"，保留双方能力，测试作为仲裁。上一轮合并（`30961af`）曾因整份取一边而静默丢掉分支功能，随后用 `2c3ece1 fix(merge): restore the branch work the merge silently dropped` 补回；`fdc3f78` 又补回被丢的 `globals.css`。这次必须用"功能存在性检查 + 测试"防复发。

### A. 词级时间轴 / STT（word-timeline、segment-timeline、transcription、minimax-transcription、media-processing、publish-acquired-*、相关测试）
- 背景：main 的 `e743733`/`9e8123f`/`dc85060`/PR #80 与分支的 MEDIA-WORD-003 是同一需求的两次实现。
- 策略：以 main 的 chunk/asset-clock 版本为底，确认分支的 `groupProviderWordsIntoSentences`、fail-closed 词时校验、review 投影去 words 等能力仍存在；三者缺一不可。用 `media-word-timeline`、`media-segment-timeline`、`content-media-runtime-word-timeline`、`minimax-transcription`、`process-media-candidate-word-timeline`、`media-transcript-words` 判定。
- 风险：分支侧可能缺 main 的精确 offset 修复，反之亦然；以测试全绿且 words 覆盖路径不变为准。

### B. 播客源解析 / 下载 / 封面 / 发布（podcast-source-resolver、resumable-audio-download、artwork-storage、publish-acquired-*、media-repository、media-persistence）
- main 侧是完整新功能（官方 RSS 解析、可续传下载、封面复制），分支没有对应实现或只有旧 stream 回退。
- 策略：取 main 版本；确认分支的 stream 路由回退链能 import 这些模块（`2c3ece1` 的教训：分支版 stream route 曾 import 未提交模块）。保留分支的媒体系列/播放器能力。
- 判定：`podcast-source-resolver`、`media-stream-route`、`media-persistence`、`podcast/video-acquisition-publish`、`media-contract`。

### C. 每日媒体管线（content-media-runtime、runtime-registry、run-daily-media-pipeline）
- main 侧有 `d42ff1e` 退出码语义、PR #80 词时透传；分支侧有 MEDIA-WORD-003 的 DTO 透传与校验。
- 策略：合并两者，保留 `dailyMediaRunFails` 的纯函数与 source 失败判定，同时保留分支的词时归一化/哈希顺序修复。判定：`daily-media-failure-policy`、词时相关测试。

### D. Lucía 主动消息（generate-proactive-message、proactive-message、proactive-message.test、spec 文档）
- 双方不是超集关系：main 有 safety-gate 稳定原因码/重试、低压力问题预算、unanswered 抑制；分支有 recent messages/openTopics/本地日期/重复问题门禁（CHAT-PROACTIVE-CONTINUITY-001）与多槽限制。
- 策略：手工合并，两边能力都保留；跑 `proactive-message`、`lucia-proactive-runner`、`proactive-message-persistence`、`character-runtime`；合并后用真实 MiniMax 有界样本复核一次（不写用户数据）。

### E. 聊天/媒体 UI 与样式（voice-composer、media-library、segment-transcript、global css、learn-page e2e/unit）
- 双方都是 UI 修补。策略：逐文件按功能并集；`app/globals.css` 以分支版本为底并确认保留 main 的 Plyr import/播放器可见性规则（fdc3f78 的教训）。
- 判定：`learn-page`、`media-library`、`media-detail-experience`、`segment-transcript`、相关 E2E。

### F. 依赖 / 契约 / 领域（package.json、pnpm-lock、openapi、media schema、media domain、repository）
- 策略：`package.json`/lock 取并集（Plyr + 所有 scripts + 无 `react-h5-audio-player`；分支的 4 空格缩进修复保留），锁文件用 pnpm 重算；`media-playback-response.schema.json` 与 OpenAPI 把 main 的播放字段和分支的 overview/words 字段并集；`media.ts` 手工合并投影与词时规则。
- 判定：contracts + openapi 校验 + `tsc`。

### G. 文档与状态（PROJECT_STATUS.md、Lucía spec、runbooks）
- 按时间顺序拼接两边日志，不删除任何一边的记录；main 侧 OPS-CI-001/002/003 与分支侧任务都要保留。

## 5. 执行步骤（建议在明天调度验证之后）

前置：`OPS-CI-003` 的下一次自然调度已核对（确认 #80/#82 生效）；工作区无未提交改动；main 与共享分支远端均已推送；没有其他会话同时在写 main。

1. 干净 worktree：`git fetch origin`，`git worktree add -b codex/integration-merge-2026-10-21 D:\workspace-worktrees\integration-merge origin/main`。
2. `git merge --no-ff codex/disable-legacy-readlang`，预期 32 冲突，按第 4 节策略逐个解决；每解决一族立即跑对应测试，不等到最后。
3. 全量门禁（合并树）：
   - 全树 `tsc --noEmit`；
   - 冲突簇相关单测/契约/PGlite（约 20 文件，含 A–F 各组的判定测试；单 worker 防 OOM）；
   - 关键 E2E：learn/read/chat/media 桌面+手机各 1–2 条；
   - 生产 `next build`（单 worker，已知 77 页基线）；
   - 限定 ESLint（冲突文件）；`db:check`；workflow YAML 解析。
4. **功能存在性清单**（防静默丢失，逐项 grep/测试）：
   - 分支侧：TTS `read-aloud`（无 speechSynthesis 回退）、短语 v3、语料 examples API/工作台、词汇 Tatoeba/朗读、媒体系列路由、聊天气泡/durable reply sources、表达辅助、学习页骨架、四板块画像、迁移 0041–0047 文件在树内。
   - main 侧：`timeout-minutes: 180`、Lucía checkout pin、每日退出码逻辑、Plyr、播客源解析、封面存储、精确词时、PR #80 词时、Lucía safety-gate 重试。
5. 提交 merge commit，推 `codex/integration-merge-2026-10-21`；开 PR 到 main（标题如 `merge: integrate the reviewed alpha branch into main`），Vercel 预览通过后合并。
6. 合并后：核对 Vercel 部署；真实浏览器冒烟 `/learn`、`/read/vocabulary`、`/read/phrases`、`/read/corpus`、`/chat/lucia`、媒体详情播放；观察下一次每日调度；更新 main 的 `PROJECT_STATUS.md`；单列跟进 Lucía workflow 临时 pin 与 merge 后清理。
7. 回滚：若合并后出现严重回归，用 `git revert -m 1 <merge>` 在 main 上 revert 整个合并（保留分支与历史），禁止 force push、禁止改写历史。

## 6. 已知风险与决策点

- **静默丢功能**：上一轮已发生两次（`2c3ece1`、`fdc3f78`）。对策是第 4 节策略 + 第 5.4 存在性清单 + 冲突簇测试，不依赖人眼。
- **迁移重复应用**：0041–0047 已在真实库按共享树应用；部署流程不跑迁移（待确认 Vercel 构建命令）。合并后不得对生产库重跑 `drizzle-kit migrate`，除非先核对 `__drizzle_migrations` 哈希。
- **一次合入 830 文件、236k 行**：Vercel 构建时间和内存可能上升；先跑本地生产构建，必要时分两次合并（先媒体/聊天 + 基础设施，再阅读/词汇/画像），但会重复冲突解决成本。
- **合并后继续双线开发会再次分叉**：合并完成即冻结共享分支的产品开发，所有新任务从 main 切分支。
- **需要所有者批准**：合并会一次性把全部未验收/已验收切片带上 main 并部署；建议合并前确认接受这个发布范围。

## 7. 下一步

1. 明天核对 `OPS-CI-003` 的自然调度结果（耗时、发布数、词时覆盖）。
2. 得到所有者对"一次性整合发布"的确认后，按第 5 节执行；预计 2–4 小时 + 门禁。
3. 合并完成后另立 `OPS-LUCIA-PIN-001`（移除 Lucía workflow 临时 pin）与 `DEPLOY-SMOKE-001`（部署后真机冒烟）。
