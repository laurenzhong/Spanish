# CONTENT-PREP-001：朋友聚会候选审核材料取得

- 日期：2026-10-16；授权：用户“继续下一步”，随后明确指定“minimax转写”，承接CONTENT-FIT-002。
- 状态：审核材料准备完成；MiniMax西语ASR草稿已生成，尚未校对、翻译或正式审核。
- 候选：`9c1dc657-0ae4-487a-8c32-907f4b44275b`，revision `5`，hash `3acdf76ca097f171d39ea3783cbf55280472449bc15fe58068b6ecc6463d77fa`。
- 来源：[Reunión de Amigos | enchufetv](https://www.youtube.com/watch?v=WYkgAPfoCZ8)。
- 分支：`codex/disable-legacy-readlang`；Commit：无，未提交、推送或部署。

## 结果

**已用现有 MiniMax `asr-1.0` 适配器完成一次真实转写，得到42段带时间戳的西语字幕草稿。** 使用本机已存在、正在监听的loopback代理进行单次请求路由后，正常取得目标视频元数据和音频；没有修改Windows系统代理、使用cookies或绕过平台访问限制。

| 转写证据 | 结果 |
| --- | --- |
| 来源身份 | YouTube ID `WYkgAPfoCZ8`、标题一致，public，平台时长237秒 |
| 当前版本只读核验 | 北京时间11:09:42，revision5/hash一致，`transaction_read_only=on` |
| 实际音频 | ffprobe时长237,101ms；规范化MP3 1,423,268字节，低于25MiB |
| 音频SHA-256 | `386f7add07025c928a4234ae6f43b24d6f0acecc9280153fba6d887bacedae65` |
| Provider / 模型 | `minimax` / `asr-1.0`，请求1次，无自动重试，无翻译请求 |
| 请求ID / 延迟 | `0720c89f9e9a40e0b30e117fad340a09` / 16,266ms |
| 时间轴 | 42段，索引0–41；00:08.540–03:54.880；合法、非空、无重叠、未越过音频时长 |
| 时间依据 | 直接保留provider返回的片段时间，未按句数均分或猜补 |
| 置信度 / 成本 | provider未提供，均为null；不冒称高置信度或零费用，实际费用以MiniMax账单为准 |
| 完成时间 / 清理 | 北京时间11:10:36，临时下载音频及规范化音频均已删除 |

草稿JSON SHA-256为 `32679400358df834b29f4239758fcb89635158f7b665f148e99eb3bb078f0708`。仓库外会话目录 `C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/` 内交付：

- `friends-minimax-draft.srt`：42段可查看的西语字幕。
- `friends-minimax-draft.json`：原始ASR文本、真实片段时间、候选revision/hash与provider来源，明确 `unreviewed-asr-draft`，译文为null。
- `friends-minimax-attempt.json`：脱敏调用、音频hash、清理及未写库证据；重复运行脚本会复用已有结果，已有provider尝试时禁止自动重试。

没有把草稿写回候选或正式审核表，候选仍保持原状态，选材仍3席待适用性复核/9席未填补。时间结构检查不代表逐字准确、全片语音覆盖或教学适用性通过。文本仍有跨段标点、长段多说话人及疑似误识别，需结合原片校对；本轮未凭ASR结果直接批准、拒绝或重新评级。

## 首次直连失败的历史

最初两次原字幕请求在元数据阶段失败，没有取得字幕清单。当时DNS解析成功，独立HTTPS请求返回连接重置 `ECONNRESET`；Windows系统代理未启用，进程也没有HTTP/HTTPS/ALL_PROXY环境配置。后续确认先前系统配置指向的本地代理端口实际正在监听，显式用于本次请求后恢复访问。系统全局配置始终未改变。

恢复后的元数据显示存在西语人工字幕和自动字幕；本轮遵循用户明确选择，使用MiniMax生成独立ASR草稿，没有下载或混合平台字幕。此前 `friends-preparation-evidence.json` 保留为首次失败证据，不代表当前仍阻塞。

## 已确认的处理前提

2026-10-16 **10:53:54北京时间**只读查询（UTC `2026-10-16T02:53:54.351Z`）再次确认相同revision/hash，`transaction_read_only=on`。

| 项目 | 结果与边界 |
| --- | --- |
| 来源身份 | 已登记 `language-reactor` / `video-channel`，不是新增来源 |
| 来源授权声明 | 保存了2026-09-15所有者提供的声明，称平台及所含作者授权个人Alpha完整使用；本轮核对该声明，没有重新取得第三方授权文件 |
| 授权证据URL | 仍指向LR播客目录；该URL本身不能证明具体视频授权，不能静默改写为视频证明 |
| 临时处理 | 策略明确 `temporaryMediaProcessing=yt-dlp`，上限26,214,400字节（25MiB） |
| 语言 / 时长 | 已存 `es` / 237秒，在本批3–8分钟选材范围内；实际语言、相关性和适用性仍待内容材料核验 |
| 处理资产 / 费用估值 | 未登记processingAssetUrl、processingAssetBytes和estimatedAsrCostMicros；缺失费用值不当作已知零成本 |
| 本机工具 | Python模块 `yt-dlp 2026.08.19` 可用；ffmpeg/ffprobe可用。yt-dlp不在PATH，可用 `py -m yt_dlp`，没有安装新依赖 |
| Provider配置 | 原预检媒体runtime的mode/STT/translation及预算环境值未显式配置；本轮按用户选择直接使用现有MiniMax provider适配器，仅脚本进程生效，没有改环境文件或全局配置 |

本轮费用控制按用户指定的单条3分57秒素材、最多一次MiniMax请求执行，下载和请求前校验25MiB及240秒上限；不额外请求翻译、不自动重试。未将缺失费用值写成0，也未宣称供应商返回了可执行的金额上限。ASR结果仍是草稿，独立西语与中文教学审核后才能另行考虑发布。

## 实际请求与验证

- 仓库外脚本 `prepare-friends-subtitles.mjs` 使用现有 `py -m yt_dlp`，只请求目标元数据和已有西语字幕，关闭媒体下载、播放列表、自动重试和配置文件加载；有55秒进程上限及响应大小边界。
- 第一次元数据请求未成功；第二次加入脱敏诊断，并允许在无媒体格式时仍读取元数据，仍返回 `YOUTUBE_CONNECTION_FAILED`、进程exit1。没有更换客户端、启用cookies、token或尝试绕过平台访问限制。
- 独立Node HTTPS探测确认 `ECONNRESET`，没有保存网页或音视频；没有取到字幕清单，因而未执行字幕下载、ASR、翻译或审核。
- 最小取得证据保存在仓库外会话目录 `C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/friends-preparation-evidence.json`。仅含候选ID、版本、时间、工具身份、失败码和处理标志，不保存cookies、密钥、完整媒体URL或原始stderr。
- 上述三条请求和失败证据均描述首次直连阶段。后续使用 `transcribe-friends-minimax.mjs`，只在只读版本/授权核对、目标身份、大小、时长校验通过后调用现有MiniMax适配器；provider超时180秒，原音获取90秒，无自动重试。原音仅在独立临时目录处理，finally验证目录边界后删除，未保留音频。
- 两个仓库外脚本Node语法检查、草稿hash、42段索引/真实时间/非空/无重叠/不越界、SRT与JSON逐段一致性、调用次数和清理标志、任务文档链接及限定diff检查通过。现有 `tests/unit/minimax-transcription.test.ts` 聚焦 **7/7** 通过，使用fake响应，未重复计费。pnpm未在PATH，改用本地Vitest Node入口运行。
- 修改文件仅本报告、`PROJECT_STATUS.md`及原实施计划本任务章节。没有产品代码/Schema变更，未运行全量lint/typecheck/Vitest/E2E/build，也未做播放器、原音听审或iPhone Safari验证。
- 未写数据库、候选状态、审核、已发布内容、来源策略或自动化；本轮明确发生1次真实MiniMax转写请求，临时音频已清理。共享树其他任务改动保留。

## 恢复与用户验证

用户可打开上述SRT或JSON查看结果，并按原视频时间对照；索引从0开始，SRT编号从1开始。原素材前8.54秒和末尾空隙未听审，不凭时间范围断言缺句或无语音。

下一建议任务：基于本次42段ASR草稿做逐句校对、中文教学翻译及独立双维审核；不得因为MiniMax请求成功或存在SRT就直接发布。原材料取得阻塞已解除，此报告不批准或拒绝该内容。
