# 授权视频沉浸内容与字幕解析设计

- 日期：2026-09-11
- 状态：聊天设计已确认，书面规格待产品本人复核
- 候选任务 ID：`VIDEO-001`（须在 `ALPHA-033` 退出后由协调者登记和领取）
- 首发客户端：响应式 Web/PWA 与 iPhone Safari
- 关联规范：[西班牙语沉浸式口语学习平台设计](./2026-08-20-spanish-speaking-learning-platform-design.md)、[Web 优先的个人学习与场景实战设计](./2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)、[内容创作规范](../../content-authoring.md)

## 1. 决策摘要

Sueño 在现有“探索 → 沉浸内容包”中增加一种视频内容包。用户播放获得授权的西语视频，跟随同步双语字幕，点击词语或语块查看当前语境中的解析，并可自主进入跟读或复述。它不是新的一级导航，也不是独立的视频社区、浏览器扩展或通用下载器。

第一版采用“受控开放许可采集”：Wikimedia Commons 是首个发现来源；PeerTube 以后只接经过验证的实例或频道；YouTube 只用于候选发现，或在取得明确授权后使用官方嵌入，不自动下载。发现、版权复核、媒体下载、字幕生产、教学审核和内容发布是分开的门禁，平台元数据或 AI 输出都不能自动令内容成为 `published`。

视频文件存放在 Supabase Storage/CDN，不进入 Git。字幕、翻译、语块、解析、来源、许可、审核和内容版本进入现有版本化 Content Bundle。观看和查词只形成内容进度，不产生能力证据；只有用户主动进入既有口语训练链路后，才可能生成适用的口语证据。

本设计属于 `ALPHA-033` 之后的独立候选任务。它不改变当前发布候选队列，也不授权立即抓取或下载媒体。

## 2. 目标与非目标

### 2.1 第一版目标

1. 从 Wikimedia Commons API 发现符合语言、时长、质量和许可初筛条件的候选视频。
2. 通过人工试听和版权复核，选出 3–5 个短视频；至少 1 个走通发现、下载、字幕制作、内容包导入和 Web 播放全链路。
3. 在现有内容包页面提供视频播放、活动字幕、双语显示、逐句定位和点击解析。
4. 复用现有固定解析、本地词表和 MiniMax 流式解释能力，并保护取消、断流和过期响应边界。
5. 保留明确的地区、来源、作者、许可、署名和审核信息。

### 2.2 非目标

- 新建一级“视频”导航、无限信息流或完整内容管理后台。
- 抓取任意网站、绕过平台限制、下载 YouTube 视频或重新发布许可不明内容。
- 浏览器扩展、任意网页字幕注入、字幕自动搜索或完整字幕编辑器。
- 以观看、阅读字幕、查词、收藏或打字提高发音、语流和真实口头反应评分。
- 新建媒体微服务、复杂消息队列、本地离线 ASR 或用户音频媒体库。
- 在本任务中恢复 Flutter 页面开发。公共 DTO、Schema 和 fixtures 仍需保持跨端可消费，但 Flutter UI 等待后续任务。

## 3. 调研结论

### 3.1 产品参考

