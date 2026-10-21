# MEDIA-WORD-004：2026-10-19 自动发布播客缺词级时间轴（再次发生）与管线修复收口

- 日期：2026-10-20；状态：review；负责人：本会话（Lead + 2 个独立复核子代理）。
- 授权：所有者报告“今天自动化更新了两条内容，没有词级时间轴”，按既有个人 Alpha 内容/媒体修复流程处理；沿用共享分支 `codex/disable-legacy-readlang`，保留工作树其他任务改动。
- Commit：数据修复无产品代码 commit；管线修复已推送 focused 分支并开 PR（见 §4）。
- 证据：`.tmp-word-*` / `.tmp-audio-hosting-report-1019.json` 等未跟踪文件。

## 1. 现象与只读证据

2026-10-19（北京时间 17:00/17:15）每日内容采集管线自动发布两条 Language Reactor 播客（当前版本 v1），词级时间轴覆盖为 0：

| stable key | 标题 | 段数 | 当前版本 words | 说明 |
|---|---|---|---|---|
| `podcast.language-reactor.it_f0e5e67c46b5` | Relatos Macabros de Turnos Nocturnos - Octubre de Relatos vol. 3 | 366 | 0/366 | 句子时间按 2,140,000ms 平均分配 |
| `podcast.language-reactor.it_e2b98ddbeb64` | Los Bowery Boys: Pandilleros Boxeadores (Smollop) - E388 | 336 | 0/336 | 句子时间按 1,306,000ms 平均分配 |

两条均为 `source_kind='asr'`、由每日管线 auto-publish、无 `media_transcript_backfills` 记录。

## 2. 根因

