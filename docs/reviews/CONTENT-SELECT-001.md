# CONTENT-SELECT-001：六场景媒体候选准备包

- 日期：2026-10-15；本会话在 CONTENT-AUDIT-001 交付后获用户同意继续选材。
- 状态：准备包完成，存在明确缺口；不是12条合格内容的发布交付。
- 分支：沿用共享工作树 `codex/disable-legacy-readlang`；无提交、推送或部署。
- 机器可读清单：[CONTENT-SELECT-001.json](CONTENT-SELECT-001.json)。它是本地选材记录，不是可导入的内容 bundle 或正式 API 契约。

## 结论

整理了 **6条视频线索和6集播客备选**，其中4条视频可优先做适用性复核。原定的12个席位仍有 **4个待适用性复核、8个未填补**；这4个也未确认为合格教学内容。目前不能把这份名单算作新增12条或可发布12条。

现有启用、权利状态为 `verified` 的媒体来源只有 Language Reactor YouTube Mix 与 Podcast Mix。本次按已实现适配器的请求格式，读取这两个来源的目录元数据；没有扩展到其他 playlist、外部频道或节目 feed。规范化、语言过滤和去重后为 **400条视频、199集播客**，共599条目录记录。它们是白名单目录当前分页返回的集合，和上一任务的172条已发布库存口径不同，不代表来源历史全集。

优先处理顺序为药房、朋友聚会、公交、第一天工作。药房候选已有121段草稿，可先判断素材有没有合适的日常表达；其他线索仍需确认具体交流动作。六条视频均来自 enchufetv，说明当前白名单选材仍偏搞笑短剧；它们不是已经解决来源多样性问题的新内容组合。

## 1. 六场景的12个目标席位

目标仍为8条A2、4条B1；视频3–8分钟、播客4–10分钟。以下级别是编辑目标，不是已完成的CEFR评级。

| 场景 | 视频目标 | 播客目标 |
| --- | --- | --- |
| 购物、餐饮 | A2，缺：询价、点单、替换要求或结账的实际互动 | A2，缺；价格口语备选22.33分钟，不计入短篇席位 |
| 租房、居住 | A2，缺：问条件、约看房、报修或沟通室友问题 | B1，缺；住房新闻和恶作剧不能替代这些动作 |
| 预约、看病 | A2，药房短剧待适用性复核；牙医短剧为同席备选 | A2，缺：预约、描述不适、确认说明或请求复述 |
| 出行、办事 | A2，公交短剧待适用性复核 | A2，缺；问路播客15.60分钟，保留备选 |
| 朋友、日常聊天 | A2，朋友聚会短剧待适用性复核 | B1，缺；出游协商播客14.05分钟，保留备选 |
| 工作、学习 | B1，第一天工作短剧待适用性复核；面试短剧为同席备选 | B1，缺；奖金文化话题不是确认任务或请求帮助的对话 |

8个未填补席位包括全部6个短播客目标，以及购物/租房视频目标。未把超长节目裁成短片，也未修改原定时长或难度要求来填数。

## 2. 视频线索：4条优先复核、2条同席备选

标题、目录简介只证明选材线索，尚不能证明台词自然、语速合适或具备所需交流动作。原文里的玩笑、刻板印象和错误服务行为不得直接当教学范本。

