# MEDIA-WORD-003：最近发布播客的词级时间轴缺失与媒体托管收口

- 日期：2026-10-18；状态：review；负责人：本会话（Lead + 3 个执行队友）。
- 授权：所有者报告“最近更新的几条播客没有词级时间轴”，按既有个人 Alpha 内容/媒体修复流程处理；沿用共享分支 `codex/disable-legacy-readlang`，保留工作树其他任务改动。
- Commit：无；本任务未提交、推送或部署。数据库执行了版本化发布、CNN 时长修正与当前版本播放资产切换；旧版本与历史证据保留。
- 证据：`.tmp-word-*` / `.tmp-audio-hosting-report.json` 等未跟踪文件；下文引用关键路径。

## 1. 现象与只读证据

只读直连生产库（2026-10-18）核对 `media_items`/`media_versions`/`media_segments`：

- 已发布媒体 177 条（视频 80、播客 97）。
- 词级时间轴（`media_segments.words` 非空）覆盖：视频 22,260/22,260 段；播客 17,061/17,544 段。
- 缺口恰好 5 条，全部是 2026-10-16～18 由每日内容采集管线自动发布的播客 v1，全部 0 段有 words：
  - `podcast.language-reactor.it_0ddda667ad41`（CNN 5 cosas 25/09/26，32 段，duration 335000ms）
  - `podcast.language-reactor.it_42c888ee9a00`（CNN 5 cosas 10/13/26 6pm，44 段，311000ms）
  - `podcast.language-reactor.it_75c8bab3ce04`（Los últimos de Filipinas，137 段，695000ms）
  - `podcast.language-reactor.it_edcc210cdcc5`（2370. Caso ERE，116 段，701000ms）
  - `podcast.language-reactor.it_58ec1fa91782`（2379. El hombre que tiró un disco duro…，154 段，813000ms）
- 5 条的句子时间戳也是把整段文本按总时长平均分配（例如 CNN 25/09 每段恰好 10,468/10,469ms），并非 provider 真实时间；这些 v1 由管线自动发布、`source_kind='asr'`、无 `media_transcript_backfills` 记录。

## 2. 根因

每日媒体处理使用 `content-media-runtime` 的 `SpeechToMediaTranscriptionProvider`：

1. 它调用 `SpeechToTextProvider.transcribe()`，只读取 `result.text`；
2. 完全丢弃 `result.segments`——而 MiniMax ASR 在 `timestamp_level=word` 时正是通过该字段返回逐词时间戳；
3. 之后用 `splitTranscriptText(text, durationMs)` 把文本按句号切句并把句子时间按 `index * duration / count` 平均分配；
4. 因此候选草稿的 segments 既没有真实句子时间，也没有 `words`，发布后 v1 自然没有词级时间轴。

下游本已支持词级时间轴：`podcastCandidateSegmentSchema.words`、`DraftMediaSegment.words`、`media_segments.words`、`projectMediaPlayback`、`wordTimingsForPlayback` 均为既有能力。缺口在管线适配层。

另外发现 5 条新播客的播放资产仍引用外部 signed/动态广告 URL（`provider_key='language-reactor'`），与库内其余 92 条已托管到自有 Bunny CDN 的播客不一致：libsyn 签名链接已过期 403、blubrry 在本机网络不可达；megaphone 会 302 到动态签名/广告 rendition。这会造成签名过期或播放音频与时间轴漂移，需要一并收口。

## 3. 代码修复（T1，未提交）

### 3.1 领域与管线

- `src/modules/media/domain/word-timeline.ts` 新增 `groupProviderWordsIntoSentences`：只用 provider 词单元（`{startMs,endMs,text}`）生成句子级字幕和精确 UTF-16 词级 offsets（`text` 一律等于 `sourceText` 的精确切片）。句界：句末标点（含收尾引号/括号）、词间 gap > 1000ms、当前句长度 ≥ 240。纯标点单元只并入文本；多词元单元、非整数/倒置/重叠时间、超过候选 duration 的任意单元都 fail-closed（`MediaWordTimelineError` / `MEDIA_WORD_TIMELINE_INVALID`）。
- `src/modules/content-acquisition/application/content-media-runtime.ts`：live MiniMax 构建显式传 `timestampLevel: "word"`；`result.segments` 非空时按上述函数分组并输出带 `words` 的 `RawTranscriptSegment`；为空时保留原 `splitTranscriptText` 文本回退（OpenAI 等纯文本 provider 不回归，但该回退仍不产生 words）。分组失败转为不可重试的 `provider-response-invalid`，不发布估算时间轴。

