# MEDIA-RIGHTS-001：字幕翻译与ASR处理前权利重验

2026-10-16 · review · 共享分支 `codex/disable-legacy-readlang` · Commit：无，未提交、推送或部署。

承接[CONTENT-RIGHTS-001](CONTENT-RIGHTS-001.md)首项建议，用户已确认。本任务只补处理门禁，不实现精确视频ID发现，不启用来源、不写真实配置、不运行实际转写、翻译、下载或发布。历史审计保持原样；本批仍为2条待复核、10个未填补。

## 完成的行为

已有字幕和无字幕路径共用授权、取消及截止检查。来源必须仍启用且verified；候选自身也必须verified，不能被来源状态覆盖。通用候选流程固定要求 `shared-learning`，不接受私人非分享译稿许可。

每次取得音频、ASR、缺译文的逐段翻译前后，以及返回前、删除临时资产后，重验当前来源和候选。候选sourceId、revision、generation或处理状态变化后停止；来源revision变化同样停止，避免观察到新配置后仍按旧artifact store的主机/下载策略处理。失败状态保留既有CAS保护，不写入新generation。

预检实际会执行的整条操作链，缺翻译权时不会先付费做ASR。只补字幕译文不要求音频/ASR许可；无翻译provider的ASR不要求翻译许可；完整已有时间轴不凭空要求新的处理权。普通翻译技术失败仍保留西语原文；撤权、到期、取消或超时不能被降成部分翻译成功。取得资产后先保存资源引用，再检查状态，保证失败仍进入删除；清理失败继续使用既有清理错误和重试记录。

## 授权字段与兼容

`rightsPolicy.mediaProcessing`是来源策略中的可选严格对象，字段为：

| 字段 | 约束 |
| --- | --- |
| version | 固定1 |
| allowedOperations | 非空、不重复的acquire-audio / asr / translate子集 |
| audience | owner-private或shared-learning |
| thirdPartyProcessing | 必填布尔值；ASR/翻译必须为true |
| evidenceUrl | 无用户名/密码的HTTPS证据URL |
| expiresAt | 必填UTC ISO时间或null；到期瞬间即拒绝，null为无约定到期 |

这些字段是实际使用判断的记录，不自动证明链接已覆盖某用途，也不要求所有合法私人翻译都另求作者授权。verified、许可标签、authorization文字和temporaryMediaProcessing均不自动产生新处理许可。三个strict来源schema接受此可选对象；旧策略仍可读取和发现，缺字段时暂停新增翻译/ASR，不回填真实授权。播放、发布审核和历史内容版本保持既有语义；本字段不授予发布、索引或绕过平台取得限制的权利。

新增内部错误码 `MEDIA_PROCESSING_NOT_AUTHORIZED`；没有新增HTTP接口、数据库列或迁移。纯领域判定不依赖Zod、框架或供应商；Zod位于schemas边界。

## 修改文件

相对仓库根目录：

- `src/modules/media-processing/application/process-media-transcript.ts`：共用处理生命周期、整链预检、逐段复验。
- `src/modules/media-processing/domain/processing-authorization.ts`、`domain/index.ts`、`domain/media-processing.ts`：纯授权规则、导出及错误码。
- `src/modules/media-processing/schemas/processing-authorization.ts`：严格运行时校验。
- `src/modules/content-acquisition/application/process-media-candidate.ts`：当前来源/候选复读、固定受众、来源revision绑定及默认15分钟协作式截止（依赖可覆盖）。
- `src/modules/content-acquisition/adapters/youtube/youtube-policy.ts`、`adapters/podcast/podcast-policy.ts`、`adapters/language-reactor/language-reactor-adapter.ts`：各增加可选授权schema，保留原有适配器逻辑。
- `tests/unit/media-processing-rights.test.ts`、`media-processing-orchestrator.test.ts`、`process-media-candidate.test.ts`：拒绝场景、回调、清理和CAS；既有成功fixture显式提供fake授权。
- `tests/contracts/media-processing-authorization-contract.test.ts`：三个来源策略兼容、严格授权字段和私用/资料库受众隔离。
- `docs/architecture.md`、`docs/content-authoring.md`、`docs/testing-strategy.md`、内容供应实施计划、`PROJECT_STATUS.md`及本报告：兼容、限制及交接。

其他会话的既有改动保留。三个来源文件改前副本保存在仓库外，新增授权import/字段以外与副本一致；共享文档只补本任务段落。Next验证自动追加的本任务dist include已从tsconfig移除，保留其他原有include。没有整体提交共享工作树。

