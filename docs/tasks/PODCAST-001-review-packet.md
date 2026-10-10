# PODCAST-001 复核包（播客 RSS 纵向闭环）

状态：`review`（实现在当前分支历史中，等待产品本人复核与合并动作）
分支：`codex/podcast-001-rss-learning`，远端 `origin/codex/podcast-001-rss-learning`
复核包整理时间：2026-10-10

## 1. 关键事实（先看这条）

`git merge-base --is-ancestor origin/codex/podcast-001-rss-learning HEAD` 返回 0，
即**该分支的 tip 已经包含在当前分支（`codex/disable-legacy-readlang`）的历史里**；
`git diff <merge-base>..origin/codex/podcast-001-rss-learning` 为空。

因此本项**不需要再生成新的实现或复核代码**，剩下的动作只有两个：

1. 产品本人确认功能行为与边界（下方第 4 节）；
2. 合并者把状态页的 `review` 改为 `done`，并解锁 `MEDIA-002`。

## 2. 交付内容

| Commit | 说明 |
|---|---|
| `3943019` | `docs: start podcast-001`（任务启动记录） |
| `0e047ec` | `feat: add reviewed podcast learning`（实现） |
| `1553dfc` | `docs: hand off podcast-001 for review`（交接） |

规模：`54 files changed, 13601 insertions(+), 45 deletions(-)`（相对 `3943019^`）。

按区域分组（改动文件数）：

- 采集与候选：`src/modules/content-acquisition/adapters/{podcast,rss}`、`normalizers/podcast-candidate.ts`、`application/prepare-podcast-candidate-for-review.ts`、`publishers/acquired-podcast-publisher.ts`
- 媒体与发布：`src/modules/media/application/publish-acquired-podcast.ts`、`repositories/acquired-podcast-repository.ts`
- 学习端：播客音频播放器与其学习工作台接入、`app/(product)/learn/media/[stableKey]`
- 契约与夹具：`contracts/`、`tests/fixtures/content-acquisition/podcast/*.xml`、`tests/fixtures/media/audio/podcast-sample.mp3`
- 测试：`tests/e2e/podcast-learning.spec.ts`、`tests/unit/podcast-*.test.ts(x)`、`tests/unit/content-acquisition-cli.test.ts`

## 3. 记录中的验证结果

以下为交接时记录的结果（来自提交与状态页，本次整理**未重跑**，因为代码已在分支历史中且共享工作树正被其他会话使用）：

- 播客发现、音频播放、转写片段与恢复路径的聚焦单测与 Playwright 用例随实现一并提交。
- 采集侧仍为白名单来源 + 权利校验 + 结构化错误码；媒体公开投影要求当前版本已发布、版权清晰、资产可用且播放信息未过期。

**未执行（本次整理）**：全量 Vitest、`pnpm build`、真实来源抓取、真实收费 provider、iPhone Safari/PWA 真机。若需要重跑，建议在干净的检出上执行 `pnpm test --run` 与 `pnpm test:e2e`，避免与本机多会话共享工作树相互干扰。

## 4. 复核时应确认的产品行为

- [ ] 播客详情页：音频可播放、可暂停、可跳转，字幕/转写片段与播放位置同步。
- [ ] 无字幕的授权播客在门禁通过前不会生成发布版本；失败时不伪造内容。
- [ ] 付费墙 / DRM / 平台下载限制未被绕过；来源与许可信息可见。
- [ ] 播客与视频共用同一学习工作台，不出现两套播放语义。
- [ ] 发布仍受三维审核与 `CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH` 约束。

## 5. 复核结论（待填）

- 结论：`approve` / `revise` / `reject`
- 复核人：
- 日期：
- 备注：

## 6. 解锁关系

本项转为 `done` 后，`MEDIA-002`（ASR、翻译、成本与媒体可靠性）才解除阻塞；`LEX-001`、`LEX-002`、`PROFILE-001`、`OPS-001` 依次在其后。