### 3.2 类型、校验与发布门禁

- `src/modules/media-processing/domain/media-processing.ts`：新增独立小 DTO `MediaTranscriptWordTiming`（不 import media 领域类型），`RawTranscriptSegment`/`MediaTranscriptSegment` 增加可选 `words`；`segmentMediaTranscript` 做整数/单调/段界/offset/切片校验，非法 → `MEDIA_TRANSCRIPTION_FAILED`。
- `src/modules/media/domain/segment-timeline.ts`：`validateSegmentTimeline` 在 `words` 非空时用 `validWordTimings` 严格校验（长度等于 sourceText 词元数、offset 精确、时间在段内）。候选准备、内容审核与发布三处共用，历史无 words 草稿与平台字幕不受影响。

### 3.3 连带修复：contentHash 键序

`processMediaCandidate` 原先直接用 JS 对象计算候选 contentHash；注入 words 后，zod schema parse 会把可选键重排（`words` 到 segment 首键），导致写入候选的 hash 与审核/发布时重算值不一致、候选永远无法通过。修复为写库前先用草稿 schema 归一化再算 hash（播客/视频两条路径都处理）。

### 3.4 评审/修订输入投影

`run-media-review.ts` 与 `revise-media-candidate.ts` 现在把发给 content/teaching/revision 模型的 `draft` 投影为不含 `segment.words` 的副本；`mediaReviewInputHash` 同样基于投影输入。真实草稿与 contentHash 仍覆盖完整词级时间轴，模型请求不会因每段几十个词而膨胀到数百 KB。

### 3.5 测试

新增/修改 6 个测试文件、32 个断言，先红后绿：

- `tests/unit/media-word-sentence-grouping.test.ts`（8）：精确 offsets/时间、标点与句末引号、gap/长度切句、多词元/重叠/非法时间拒绝。
- `tests/unit/content-media-runtime-word-timeline.test.ts`（5）：fake provider 词单元 → 合法句子+words；纯文本回退；超 duration 拒绝。
- `tests/unit/media-transcript-words.test.ts`（6）：media-processing 透传与非法结构拒绝。
- `tests/unit/media-review-input-projection.test.ts`（5）：评审/修订输入与 inputHash 投影 words，真实草稿保持。
- `tests/unit/process-media-candidate-word-timeline.test.ts`（1）：application 路径写出带 words 的候选且 contentHash 自洽。
- `tests/unit/media-segment-timeline.test.ts`（+3）：合法 words 通过、非法 words 拒绝、无 words 历史草稿通过。

Lead 复跑：上述 9 个相关文件 56/56 通过；全树 `tsc --noEmit` 通过；改动 9 个源码 + 5 个测试文件 eslint 0 warning。T1 另外执行了受影响 14 文件 78 项、80 文件 461 项、60 文件 394 项（2 项为脏树既有 PGlite 迁移基线失败，与改动模块无 import 关系）的回归 sweep。

## 4. 数据修复（T2 生成草稿，T3 独立复核并发布）

### 4.1 音频取得

逐条下载 5 条音频并 ffprobe 实测（`.tmp-word-repair-audio/*.bin`，词级时间轴就是基于这些字节生成）：

| stable key | 下载路径 | 字节 | 实测时长 | DB duration_ms | 差 |
|---|---|---|---|---|---|
| it_0ddda667ad41 | 存储 megaphone URL（302→无广告 rendition） | 5,975,829 | 245107ms | 335000 | -89893 |
| it_42c888ee9a00 | 存储 megaphone URL（同上） | 5,409,078 | 221492ms | 311000 | -89508 |
| it_75c8bab3ce04 | 官方 RSS → 新签名 traffic.libsyn.com | 4,679,550 | 694449ms | 695000 | -551 |
| it_edcc210cdcc5 | 发布方 audio proxy（`hoyhablamos.com/.../downloadaudio.php?file=media.blubrry.com/...`） | 8,416,210 | 700475ms | 701000 | -525 |
| it_58ec1fa91782 | 同上（约 70KB/s，完整下载约 465s） | 32,526,421 | 812869ms | 813000 | -131 |