## 验证

本shell的pnpm不在PATH，使用既有 `C:/nvm4w/nodejs/node.exe` 直接运行本地工具；不安装依赖。

| 检查 | 结果 |
| --- | --- |
| 修复前回归 | 新增授权测试在旧实现上20失败、1通过，确认绕过门禁、取消及晚到结果问题 |
| 最终专项Vitest | **12文件 / 97项通过**；包含领域门禁、编排、候选、ASR eligibility、三个来源policy/adapter、daily pipeline、runtime及转写/翻译/新授权契约 |
| 最终专项ESLint | **13个TS文件通过**，max-warnings=0 |
| 全树TypeScript | **通过**；最终清理Next自动include后 `tsc --noEmit --incremental false` 退出0 |
| 视频/播客E2E | 桌面及手机Chromium **18/18通过**；Node wrapper确认Playwright子进程退出0。首次PowerShell重定向虽显示18通过但wrapper退出1，因此另用wrapper复核；未把首次当作干净命令成功 |
| 全量Vitest | **407文件，397通过/10失败；2560项通过/24失败/1跳过**，未全绿。执行期间本任务与共享树仍在变动，含2项新增来源revision回归失败；最终冻结后的专项已覆盖且通过这2项，但未重跑冻结后的全量。其余22项失败未通过隔离基线归因，不能称为已证明的既有失败 |
| 生产build | 首次Node半空间分配OOM；单独重试后Turbopack编译成功（14.9s），但TypeScript worker分配OOM，退出1。未关闭类型检查，不能称生产build通过 |
| diff与保存 | 限定diff whitespace、文件/UTF-8、任务段落与共享适配器保留检查，见仓库外验证清单 |

最终专项命令：`node node_modules/vitest/vitest.mjs run tests/unit/media-processing-rights.test.ts tests/unit/media-processing-orchestrator.test.ts tests/unit/process-media-candidate.test.ts tests/unit/media-asr-eligibility.test.ts tests/unit/youtube-candidate-policy.test.ts tests/unit/podcast-candidate-policy.test.ts tests/unit/language-reactor-adapter.test.ts tests/unit/daily-media-pipeline.test.ts tests/unit/content-media-runtime.test.ts tests/contracts/media-transcription-provider-contract.test.ts tests/contracts/media-translation-provider-contract.test.ts tests/contracts/media-processing-authorization-contract.test.ts --maxWorkers=1`。

全量失败文件为article-acquisition-publish、corpus-form-frequency-materialisation、account-data-route、chat-expression-assist、desktop-navigation、expression-assist、learning-heatmap、lucia-data-route、process-media-candidate和vocabulary-page；详情及计数保存在 `media-rights-001-vitest-full.json`。不因相关专项通过就把全量失败抹去。

未执行全仓lint（本机内存限制，已有全仓OOM记录，本轮仅跑专项）、整个E2E、真实数据库/RLS、真实供应商或iPhone Safari/PWA真机。没有数据访问/迁移变更，fake repository测试证明编排拒绝与既有CAS参数，不替代真实数据库事务验证。

另一名独立AI完成只读设计与代码复核，指出旧artifact store与新版source policy的绑定风险；已用来源revision检查及两项回归修复。它独立跑过中间专项3文件50项。AI工程复核不构成正式内容双维审核。

仓库外证据目录：`C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/`，包括本任务baseline、全量JSON/log、E2E两次log、build两次log和最终验证清单。不包含真实媒体或生产数据。

## 限制、用户验证与下一步

来源重读与候选CAS仍为独立操作，最后观察之后至提交存在竞态窗口，尚非来源和候选的跨表原子撤权。检查不能撤销已开始的供应商请求或已产生费用。截止通过abort协作取消：忽略signal但最终返回的成功/失败会被拒绝；永不settle的provider、取得或repository调用不能保证在截止时刻退出。来源revision变化采取保守停止，需要在新策略下重新开始。

用户可在本地重跑上述97项fake测试，观察disabled、unknown/revoked、缺操作/受众/云处理、到期和过期generation均在预期位置拒绝，且首次拒绝场景供应商零调用。无需配置真实来源或密钥。已有视频/播客播放和词汇工作台可按E2E复核；本轮没有新增可在资料库看到的内容。

下一项建议仍单独实施官方频道且精确视频ID的元数据发现；来源实际授权、取得方式与发布审核继续保持门禁。上线前还需冻结共享树后重新跑全量测试、归因失败，并在内存充足的环境完成生产build。