| 编号 | 具体来源 | 时长 | 状态与已知缺口 |
| --- | --- | ---: | --- |
| V1 | [Viendo Como Farmacéutica](https://www.youtube.com/watch?v=boVmqMPXomQ)，enchufetv | 4.08分钟 | 优先；现有候选，revision 5、121段草稿，无当前审核记录，无Bunny托管元数据。先确认是否有可迁移药房表达；不能将情节当用药指导 |
| V2 | [Ir en Bus (Qué Choverga)](https://www.youtube.com/watch?v=FquokbZwdvI)，enchufetv | 5.40分钟 | 优先；现有候选，revision 5、0段、无当前审核/托管。需确认问站点、路线或目的地的真实表达 |
| V3 | [Reunión de Amigos](https://www.youtube.com/watch?v=WYkgAPfoCZ8)，enchufetv | 3.95分钟 | 优先；现有候选，revision 5、0段、无当前审核/托管。需确认接话、邀请或澄清语境 |
| V4 | [Primer Día De Trabajo](https://www.youtube.com/watch?v=tgpEafU9Ihk)，enchufetv | 3.22分钟 | 优先；授权目录中找到，尚未入候选库。简介明确是sketch；需确认介绍自己、询问任务、请求帮助等动作及难度 |
| V5 | [Viendo Como Paciente De Dentista](https://www.youtube.com/watch?v=7YfJ0sMf120)，enchufetv | 4.75分钟 | 健康席位备选；现有revision 5，0段、无当前审核/托管；不与V1重复计席位 |
| V6 | [Entrevista de Trabajo](https://www.youtube.com/watch?v=3Y2t5kfm4FI)，enchufetv | 3.93分钟 | 工作席位备选；现有revision 6，`processing`、0段、无当前审核/托管；未重启或争抢在途处理 |

V1/V2/V3/V5当前为 `review_ready`，V6为 `processing`，均仍为 `draft`；当前revision的审核记录查询为空。现有5个候选均存A2标签，它只复述数据库字段；未重评级。V4没有单条已存难度，源策略的默认A2不能充作实测难度。候选UUID、revision、hash和来源键保存在JSON清单，后续处理必须重新读取当前版本。

## 3. 六集播客备选及未计入目标的原因

全部来自已启用的同一个Podcast Mix目录，本次均未入库。只核对目录元数据，没有访问音频、付费字幕或完整转写；语言比例、播放可用性和实际难度待验。

| 编号 | 节目及条目 | 时长 | 可用线索和限制 |
| --- | --- | ---: | --- |
| P1 | [SpanishPod101：Everyday Spanish Conversations #6 — The Weekend Getaway](https://www.languagereactor.com/c/es/pd/t_pd_mix_es?doc=it_ac97373aa79a) | 14.05分钟 | 简介明确“处理分歧、达成折中”，适合复核出游计划/协商；超出短篇目标，英文讲解比例待确认 |
| P2 | [SpanishPod101：Everyday Spanish Conversations #5 — The Lost Day Out](https://www.languagereactor.com/c/es/pd/t_pd_mix_es?doc=it_33c1d7308de4) | 15.60分钟 | 简介明确“城市问路、交流兴趣”；超出目标，英文讲解比例待确认 |
| P3 | [Learn Spanish and Go：Qué decir cuando no entiendes a un hablante nativo](https://www.languagereactor.com/c/es/pd/t_pd_mix_es?doc=it_965238819840) | 19.05分钟 | 简介明确请求澄清、租车误解等语境；超出目标，不是租房材料 |
| P4 | [How to Spanish：La verdadera forma de hablar de la hora, el clima y el precio — EP424](https://www.languagereactor.com/c/es/pd/t_pd_mix_es?doc=it_cda145038802) | 22.33分钟 | 简介明确墨西哥口语的时间/价格表达；超出目标，也不能仅凭简介标成点餐完整对话 |
| P5 | [Chill Spanish #349：El aguinaldo](https://www.languagereactor.com/c/es/pd/t_pd_mix_es?doc=it_ef2dd42d460f) | 5.07分钟 | 符合时长，讨论奖金；可作工作文化短听力，但不是工作任务确认对话 |
| P6 | [Chill Spanish #348：Quedarse dormido](https://www.languagereactor.com/c/es/pd/t_pd_mix_es?doc=it_7dd6536d38d8) | 6.25分钟 | 符合时长，可作日常话题；不等于邀请、改约或澄清的交互材料 |

这些链接使用现有适配器的目录定位格式；未验证页面打开后能直接定位或播放对应集。保留真实目录ID，后续应以ID去重，不能只按标题匹配。没有把前两集的英语标题当作已确认的纯西语对话。

## 4. 排除与去重

- `El Piso Es Lava` 是游戏/搞笑标题，不因含piso就归入租房。
- `MANERAS DE MOLESTAR A TUS VECINOS/COMPAÑERO DE PISO` 不因含邻居/室友就充作沟通示范。
- `La Comida` 的标题和简介不足以证明有点餐或结账动作，未作为购物/餐饮主候选。
- 住房新闻、疾病科普、学校工具介绍以及CNN短新闻，不替代实际办事/交流内容。
- 已发布、已撤下或被拒绝的条目不计作新增候选；未重试 rejected 内容。
- 同一媒体平台ID只保留一次；牙医/药房、入职/面试为同席竞争，不重复填席位。

## 5. 后续可执行顺序

1. **先复核V1已有草稿的适用性**：要求能定位实际交流片段和可迁移表达；记录具体台词位置，判断玩笑是否会误导。若不满足则淘汰，不先花费重转写或托管。
2. 同样复核V3/V2/V4；确认素材合适后，才按现有权利、预算、字幕、独立双维审核、结构及资产门禁准备草稿。V6仍在处理中，使用前重读当前状态。
3. P1/P2可作为14–16分钟对话备选继续复核，但不填进原4–10分钟席位；P3提供沟通修复线索。P5/P6只用于短篇泛听备选。
4. 原短篇六场景目标仍需更合适素材。后续单独进行来源补选，优先找清楚包含购物、租房、预约、问路、邀约和工作协作的短对话；新增来源需按既有流程登记具体范围、许可和字幕取得方式。这里没有启用或扩展任何来源，也没有向第三方发消息。

本次不更改每日采集顺序/频率、不调整自动发布开关、不修改已有内容标签，也不把选材记录写成审核批准。下一建议切片为V1适用性复核；来源补选保持独立任务，不能自动把本清单推送到生产发布。

## 6. 验证与限制

- 白名单/全量候选快照：北京时间 **23:37:19**，583个候选身份用于去重；后续5条视频详情复核为 **23:55:57**。
- 两类查询均使用 `REPEATABLE READ READ ONLY`，并断言 `transaction_read_only=on`；只查来源、候选与审核表，没有读取用户私有数据。
- 目录请求时间为 **23:40:10–23:44:04**：15次有界元数据请求，包含返回空页的探测；每次最多50条、25秒、5MB，禁止跨host重定向，顺序请求间隔约1.1秒。普通日志不含播放地址或完整转写。
- 初版详情统计查询两次达到20秒超时，事务只读回滚；改为轻量身份查询加少量定点详情查询后成功。未通过提高写权限或变更数据库解决。
- 清单断言通过：12条唯一身份、6视频/6播客、均来自现有启用/verified来源、无已发布/被拒绝条目；12个场景×媒介唯一席位、8A2/4B1目标、4条优先复核线索符合视频时长、8个缺口显式保留，未声称任何条目可发布。
- 外部脚本语法检查及本任务文档 `git diff --check` 通过。未运行lint、typecheck、Vitest、E2E或build：没有产品代码、领域规则、API、Schema或迁移变更；本地选材清单不进入运行时。
- 未下载音视频、未调用收费ASR/翻译、未创建数据库候选、未提交审核、未发布、未改变生产配置。未验实际播放、字幕语义、口音、CEFR或Safari真机。
- `verified` 是现有来源登记事实，不是本轮重新取得的授权证明；拟用资产仍需核验实际授权范围。YouTube来源的 `licenseEvidence` 当前指向播客目录，后续使用前应核对原授权记录，不能仅凭该URL宣称覆盖某条视频。
- 文件：本报告、同名JSON清单、`PROJECT_STATUS.md`和实施计划CONTENT-SELECT-001章节。Commit：无；共享树其他改动保持。
- 用户验证：可先打开V1/V2/V3/V4来源页面，检查片段是否真的含所列交流动作；按JSON中的UUID/revision/hash在所有者内容工作流核对候选。链接和目录存在不等于已通过媒体质量或发布验收。

查询、目录扫描、清单构建脚本与最小元数据证据保存在仓库外本会话目录 `C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/`，文件名为 `select-content.mjs`、`browse-selection.mjs`、`check-selection-candidates.mjs`、`build-selection-pack.mjs`及对应JSON；不包含凭据、用户私有数据、播放URL或完整字幕。