注：直连 `content.blubrry.com`/`media.blubrry.com` 在本机被 DNS 污染不可达；发布方自己的 proxy URL 可正常完整下载（不是绕过平台访问控制，来源仍是已授权 podcast 音频）。CNN 两条的 -90s 来自 LR 元数据与 megaphone 当前 rendition 不一致（v1 的转写里含 CarMax 广告，本机下载为无广告版），因此必须校正 duration。

### 4.2 词级 ASR 草稿

`scripts/backfill-media-word-timings.ts` 逐条重跑 MiniMax `asr-1.0` 词级 ASR + MiniMax-M3 中文翻译，因 v1 平均分配时间无法与真实词对齐，5 条全部走“整条重切句 + 重译”路径。生成 `media_transcript_backfills` 草稿（唯一且 `status='draft'`，未改任何已发布数据）：

| stable key | draft | 段 | 词 | 质检 |
|---|---|---|---|---|
| it_0ddda667ad41 | 036e6af2-a728-4c6b-8ec2-6f414f5e8891 | 32 | 650 | 全 PASS |
| it_42c888ee9a00 | 2bd07637-0084-4576-84b4-19e14214dd32 | 23 | 566 | 全 PASS |
| it_75c8bab3ce04 | cb296215-132a-47e9-86ab-af0855fbb858 | 136 | 1198 | 全 PASS |
| it_edcc210cdcc5 | 4135d73a-197f-4410-8a70-e4730d927cf6 | 111 | 1779 | 全 PASS |
| it_58ec1fa91782 | 6ae795e8-700c-45e1-81cc-6fd7b014ef0f | 145 | 2055 | 全 PASS |

T2 严格校验 0 失败（index 连续、时间整数/单调不重叠/不越最终 duration、翻译非空、words 数=词元数、`validWordTimings`/`hasExactWordLexemes`/切片全通过）；DB 快照不变量确认 v1、资产与已发布 segments 未被改动。

### 4.3 独立复核与译文修正

T3 自写只读校验脚本直读 DB 重算全部 447 段/6,248 词，硬失败 0；CNN 两条 55 段全读、其余 392 段全读+启发式扫描，转写真实连贯、无大面积错词/幻觉/重复/漏译。仅修正 draft 行 `translation`（sourceText/时间/words 字节级不变）共 12 处，包括：

- it_0ddda667ad41 #16 英文→“据美国国家飓风中心”；
- it_42c888ee9a00 #22、it_edcc210cdcc5 #5/#106、it_58ec1fa91782 #6 的 `com.` 碎片/拒答式翻译→“com（网址后缀）。”；
- it_75c8bab3ce04 #32 `el sitio`→“这场围困”、#35/#37 `UU.`→“美国。”、#48 `teniente`→“中尉”；
- it_edcc210cdcc5 #24 `presidente`→“自治区主席”；
- it_58ec1fa91782 #42 挖矿、#120 硬盘等语义修正。

（it_75c8bab3ce04 #6/#133 与 it_58ec1fa91782 #140 的“com。”保留。）

### 4.4 版本化发布与时长修正

标准脚本逐条串行执行，全部 exit 0：

- `publish-media-subtitle-backfill.ts`：5 条均 `{"status":"published"}`，v2 分别 32/23/136/111/145 段、650/566/1198/1779/2055 词；`media_transcript_backfills` 三维度 approved，`content_reviews` es-ES/zh-CN approved，reviewer 均为 `dsh-ai-owner-authorized-review`；旧 v1 保留。
- `correct-media-duration.ts`（两条 CNN）：335000→**245107**、311000→**221492**，发布 v3；`lastEnd` 231100/208840 ≤ 新时长；v3 segments/words 与 v2 字节一致。