与 `MEDIA-WORD-003` 相同：`content-media-runtime` 的 `SpeechToMediaTranscriptionProvider` 只读取 `result.text`、丢弃 `result.segments`，并且没有对 MiniMax ASR 显式请求 `timestamp_level=word`，于是按总时长平均分配句子时间。`MEDIA-WORD-003` 的实现与验证已完成，但**从未提交/合并到默认分支**；GitHub Actions 定时任务（run [39225780831](https://github.com/laurenzhong/Spanish/actions/runs/39225780831)，`main@68e2b0f`）按 main 旧逻辑运行，因此再次发布无词级时间轴内容。

## 3. 数据修复

### 3.1 词级 ASR + 翻译草稿

使用既有 `scripts/backfill-media-word-timings.ts`（MiniMax `asr-1.0` 词级 ASR + MiniMax-M3 中文翻译），从两条播客的授权音频重新生成 `media_transcript_backfills` 草稿（draft only）：

| stable key | draft | 段 | 词 | 实测音频时长 |
|---|---|---|---|---|
| it_f0e5e67c46b5 | `f6972d26-5771-40a1-91ca-aeaf27f41487` | 369 | 4,961 | 2,140,735ms（DB 2,140,000） |
| it_e2b98ddbeb64 | `61eefbd4-e73e-437f-9fcf-c17cf524d7c0` | 363 | 3,954 | 1,306,149ms（DB 1,306,000） |

### 3.2 二十分钟级窗口的词时质量检查

普通结构校验（index/时间/words/offset/切片/译文）通过后，额外做 10 秒滑窗 wpm 与词时长检查，发现第一份草稿有 3 处 provider 局部异常（10s 窗 360–408 wpm、词时长中位数 100ms，远高于正常叙述）——这些窗口同时伴随与相邻上下文不连贯的句子，判断为长音频（450s 分块）转写在该区域的词时压缩/幻觉：

- 847.6–860.1s（原 v1 索引 140–145）
- 890.5–902.6s（原索引 151–156）
- 1793.8–1802.2s（原索引 303–308）

处理：对这三个窗口分别用 15–20s 短窗重新做词级转写（短窗 ASR 词时正常并与相邻音频一致），用 `groupProviderWordsIntoSentences` 生成精确 offset 的句子，删除原 18 段并替换为 6 段（357 段、4,820 词）；同时修正 2 处 `¿ ` 反引号间距（偏移精确重映射）。第二份草稿无同类持续异常，仅保留少量正常快语速短句。

### 3.3 独立翻译复核

两个独立子代理分别全量审阅两份草稿的中文译文（不修改西语文本）：

| stable key | 审阅段数 | 修正翻译 | source concerns |
|---|---|---|---|
| it_f0e5e67c46b5 | 369 | 27 处（另 2 处落在被替换窗口内，随替换丢弃） | 7 处（含被替换窗口） |
| it_e2b98ddbeb64 | 363 | 55 处（含 5 处无中文/未翻译） | 12 处（ASR 词沙拉/不可恢复处，未臆造） |

第一份替换窗口内的 6 段新译文由 Lead 按西语语义人工复核后写入。修正范围包括：主宾/代词/性别漂移、墨西哥俚语（güey/chingazos/pistear/Simón/mami 等）、译者元注释、人名统一（博尔斯特/鲍威里/朱厄尔/铁匠雷迪）与英文残留。

### 3.4 校验与版本化发布

- 发布前逐段校验：357/363 段 index 连续、时间整数且单调不重叠、`words` 数=词元数、`validWordTimings`/`hasExactWordLexemes`/`wordTimingsForPlayback` 全通过、译文均为中文；发布前快照不变量（旧 v1、资产、已发布 segments 不变）全 true。
- `scripts/publish-media-subtitle-backfill.ts` 串行发布，均返回 `{"status":"published"}`：v2 分别为 **357 段 / 4,820 词**、**363 段 / 3,954 词**；`media_transcript_backfills` 三维度 approved，`content_reviews` es-ES/zh-CN approved，reviewer `dsh-ai-owner-authorized-review`；旧 v1 保留。
- 发布后只读验证（每条 9 项 check 全 true）：当前版本 words 覆盖 357/357、363/363；每段 `wordTimingsForPlayback` 非空；`lastEnd` 2,119,300 ≤ 2,140,000、1,289,200 ≤ 1,306,000；库级“已发布播客无词级时间轴”由 2 降到 **0**。

### 3.5 播放资产托管

两条 v2 从 v1 复制了外部 Language Reactor/simplecast URL（带签名 query）。按既有托管模式，把 T 步骤中实际用于生成词级时间轴的精确音频上传自有 Bunny Storage，并把当前版本 audio asset 切换为自有 CDN（事务 + CAS，只改当前版本 asset 行；旧版本资产保留）：

| stable key / 版本 | 音频字节 | 本地 sha256（前 12） | CDN 对象 |
|---|---|---|---|
| it_f0e5e67c46b5 v2 | 34,311,488 | `6348d31bd349f9d6378c1b92bf4bc00c225d3794baba19702fe7722846b0304e` | `media/podcast.language-reactor.it_f0e5e67c46b5/2/audio-6348d31b….mp3` |
| it_e2b98ddbeb64 v2 | 20,946,183 | `928a5830702e49736f2c487bb04da10fa2d9ce7962b0d36946c3c180596837f8` | `media/podcast.language-reactor.it_e2b98ddbeb64/2/audio-928a5830….mp3` |

每条通过：完整 GET 200 + `audio/mpeg` + content-length/字节数一致 + sha256 逐字节相等；Range 0–1023 与中段 Range 206 且切片相等；ffprobe 解码时长与版本 duration 差 ≤1.5s（2,140,735 vs 2,140,000；1,306,149 vs 1,306,000）；切换后回读 `provider_key='bunny-storage'`、无签名 query、`playback_expires_at=NULL`、`mime_type='audio/mpeg'`。托管后库级播客当前版本音频资产 = **99/99 bunny-storage**、0 带签名 query（详见 `.tmp-audio-hosting-report-1019.json`）。

托管脚本报告里的 `globalChecks` 中 `allFiveSwitched`/`bunnyStoragePodcasts97`/`onlyFiveAssetsUpdated` 为复用 5 条旧任务模板的硬编码期望，故其 `pass` 为 false；本任务另写独立复验 `.tmp-word-1019-hosting-verify.ts`（重新下载两个 CDN 对象、逐字节 hash、双 Range、ffprobe、DB 回读）得到：两条逐项全 true、库级 99/99 bunny、无词播客 0、快照后仅 2 行 asset 更新 → **pass=true**，证据 `.tmp-word-1019-hosting-verify.json`。

## 4. 管线修复（防止再次发生）

从 `origin/main@f89868e` 的新 worktree 构建**仅含 MEDIA-WORD-003 修复**的 focused 分支，剔除共享工作树中的无关在途改动（授权错误码、`timeoutMs`/`revalidate`/`processingAudience`、CEFR 枚举扩展等）：

- 分支：`codex/media-word-timeline-pipeline`
- commit：`380ee02c17f17daafc8931172ccb7c1091e58cf9`（15 文件，+1293/−20）
- 适配：main 的 MiniMax adapter 已用 `word-segments.ts` 把词单元分组成句子并带逐词 offset；runtime 在该路径直接复用已分组时间轴，原始词单元 provider 才走 `groupProviderWordsIntoSentences`，仍然 fail-closed。
- 验证（worktree from main）：`tsc --noEmit` 干净；聚焦 6 文件 **33/33**；相邻 13 文件回归 **50/50**。
- 已推送并开 PR #80：<https://github.com/laurenzhong/Spanish/pull/80>；Vercel 预览构建通过。**合并后下一次定时任务才会使用词级时间轴修复。**

## 5. 最终验证

- 发布后只读检查：`.tmp-word-1019-verify.ts` 对两条当前版本逐段重算 words/offset/playback/译文与 9 项 check，全部 true；库级无词播客 0；审核 2/2。
- 应用播放 DTO：`.tmp-word-1019-dto-verify.ts` 用真实 repository `getPlayback` 校验（虚拟用户只用只读进度）：两条均 `media.version=2`、357/363 段且每段 words 非空、`wordTimingsForPlayback` 每段非空、`asset.url` 为 `sueno-media.b-cdn.net` 且无 query；首词分别为 `Desde 4340–4660ms`、`Estás 920–1200ms`。
- CDN 托管独立复验：`.tmp-word-1019-hosting-verify.ts` 重新下载、hash、双 Range、ffprobe、DB 回读全通过；库级 99/99 bunny、0 无词播客、快照后恰好 2 行 asset 更新。
- 数据侧：发布前后快照对比仅新增 2 个版本 + 2×segments，旧 v1、历史审核与证据不变（详细计数见 `.tmp-word-repair-1019-summary.json`、`.tmp-word-1019-item1-spliced.json`、`.tmp-word-1019-item2-reviewed.json`）。
- 管线侧：上述 tsc + 33/33 + 50/50 + PR #80 Vercel 预览构建通过（`gh pr checks 80` 全 pass）。
- 未执行：真实听音、人工母语/教学签字、iPhone Safari 真机播放验收、全量 Vitest/E2E/全仓 lint；未合并 PR #80（待所有者确认）。

## 6. 已知限制与风险

- ASR 文本仍有个别错词/词沙拉（第一份 7 处、第二份 12 处 source concerns 已记录在 `.tmp-word-review-fixes-*.json`），不阻塞词级时间轴，但教学使用前可另立人工校对。
- 长音频（450s 分块）provider 词时偶发局部压缩/幻觉；本任务通过 10s 窗 wpm 检查发现并用短窗替换修复。合并后的每日管线仍可能遇到同类 provider 异常，建议后续在发布门禁加入词时质量检查（如持续 wpm/词时长阈值）或在 450s 分块失败时降级到更短分块。
- `main` 既有 `groupWordSegments` 对独立倒问号/叹号单元会产生 `¿ qué` 间距；本 PR 沿用该路径，既有库内视频字幕本就有此历史现象，建议另立任务统一。
- 未做 iPhone Safari 真实播放与词级选框验收；未真实听音核对 ASR 文本。
- 未修改任何产品代码/迁移/评分；共享工作树其他任务改动保留。

## 7. 修改文件

- 数据（真实库写入）：两条播客 v2 词级版本、`media_transcript_backfills` 2 行（published）、draft 译文修正 27+55 处与 6 段替换、当前版本 audio asset 切换自有 CDN。
- 仓库文件：`PROJECT_STATUS.md` 本页条目、本交接（均未提交，保留共享树其他改动）；本地 `.tmp-word-*`、`.tmp-audio-hosting-*` 证据文件（未跟踪）。
- 管线分支（已推送，未合并）：15 个代码/测试文件见 §4 与 PR #80。

## 8. 用户验证与下一步

1. 刷新学习页，打开 `Relatos Macabros de Turnos Nocturnos - Octubre de Relatos vol. 3` 与 `Los Bowery Boys: Pandilleros Boxeadores (Smollop) - E388`：播放时应看到当前句/当前词自动选框，拖动进度条与点击字幕词可定位；进度总长应分别为 35:40 / 21:46。
2. 若发现具体错词/译文问题，记录条目标题与时间点另立校对任务。
3. 下一步建议：合并 PR #80，并在下一次定时运行后只读核查新发布内容的 `words` 覆盖率；合并后可另立任务给发布门禁加词时质量阈值。
