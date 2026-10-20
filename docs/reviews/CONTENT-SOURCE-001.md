# CONTENT-SOURCE-001：新增实用对话来源提案

2026-10-16 · 状态：提案待复核 · 分支：`codex/disable-legacy-readlang` · Commit：无，未提交/推送/部署。

承接 CONTENT-SELECT-002。建议优先核实 VideoEle 两条短视频的具体使用权，其次保留 Easy Spanish 两条元数据线索；Spanish Learning Lab 先作为原站参考。本次研究没有新增可发布内容，本批仍为 **2 条待复核、10 个席位未填补**。以下是 AI 公开资料研究，不是正式语言/教学审核、法律意见或来源启用记录。

## 1. 具体来源与样本

| 优先级 | 官方来源与具体样本 | 时长与目标 | 文字取得情况 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | VideoEle：[A2 Sube a mi casa](https://www.videoele.com/A2-Sube-a-mi-casa.html)，视频 `S0irU4fsfA0` | 4:49，符合视频 3–8 分钟；官方功能标注“Ofrecer e invitar” | 官方公开 transcripción PDF；不是已验证同步字幕 | 优先核实邀请/回应是否形成完整往返，以及具体许可范围 |
| 1 | VideoEle：[B1 Comer fuera](https://www.videoele.com/B1-Comer-fuera.html)，视频 `z-CS3hAuOxs` | 4:16，符合时长；官方列计划、餐桌祝愿、愿望与评价 | 官方公开 transcripción PDF；同步时间轴待制作/核验 | 日常用餐备选；官方 B1 标签不代替本项目适用性审核 |
| 2 | Easy Spanish：[Casual Spanish Conversation about Summer Plans，109](https://www.youtube.com/watch?v=SDcJPk62qG0) | 单条元数据 7:53，符合时长；说明称 Carla/Sara 慢速谈假期计划 | 本次元数据 `subtitles=[]`；有自动字幕语言列表，未取得任何字幕 | 保留谈计划线索；尚未证明包含邀请、时间地点协商 |
| 2 | Easy Spanish：[3 Ways to Order a Coffee，74](https://www.youtube.com/watch?v=JtLypQpGruo) | 单条元数据 7:57，符合时长；题名为点咖啡表达与错误讲解 | 同上；会员提供 transcripts，不读取会员内容 | 办事表达备选；不能仅凭题名认定是完整服务对话 |
| 3 | Spanish Learning Lab：[Making Future Plans in Spanish](https://www.spanishlearninglab.com/making-future-plans-in-spanish/)，“Listening Activity No. 1” | 公开音频时长未知；不是已核验 4–10 分钟播客/feed | 页面公开西语文字与英文翻译，无同步时间轴 | 原站参考；不计入视频或播客席位 |

时长使用单条视频元数据。Easy Spanish 的两个列表分别显示 474/478 秒，单条查询显示 473/477 秒，保留这一秒差异并采用单条值，不默默统一原始证据。以上四条视频仅满足时长门槛，未通过本项目内容审核、原音听审、嵌入可用性或 CEFR/地区复核。

Learning Lab 主活动的最小文字证据包括“pensamos en invitarte a ir con nosotros”“Dale, me parece buena idea”“¿Qué vamos a hacer después?”与“pasar por ti media hora antes del concierto”：可确认邀请、接受、追问安排和接送的交流动作，尚无明确钟点。页面嵌入 `ImRaC-WlgHo` 是 IR+A+infinitive 语法教学视频，不能将它与主活动音频混为一条对话，也不能把页面转换成已获许可的文章全文。

## 2. 官方身份与许可边界

### VideoEle

官方教学页直接提供视频及文字稿链接。官网 [法律声明](https://www.videoele.com/legal.html) 明确链接 **CC BY-NC-ND 4.0**。必须保留作者、来源、许可证链接及修改说明；非商业条件和 ND 条件都需要满足。ND 对分发改编作品有限制，不能将公开 PDF 或视频自动解释为允许站内分发翻译、重切字幕、音频剪辑或双语内容包。个人非商业使用也不能替代其他条款与平台取得规则。

两条视频元数据均属于 VideoEle 频道 `UCQK4L3hsPP0ei2_54lDaB6g`；西语字幕轨道键分别为 `es`、`es-G-PHUSlR500`。仅确认轨道元数据，尚未取得字幕正文或核验时间轴。元数据工具报告缺少支持的 JavaScript runtime，不能据成功取得标题/时长推断已完整验证字幕、媒体格式或播放可用性。

在许可允许的条件下制作个人不共享改编，与向站内用户分发改编是不同动作；本提案没有判定当前服务端处理和页面交付必然属于哪一类。后续应针对具体内容、处理方式、受众与分享方式取得可核验的授权结论。不要把 ND 简化成禁止一切私人改编，也不要据此认为本项目可直接分发翻译。法律页若存在命名为 `by-nc-sa.png` 的图片，以明确正文和实际许可证链接为证据，不能用文件名推断 SA。

配套公开互动练习提供最小文字证据：A2 有“¿Quieres ver el piso donde vivo?”和“¿Te apetece...?”；B1 有“Camarero, ¿nos pone una ración de calamares a la romana?”和“¿nos trae la cuenta?”。这是练习文字，尚不能证明原视频已有完整双人往返，也没有时间戳。PDF 仅发现公开链接，未取得全文。

当前 YouTube 查询未返回 license 字段，不能从缺失字段推定 CC 或标准许可；站点许可是否覆盖所有视频、字幕、第三方素材及拟处理方式仍应逐项确认。取得足以覆盖具体用途的可核验许可结论前，不将该源设为 `rights_status=verified` 并运行处理；如超出已有许可，再取得权利人额外授权。

### Easy Spanish

官方身份链为 [Easy Languages](https://www.easy-languages.org/) → [Our Languages](https://www.easy-languages.org/our-languages) → [easy-spanish.org](https://www.easy-spanish.org/) → `@EasySpanish`。官方频道 ID：`UCAL4AMMMXKxHDu3FqZV6CbQ`；[Imprint](https://www.easy-spanish.org/imprint) 标识 Easy Languages GmbH。近似域名 `easyspanish.org` 当前为出售页面，已排除。

[会员页](https://www.easy-spanish.org/membership) 将视频/播客转写、练习和下载列为权益。本次未找到支持本项目复制、翻译、托管或索引转写的开放许可证据，未购买或读取会员材料。公开页面所说的西/英字幕可能是画面字幕；本次机器元数据未发现人工字幕轨道，不能宣称字幕不存在，也不能宣称已有可导入字幕。自动字幕的出现不授予处理或分发权。

### Spanish Learning Lab

官网有 copyright 声明；本次检查的页面和公开链接未提供可用于本项目复制/翻译/托管的明确开放许可。首页 2018 年 Alex 对一位教师的公开回复要求导向原站、“sin necesidad de duplicar nuestro contenido en tu sitio”。这是特定回复，不能扩大为对本项目的一般授权，也不能替代正式许可条款。建议只保存课程标题、规范化 URL 和最小研究元数据，用户在原站查看；不复制整页、公开评论或全文进产品。

## 3. 可审核的有限白名单草案

以下是**研究范围草案**，不是可直接导入的 source 配置；未启用来源、定时任务或游标。现有适配器要求明确 `rights_status=verified`、HTTPS licenseEvidence 与其他策略字段，不能为保存线索伪造这些字段。公开页研究不等于正式授权来源。

| 来源 | 有限范围 | 拟保留字段 | 暂缓动作与门禁 |
| --- | --- | --- | --- |
| VideoEle | `www.videoele.com` 仅上述两教学页及 `legal.html`；YouTube 频道 `UCQK4L3hsPP0ei2_54lDaB6g` 且仅 `S0irU4fsfA0`、`z-CS3hAuOxs`；不放开整个频道/域名 | 来源名、标题、规范化 URL、频道/视频 ID、时长、官方等级/功能标签、许可 URL/hash、文字稿链接、字幕轨道存在性 | 核逐条许可和第三方权利、嵌入/语言/区域可用性；明确 PDF/字幕正文取得、翻译、字幕对齐、词句索引及页面分发权限后才评估处理 |
| Easy Spanish | 官方 channel `UCAL4AMMMXKxHDu3FqZV6CbQ` **且**视频 ID 仅 `SDcJPk62qG0`、`JtLypQpGruo`；上述官网身份/会员页 | 标题、URL、ID、时长、官方频道、声明语言、字幕可取得状态、权利待定标记 | 未授权不读取会员/转写全文，不下载、ASR、翻译或建字幕索引；先取得覆盖这两条及具体用途的授权证据 |
| Spanish Learning Lab | `www.spanishlearninglab.com` 仅课程 URL 与首页权利证据 | 标题、URL、活动名、文字/音频存在性、时长未知标记 | 不建立假 podcast feed；不请求音频，不复制全文；如拟收录先补音频时长、适配器边界与作者授权 |

若未来进入运行配置，发现频率建议先单次人工 dry-run、最多本表五条线索、并发 1、无 ASR/翻译预算。持续扫描、整频道或整站扩张另行界定；不能只按域名放行外链、短链、CDN 或重定向。当前代码是否支持“频道且两 ID”的交集限制尚未验证；不能表达时保留手工提案，不能退化为全频道启用。

署名草案：VideoEle 样本标题＋官方页＋已核实作者＋CC BY-NC-ND 4.0 链接；Easy Spanish 样本标题＋官方视频＋Easy Spanish/Easy Languages，待授权指定最终署名；Learning Lab 只作标题外链，若获授权再按作者要求补充。任何实际复制/翻译均须保存授权覆盖、版本与修改说明。撤下入口、来源联系路径及具体作者名称在正式启用前核实；来源许可改变、授权撤回或下架时暂停发现并按既有撤下机制处理，保留审计，不覆盖有证据的内容版本。

## 4. 缺失授权的具体记录模板

后续为每个拟使用样本记录：授权人/权利主体、身份依据、授权形式与日期、公开 HTTPS 证据或受控授权记录 ID、精确 URL/视频 ID/版本、是否涵盖第三方素材、地域/期限、商业与非商业范围、受众、官方嵌入、字幕/PDF 获取、临时下载与删除、第三方 ASR/翻译处理、字幕切分与对齐、中文翻译、词句索引/短摘、站内显示与再分发、署名/修改标记、撤回与到期办法。每项写允许/不允许/待确认，空白不能解释为允许。

所有者可以确认项目受众、用途和拟纳入的具体 ID；这不能替代第三方权利人的授权。当前未联系任何第三方，也未准备或发送外部消息。若仅采用未修改官方嵌入，仍需按本项目既有规则补足许可证据、来源及发布门禁，不能自动获准双语处理。

## 5. 证据、验证与交接

机器清单：[CONTENT-SOURCE-001.json](CONTENT-SOURCE-001.json)，保存来源/样本/门禁与最小证据摘录、取得时间、原始响应 hash、外部证据文件 hash。研究文件目录：`C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/`。HTML 临时文件读后删除；没有下载音视频、取得完整字幕或 PDF 全文、调用收费 provider。

验证：JSON 可解析、UTF-8、样本 ID/官方链/URL/时长与证据一致、许可边界、证据 hash、文档链接、外部脚本语法与限定 diff 检查。结果以最终验证文件为准；公开页研究和独立 AI 事实复核不等于正式双维内容批准。

另一名 AI 独立研究并复核 VideoEle 部分，确认两样本时长、频道、轨道元数据、官方练习证据和 NC/ND 边界；其交接为 `source001-videole-review.json`，原始短摘及视频元数据分别为 `source001-videole-evidence.json`、`source001-videole-video-metadata.json`，hash 绑定在机器清单。该复核仅覆盖 VideoEle，不是全提案独立法律审查或正式语言/教学审核。最终结构验证文件为上述外部目录的 `source001-validation.json`。

本任务只有两份报告、状态页和实施计划变更；无产品代码/接口/Schema/迁移变化，未跑全仓 lint/typecheck/Vitest/E2E/build。未验证原音、画面、播放器、真实嵌入限制、iPhone Safari、真实库或 CEFR/地区，也没有新增正式审核、写库、发布、部署或提交。保留共享树其他改动。

用户验证：打开上表官方链接，对照样本时长、教学功能、法律页 NC/ND 和会员页的转写范围；查看 JSON 中证据摘录及 hash。下一建议切片为 VideoEle 两样本的**具体使用权核验**：先补许可覆盖与可用的处理/显示方式，再决定是否将两 ID 加入来源配置和进入独立内容审核。播客席位继续保留缺口。