发布后只读验证（每条 16 项 check 全 true）：当前版本 words 覆盖 32/32、23/23、136/136、111/111、145/145；`wordTimingsForPlayback` 每段非空；旧版本 versionId/content_hash/duration/段数/有词段数逐项保留；库级已发布播客无词数从 5 降到 0、视频仍 0；以快照为界仅 5 个 item 更新、新增版本恰 7、新增 segments 恰 502。

## 5. 播放资产托管（T4）

5 条新播客的 v2/v3 从 v1 复制了外部播放资产，无法保证长期可播与时间轴一致。按既有托管模式（`MEDIA-HOSTING-DURATION-002` / `scripts/migrate-podcasts-to-bunny.ts`），把 T2 已下载并用于生成词级时间轴的精确音频上传自有 Bunny Storage，并把当前版本 audio asset 切到自有 CDN（事务 + CAS，仅改当前版本 asset 行，旧版本资产与媒体内容不变）：

当前版本 audio asset 已全部切换（5/5，上传总量 56,977,088B）：

| stable key / 版本 | 旧 host | CDN 对象 | 字节 | CDN 解码时长 vs duration |
|---|---|---|---|---|
| it_0ddda667ad41 v3 | dcs-cached.megaphone.fm（签名） | `media/…/3/audio-138ff556….mp3` | 5,975,829 | 245107 vs 245107 |
| it_42c888ee9a00 v3 | dcs-spotify.megaphone.fm（签名） | `media/…/3/audio-746418e2….mp3` | 5,409,078 | 221492 vs 221492 |
| it_75c8bab3ce04 v2 | content.libsyn.com（已 403） | `media/…/2/audio-59882d79….mp3` | 4,679,550 | 694449 vs 695000（-551ms） |
| it_edcc210cdcc5 v2 | content.blubrry.com（不可达） | `media/…/2/audio-5991e3f8….mp3` | 8,416,210 | 700475 vs 701000（-525ms） |
| it_58ec1fa91782 v2 | content.blubrry.com（不可达） | `media/…/2/audio-fa4976d8….mp3` | 32,526,421 | 812869 vs 813000（-131ms） |

每条均通过：完整 GET 200 + `audio/mpeg` + content-length 与字节数一致 + sha256 逐字节等于本地；Range 0-1023 与中段 Range 均 206 且切片一致；完整内容 ffprobe 时长与版本 duration 差 ≤1.5s（独立第二轮复验全部通过）。写入用事务 + CAS（asset id + version id + 旧 URL + current/published/cleared/duration 不变），5/5 返回 1 行；回读 provider=`bunny-storage`、https、无签名参数、`playback_expires_at=NULL`、`mime_type=audio/mpeg`。以切换前快照为界仅 5 行 `media_assets` 更新，媒体/版本/字幕/审核/backfill 均 0 行变化；旧版本资产保留原外部 URL（不可变设计）。库级播客当前版本音频资产：**bunny-storage 97 / 其他 0**（切换前 92+5）。应用播放路由允许 `sueno-media.b-cdn.net`，新 URL 无签名参数，不会触发旧 language-reactor 刷新分支。

Lead 独立复查：5 个新 URL 的 Range 0-1023 与中段 Range 均 206 `audio/mpeg`；库级 provider 统计 97/97 bunny-storage。

## 6. 最终验证

Lead 独立复跑（发布后、T4 前）：

- 5 条当前版本逐段验证：segments 32/23/136/111/145，withWords 与 validWords、exactWords、playback 均 100%，missingTranslation 0；CNN current_version=3（duration 245107/221492），其余 current_version=2（695000/701000/813000）。
- 库级：视频 80 条 22,260 段全有 words；播客 97 条 17,508 段全有 words，无词条 0。
- 当前版本审核：5 条 x es-ES/zh-CN 均 approved、`dsh-ai-owner-authorized-review`。
- 应用播放 DTO 实测（`createDrizzleMediaRepository().getPlayback`，虚拟用户只读进度）：5 条当前版本分别为 v3/v3/v2/v2/v2，duration 245107/221492/695000/701000/813000；asset 均为 `sueno-media.b-cdn.net`、无签名 query；segments 32/23/136/111/145 且 segmentsWithWords 与之一致（100%），首词时间/词面正常（如 CNN `Bienvenidos 4340–4840ms`）。
- 代码侧：T1 相关 9 文件 56/56 通过；全树 typecheck 通过；改动文件 eslint 0 warning。