| 产品 | 可借鉴能力 | Sueño 的边界 |
| --- | --- | --- |
| [Language Reactor](https://www.languagereactor.com/) | 双语字幕、逐句控制、词典和语块学习 | 不做浏览器扩展和任意站点注入 |
| [FluentU](https://www.fluentu.com/) | 以真实视频组织分级语言内容 | 不复制其封闭内容或商业课程结构 |
| [Lingopie](https://lingopie.com/) | 字幕点击、回放和内容发现 | 第一版不做流媒体片库和订阅 |
| [Migaku](https://migaku.com/) | 从媒体语境生成学习项 | 不自动把点击行为转成能力证据 |
| [CaptionPop](https://www.captionpop.com/) | 双字幕和逐句导航 | 不依赖未经审核的外部字幕作为正式内容 |

### 3.2 开源与 Web 能力参考

| 项目/能力 | 结论 |
| --- | --- |
| [asbplayer](https://github.com/asbplayer/asbplayer)（MIT） | 可研究字幕列表跳转、自动暂停和单句学习交互 |
| [interSubs](https://github.com/oltodosel/interSubs)（MIT） | 可研究悬浮字幕词语交互；实际复用仍需逐文件许可检查 |
| [LLPlayer](https://github.com/umlx5h/LLPlayer)（GPL-3.0） | 仅作产品研究，不复制代码到闭源产品 |
| 原生 [`<video>`、WebVTT 与 TextTrack](https://developer.mozilla.org/en-US/docs/Web/API/TextTrack) | `activeCues` 与 `cuechange` 足够支持第一版，无需立即引入 Video.js |

## 4. 内容来源与许可门禁

### 4.1 来源策略

允许同时收录西班牙本土和拉美西语，但必须填写可审核的地区标签，不能仅用笼统的“Spanish”。第一版只自动读取公开 API 元数据，不以页面抓取替代平台 API，也不把搜索结果视为授权证明。

许可规则：

- 优先 `CC0` 和 `CC BY`。
- `CC BY-SA` 进入人工复核队列，明确记录 ShareAlike 对派生字幕、剪辑、分发方式和产品许可的影响后才能批准。
- 排除 `CC BY-NC`、`CC BY-ND`、许可缺失、署名不完整、来源与上传者无权授权或平台标有 license review 问题的内容。
- 平台自报许可与实际作品明显矛盾时，以权利存疑处理，不下载、不发布。
- 所有正式内容保留原始页面、作者/上传者、许可名称和版本、许可证据摘要、署名文本、复核人、复核时间和下载时的内容哈希。

### 4.2 采集状态与数据流

```text
平台 API 发现
→ 自动筛选候选
→ 人工试听与版权复核
→ rights_verified
→ 下载并计算 SHA-256
→ 生成字幕草稿
→ 西语准确性与中文教学审核
→ 导入版本化内容包
→ published
```

发现工具只把候选元数据写入本地、非发布的工作区清单；`rights_verified` 之前不得下载媒体。第一版不建设 CMS，审核人通过可追踪的候选清单完成接受、拒绝和备注。只有被接受的来源、哈希和审核信息才进入正式 Content Bundle 与数据库。

下载必须使用平台提供的原始文件 URL，限制允许的主机、响应大小、媒体类型、时长和重定向次数，并在写入 Storage 前重新验证媒体探测结果。重跑发现或下载使用平台来源 ID 与文件哈希幂等去重。

### 4.3 首批候选

| 候选 | 初步信息 | 当前结论 |
| --- | --- | --- |
| [WIKITONGUES – Regina speaking Spanish](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Regina_speaking_Spanish.webm) | 约 113 秒、1080p、页面标为 CC BY 3.0 | 可进入试听、地区和权利复核，不等于已批准 |
| [WIKITONGUES – Azariah speaking Spanish](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Azariah_speaking_Spanish.webm) | 约 117 秒、1080p、页面标为 CC BY 3.0 | 可进入试听、地区和权利复核，不等于已批准 |
| [Huaraz 环境正义课程采访](https://commons.wikimedia.org/wiki/File:Curso_de_Justicia_Ambiental_y_Wikipedia_en_Huaraz_-_Entrevista_a_participante_01.webm) | 短采访系列、页面标为 CC BY 4.0、秘鲁西语 | 优先候选，仍需逐文件核验 |
| [WIKITONGUES – Pau speaking multiple languages](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Pau_speaking_French,_Lithuanian,_Italian,_English,_Spanish,_and_Catalan.webm) | 约 582 秒、页面标为 CC BY-SA 4.0 | 仅备选；需确认西语片段、剪辑与 ShareAlike 义务 |

候选准入偏好为 30 秒至 3 分钟、单一主题、自然连续口语、西语占主体、语音清晰、背景噪声可控且优先 720p 以上。排除隐私或未成年人风险、纯朗读、过度表演化、画面/音频质量不足和许可无法核实的素材。

## 5. 内容与数据模型

### 5.1 延续现有 Content Pack

视频是内容包的一种媒体形态，不建立独立课程、进度或评分体系。现有 `content_packs`、`content_pack_activities`、`content_sources`、`content_reviews` 和 `user_content_pack_states` 继续负责稳定身份、活动、来源、审核和用户状态。

Content Bundle 新增 `1.1` Schema：在内容包上增加可选 `video` 对象，在 segment 上增加可选时间轴、speaker 和 annotations；导入器同时保留 `1.0` 与 `1.1` 解析器。`1.0` 内容按原语义导入，不能通过修改同名 Schema 静默改变已导入内容。

### 5.2 视频资产

一个视频内容包版本最多绑定一个主视频资产。逻辑字段至少包括：

- `platform`、`platformSourceId`、`sourcePageUrl`、原始文件 URL 的不可长期暴露引用。
- `storageKey`、`mediaType`、`durationMs`、`width`、`height`、`sha256`。
- `locale`、`region`、`register`、可选 `speakers`。
- `license`、`licenseVersion`、`attribution`、`licenseEvidence`、`rightsReviewedAt`、`rightsReviewerReference`。
- `transcriptStatus`、`languageReviewStatus`、`pedagogyReviewStatus` 和资产可用状态。

`storageKey` 指向私有或受控 Storage 对象；公共 DTO 不返回长期有效对象 URL。服务端在所有权、发布状态和资产可用性检查后签发短时播放地址。媒体文件不进入 Git，开发 fixture 使用小型本地假媒体或 provider fake。

### 5.3 字幕 cue 与解析

数据库新增由 content pack version 拥有的 `content_pack_video_assets`；现有 `content_pack_segments` 增加可空的 `start_ms`、`end_ms`、`speaker_ref` 和 `annotations`。没有 `video` 的旧内容包必须保持这些字段为空；视频内容包的每个 segment 同时就是一个定时 cue。每个 cue 至少包含：

- 稳定 `cueId`，建议由 `packStableKey@version:cue:position` 派生。
- 连续且唯一的 `position`。
- 非负整数 `startMs`、`endMs`，且 `endMs > startMs`。
- 西语 `sourceText`、`zh-CN` 翻译、可选 `speakerId`。
- 已审核的 `chunks`、词语/语块 annotation 和解析引用。

第一版不接受互相重叠的 cue，但允许句间空隙；播放时间命中区间 `[startMs, endMs)`。字幕草稿和正式字幕分开：自动 ASR 输出只能是 draft，不能覆盖已发布 cue。修正西语原文、时间轴、翻译、解析语义或媒体内容都必须产生新的内容包版本；只修复不影响语义的署名展示错误，也必须保留审计记录。

固定解析至少表达当前语境中的中文含义、原形、词性、必要变位、语用作用和自然替代表达。它是内容，不是用户能力事实。AI 补充解析不自动写回正式内容；只有经过同样审核和版本流程后才能晋升为固定解析。

### 5.4 用户状态与证据隔离

观看位置作为 `user_content_pack_states` 的小型版本化扩展保存，例如 `lastPositionMs` 和最后活动 cue；完成步骤仍由既有活动定义，不以播放秒数伪造“掌握”。保存操作必须按用户、pack stable key 和 pack version 幂等更新。

以下行为不写 `evidence_events`，也不更新 `mastery` 或 `confidence`：播放、暂停、拖动、看完、查看翻译、点击解析、慢速回放、保存词语和打字笔记。用户主动进入跟读、复述或情境表达后，客户端只创建训练尝试；服务端继续按现有评估、低置信度和技术失败规则决定是否形成证据。

## 6. 模块与接口边界

```text
content acquisition tooling
  平台发现、许可初筛、候选清单、下载门禁、哈希与媒体探测

content
  视频资产、cue、固定解析、来源、审核、版本化导入与发布状态

explore
  内容包发现、保存、观看位置和完成状态

providers
  ASR 草稿与 AI 补充解析；只返回内部类型，不决定发布或证据

training / evidence
  只接收用户主动开始的口语尝试并在服务端重新校验
```

Route Handler 只负责鉴权、Zod 校验、调用 application 用例和协议转换。媒体下载器、供应商 SDK、Drizzle 与 React 不进入纯 TypeScript domain。模块通过明确 DTO 交互，客户端状态不能成为发布、许可或能力事实。

公共合同覆盖内容包视频元数据、cue、解析状态、短时播放地址和进度更新。Web 与未来 Flutter 使用同一 JSON Schema、稳定错误码和 `contracts/fixtures`；两端不共享 UI 源码。至少需要区分：内容不存在/未发布、资产不可用、签名失败、字幕不可用、解析不可用、版本过期和进度保存失败。

第一版接口固定为：

- `GET /api/v1/content/packs/[stableKey]/playback?version=`：鉴权并校验指定版本已发布且资产可用，返回资产元数据、cue DTO、短时播放 URL 和 `expiresAt`。
- `POST /api/v1/content/packs/[stableKey]/explanations`：接收 `version`、`cueId`、选择范围和 `generationId`；服务端从已发布 cue 重建上下文，优先返回固定解析/本地词表，否则流式生成 AI 补充并回显 `generationId`。
- `POST /api/v1/explore/state`：在现有合同上增加可选 `lastPositionMs` 和 `lastCuePosition`。服务端按 stable key/version 读取真实内容包并校验时长和步骤，不信任客户端提交的媒体时长或 `totalSteps`。

## 7. Web 播放与字幕交互

内容包页面使用原生 `<video>` 与受控 TextTrack/cue 映射。上方播放视频，下方显示可滚动的双语字幕列表：

- 当前 cue 自动高亮并滚动到可视区域。
- 用户手动滚动字幕后暂停自动跟随，并显示“回到当前字幕”。
- 点击字幕行空白区域跳到该句起点并继续播放。
- 点击具体词语或审核语块暂停视频，打开解析面板，不额外触发跳转。
- 用户可切换西语字幕/双语字幕、隐藏中文、再听本句和慢速播放。
- 桌面端视频与解析面板并列；窄屏和 iPhone Safari 使用底部抽屉，不能遮住字幕上下文或系统安全区。
- 解析入口和保存入口具有独立命中区、可见焦点、`aria-label` 和键盘操作，不把整行点击与词语点击混为一个动作。

解析按以下顺序降级：内容包内已审核固定解析 → 现有本地词表 → MiniMax 流式补充。生成内容明确标记“AI 解析”，没有显式 `done` 不算完成，也不能缓存为正式解析。

每个 cue 可显示“跟读这句”，内容结尾可显示复述或情境表达入口。它们是次级动作，用户必须明确启动；进入后复用现有训练 application、`attemptId`、录音隐私和评分边界。

## 8. 状态、竞态与错误恢复

播放器和解析分别使用可测试的状态机或纯编排器：

```text
player: loading → ready → playing / paused → ended
                   └──────────────────────→ error

analysis: idle → loading → streaming → done
             └──────────────────────→ error / cancelled
```

- 每次解析使用独立 `generationId`。连续点击不同 cue、切换内容或离开页面时取消旧请求；旧回调不得更新当前状态。
- 拖动或程序化 seek 后使用当前媒体时间重新计算 cue，不信任可能延迟到达的旧 `cuechange`。
- 页面卸载或内容版本变化时释放媒体监听器、定时器、流读取器和临时对象 URL。
- 视频加载失败时保留内容介绍、已加载字幕、明确错误和重试；签名 URL 过期时只通过服务端重签。
- 字幕失败时允许继续播放，但显示“字幕加载失败”，不能展示另一个版本或错位缓存。
- AI 失败时保留固定翻译和本地词典结果；断流结果标为未完成并允许重试。
- 观看进度节流、幂等保存；离线失败不阻止播放，恢复后重试。旧版本进度不得写入新版本。
- 内容被撤下、许可失效或审核回退时停止公开播放，但保留内部来源审核记录和历史用户状态。

日志只记录内部资产 ID、平台来源 ID、错误码、延迟、generation/request ID 和估算成本。不得记录完整签名 URL、访问令牌、原始私密笔记或把完整用户查询长期写入普通诊断日志。

## 9. 测试与验收

### 9.1 自动化测试

- Domain 单元测试：播放时间到 cue 的映射、区间边界、空字幕、重复/跳号 position、重叠和非法时间轴。
- 状态机测试：加载、播放、暂停、seek、切换内容、取消、断流、过期 `generationId` 和资源释放。
- 采集测试：Wikimedia API fake、许可白名单、可疑许可拒绝、主机/大小/媒体类型限制、重复来源 ID/哈希和下载前 `rights_verified` 门禁。
- 内容导入与数据库测试：Schema 兼容、整包校验后事务写入、版本不可静默覆盖、RLS/所有权、进度幂等和撤下内容不可公开访问。
- Provider 契约测试：ASR/解析响应转内部类型，供应商失败和不完整流不写正式内容、不产生证据。
- 组件测试：字幕高亮、行跳转、词语解析、自动跟随暂停与恢复、字幕/解析降级、键盘和 reduced motion。
- Playwright：打开视频内容包、定位 cue、查看解析、刷新恢复位置、签名过期重试和主动进入跟读。
- 评分隔离测试：纯观看、查词、慢放、保存和技术失败均不写 evidence；可信语音尝试仍由训练链路判断。

默认测试只使用 fake 或本地 fixture，不调用收费供应商，不下载公网媒体。涉及实现时至少运行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`；跨模块、迁移和发布候选还需运行 `pnpm test:e2e` 与 `pnpm build`。

### 9.2 首版验收条件

1. 至少 3 个候选具有完整发现元数据和人工接受/拒绝结论。
2. 至少 1 个 `rights_verified` 视频完成哈希、Storage 上传、字幕与教学审核，并作为新内容包版本导入。
3. Web/PWA 可播放、同步高亮字幕、逐句跳转、点击解析、切换双语显示并恢复观看位置。
4. 取消、过期回调、断流、签名过期、字幕失败和内容撤下均有可恢复或诚实降级路径。
5. 来源、许可、署名、地区和审核信息可追溯；未审核内容在生产环境不可见。
6. 只观看或查词不会产生学习证据；主动口语迁移继续满足现有评分和隐私不变量。
7. 320–1440px 无横向溢出，键盘、屏幕阅读器、触控目标和 iPhone Safari 基础播放路径可用。

## 10. `VIDEO-001` 实施切片边界

详细逐文件步骤在本规格书面复核通过后另写实施计划。该单一任务建议按以下顺序推进：

1. 扩展 Content Bundle、公共 DTO、错误码和跨端 fixtures；补数据库迁移与纯领域校验。
2. 实现 Wikimedia 候选发现与下载门禁工具，不下载未核权内容。
3. 人工复核首批候选，制作并导入至少一个已审核视频内容包。
4. 实现 Web 原生播放器、字幕同步、观看进度和可靠性状态机。
5. 接入固定解析、本地词表、AI 流式降级和口语迁移入口。
6. 完成契约、数据库、组件、E2E、可访问性和评分隔离验收。

如果首批候选均无法通过版权或质量复核，任务停止在候选报告，不扩大到未经验证的 PeerTube 实例或 YouTube 下载。若 Supabase Storage 策略、媒体带宽或 ShareAlike 义务需要改变现有架构/商业许可，先补 ADR，再继续实施。

## 11. 已知限制与后续方向

- 当前候选信息来自公开页面的初步调研，正式下载前必须重新通过平台 API 和人工方式核验。
- 第一版没有批量内容后台，候选审核和字幕制作仍是受控人工流程。
- 自动转写只能减少录入成本，不能代替母语者语言审核和中文教学审核。
- 原生 `<video>` 是否满足未来 HLS、多音轨、DRM 或大规模带宽需求，留到真实数据证明后评估。
- PeerTube 可信实例、官方嵌入、内容创作者合作、字幕编辑器和 Flutter 播放器分别作为后续任务，不在 `VIDEO-001` 扩张。
