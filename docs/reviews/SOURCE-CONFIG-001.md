# SOURCE-CONFIG-001：VideoEle单ID配置与处理就绪核验

2026-10-16 · review · 共享分支 `codex/disable-legacy-readlang` · Commit：无，未提交、推送或部署。

已完成两条视频的来源配置草案和逐项使用范围核实。**当前不能通过既有live runner试运行或接入双语资料库**：代码已支持精确元数据发现，但实际许可路径、可用素材取得渠道、云端处理与展示范围尚未落实。不是所有元数据读取或私人翻译都需要额外作者许可；本结论针对当前应用配置与处理路径，不把这些不同动作合并为一份授权。

## 可审阅草案

[机器清单](SOURCE-CONFIG-001.json)保存两个按官方等级拆分的单ID草案：

| 内容与原站入口 | 指定ID / 频道 | 来源stableKey / 等级 |
| --- | --- | --- |
| [Sube a mi casa](https://www.videoele.com/A2-Sube-a-mi-casa.html) | `S0irU4fsfA0` / `UCQK4L3hsPP0ei2_54lDaB6g` | `youtube.videoele.a2-sube-a-mi-casa` / A2 |
| [Comer fuera](https://www.videoele.com/B1-Comer-fuera.html) | `z-CS3hAuOxs` / 同上 | `youtube.videoele.b1-comer-fuera` / B1 |

两份草案均为`enabled=false`、`rightsStatus=unknown`、`cursor=null`，无数据库ID，不可直接导入；`rightsPolicy`保留精确单ID、官方等级、署名、证据与拟定3–8分钟/ES观看范围，故意不填`license`和`mediaProcessing`。通用注册schema去除ID后的结构校验通过，但YouTube策略明确因缺license拒绝，不能拿结构正确当使用授权。region保留null，ES是拟定观看限制，不声称已验证口音或平台可播地区。289/256秒沿用前轮元数据，未重新测量；CEFR是官方选材信号，不是正式内容审核。

官方BY-NC-ND不能直接映射YouTube的`creativeCommon`；`licensed`也不是通用绕过选项，必须先形成适用于实际用途的判断及证据。原有两条仍无新语言/教学审核记录。

## 本次新证据与逐动作结论

18:11（Asia/Shanghai）重新读取两条教学页、法律页和课程说明，4页均HTTP 200。只保留必要短摘、链接、时间和正文SHA-256，未取得PDF/字幕全文或音视频。两条教学页hash与前轮相同，embed精确对应两ID，标题分别标A2/B1；频道仍沿用前轮官方身份链，未以页面embed假装完成Data API频道复验。

两条教学页页脚明确写有`VideoEle by Agust&#237;n Iruela`，因此新草案署名补充为 **VideoEle — Agustín Iruela**。前轮只建立品牌署名的报告保持原样，不能将本次发现倒写为历史已知。单份PDF内部版权和第三方声明仍未读。页脚明确文本/链接为BY-NC-ND 4.0，图片文件名`by-nc-sa.png`的矛盾继续保留。

| 动作 | 本次判断与尚缺输入 |
| --- | --- |
| 原站观看、原版PDF个人学习 | 官方明确支持相应学习用途，保留NC、ND、署名等条件；原站链接可用，PDF本轮未取得 |
| 本人非商业且不Share的翻译/笔记 | 既有CC法条核验支持条件内私人改编；课程说明亦提到读转写、翻译所需内容，不据此推导云处理或本站多人展示许可 |
| 官方精确元数据 | 代码具备；真实API的license、公开、嵌入、频道、语言、时长、地区尚未核，需明确凭据/配额、限次和运行边界 |
| 平台字幕取得 | 当前适配器只输出`captionStatus=unavailable`和空segments；官方captions.download要求编辑权限，未建立可用下载路径 |
| 音频取得与ASR | 没有获准的原文件或可用取得路径；plain youtube来源不能直接走现有视频音频下载函数 |
| 第三方翻译/ASR | 未建立acquire/asr/translate操作、第三方处理和适用受众的证据，不创建mediaProcessing |
| 双语字幕展示与视频转托管 | 不能从私人学习或PDF下载推导对外改编分享/视频转托管范围；需按实际受众与形式落实 |
| 词形统计、索引、语料例句 | 技术统计和对外显示受保护表达需分别判断；不一概要求额外许可，也不默认现有语料展示已获覆盖 |

既有法条与平台证据沿用[CONTENT-RIGHTS-001](CONTENT-RIGHTS-001.md)，不是本轮重新抓取的页面。没有联系作者或向第三方发送消息。

## 当前代码与试运行判定

本次读取的代码路径均为仓库相对路径，hash见仓库外验证清单：

- `src/modules/content-acquisition/adapters/youtube/youtube-policy.ts`：工厂要求enabled、verified及完整license策略，不能用缺字段草案直接调用。
- `src/modules/content-acquisition/adapters/youtube/youtube-channel-adapter.ts`：精确查询保留频道门禁；发现并不取得字幕正文。
- `src/modules/content-acquisition/application/run-daily-media-pipeline.ts`：会选取enabled/verified的媒体来源；空schedule不是可靠的排除机制。不能为CLI的`--dry-run`先改生产标记，再假设每日任务不会碰到。
- `src/modules/content-acquisition/application/content-media-runtime.ts`：`downloadAuthorizedYouTubeAudio`明确拒绝非language-reactor来源，普通youtube策略不能当作其下载授权。此处只是核验，不扩展新下载器或调用yt-dlp。
- `src/modules/content-acquisition/publishers/acquired-video-publisher.ts`：新视频要求合法`bunnyVideoAsset`；official_embed草案并不代表当前可只靠官方嵌入完成发布。既有历史嵌入不因此改写。
- `src/modules/content-acquisition/application/process-media-candidate.ts`：仍检查当前source/candidate及处理授权；本任务不改变上一轮门禁。

因此本轮没有执行真实Data API试运行。元数据本身与音频处理的权限不同，但**现有live入口不能在不提升来源标记的情况下表达这次纯元数据检查**。后续如只需要核查官方元数据，应单独限定一个不注册来源、不升级verified、不落库的检查入口及其凭据/配额边界，不能为实验虚构处理授权。

将来元数据检查的具体上限：固定当前频道和两ID；最多2次官方videos.list请求、零自动重试；零候选/游标写入、零来源启用、零处理/发布。逐项核对真实频道、公开/可嵌入、语言、时长、ES地区及实际API许可；缺失条目不替换；日志只保留结论、数量、时间与必要内部身份，不输出密钥或完整API响应。真实API会消耗配额。此为可审阅条件，未创建或执行运行脚本。

## 文件、验证与用户验收

本任务只修改本报告、同名JSON、`PROJECT_STATUS.md`和内容供应实施计划本任务章节；没有应用源码、公共Schema、迁移、数据库、环境或定时配置变更。其他共享树内容及历史报告保留。

| 检查 | 结果 |
| --- | --- |
| 官方HTML定点复核 | 4/4成功；页面身份、精确embed、等级、许可短摘与作者署名记录时间/hash |
| 仓库外离线探针 | 18组断言通过：去ID草案结构、禁用/unknown、缺license拒绝、工厂三种拒绝均零网络；假设许可的fake对照验证两个单ID、CEFR、稳定key及无字幕/处理，不登记真实授权 |
| 相关Vitest | **3文件 / 61项通过**：精确发现42项、处理授权13项、acquisition-run6项；无真实供应商 |
| 文档与保存 | JSON/UTF-8、链接、证据hash、历史文件hash、其他状态段落保留及限定diff校验，见外部validation清单 |

相关测试可在仓库根目录重跑：

```powershell
& 'C:\nvm4w\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/contracts/youtube-exact-discovery-contract.test.ts tests/contracts/media-processing-authorization-contract.test.ts tests/unit/content-acquisition-run.test.ts --maxWorkers=1
```

pnpm不在本shell PATH，使用既有Node和本地工具，无安装。仅文档/草案任务，未重跑全仓lint、typecheck、全量Vitest、E2E或build；前轮通过的构建不计成本任务重新验证，共享树全量失败也未算通过。未验真实Data API/数据库/RLS、付费provider、播放、字幕正文、原音、口音或Safari/PWA真机。此次2待复核/10未填补沿用前轮状态，并非新数据库计数。

用户可打开上方两条原站教学链接直接学习，按机器清单核对每份草案只有一个ID、禁用/unknown、无license/mediaProcessing；重跑fake测试验证门禁。下一建议优先落实能用于本站处理的原文件/字幕及具体使用范围；若仅核对平台可播性，则独立做上述不落库元数据检查，不以继续扩写来源文档代替实际素材条件。

仓库外证据目录：`C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/`。本任务`source-config-001-`前缀包含baseline、HTML读取脚本与最小证据、离线探针与结果、验证清单。Commit无；没有推送、部署、正式审核、来源启用、写库、素材下载、云处理或发布。