## 7. 已知限制与风险

- 未真实听音、未做人工母语/教学签字；审核为明确 AI 身份 `dsh-ai-owner-authorized-review`，不能当作真人复核。
- ASR 文本仍有少量残余（如 it_75c8bab3ce04 的 Baler 被识别为 Valer 约 5–6 段；it_58ec1fa91782 个别谚语/引语欠精确；it_0ddda667ad41 部分新闻句被并入同段）。不阻塞词级时间轴，但教学使用前可另开任务人工校对。
- 严格单词语元策略：provider 若返回含缩写点/连字符的多词元单元（如 `EE.UU.`、`político-social`），整条候选会 fail-closed 失败而非猜时间轴；上线后需观察 daily pipeline 失败码，必要时另开任务实现多 token 单元拆分策略。
- 长音频（>500s）MiniMax 分段偏移沿用既有 `offset = chunkIndex × 450s` 逻辑，未用真实 provider 复验跨 chunk 边界；本次 5 条回填脚本路径不受影响，但每日管线长播客仍需实测。
- 每日管线代码尚未提交/合并到默认分支，GitHub Actions 的定时任务在下一次合并前仍会按旧逻辑发布无词级时间轴内容。
- megaphone/blubrry 等外部 rendition 仍可能随时间变化；T4 托管后播放与时间轴固定，但每日管线未来新发布的播客需要同样的托管收口（见下一步）。

## 8. 修改文件

代码（未提交）：

- `src/modules/media/domain/word-timeline.ts`、`segment-timeline.ts`
- `src/modules/media-processing/domain/media-processing.ts`
- `src/modules/content-acquisition/application/content-media-runtime.ts`、`process-media-candidate.ts`、`run-media-review.ts`、`revise-media-candidate.ts`
- `src/modules/content-acquisition/providers/media-review.ts`、`media-revision.ts`
- `tests/unit/{media-word-sentence-grouping,content-media-runtime-word-timeline,media-transcript-words,media-review-input-projection,process-media-candidate-word-timeline}.test.ts`（新增）+ `media-segment-timeline.test.ts`（扩展）

文档：本交接、`PROJECT_STATUS.md`、自动内容供应实施计划 9.10、`docs/operations/content-acquisition-runbook.md`、`docs/architecture.md`、`docs/testing-strategy.md`。

数据（真实库写入）：

- 5 条播客：v2 词级版本、CNN 两条 v3 时长修正、`media_transcript_backfills` 5 行（published）、draft 译文修正 12 处、当前版本 audio asset 切换自有 CDN（T4）。

## 9. 用户验证与下一步

用户验证：

1. 刷新学习页并打开标题为 `CNN 5 cosas 25/09/26`、`CNN 5 cosas 10/13/26 6pm`、`Los últimos de Filipinas`、`2370. Caso ERE`、`2379. El hombre que tiró…` 的 5 条播客（或已打开页面刷新）。
2. 播放时应看到当前句/当前词的自动选框（词级高亮）；拖动进度条、点击字幕词应能定位到对应时间；CNN 两条进度总长应为 4:05/3:41（不再是 5:35/5:11）。
3. 字幕为真实 ASR 重新切句版本（段数与旧版不同），中文翻译已按发布版本修正；如发现具体错词/翻译问题，记录条目与时间点后另立修复。

下一步建议：

1. **提交并合并本任务代码到默认分支**，让每日定时管线使用词级时间戳修复（本会话按仓库近例未提交）。
2. 新任务：每日媒体管线在发布播客时把处理用的精确音频托管到自有 Bunny CDN，并用解码/实测时长为准（避免 signed/动态广告 URL 与 duration 元数据漂移）；补每日管线词级时间轴/托管失败码观测。
3. 视需要在托管完成后对 5 条做 iPhone Safari 真实播放与词级选框验收。
