# 个人 Alpha Web/PWA 架构边界

`CHAT-READALOUD-001`（2026-10-21）：聊天消息右键/双击菜单里的「朗读」从仅角色消息扩展到学习者自己的消息，用户可回听自己发送的西语。两种角色共用同一 `createReadAloud` 统一鉴权朗读（ADR-0019 固定 MiniMax Serene Woman），沿用既有 `speakingMessageId`、停止与 generation 隔离；消息菜单本身只对已收到正文且未撤回的消息打开，撤回提示不会进入朗读。只有角色消息菜单包含翻译（取消翻译），学习者消息仍只有复制、朗读、引用回复、撤回、删除。不新增 API、provider、数据库迁移、学习评分或证据写入；学习者文本照旧会发送至 MiniMax，隐私边界与既有聊天朗读一致，普通用户消息文本类型不做语言门禁。设计/验证见[交接](reviews/CHAT-READALOUD-001.md)。

`CHAT-ASSISTANT-001`（2026-10-21）：聊天页右上角「更多对话操作」菜单新增「AI 助手」入口，打开非模态学习助手面板，支持 `reply`（要 1–3 条可填入输入框的自然西语回复）、`grammar`（检查学习者自己编辑的西语草稿并给最小修正）、`structure`（拆分句子成分）、`question`（中文自由提问）四类意图。鉴权 `POST /api/v1/conversations/:characterId/assistant` 在 application 层重验静态角色版本、已发布人物/对话能力门禁、当前发布版本与联系人状态，只通过只读 repository 读取本用户本角色最近 8 条已完成且未撤回消息（排除被撤回消息的回复），`structure` 缺目标句时回退到最近一条角色消息；客户端不发送对话上下文，只发送学习者主动写的问题/目标句。内部 `providers/assistant` 适配 MiniMax 非流式 JSON 输出，经 Zod 归一化后返回结构化 `answer` 与可选 `suggestions/corrections/structure/correctedSentence`；可选块缺失不失败，但非法 JSON/Schema 未通过则失败关闭。请求/结果不写消息、关系记忆、人物事实、能力证据或普通日志；`provider_calls` 只记 providerType=assistant、模型、状态、延迟、请求关联与费用估算。助手结果只存在于组件内存，关闭/刷新即丢失；「填入输入框」只写可编辑草稿且必须用户显式发送，朗读统一走 `useReadAloud`（ADR-0019）。无数据库迁移、无公共路由之外的契约变化、无学习评分。设计见[规格](superpowers/specs/2026-10-21-chat-ai-assistant-design.md)，验证与限制见[交接](reviews/CHAT-ASSISTANT-001.md)。

`CHAT-GREETING-002`（2026-10-21）：修复“同一本地日的连续聊天中 Lucía 再次以问候开场”。2026-10-21 真实 transcript：16:40 已问候，16:47/16:53 为普通回复，16:58 用户只回复 `Pues sí, es una buena idea.`；第一次生成被其他安全门禁拒绝后，唯一一次重试输出 `¡Hola! ¿Qué tal te va con el día gris?`。旧 `isRedundantGreetingReply` 只检查 `recentMessages` 中最后一条角色消息，而最后一条是 `Uff, los días de lluvia…`，因此同日更早的问候被漏过。修复：问候识别与同日判定移入纯领域 `conversation/domain/greeting.ts` 与 `domain/local-date.ts`（与 `sameLocalDay` 投影共用本地日换算）；门禁扫描当天全部角色消息，任一以问候开场即视为当天已问候，时间戳不可用不猜。`buildReplyContext` 从未被 8,000 字符预算裁剪的近期历史派生 `alreadyGreetedToday`，经内部 provider DTO 交给两家 provider；system prompt 引用该字段，重试指令在“当天已问候且用户本条不是问候”时追加禁止问候约束，避免拦下后被重试换一种错误。用户重新问候、跨本地日、缺时间戳仍豁免；重试第二次仍以问候开场则失败关闭，不发送正文或 `done`。无数据库/迁移/公共 API/学习证据变更，日志不新增正文。详见[交接](reviews/CHAT-GREETING-002.md)。

`CHAT-RHYTHM-001`（2026-10-17）：文字聊天以一个逻辑助手消息保存整轮回复，空行表示语义气泡边界，单换行留在气泡内；服务端先完成全文安全检查，再逐个完整气泡发送 NDJSON delta，气泡间约450ms且可取消。共享 provider 规则要求简短回应、按意思选择1/2/3/更多条，禁止把分条变成逐条追问。客户端120ms合并连续提交；`pendingMessages` 保留较早用户消息的独立ID和辅助来源，顶层正文是最新消息。应用层在事务认领代次后读取历史，将完整验证批次另以 `unansweredUserMessages` 交给 provider，避免8000字符历史预算吞掉尚未回应的内容。最新更正优先，独立话题保留有用意思，相关话题试探连接；这些自然度规则仍依赖模型，不能视为确定性事实校验。

同会话的短事务锁与现有 `messages.status` 提供持久代次所有权：claim批次幂等、取消旧streaming占位；每个气泡先保存仅能追加的前缀，完成时CAS核验当前代次及用户消息仍有效后才允许done和记忆。`supersedes`只提供旧代次ID及可见气泡数，能够裁短本用户的未完成服务端前缀，不能提交角色正文或改写completed消息；未知旧代次写空取消标记，拒绝晚到旧请求重新认领。取消、错误、断流保留非空前缀但不产生完整轮次记忆；重放完成代次不再次调用provider或提取记忆。有序来源表 `conversation_reply_sources` 将每个助手消息关联到完整批次，严格匹配重试并支撑撤回/删除来源时只清理依赖回复，留下取消标记防止复活；RLS及部署条件见[ADR-0020](adr/0020-durable-conversation-reply-sources.md)。客户端撤回/删除成功后强制重新读取本会话权威历史，取消受影响的活流，清理关联回复而保留无关正在显示的前缀、草稿及待回复消息；刷新失败明确提示，角色切换后的晚到结果失效。客户端按transport和generation隔离所有回调与finally，保留已显示气泡，取消reader/controller/timer；同一逻辑消息的复制、翻译、引用和搜索仍作用于整条正文。不新增学习评分或用户对话诊断日志；浏览器收到内容与屏幕绘制之间仍存在网络确认边界。详见[专项设计](superpowers/specs/2026-10-17-conversation-bubbles-and-followups-design.md)。

`MEDIA-WORD-003`（2026-10-18）：每日媒体采集的 live ASR 现在要求 MiniMax 返回 `timestamp_level=word`，由 media 纯领域 `groupProviderWordsIntoSentences` 仅用 provider 词时间戳生成句子级字幕与精确 UTF-16 词级 offsets（句末标点、>1000ms 间隔或 240 字符切句）；非词级单元、多词元单元、重叠/越界时间必须 fail-closed（`MEDIA_WORD_TIMELINE_INVALID`），不得用平均分配等估算补齐播放时间轴。`media-processing` 以独立小 DTO 透传 words 并做结构校验，`validateSegmentTimeline` 在候选准备、内容审核和发布三处用 `validWordTimings` 严格校验非空时间轴；纯文本 provider 的平均回退保留原有行为但不产生 words。评审与修订 provider 只接收投影掉 `segment.words` 的模型输入（`mediaReviewInputHash` 同步），发布草稿与 contentHash 仍覆盖完整词级时间轴，避免请求体随字幕词数膨胀。历史已发布版本不改写；CLI 修复走 `media_transcript_backfills` 草稿、三维 AI 审核和版本化发布。词级时间轴只在精确 provider 词数据上生成，不能视为对音频内容的独立听审。每日管线发布的外部 signed/动态广告音频仍可能导致播放 rendition 与时间轴漂移，托管到自有 CDN 是后续独立切片。

`LUCIA-BIBLE-RESET-001`（2026-10-16）：Lucía v3 作为新的版本化人物候选保留已发布 Martín 身份，修订完整回应风格；v1/v2 与历史审核不原地覆盖。新修订的 `profile.canonPolicies` 保存按事实键和事实版本绑定的 category/reveal/audience/trigger，不新增表或修改旧事实行。resolver 校验后将公开 identity、traits 及事实策略投影为内部 DTO，旧记录无策略仍按 `never` 处理。两个 provider 的共享 `characterContextForProvider` 在指令和序列化正文前移除 never/敏感事实：contextual 需当前消息匹配已编写主题，gradual 与 relationship audience 需熟悉阶段；这是一项保守的有界规则，不等于理解任意 trigger 或已向用户披露。普通聊天、主动消息生成、预览和定时 runner 统一消费服务端解析的已发布快照，主动消息缺少快照时失败关闭。初识阶段的共享提示禁止亲昵称呼、预设共同回忆或线下见面，角色兴趣不强制成为话题。新发布审核使用明确 AI 身份 `dsh-ai-owner-authorized-review`，保留旧审核身份。初识 authored opening 保留原幂等键，事务锁定会话后仅在没有任何消息时补写自然介绍；已有聊天缺少开场标记也不追加。首次用户消息完成前不发送日常主动消息。真实发布、指定用户重置和首条消息到达必须分别核验，见[交接](reviews/LUCIA-BIBLE-RESET-001.md)。

`READ-LOAD-001`（2026-10-16）：公共文章目录的 `ReadShelfData` 将 repository 创建、首次列表读取和页码收敛后的第二次读取故障转换为独立不可用界面，不伪装成功零结果、不回退本地 bundle、不把底层 SQL 错误传给客户端。客户端重试在 transition 中刷新当前 URL，保留搜索、筛选与页码并禁用重复点击；阅读布局导航保留。成功读取、公开/私人可见性、服务端缓存及数据库连接策略不变。界面恢复能力不代表数据库连通，真实故障需分别核验。

`CHAT-CONTINUITY-001`（2026-10-16）：两个聊天 provider 共用的 system 规则明确当前 `userMessage` 优先于旧话题和角色兴趣；模糊肯定不构成选项选择，“去上班”不等于“已下班”，角色提议不是用户已完成的经历。纯 TypeScript `conversation/domain/reply-continuity.ts` 独立检查角色在当前当地日已问过的泛化当日安排与散步/居家选择，补足原 `openTopics` 只投影用户提问的覆盖缺口，不更改该 DTO 的含义。追问可继承用户明确的新时段；主动重问/求建议有受限豁免，相关问题预算允许一个实质问题，身份/困扰/告别等严格规则仍优先。重问时短语复用检查仅豁免问句，未知时间戳不猜测为同日。另外检查有限的“咖啡提议变成用户已喝”及“未指定周末工作变成周六/周日”断言，不能视为通用事实验证。命中时沿用一次有界 provider 重生成和既有观测，仍失败则不发送回复正文或 done。规则只覆盖明确西语模式，不能保证任意回复都语义贴合。已发布人物圣经、角色身份/记忆/证据、公共契约与数据库不变，日志不新增正文。详见 [交接](reviews/CHAT-CONTINUITY-001.md)。

`CHAT-ASSIST-003`（2026-10-16）：002单输入框方案已批准并实现。`VoiceComposer`复用当前草稿，在同一输入栏内放置「译」，结果以输入框上方的局部预览按需展示，只有「使用」才替换草稿并恢复输入焦点，仍须显式发送；移除独立中文输入、常驻入口行、标题及说明，继续不显示辅助标注。生成中的原入口显示可取消状态；失败保留原稿并局部重试。源文/角色/版本/可用性变化在layout cleanup取消请求和朗读，结果绑定本次原稿，关闭后恢复原文也不能复活旧预览。输入框使用可释放的ResizeObserver按宽度重算高度（上限120px），避免窄屏换行截字；翻译/发送/停止回复共用末尾操作组。复用001服务端门禁、统一TTS、来源/队列/重试与隐私边界，无API/provider/数据库/评分变更。当前交互与验证见[003交接](reviews/CHAT-ASSIST-003.md)，下文001/002为先前阶段记录。

`CHAT-ASSIST-002`（2026-10-16）：依用户要求，输入区及发送/历史消息不再显示“翻译辅助”标注；内部来源、队列/重试和无能力证据边界保留。单输入框加临时预览的简化方向已形成[调研提案](reviews/CHAT-ASSIST-002.md)，尚未替换001面板，无API/provider/数据模型变更。

`CHAT-ASSIST-001`（2026-10-16）：聊天输入区「这句怎么说」调用鉴权 `POST /api/v1/conversations/:characterId/expression-assist`，application 重验当前已发布角色版本与有效联系人，仅通过只读 repository 读取本用户本角色最近6条已完成且未撤回消息（每条最多2000字符，并排除被撤回消息的回复），不读取关系记忆。内部 translation provider 新增中文/混输→es-ES，保留原西→中能力；草稿与预览不写消息、记忆、能力证据或普通日志。文本及这段上下文会发送至 MiniMax；点击「听一遍」经统一鉴权朗读再发送西语文本。供应商调用仅记录请求关联、模型、状态、延迟与费用等元数据。

辅助接口严格校验DTO、16KiB流式请求体与30秒总截止，成功/失败均 `private, no-store`。鉴权与门禁后使用HMAC用户/角色/版本/attempt隔离的进程内singleflight，成功结果最多保留30秒、128项/512KiB；同attempt异文409、满载429，失败清除，最后等待者取消底层调用。该机制不保证跨进程/重启幂等，取消不能撤回已发生的供应商费用。客户端独立30秒截止并隔离旧generation；改源文、关闭、发送/录音、切角色/账户、隐藏或离开页面时取消并清除预览/朗读。仅显式填入可编辑草稿，显式发送才保存消息；有效预览后本轮即保留辅助来源，关闭后口述、排队和重试也不丢失，以既有 `source_type=translation_assisted` 保存，无迁移。当前普通聊天不产生学习证据，缺失客户端辅助声明不能作为独立能力的证明。验证及隐私/部署限制见[交接](reviews/CHAT-ASSIST-001.md)。

`MEDIA-SERIES-006`（2026-10-16，采集建议）：`content-acquisition` 仅取 RSS/LR 现有播客结构字段，经 `media` 同步 application/schema 生成确定性 key、仅 unconfirmed 的建议并放入候选 `metadata.mediaSeriesSuggestions`；与 draft 分离，不进入正式内容 hash 或系列目录。feed/playlist 不自动证明系列，缺 ID/title 为空、冲突保留 warning，未知季集 null/0合法；LR 混合目录只作证据，合法 itunesId 才供节目身份。无新抓取请求、来源、公开API或迁移；内部 owner-workflow JSON Schema可选描述此metadata，完整URL/文本语义由media验证。原source事务、candidate revision/generation与审核发布门禁继续适用；确认走既有所有者media用例/CAS/审计。历史重复候选不自动回填。验证及范围见[006交接](reviews/MEDIA-SERIES-006.md)。

`MEDIA-SERIES-005`（2026-10-16，换批多样性）：仅 `browse` 以 repository 私有来源身份进入纯领域双层轮换，来源间轮换、来源内系列轮换，组耗尽后继续补齐所有合法媒体；无系列每项独立。合法 YouTube channel ID、规范化且 hash 的 HTTPS RSS、已登记 LR 混合目录构成来源键，缺失/无效/凭据来源按稳定媒体 ID 独立回退，不按显示名称归组。游标明确绑定来源、seriesKey 和目录 revision（含 exclude 成员），不绑定私人进度；无新增公开 DTO/API 字段或迁移。普通 list 排序、系列页/选集顺序不经过此分散。样例和验证边界见[005交接](reviews/MEDIA-SERIES-005.md)。

`MEDIA-SERIES-004`（2026-10-16，视频播后推荐）：工作台以本次播放器 ended 维护独立完成状态，不从历史进度推导；主列播放器下方、字幕区外挂载只读推荐，最多六条同系列其他视频及“查看全部”，点击才切集。同步 failure ref 清除失败时的完成状态并拒绝恢复前迟到 ended；重播/seek 回内容区、媒体版本/资产/播放器实例变更及卸载清除展示并取消请求，adapter generation 拒绝旧 SDK 回调。请求经既有鉴权窄 API 与 Zod 复核，20 秒截止、局部失败重试、纯 reducer generation 隔离；microtask 前检查取消，StrictMode 同步卸载不创建重复网络请求。推荐不依赖进度保存，不写完成/能力证据；无系列/空结果隐藏，播客只保留选集。后端按既定 ordered/episodic 顺序读取当前可见版本，不按观看记录改序。专项验证与边界见[004交接](reviews/MEDIA-SERIES-004.md)。

`MEDIA-SERIES-003`（2026-10-16，导航集成）：单集卡片保留原播放入口，另以相邻链接进入 `/learn/series/[seriesKey]`；系列页和视频/播客选集通过已有窄 API 读取可见数量、分页、当前集 anchor 与前后邻接，不读取字幕。桌面局部面板、手机有焦点限制/恢复和安全区的抽屉；首次按当前稳定 ID 定位晚页，点击才切集，无自动连播。客户端 Zod 保留列表的可选/可空系列摘要；专用读取校验系列/类型、去重与分页一致性，20 秒截止、取消、generation 隔离和游标失效重读均局部恢复，不阻塞原播放。原媒体 repository 对列表/换批/详情/播放批量查询 active 系列摘要，放在原目录缓存之外；目录 revision 不修改媒体内容版本、字幕、进度或证据。E2E 内存仓库仅限非生产且显式 AUTH_E2E_ENABLED，窄卡片不调用字幕/播放读取，fake 写入恒定拒绝。验证与边界见 [003交接](reviews/MEDIA-SERIES-003.md)；浏览多样性和采集建议继续按005–006推进。

003 手机选集的 portal 挂在触发按钮所属 `.product-shell` 下继承主题变量，避免脱离产品壳后出现错误配色；关闭后以 `focus({ preventScroll: true })` 恢复原按钮焦点，选集定位只滚动自身容器。

`TTS-READALOUD-001`（2026-10-16）：当前全站合成朗读标准由 [ADR-0019](adr/0019-unified-minimax-read-aloud.md) 取代下文历史任务中的浏览器TTS选择。统一 `createReadAloud` / `useReadAloud` → 鉴权 `/api/v1/tts` → application → 内部 MiniMax provider；固定 Serene Woman / speech-2.8-turbo / 合成速度1，播放速率可调。客户端串行分段、playing确认、取消和资源释放；服务端 HMAC 用户隔离的128项/32MiB内存缓存，成功10分钟、失败30秒定时释放，不持久化文本或音频、无公共缓存。停止只取消等待，不撤回已发送的付费任务；进程间/重启后不保证去重。请求文本含私人内容时也发送供应商，隐私和费用限制见ADR。真实媒体/Tatoeba原声保留，不写学习证据。

`TTS-LATENCY-001`：超过300字符的合成文本先请求最多180字符首段，之后保持1000字符上限，无预生成。每个共享客户端控制器仅保留成功完整播放的最多8段/4MiB音频，最后播完后60秒定时清除；同控制器短期重播省去HTTP/鉴权/下载。内存不跨控制器共享、不持久化；stop/卸载、隐藏/pagehide、退出和后续Supabase会话事件清空并取消，闲置过期后释放会话订阅/监听器。首次与不同文本仍受网络和供应商影响，长文段间仍按需等待；播放速率不改变缓存音色。详见[性能交接](reviews/TTS-LATENCY-001.md)。

`MEDIA-SERIES-001`（2026-10-16，基础代码已实现，未应用真实迁移）：[ADR-0018](adr/0018-media-series-directory.md) 与[系列规格](superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)的系列目录由 `media` 所有，三表为独立目录、稳定媒体ID成员关系和追加审计；目录 revision 不重写不可变媒体版本、字幕、审核、进度或证据。纯领域规则和严格 Zod 命令经 application 进入专用 repository，所有者 allowlist 在 HTTP/application/repository 重验；单事务目录锁、双方 revision 与幂等哈希处理创建、改序和显式跨系列移动。三表 RLS 默认拒绝客户端访问，写审计禁止更新、删除和清空。

已实现鉴权 `GET /api/v1/media-series/:seriesKey`、`GET /api/v1/media-series/:seriesKey/episodes`、`GET /api/v1/media/:stableKey/series-recommendations` 及所有者 `PUT /api/v1/internal/content-workflow/media-series/:seriesKey`，同步 DTO、JSON Schema、OpenAPI 和稳定错误码；成功及失败均 `private, no-store`，显式无效 Authorization 不回退 cookie。请求仅携带目录元数据，写 body 有 1MiB 上限；原媒体 DTO 增加可省略/可空系列摘要，以兼容旧响应。

窄 SQL 同一快照计算当前可见数量、最多50条分页、anchor 与前后集，不读取字幕；重验 currentVersion、发布、清权与有效资产，用户进度只按本次 UUID 关联，不放入全局系列缓存。cursor 绑定目录 revision、页大小和可见当前版本集合；推荐最多6条同系列其他 video，有序后续集优先。无归属可播放媒体返回成功空推荐，当前媒体不可见404，读取失败503。归档仅隐藏系列入口，不撤下单集。库存归类/导入、卡片系列入口、系列页/选集与当前视频有效 ended 后的下方推荐 UI 尚未实现，分别按[实施计划](plans/2026-10-15-media-series-implementation-plan.md)继续002–004；浏览多样性和采集建议仍为后续切片。验证与限制见 [001交接](reviews/MEDIA-SERIES-001.md)。

语料长段显示规则（同 `CORPUS-REDESIGN-001`）：API仍返回完整原段及同版本前后文；UI纯函数 `corpusArticleExcerpt` 对超过360字符且无译文的文章按西语句界显示完整命中句，多个命中保留连续跨度，默认浏览显示前两句。朗读/临时对照使用显示句，展开使用原段；已有段落译文、单句或不支持分句时全文保留，不创建或改写内容版本。

`CORPUS-REDESIGN-001`（2026-10-15，ADR-0017）：`/read/corpus` 以完整原段/字幕为主体，独立 `CorpusWorkbench` 调用鉴权只读 `/api/v1/corpus/examples`，application + 专用repository直接检索当前可见原文，不依赖旧出现索引。单条SQL重验发布/版权/字幕审核/私人文章所有权，文章最新已发布版本、媒体currentVersion，窗口函数取得同版本可见前后文；按片段轮次、各类型文档轮次、类型交错分页，计数与内容同一快照。参数/DTO/JSON Schema版本化，private/no-store；旧search/browse API保持兼容。媒体已有译文可隐藏，浏览器合成朗读与临时最多三条对照无存储/证据写入。文章来源URL包含 `stableKey@version`，显式段落锚点与媒体时间/稳定字幕index优先旧进度。真实库约49,247条，分页允许至100,000页而非旧1,000页上限；无需迁移或新增provider。

`PHRASE-CONTENT-003`（2026-10-15）：当前短语UI明确读取 `lexicon-corpus/content/phrasebook-v3.ts` 的120条，六主题各20条，新增60条经过独立双维AI复核并绑定7个内容依赖哈希。历史v1/v2及其审核保持原值；`phrasebook.ts` 已被v2审计绑定，保留为v2兼容入口。对话逐句、主表达和自测共用一个浏览器TTS实例；仅播放当前西语，条目因取消收藏或外部存储变化离开可见列表时也停止。仍不访问数据库或写入能力证据。

`PHRASE-CONTENT-002`（2026-10-15）：当前短语手册通过稳定入口 `lexicon-corpus/content/phrasebook.ts` 读取 v2 的60条；v1的24条及审核冻结，新增36条独立双维复核并绑定全部内容依赖哈希。主题计数由内容派生，收藏继续使用原v1存储键和稳定ID。自测参考句与核心句分别调用已有浏览器TTS，切题/退出/收起正在朗读的核心句时停止；不新增API、数据库或评分证据。

`PHRASE-REDESIGN-001`（2026-10-15）：`/read/phrases` 依照 ADR-0016 改读 `lexicon-corpus/content/phrasebook-v1.ts` 的 24 条原创、双维度独立审核内容，通过 domain Zod 与审计哈希校验。SSR 仅取得当前用户和初始搜索，不发起语料数据库扫描；客户端提供主题、搜索、渐进展开、本地收藏和无评分回想。收藏 localStorage key 按服务端用户 ID 隔离，无云同步；它是个人偏好，不是能力事实。朗读复用现有浏览器 TTS。旧 `PhraseLibrary`/`PhraseShelfData` 仅为旧协议兼容代码，不再挂载于当前路由；真实来源比较仍属于 `/read/corpus`。公共 API、DB、RLS、内容索引和评分边界保持。见 `docs/adr/0016-practical-phrasebook.md`。

- 状态：实施基线
- 适用范围：个人 Alpha
- 详细产品要求：[设计规范](superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- 当前客户端设计：[Web 优先的个人学习产品与场景实战设计](superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)
- 当前内容与学习入口设计：[自动内容供应与词句学习重构设计](superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)
- 决策记录：[ADR-0002](adr/0002-web-pwa-first-personal-alpha.md)、[ADR-0008](adr/0008-content-led-learning-and-automated-ingestion.md)
- 历史多平台设计：[Web 与 Flutter 多平台架构设计](superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md) 与 [ADR-0001](adr/0001-nextjs-web-flutter-clients.md)

## 1. 架构目标

个人 Alpha 使用单仓库、一条活动的 Next.js 响应式 Web/PWA 客户端代码线和一个远程 Next.js/TypeScript 模块化单体。桌面浏览器与 iPhone Safari 共用 React 页面和服务端能力。已有 Flutter/Dart 代码保留但暂停同步。目标是在不提前拆微服务的前提下，让训练、场景实战、评分、画像、推荐、角色、记忆、平台能力和供应商集成保持清晰边界，可以独立测试和替换。

架构优先保证：

- 训练流程可恢复、可测试。
- 学习证据可审计、画像可重算。
- AI 与语音供应商可替换。
- 角色记忆不会越权共享。
- 技术故障不会污染能力评分。
- 桌面与 iPhone Safari 使用同一服务端 API、内容版本和业务语义。
- 版本化 API 与稳定错误码继续保留，为未来恢复其他客户端留出边界。
- iPhone Safari 的麦克风、键盘、安全区和 PWA 生命周期必须真实验证。
- 每日内容供应可恢复、可幂等、受预算控制，并且只能进入所有者候选审核库。
- 视频/播客、文章和词句语料通过版本化位置 DTO 互通，不合并为失去职责边界的通用内容表。

## 2. 运行时视图

```text
Next.js 响应式 Web / PWA
  ├─ 桌面 React 页面与组件
  ├─ iPhone Safari / 主屏 PWA
  ├─ 浏览器 TTS、录音、权限
  └─ Web 平台适配器
             │ HTTPS / NDJSON
             ▼
远程 Next.js 模块化单体
  ├─ Route Handlers：鉴权、校验、协议转换
  ├─ Application：用例编排与事务边界
  ├─ Domain：纯服务端业务规则
  ├─ Repository：数据库访问接口与实现
  └─ Provider Gateways：STT、发音、LLM、TTS、地点
            │
            ├─ Supabase PostgreSQL / Auth / Storage
            └─ 外部 AI、语音与地点供应商

定时 CI runner
  └─ TypeScript acquisition CLI
             │ application ports
             ▼
      同一个远程模块化单体与 PostgreSQL 工作记录
```

长时间来源抓取、媒体处理和 ASR 不在 Vercel Route Handler 内执行。调度器只负责触发仓库内 CLI；业务规则、幂等和事务仍位于 application/domain/repository 边界，不因此形成第二套服务。

## 3. 目录与职责

```text
app/
  (auth)/                 # 登录与账号页面
  (product)/              # 学习、阅读、探索、对话、我的
  api/                    # 薄 Route Handlers
src/
  modules/
    content/              # 内容图谱、导入、发布与文章查询
    content-acquisition/  # 白名单来源、增量运行、候选、处理与审核编排
    media/                # 视频/播客版本、播放资产、片段与用户进度
    lexicon-corpus/       # 词元、短语、出现位置、语料查询与文字考察
    explore/              # 场景/表达发现、搜索与轻量选择策略
    scenario-practice/    # 私人场景、临时人物、实战、复盘与复现
    training/             # 训练计划、状态机、断点
    evidence/             # 评估结果、证据强度、事件写入
    profile/              # 技能快照、场景状态、进步解释
    recommendation/       # 历史断点、到期复现与渐进式建议排序
    characters/           # 人物圣经与固定事实
    memory/               # 关系记忆、权限、冲突检查
    conversation/         # 对话、回复规划、消息流
    providers/            # 外部供应商适配器
  shared/
    auth/                 # 服务端身份解析
    db/                   # Drizzle 客户端与共享事务工具
    validation/           # 通用 Zod 工具
    observability/        # 日志、追踪、调用成本
    ui/                   # 无业务含义的基础组件
apps/
  mobile/                 # 已有 Flutter 客户端；当前暂停功能同步
contracts/
  openapi/                # 版本化 API 规范
  fixtures/               # TS/Dart 共同读取的一致性样本
content/                  # 版本化内容源
drizzle/                  # 数据库迁移
tests/
  fixtures/               # 固定音频、文本、角色和证据样本
  contracts/              # 供应商与协议契约测试
  e2e/                    # Playwright
```

现有 Next.js 根工程暂不整体搬入 `apps/web`。只有独立部署或工具链冲突证明迁移有价值时，才另写 ADR。

## 4. 分层规则

每个业务模块可以包含：

```text
domain/          # 纯 TypeScript 规则，不访问 IO
application/     # 用例编排、权限、事务和端口调用
repositories/    # 数据访问接口及实现
schemas/         # 外部输入和持久化边界校验
ui/              # 模块专用 React 组件
```

活动客户端只使用 TypeScript/React。已有 Flutter 代码不得直接导入服务端 TypeScript；未来如恢复多客户端，仍通过版本化契约和 fixtures 对齐，而不是复制数据库行类型。

依赖方向：

```text
UI / Route Handler → Application → Domain
                         │
                         ├→ Repository interface → DB implementation
                         └→ Provider interface   → Vendor adapter
```

硬性规则：

- 服务端 `domain` 不导入 React、Next.js、Drizzle、Supabase SDK 或供应商 SDK。
- Route Handler 不直接实现评分、推荐或记忆规则。
- React 组件不直接写数据库。
- 浏览器客户端不直接写证据、画像或关系记忆。
- 模块不能直接更新其他模块拥有的表；必须调用对方 application 接口。
- `shared` 不能反向依赖任何业务模块。
- 跨模块共享的数据使用小型显式 DTO，不导出内部数据库行作为公共 API。

## 5. 模块所有权

`MEDIA-PLAYER-002`：媒体适配器由 React 持有稳定宿主节点，Plyr 输入及其克隆/包装节点由单次资源生命周期管理。来源切换创建新输入；状态、位置、错误和端口通知使用最新回调，不因 callback identity 或刷新后的进度 DTO 重建播放器。generation、取消和卸载清理继续隔离旧事件；播放器内置自动暂停是唯一可见入口，不再依据控件挂载状态恢复旧复选框。

`MEDIA-WORD-001` / `MEDIA-WORD-002`：字幕点词 UI 复用 `reading` 审核词表与 `lexicon-corpus` 的既有鉴权词典 DTO，通过 `request-word-lookup.ts` 做客户端 Zod 协议校验；不从媒体组件直接读取数据库。`request-word-explanation.ts` 复用既有阅读语境解释端点；按 2026-10-15 用户要求，点词立即并行请求词典和公开字幕语境解析，无二次生成操作，相同选择重渲染不重复请求。NDJSON 必须收到合法 done，取消释放流 reader。选择以词/原句为生命周期边界，词典/解释分别 20/30 秒截止；失败仅手动重试，旧请求与 TTS 回调不改变新选择。保留朗读按钮、字幕原句及 AI 例句身份，去掉闲置朗读、缺词和按需生成提示；自动结果通过礼貌播报呈现，不移动键盘焦点。词音复用浏览器 es-ES TTS，不创建音频文件，原句和临时解释不写普通日志、个人状态或能力证据。语料查询复用 `/read/corpus?q=…&match=surface`；本任务无新公共接口、数据模型或供应商。

| 模块 | 拥有的规则 | 主要数据 |
|---|---|---|
| content | 内容版本、审核、图谱和发布 | expressions、tags、scenarios、content_packs |
| content-acquisition | 来源白名单、游标、候选、处理步骤、权利/预算门禁和所有者审核投影 | acquisition_sources、acquisition_runs、content_candidates、candidate_artifacts、candidate_processing_attempts、candidate_reviews |
| media | 视频/播客稳定身份、不可变版本、播放资产、定时片段与用户进度 | media_items、media_versions、media_assets、media_segments、user_media_progress |
| lexicon-corpus | 词元/词形、正式与私人短语、出现位置、KWIC、个人复习意图和文字考察 | lexemes、lexeme_forms、phrase_entries、phrase_variants、corpus_occurrences、user_lexical_intents、lexical_assessment_items、lexical_assessment_attempts |
| reading | 阅读断点、用户标注、保存和外部来源元数据 | user_reading_progress、user_article_saves、user_article_highlights、user_saved_article_sources |
| explore | 场景与表达搜索、来源筛选、资格过滤和可解释的场景选择 | 默认不拥有持久表，通过只读端口读取场景目录和用户投影 |
| scenario-practice | 私人表达收藏、私人场景、临时人物轮次、条件变化、复盘和复现 | user_saved_expressions、personal_scenarios、scenario_session_states、scenario_turns、scenario_turn_reviews、scenario_repetition_items |
| training | 当前训练计划、状态机和断点 | practice_sessions、practice_attempts、learning_breakpoints |
| evidence | 尝试评估和证据强度 | evidence_events |
| profile | 技能快照、场景状态和四板块能力解释 | user_skill_states、user_scene_states |
| recommendation | 候选排序与下一动作 | 默认不拥有持久表，读取其他模块投影 |
| characters | 人物圣经、固定事实、揭示策略和跨修订身份 | characters、character_canon_facts、character_identities |
| memory | 关系记忆、共享权限和冲突 | relationships、memories、permissions |
| conversation | 会话、消息和回复生命周期 | conversations、messages |
| providers | 供应商适配、用户能力偏好和统一错误 | provider_calls、user_provider_preferences、audio_assets |

## 6. 关键领域边界

### 6.0 内容采集、正式内容与语料隔离

`YOUTUBE-EXACT-001`：YouTube来源可选`rightsPolicy.allowedVideoIds`将同一适配器切到精确ID元数据模式（1–2条），直接访问官方videos.list，完全不依赖最新feed或发布时间。共享原有频道/公开/嵌入/语言/地区/时长/许可门禁；返回ID必须属于本次请求页且不得重复。中间游标绑定mode/version/sourceStableKey/channelId/有序ID列表/offset，末页null用于下轮重验；模式或配置失配在网络前拒绝，不自行扩大或重置范围。`runAcquisitionSource`在外部await后重验取消再调用原有原子候选/游标提交，source revision CAS仍由repository持有；不新增DB边界、公共DTO或处理授权。兼容和继承的稳定key大小写限制见[精确发现交接](reviews/YOUTUBE-EXACT-001.md)。

`MEDIA-RIGHTS-001`：`media-processing` 的纯领域授权判定与Zod边界共用显式 `rightsPolicy.mediaProcessing`；来源verified不代表允许音频取得、ASR或翻译。`processMediaCandidate` 固定要求 `shared-learning` 受众，逐次重读来源/候选，校验候选自身权利、sourceId、revision/generation和来源revision，再由编排器预检实际操作链，并在每次外部处理前后及临时音频删除后重验授权/截止/取消。旧来源缺字段只暂停新增处理；不回填授权、不改变已发布播放。沿用候选CAS防止旧generation回写；来源复验与候选CAS尚非跨表原子事务，最后一次观察之后的撤权存在竞态窗口，不声称实现原子撤权。详细字段、兼容与验证见[处理权利交接](reviews/MEDIA-RIGHTS-001.md)。

`LEARN-BROWSE-001` 的 `POST /api/v1/media/browse` 是鉴权只读查询。Route 校验 `mediaBrowseQuerySchema`，application 调用 media repository；repository 从完整已发布、版权清晰、当前可播放目录投影候选并保留全部筛选，绕过普通目录的十分钟缓存，再交纯 TypeScript `selectMediaBrowsePage` 按固定 seed 来源轮换、排除最近展示 ID 与生成绑定候选集合的游标。只对本页版本读取当前用户进度，公共候选不缓存私人进度。目录成员/版本变化后返回既有 `VALIDATION_FAILED`，客户端提示换批；无写入、事务或新表。该能力不依赖 recommendation、content-acquisition 或供应商。

浏览模式由页面 `view=browse` 标识，正常时间排序 API 不变。可取消客户端编排以 generation 隔离换批、频道、翻页、预取及恢复；浏览器历史仅存最多 1000 个公开稳定 ID、seed、筛选、页数（最多恢复 100 页）和位置，返回时重新请求并鉴权，不存私人卡片进度。显示状态不作为学习证据。`topic` 在页面和普通列表 API 也完整转发，避免保存的筛选在换批/搜索后丢失。

`content-acquisition` 只负责白名单来源、增量游标、发现、去重、初筛、处理编排、成本门禁和候选审核状态。它不能直接把候选标为正式文章或媒体，也不能写学习证据。每日自动化最多推进到候选审核库；正式 publisher 必须调用 `content`/article 或 `media` 的 application，并再次验证权利、两个审核维度、结构、哈希和 revision。`content_candidates.publication_status` 与采集状态独立，只保存正式模块返回的版本引用、发布时的候选 revision/hash 和撤下时间；正式内容实体仍由 article/media 模块拥有。

所有者工作流通过服务端 `CONTENT_WORKFLOW_OWNER_USER_IDS` UUID allowlist 授权。页面隐藏只改善信息架构，每个 Route 和 application 都重新验证所有者身份，客户端角色字段不参与授权。审核按候选 revision 保存，`content-es-ES`、`teaching-zh-CN` 和结构结论不能互相替代；重新处理创建新 generation/revision 并保留旧备注。`ARTICLE-001`、`VIDEO-001` 与 `PODCAST-001` 已分别注册 article、YouTube video 和 podcast publisher。publisher 必须原子创建不可变正式版本；若随后工作流 CAS 失败，application 调用撤下补偿，避免半发布投影。

文章 RSS 使用 `saxes` 解析 XML，文章页使用 `parse5` 生成不执行脚本的语法树。两层请求都只允许 HTTPS，并在每次重定向重新校验显式主机 allowlist、Content-Type、Content-Length、流式读取上限和字符编码；默认测试通过 fixture/fake fetch，不访问公网。文章来源的 `rights_policy` 必须明确 `contentMode=full_text`、许可、署名、许可证据、文章主机和教学默认字段。采集适配器把清洗后的纯文本段落和内容哈希写入候选 metadata，处理用例只把字段与哈希完全一致、权利已验证的文章推进到 `review_ready`。

article publisher 不直接由 `content-acquisition` 写表，而是调用 `content` application/repository。事务内创建或复用稳定文章身份、追加不可变 `article_versions`、保存来源候选 revision、抓取时间和两份 owner-authorized AI 审核记录（原样回显门禁校验通过的 `reviewer_reference`，因此历史 `codex-ai-owner-authorized-review` 与当前 `dsh-ai-owner-authorized-review` 记录都不会被平台身份改名）。公开查询只投影 `published` 且版权为 `cleared` 的版本；撤下只修改公开状态并保留来源、版本和审核审计。

YouTube 频道适配器只读取官方 Atom feed 和 Data API v3 元数据。频道来源必须为已启用、已验证的西语 `video-channel`，并在 `rights_policy` 中明确官方嵌入、许可/授权证据、地区、CEFR、主题和时长边界；API key 只从服务端 `YOUTUBE_DATA_API_KEY` 读取。适配器用 ETag/Last-Modified 和发布时间/视频 ID 游标增量发现，只接受频道一致、公开、可嵌入、目标地区可用且语言/时长合格的视频；Creative Commons 来源还要逐条验证平台许可。它不下载 YouTube 音视频，也不调用非公开字幕接口；没有合法字幕时只生成可播放候选。

video publisher 调用 `media` application/repository，在单一事务内追加不可变 `media_versions`、官方 `youtube-nocookie.com` 播放资产、可选的已审核字幕时间轴、候选 provenance 和两份 owner-authorized AI 审核记录（原样回显已通过门禁的审核身份，不改写历史 `codex-*` 记录）。同一 candidate revision/hash 幂等返回原版本，哈希不一致时冲突；撤下同时归档版本、撤下播放资产并清除当前公开版本。

播客 RSS 与文章 RSS 共享 `saxes` XML 解析和有界 HTTPS 获取边界。来源必须是已启用、权利已验证的西语 `podcast-feed`，并显式列出 feed、episode、音频和可选 transcript 主机，以及许可、署名、证据、时长、体积、CEFR、主题和播放校验有效期。适配器用 GUID、规范化 episode URL 与确定性内容哈希形成候选；enclosure 只发起逐跳 allowlist 校验的 `HEAD`，验证 Content-Type 和 Content-Length，不在发现阶段下载音频。只接受来源声明的西语 `text/vtt`，解析失败或没有合法 transcript 时形成无逐句文本的可播放候选，不调用 ASR。enclosure 或已声明 transcript 的网络、`429`、`5xx` 错误会中止本轮并保留游标以便重试；永久 4xx、格式或权利错误才跳过或降级。

podcast publisher 在播放校验未过期时调用 `media` application/repository，原子保存 feed/GUID/enclosure URL 哈希、带有效期的音频播放资产、可选已审核 transcript 时间轴和两份授权 AI 审核记录（原样回显已通过门禁的审核身份）。原始 enclosure URL 只存在服务端候选和播放资产，不写普通日志；公开投影仍受发布、版权、资产可用性与有效期共同约束。撤下会归档版本、标记资产为 `withdrawn` 并移除当前公开版本，保留来源和审核审计。

文章继续由现有 article 表族拥有；视频和播客由 `media` 共享稳定身份、版本、资产和定时片段；旧 `content_packs` 冻结为历史兼容载体，不为新媒体增加字段。`lexicon-corpus` 通过只读投影索引已发布 article/media 版本，不修改来源内容。

跨内容引用使用显式版本 DTO：`ContentDocumentRef` 区分 article/media，`SourcePosition` 区分段落/片段和媒体毫秒。撤下内容必须从公开目录和语料索引消失，内部审计引用可以保留。

长任务由定时 CI runner 调用 TypeScript CLI。每次运行/步骤携带 `runId`、`jobId`、`generationId` 和 revision；游标只在已承诺写入完成后推进。Route Handler 只承担所有者短操作，不承担抓取、下载或 ASR。

### 6.1 学习、阅读与能力入口

`VOCAB-SHELF-001` 加载故障续修：参考词表与释义来自已保存内容资产，语料例句是可选附加数据。`load-vocabulary-shelf` application 对例句加载限制为 1500ms，异常/超时/无 DB 时返回同一参考表的完整词架及搜索结果，context/sourceTitle 为 null，展示例句不可用提示；展示 DTO 不编造 occurrenceCount。快速成功保留真实例句，真实搜索空结果保持空态；词频统计的 36h 时效门禁、语料可见性和已有查询缓存生命周期不变。该边界只保证词表与本机默写可用，不把本地展示或标记变成能力事实。

`VOCAB-RECALL-001` 的词架默写是临时自查：进入时从当前渲染词表冻结本浏览器 `familiar` 词及现有释义，以纯 TypeScript `vocabulary-recall` 编排器隔离两种模式的输入、批改、提示、自行确认和重练。React 仅在练习词原行挂载 portal，不把整份词架改成逐词 hydration；退出/卸载恢复原按钮，搜索/用户范围切换重建词架。中文答案只匹配完整释义或明确并列项，未匹配不猜测语义，交给用户对照参考释义确认；自行确认与独立匹配分开显示。查看答案或反馈后修改答案都保留提示依赖。练习时关闭悬浮解释、词卡和自动发音并取消旧声音。答案和反馈只在当前内存会话中存在，退出/刷新即清除；不写 API、用户意图、`evidence_events`、`user_skill_states` 或画像，不自动改变「已知」标记。服务端可信文字考察仍使用 LEX-002 的版本化 assessment/attempt 契约。

词架默写的 Enter 导航使用纯函数选择当前模式/轮次的下一空答案，跳过已填写项并回到前面的漏填项；只检查当前词，空答案或待确认不移动。UI 使用挂载输入框引用同步聚焦，不排队异步焦点回调，模式切换、重练、退出和卸载会释放原输入引用。输入法组合阶段不提交或移动。

`/learn` 是视频/播客目录和媒体学习器，不再读取推荐器生成“开始/继续”任务。`/read` 在文章之外提供词汇、短语、语料和文字考察。`training` 继续提供 attempt、录音、状态机和证据编排，但不再拥有任务式学习首页。

词汇页单词发音遵循 ADR-0013 的 2026-10-13 修订与 ADR-0019 的统一合成朗读：手动朗读和点词自动发音均只读显示词本身，不请求媒体 word-audio/切片。准备可取消，start 后确认朗读，结束复位，错误/超时可重试；generation 隔离，切词/关闭/Escape/隐藏/卸载停止，例句与词音互斥。2026-10-20 所有者要求词卡不再显示“合成音 · 准备中…”/“合成音”状态行：加载、播放与停止只由按钮的停止标签、`aria-busy` 与 `aria-pressed` 表达，失败仍在词卡内显示可重试提示；不把合成声音称为真人、母语者或标准发音。旧服务端解析接口保留兼容；本修订无供应商、DB 或能力证据变更。

词汇侧栏的 Tatoeba 例句录音遵循 ADR-0015：官方导出预先按 sentence ID/audio ID 配对，独立元数据资产保存各录音作者、许可及署名；查词 DTO 补充可空 `audio`，运行时不请求外部元数据。点击才流播官方完整录音（`api.tatoeba.org/v1/audios/{id}/file`），未知/空许可不复用该录音。缺少可用授权录音时提供按钮标注“合成朗读例句”的浏览器西语 TTS，例句旁不单列“暂无录音”提示（2026-10-18 所有者要求移除该行）；原声播放失败不自动改用合成音。点击播放按钮不显示准备/加载/播放状态文案（2026-10-18 所有者要求），状态只由按钮图标、停止标签、aria-busy 与 aria-pressed 表达；原声只有实际媒体进度才确认播放中，加载或中途停滞均有 20 秒无进度超时。TTS 复用 `useBrowserSpeech`，可选 start/end/error 回调按 generation 隔离，例句错误落在对应行；只有确认 start 才把合成朗读按钮视为正在播放。失败重试与复制反馈仍可见。词音与两种例句音互斥，共用词架取消生命周期；切词、关闭、隐藏或卸载均取消并释放事件/计时器/src。播放或复制不写学习证据；没有新供应商或录音存储，元数据构建无需数据库写入。

`media` 的公开列表和详情只投影当前 `published + cleared + playable` 版本，稳定引用为 `stableKey@version`。播放接口要求用户会话，只返回 HTTPS 播放信息和当前版本的全部已审核片段；临时播放地址过期、资产撤下或版本不可用时失败关闭。旧播客 CDN 地址由鉴权的 Range 代理转发，并在跳转后再次校验允许主机。正式视频和播客详情统一由 `Plyr` 渲染；YouTube、托管视频和播客只把各自的 iframe/HTML5 media node 作为 Plyr 的底层媒体源。它们都通过 play/pause/seek/currentTime/destroy 小型端口驱动同一工作台，并用 generation 隔离旧播放器回调。工作台提供 A/S/D 逐句控制、Q 自动暂停、西语/双语/隐藏字幕和保留上下文的词句抽屉；无已审核 transcript 的播客仍可播放，但逐句控制禁用并明确提示。词义与保存仍由后续词句任务负责。

`MEDIA-SEGMENT-CAP-001`：完整字幕用单次有序查询读取，SQL 限定当前 `mediaVersionId` 与 `approved`，显式选择播放 DTO 所需字段，保留原片段 index、翻译和可空 words；领域层再次过滤审核状态。移除播放查询、领域投影、JSON Schema 三处 500 条截断，不添加字幕分页或静默丢弃词时间轴。进度读取仍与字幕并行并按用户隔离，不缓存私人进度。该修复无需迁移、重新发布或付费转写；未审核尾段不会提前交付。

`MEDIA-SPEAKER-LABEL-001`：导入字幕（`youtube.language-reactor.*`、`podcast.language-reactor.*`）在 `media_segments.speaker` 保存的是 `S1`/`S2` 这类只相对于该份转写的机器编号，对学习者没有含义。播放领域投影 `projectSpeakerLabel` 把它归一为 `null`，字幕行也只渲染归一后的真实姓名，所以客户端 DTO 和任何字幕界面都不会把编号当成说话人。数据库现状保留原值：`speaker` 属于候选内容哈希覆盖的已发布版本内容，本任务不改写历史版本、不新增版本、不要求迁移；真实姓名（若未来来源提供）仍照常显示。

`MEDIA-LOAD-001` 骨架等待续修：完整播放 DTO 仍一次取得且不缓存私人进度；`SegmentTranscript` 首屏只挂载 32 句及当前句前后附近的真实行，余下行以可取消的短任务逐批挂载，完成后全部可读，不截断或分页字幕数据。尚未完成时明确 `aria-busy` 与加载状态，恢复/跳句即使在末尾也立即显示并高亮；隐藏、换版本或卸载取消旧批次。服务端首屏不为全部词生成按钮，播放器无需等待所有字幕行挂载；跟随与逐词刷新语义保留。运行时配置与诊断配置须保持同一环境文件优先级，见数据库连接文档；本机修正不改变托管部署配置。

`MEDIA-LOAD-001`：音视频 Range 代理在鉴权后调用 `getMediaStreamSource`，只用一次无缓存查询解析当前公开可播放版本，返回稳定身份、版本、类型、标题、来源与已校验资产；不访问 `media_segments` 或 `user_media_progress`。每个分段请求重新校验发布、版权、撤下与过期，沿用上游主机/重定向白名单与 Range 协议。完整详情/播放接口仍加载全部已审核字幕和当前用户的进度。卡片不再把封面图片 priority 映射为整页强制预取，使用 Next 默认部分预取与现有详情 loading 边界，减少未选择内容的完整字幕请求。无新公共协议、迁移或证据语义。

`MEDIA-DETAIL-PROGRESSIVE-001`：媒体详情页（`/learn/media/[stableKey]`）不再在返回 JSX 前 `await` 整个 `getPlayback`。页面只 `await params`、校验 stableKey 后立即返回 `<Suspense fallback={<MediaDetailLoading/>}>`，因此直访和客户端导航都会先得到既有详情骨架；真实媒体路径先在服务端读取轻量 overview（当前发布版本/版权/可用/过期/鉴权门禁、卡片、已校验播放资产、当前用户进度、系列摘要与已审核句数，不读 `source_text`/`words`），据此渲染标题、信息与播放器。完整字幕随后由客户端两阶段取得：先 `GET /api/v1/media/:stableKey/playback?include=text` 只取逐句文本（`words` 为 null，Word 时间轴不进入首屏路径），文本可读后再取默认 `/playback` 并只合并 `words`。两阶段都校验 `stableKey`+`version` 与 overview 一致，不一致则报错重试而不是混版本；请求有取消、45 秒超时、StrictMode 去重与旧响应隔离；词级阶段失败不移除已显示文本，只显示可重试提示。播放器的 `hasSegments` 使用 overview 的已审核句数这一稳定值，字幕后到不会重建/中断播放器；`?t=` 深链优先，只有 `?segment=` 时在字幕到达后按其 `startMs` 定位一次。E2E fixture 路径继续在服务端使用完整 playback，不经过后台 fetch。`include` 是可选 query，默认响应与既有契约不变，非法值返回 400；OpenAPI 已同步。无迁移、供应商、评分或证据变更。

`LEARN-NAV-PERF-001`：`/learn` 的完整 24 卡自适应网格骨架从路由级 `loading.tsx` 移入页面内 `<Suspense>`，所以直访与同段筛选/搜索导航仍会流式输出真实资料库骨架；`/learn/loading.tsx` 只保留顶栏占位与“正在打开…”中性壳，仍作为 `/learn` 及其子路由（含 `/learn/media/*`）的已挂载兜底边界，但不再在进入媒体详情时闪出“资料库正在加载”的网格。加载边界保留也意味着 `/learn` 仍可被 Next 预取。资料库卡片保留 `Link` 默认预取，并在 hover（约 100ms 延迟）/focus/touchstart 时调用 `router.prefetch(href)` 做意图预热；使用默认 `auto` 策略只取到详情 loading 边界，不把带用户进度的完整 RSC 缓存进 5 分钟静态窗口；同一 href 去重、离开取消、`onInvalidate` 复位，`useLinkStatus` 在卡片上显示 pending 指示。Next 开发模式的 `createPrefetchURL` 直接关闭预取，因此意图预取的实际效果只能在生产构建验证；开发模式只能验证中性壳/骨架结构与单测调用链。

用户进度绑定具体媒体版本，以 revision/CAS 保存位置并允许相同旧请求幂等重放，不能把过期版本、未审核片段或越界位置写入进度。客户端串行同步最新位置，切换媒体或卸载时取消旧请求，并忽略旧 generation 响应；409 必须要求刷新，普通同步失败只提示可重试，均不写学习证据。`/learn` 在没有正式媒体时显示真实空状态，不用 fixture 或 AI 示例内容冒充已发布素材；视频与播客 E2E fixture 只在非生产且 `AUTH_E2E_ENABLED=1`、命中各自固定 stable key 时可用。旧 `/learn/practice` 保留为兼容 route，但不再从学习首页暴露。

画像主投影为词汇与短语、交流运用、语音表达、跟读表现四个板块。底层 `evidence_events` 和 `user_skill_states` 继续按 skill key 保存并可重算；profile 只做版本化分组和解释。文字考察、文字对话、可信语音和跟读按输出方式进入不同 skill；观看、阅读、查词、收藏和时长均不写证据。

### 6.2 场景实战与长期角色隔离

`scenario-practice` 负责从主题、阅读、收藏表达或最近错误创建私人场景，并编排临时人物多轮实战、完整文字复盘和当天/1/3/7 天复现。它可以引用 `content` 的场景、任务和表达版本，复用 `training` 的尝试、录音和稳定断点能力，并把到期复现投影给 `recommendation`。

临时人物只保存本次会话的人物快照，不创建 `characters`、`conversations` 或关系记忆，也不读取长期角色的关系阶段和私密记忆。只有用户完整表达可以进入评估；自然替代表达可以完成沟通任务。Provider 输出必须经过 Schema 和服务端规则后才能形成证据，技术失败、低置信度转写和打字不得污染口语能力。

详细数据、API、Provider 路由和状态机见 [Web 优先的个人学习产品与场景实战设计](superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)。

### 6.3 Explore 场景选择与首页推荐隔离

`explore` 通过 `POST /api/v1/explore/scenario-suggestions` 提供“适合我的 / 探索新场景 / 随机来一个”。Route Handler 认证并校验请求，application 从公开场景目录和当前用户的只读学习投影组装上下文，纯 TypeScript 策略先过滤发布状态、所有权、可用性、当前稳定断点和难度，再选择一个场景并返回最多两个结构化理由。用户投影不可用时退化为基础建议，不能伪造个性化依据；选择接口只读、不产生证据，也不调用场景生成 Provider。

该策略只解决用户进入 Explore 后“不知道搜什么”的发现问题。它不参与 `/learn` 的媒体目录排序；历史稳定断点、到期复现和跨任务建议可继续由 `recommendation` 供场景历史或其他渐进式入口使用，但不得恢复任务式学习首页。接口不返回候选池、内部权重、原始错误句或完整私人来源，响应使用 `private, no-store`。详细交互、隐私和测试边界见 [Explore 场景建议与随机选择设计](superpowers/specs/2026-09-11-explore-scenario-suggestions-design.md)。

`GET /api/v1/explore/dashboard` 的 `library` DTO 合并可开始的公共/本人私人场景、版本化正式表达、本人收藏、本人阅读选区和可信近期错误。服务端 repository 负责发布门禁、所有权和来源去重；任一私人来源读取失败时保守退化为公共目录，并明确返回 `privateState=unavailable`。浏览器只在这份授权 DTO 上执行纯搜索和筛选，不直接查询数据库，也不能扩大可见范围。搜索使用 NFKD 归一化，忽略大小写、标点、西语重音和重复空格，多词按 AND 匹配；`q` 与 `filter` 写入 URL，以便刷新、前进后退和深链恢复。搜索、筛选和收藏都不产生学习证据。

### 6.4 收藏表达与私人场景生成

`scenario-practice` 通过 `GET/POST /api/v1/expressions/saved` 和归档接口拥有私人表达收藏。客户端只能提交版本化正式表达引用、本人阅读选区 ID、本人场景复盘 ID，或明确标记的手工文本；application 重新解析来源并以 `clientSaveId` 幂等保存，收藏行为不写学习证据。正式公共表达在生产环境仍必须为 `published`，开发环境的草稿预览不会改变公开发布状态。

`POST /api/v1/scenarios/generate` 只在用户确认后调用 `ScenarioGenerationProvider`。输入为主题或当前用户拥有的单个来源 ID；repository 最小化投影文本，application 以请求内容指纹校验 `Idempotency-Key`，再验证 Provider 返回的临时人物、开场、沟通目标、条件变化和表达 Schema，并确认选中的来源表达没有被丢弃。成功结果完整写入 `personal_scenarios` 后才返回，失败不保存半成品。私人场景以 `personal.<uuid>` 作为 Web/API 稳定引用，只能由拥有者读取、归档、开始实战或进入 Explore 建议候选；它保持私人 draft，不进入公共内容 API，也不创建长期角色或关系记忆。

### 6.5 阅读状态与外部来源

`reading` 模块拥有用户阅读私有数据，Route Handler 只负责会话验证、Zod 输入校验和协议转换，application 调用 `ReadingRepository` 完成事务写入。文章正文仍由 `content` 模块的已发布版本提供；阅读表只引用 `article_versions.id` 和内容哈希，不复制公共正文。

词语解释通过 `WordExplanationProvider` 走服务端 provider 边界。`POST /api/v1/read/word-explanation` 接受选中的词语或句子、当前段落上下文、文章语言和 `selectionType`（`word`/`sentence`）；服务端优先从 `content/glossary/es-zh-common-v1.json` 命中已审核的常用词条，未命中时使用 `MINIMAX_API_KEY` 调用 MiniMax M3。MiniMax 请求使用 `stream: true`，Route 以 `application/x-ndjson` 发送 `delta`、最终经完整 Schema 校验的 `done`，浏览器可逐步显示字段；不支持流式 provider 时保留一次性 JSON fallback。浏览器不会接触供应商密钥，阅读器只渲染固定解释字段；句子选择通过拖选正文后立即触发，不在 Explain 面板重复展示上下文。解释结果是临时阅读辅助，不写入 `evidence_events`、`mastery`、`confidence` 或角色记忆；超时、限流、取消、断流和供应商失败只返回稳定错误，正文阅读与本地 glossary fallback 不受影响。

角色对话通过 `CharacterReplyProvider` 走同一服务端 provider 边界。`POST /api/v1/conversations/:characterId/stream` 只把服务端隐私过滤后的角色事实、关系摘要、可读记忆、最近消息、当前用户消息和由最近历史派生的 `alreadyGreetedToday` 交给所选 provider；内部输入 DTO、输出 DTO、错误码和观测字段不随供应商变化。默认仍使用已配置的 MiniMax adapter；只有显式设置 `CONVERSATION_PROVIDER=openai` 且存在服务端 `OPENAI_API_KEY` 时才启用 OpenAI Responses adapter，模型由 `OPENAI_CONVERSATION_MODEL` 指定。模型只返回自然语言消息，应用层继续负责 NDJSON `meta/delta/done`、generation 竞态、取消、完整消息持久化和记忆提取。超时、限流、鉴权、响应损坏或网络失败使用统一错误分类并写入脱敏观测，只发送失败事件，不生成 fallback 角色文本，也不提交完整助手消息或关系记忆；安全门禁拒绝时最多进行一次更严格的 provider 重生成，第二次仍越界则发送失败事件。语言纯度属于安全门禁：回复含汉字、假名或谚文时走同一条拒绝路径，只有用户本轮显式要求其他语言才放行；主动消息没有用户请求可以证明切换，因此由 `isProactiveMessageSafe` 强制纯西语，命中即整条候选失败并记录 `safety-gate`。只有完全没有配置真实 provider 的本地/测试环境才使用确定性回复。供应商不会写入证据、画像或关系记忆，日志不保存 prompt、原始响应或私密正文。角色是否可进入该流程由已发布人物版本和 `CharacterRuntimePolicy` 决定，不能由静态角色目录或客户端 `characterKey` 绕过。

对话工作区通过 `GET /api/v1/conversations` 返回当前用户实际拥有的会话摘要（角色、最后一条已完成消息和时间），不再用角色目录冒充历史。无会话、数据库未配置和请求失败分别呈现为空状态或可重试状态；未读数没有可靠数据来源时不展示。未读以服务端 `conversation_preferences.last_read_at` 为唯一游标：线程加载或轮询成功即确认已读，回执失败重试一次，只有服务端确认后才刷新列表；导航徽标按当前用户所有会话未读之和渲染，并在挂载、`focus`、`visibilitychange` 和每 60 秒重新读取一次（页面隐藏时跳过），所以已读后的红点不会滞留在旧快照上，新生成的主动消息也不必等整页刷新才出现。语音消息使用 `POST /api/v1/transcriptions` 一次性转写为可编辑草稿，音频仅在 provider 请求生命周期内使用并以 `ephemeral` 策略处理，确认发送后仍复用文字对话流，不产生学习证据。

Lucía 的好友申请通过 `GET/POST /api/v1/character-network/lucia-contact` 管理，不新增关系表：没有当前用户关系记录时返回 `pending` 及固定的虚构初识来源（Lucía 故事里的马德里文化活动、城市摄影；不代表真实活动或线下见面）；接受在同一事务内将 `character_relationships.status` 设为 `active`、幂等创建会话并写入唯一的 authored opening message，拒绝记录为 `declined` 且不创建新会话。好友侧栏只显示真实存在的会话，并以申请状态显示红点/入口。`POST /api/v1/conversations/lucia/stream` 在读取历史、写入用户消息或调用 provider 前再次检查该关系必须为 `active`，否则返回稳定错误 `CONTACT_REQUIRED`；其他角色同样走通用 published/capability 门禁，当前 draft 不可生产聊天。

Lucía 的主动消息暂限 App 内可见。`POST /api/v1/conversations/lucia/proactive` 供受控手动触发，`.github/workflows/lucia-proactive-daily.yml` 每 15 分钟调用 `scripts/run-lucia-proactive.ts`；脚本按 Lucía 的 `Europe/Madrid` 时区为每个白名单用户计算每日三个稳定但错开的随机时间槽（上午、下午和晚间），只在到达时间槽后尝试生成。服务端先按关系 active 状态、暂停开关、每日 3 条上限、每周 12 条上限和 4 小时冷却判断资格；用户未回应不再阻止后续自然分享或轻量追问。每个时间槽使用独立 `(user_id, dedupe_key)`，重复调度仍幂等。provider 收到 `inputKind=proactive`、主动消息来源、关系摘要、情绪上限、日常状态、问题预算，以及服务端隐私过滤后的可读记忆、最近已完成消息和由此派生的 `openTopics`/`characterClaims`/`openCommitments`/`currentLocalDate`/会话时区；它不能决定发送资格或关系升级。`daily_share` 允许最多一个低压力问题，其他来源为零问题预算。除 `isProactiveMessageSafe` 的文本门禁外，服务端还执行 `repeatsAnsweredQuestion`：若主动消息的选择问句重问用户已在近期对话中给出的两个选项，或近乎逐字重复已问已答的问题，则最多重生成一次；第二次仍命中时整条候选失败并记录 `safety-gate`，不写入任何用户可见消息。报备型日常分享是默认形式；关系达到 `familiar` 且日常状态为 `waking` 时，允许单句 `Te echo de menos.` 这类低压力想念表达。通过门禁后，候选与 `messages.source_type=proactive` 在同一事务内完成；provider 失败、取消或门禁失败只标记候选失败，不写入半条用户可见消息，也不使用真实运行时 fallback。候选和消息都按用户所有权隔离；当前仍不接 Web Push/APNs/FCM，用户打开聊天页后由现有历史刷新机制看到已生成消息。
开发环境可传 `preview: true` 进行不落库的声音检查；预览仍调用真实 provider 并执行同一安全门禁，但不创建候选、不消耗每日额度，生产环境忽略该字段。

已发送用户消息的上下文操作通过 `DELETE/PATCH /api/v1/conversations/:characterId/messages/:messageId` 进入 conversation repository，并再次执行用户所有权、角色和消息状态校验。删除只移除用户历史；撤回将消息置为 `withdrawn`，历史正文不再进入搜索或角色回复上下文，并删除其来源关系记忆。流式回复完成时还会重新检查用户消息状态，防止回复期间撤回的消息产生介绍候选或记忆；撤回不会生成学习证据。

- `user_reading_progress` 保存版本化断点、完成状态和个人笔记；`user_article_saves` 保存文章收藏；`user_article_highlights` 保存短语/高亮文本及段落位置。
- `/api/v1/read/articles/:articleId/state` 使用内容哈希做乐观版本检查。哈希过期返回 `409 CONFLICT`，客户端保留本地状态并提示重新定位，不静默覆盖标注。
- `/api/v1/read/saved` 和 `/api/v1/read/sources` 只返回当前用户的明确 DTO。外部来源接口目前只保存规范化 URL、标题、作者、许可和版权状态等元数据，绝不抓取 URL 或保存未经验证的全文。
- `/api/v1/read/saved-items` 是个人阅读书架的单一入口：默认（`全部`）按 `createdAt` 倒序合并“文章类”与“标注类”两个来源，`itemType=article` 只返回文章类（当前用户收藏的已发布文章 + 当前用户的私人生成故事），`itemType=phrase|highlight` 只返回 `user_article_highlights` 标注。文章类条目带稳定 `stableKey@version`、标题、来源、`origin`（`public`/`generated`）与 `saved` 标记；标注类条目带段落位置、上下文和来源。两个来源在 PostgreSQL 各自分页：单类型页签使用该来源真实的 `page/pageSize/total`；`全部` 会先读取两个来源各自的 `page * pageSize` 行（上限 500）再在应用层合并切片，`total` 为两来源之和，因此深于该窗口的 `全部` 页只覆盖窗口内最新的行，而单类型页签在任意深度都精确。阅读状态同步按条目标识差异更新，未变化标注保留 UUID 与 `createdAt`，避免进度同步改变书架排序。`/api/v1/read/saved-items/:itemId` 只按当前用户所有权幂等移除一条标注（文章收藏仍走 `/api/v1/read/saved`，私人故事删除走 `/api/v1/read/generated-stories/:articleId`）。撤下版本、未清权来源和其他用户的私人生成文章不会进入投影。
- `/read/saved-items` 是个人阅读书架，页签为 `全部 / 文章 / 保存词语 / 短语 / 高亮`，提供搜索、分页、原文段落锚点、来源链接、浏览器 TTS、当前页 CSV 导出、文章取消收藏和私人故事显式删除确认。它与正式词汇/短语 corpus 页面分开，不能把用户点选的 surface text 伪称为已确认 lemma。
- `/read/vocabulary` 默认视图是可直接学习的词表：条目来自 `content/glossary/es-zh-common-v1.json` 中 `reviewStatus: reviewed` 的已审核常用词条（词目、词性、CEFR、中文释义、用法、搭配、例句和用于语料匹配的词形），因此不依赖数据库是否已索引 lexeme，也不受用户是否收藏过词语影响。其余视图分别是：`?view=frequency` 的**参考词频内容词表**和 `?view=lexicon` 的正式词元词库；已保存词句不再在此页重复呈现，统一由 `/read/saved-items` 承担。**频次视图的排序基准是参考词表 `content/word-lists/es-frequency-v1.json`**（8000 个西语词元、按词频名次排列；来源与授权见同目录 provenance 清单），而非本项目语料自身的词频统计 —— 后者会把 `que`/`los`/`por`/`con` 这类**功能词**顶到最前，而那正是学习者最不需要背的词。因此该视图：① 先从参考词表中**滤除封闭类功能词**（冠词、介词、连词、代词、限定词、纯程度/否定助词；清单与收录标准见 `content/word-lists/es-function-words-v1.json`，**所有动词一律不滤**，`ser`/`estar`/`haber`/`tener`/`ir`/`hacer` 等 15 个必需动词由 `neverFilter` 显式保护并被测试遍历）；② **保持参考表自身的词频名次**，不再按本语料频次重排（客户端也不得重排：`VocabularyWordGrid` 按收到的顺序渲染）；③ 每个词仍附上**本语料中的出现次数**与一条真实例句（复用 `corpus_occurrences` 的可见性谓词与 180 字符截断）。当前规模为参考表 8000 词、词架 7922 词（滤除 78）。**已知限制**：出现次数按词元拼写的**表层形**统计，而语料未做词形还原，故 `estar` 尚不覆盖 `está`/`estoy`；例句上下文在 LEX-INDEX-001 以 `index` 模式运行前为 `null`（`corpus_occurrences` 仍为空），但次数可用；搜索只覆盖参考词表，故 `george`/`pablo` 这类表外词形不再出现。该视图声明自己是**学习骨架**而非全部词形清单。
- 学习卡片按需调用 `GET /api/v1/read/vocabulary-example?word=<词目>`，服务端只在已发布、版权清晰且字幕审核通过的媒体段落中按词边界匹配，命中不到时回退到已发布版权清晰的文章段落，返回一条真实例句、可用的中文翻译和 `stableKey@version` 来源；结果按词形缓存一小时。查询词形只允许字母、重音符号和撇号，不进入正则以外语义。列表与卡片都不把自动统计的 surface text 伪称为 verified lemma。
- 词表的“已熟悉 / 想复现 / 暂不学习”标记保存在浏览器本地（按用户 scope 隔离），不写入 `evidence_events`、`user_skill_states`、`mastery`、`confidence` 或角色记忆；向量表写入需要新的 schema 决策。
- `VOCAB-PANEL-002` 详情布局试版：1200px 起使用 350–400px 右侧分栏，首次开关以选中词为纵向锚点并在有界渲染帧内补偿 `content-visibility` 高度变化；不注册滚动测量监听。901–1199px 为右侧抽屉，900px 以下保留底部抽屉，均通过 body portal 呈现，背景 inert、焦点限制和关闭恢复具有明确生命周期。详情按词目/发音、释义、个人标记、带署名例句、完整的已有变位/形式、默认折叠用法/搭配、查词排序；变形独立展示，不折叠或截断，仍为既有词形数据而非完整变位表。切词复位详情滚动与折叠。临时历史项在关闭/返回/卸载时释放，并恢复先前的 scrollRestoration；内容、音源、标记存储与证据语义不变。
- 阅读、TTS、词语查询、笔记和保存操作不会写入 `evidence_events`、`mastery` 或 `confidence`；只有显式口语迁移才进入 training/evidence 链路。

Generate Story 通过 `StoryGenerationProvider` 在服务端调用 MiniMax M3。`POST /api/v1/read/generated-stories` 要求当前会话和 `Idempotency-Key`，输入经 Zod 校验后生成私有 AI draft；文章正文写入内部 `article_*` 版本载体，并由 `user_generated_articles` 按用户所有权关联。`GET/DELETE /api/v1/read/generated-stories/:articleId` 只返回或删除当前用户的记录，公共内容列表与公开内容 API 永不包含这些文章。生成文章可以复用阅读器的版本哈希、断点、标注和 TTS，但这些操作仍不会写入口语证据、画像或角色记忆。供应商请求只记录模型、延迟、请求 ID 等脱敏元数据，不保存 prompt 或原始响应。

### 6.6 训练完成不等于能力掌握

`training` 只回答“用户当前正在做什么、流程走到哪里”。`evidence` 判断本次尝试提供了什么证据，`profile` 决定技能状态如何变化。

禁止在训练页面完成回调中直接把场景标记为掌握。

### 6.6.1 训练断点的稳定边界

训练断点只保存可安全重建的稳定状态：`awaiting-output`、`showing-feedback`、`completed` 和 `recoverable-error`。播放、录音、转写、评估以及其他带活动副作用的状态不落盘；如果这些状态触发保存 effect，客户端保留上一个稳定断点。恢复只注入状态，不重放旧的播放、录音、转写或评估 effect。

断点包含内容包 key/版本、表达和目标 key、输出方式、提示级别、generation、转写和反馈快照；不包含证据、画像、API 密钥或原始录音。Web 断点按用户 ID 隔离在浏览器本地存储，Flutter 通过平台安全存储抽象隔离。Schema 或内容包版本不兼容、数据损坏时清除断点并从当前微循环起点开始。

### 6.7 证据事件与技能快照

`evidence_events` 是追加式事实，至少保存：

- `attempt_id`
- `skill_key`
- `observed_value`
- `evidence_strength`
- `output_mode`
- `prompt_level`
- `tag_weight`
- `evaluation_confidence`
- `algorithm_version`
- `occurred_at`

`user_skill_states` 是派生快照，至少保存：

- `mastery`
- `confidence`
- `oral_coverage`
- `evidence_count`
- `last_verified_at`
- `revision`
- `algorithm_version`

每次证据写入和快照更新在同一事务中完成。定期重算用于验证快照没有漂移。

### 6.8 内容版本

- 内容源使用稳定 `external_id`。
- 每次教学含义变化增加版本。
- 已产生学习证据的版本不可原地重写。
- 训练尝试保存实际内容版本。
- 推荐器只使用已发布、适合当前母语且审核通过的内容。
- Content Bundle 在写库前完成结构与跨引用校验，随后在单个数据库事务中导入。
- bundle 稳定 ID＋版本＋规范化哈希决定幂等性；同版本不同哈希必须报告冲突。
- 导入器不会自动审批或发布。后继 bundle 只有在内容字段及子项完全一致时才能单向推进既有实体状态；状态降级、归档后恢复和同版本内容改写均拒绝，状态更新与 bundle claim 在同一事务中回滚。
- 个人产品阶段的正式 expression/scenario 必须同时具有 `es-ES` 与 `zh-CN` approved review；审核者身份来自 `content_reviews.reviewer_reference`。历史记录使用 `codex-ai-owner-authorized-review`，2026-10-10 平台迁移后的新记录使用 `dsh-ai-owner-authorized-review`（可带 `:actor[:runId]`），两者都不得解释为真人签字；门禁同时接受两种身份，权威定义在 `src/modules/content-acquisition/domain/review-identity.ts`。生产投影仍只读取 `published`。

### 6.9 人物固定事实与关系记忆

人物圣经是全局角色事实，关系记忆是某个用户与角色的共同历史，两者不可混写。

必须区分：

- 事实存在于人物设定。
- 事实已经向当前用户透露。
- 用户告诉当前角色的信息。
- 用户允许分享给其他角色的信息。
- 只供教学推荐使用的画像。

### 6.10 角色运行时、发布门禁与长期对话

长期角色是版本化的发布单元，而不是一个可调用模型的显示名称。`characters` 模块拥有角色人物版本、固定事实、透露策略和生命周期；`memory` 模块拥有当前用户与当前角色的关系记忆、共享许可和冲突状态；`conversation` application 通过内部端口读取两者并组装 provider-neutral runtime context。角色目录只能投影已经发布且具备相应 capability 的版本，不能成为第二套人物事实来源。

生命周期与能力独立建模：`draft`、`published`、`retired` 只回答“是否可以进入生产”；`conversation`（`disabled`/`basic`/`full`）、`proactiveMessages`、`romanticSubtext`、`persistentMemory`、`introductions`、`voiceInput` 和 `maxRelationshipStage` 决定“可以做什么”。所有角色列表、详情、联系人接受、会话创建、历史、搜索、stream、主动消息和记忆写入都必须在服务端重检生命周期、版本、所有权和 capability。当前个人 Alpha 只正式开放 Lucía；Mateo/Inés 在各自人物包、审核和 replay 门禁完成前保持 draft/coming-soon；场景临时人物不创建长期角色、会话或关系记忆。

`buildReplyContext` 只消费当前发布版本、`CharacterRuntimePolicy`、`getCharacterRelationship(userId, characterKey, characterVersion)` 返回的关系快照、当前用户可读记忆和已完成消息。不得为非 Lucía 复用 Lucía 的时区、恋爱、主动消息或 claims/commitments 分支。provider 只能生成候选表面文本，不能直接写人物事实、关系阶段、记忆共享权限或主动消息资格。

只有带有明确 `done`、通过 Schema/安全门禁且幂等落库的完整回合，才能触发关系事件候选、开放话题、摘要和长期记忆。旧 generation、取消、断流、删除/撤回和低置信度/技术失败不得更新这些派生状态。场景练习的人物快照继续由 `scenario-practice` 独立拥有，不能进入长期联系人或角色关系。

### 6.11 角色身份与修订的分离

`characters` 每一行是**一个修订**（`stable_key` + `character_version`），行 id 只代表那一版内容；`character_identities` 是**跨修订的稳定身份**（`stable_key` unique + `current_character_id` 指针）。两者职责严格分开（ADR 0014）：

- **身份拥有用户状态**。`conversations`、`messages`、`conversation_preferences`、`proactive_message_candidates`、`character_relationships`、`relationship_memories`、`memory_sharing_permissions.target_identity_id`、`character_introduction_offers.source_identity_id`/`target_identity_id` 都按 `identity_id` 归属和查询。读路径先按 `stable_key` 解析身份，再由指针拿到当前修订；写路径在迁移窗口内双写 `identity_id` 与旧的 `character_id`（切片 4 验证后才删旧列）。
- **修订行拥有版本内容**。`character_canon_facts` 和 `characters.profile.relationships` 属于那一版本身，继续挂修订行 id；它们不是用户状态，不需要也不应该跟着身份走。
- **`messages.character_id` 保留为审计来源**：它回答"这条消息由哪一版生成"。历史消息因此永远能解析回生成它的修订，即使当前指针已经前移。
- **发布即翻转指针**。`publishCharacterBibles` 在同一事务内插入/更新修订行、写入审核记录，并按 `stable_key` upsert 身份把 `current_character_id` 指向该修订（首次发布时创建身份）；导入只写修订行，不创建也不移动指针，否则指针只能指向未发布草稿，正是该 ADR 禁止的状态。**用户状态零迁移**，这也是"改一行圣经"不再需要重排生产数据的原因。
- **回滚是指针回退**，不是数据回退：把 `current_character_id` 指回上一版已发布修订即可，用户状态不受影响（步骤见 `docs/operations/character-revision-runbook.md`）。

因此"人物设定存在"与"已经向当前用户透露"的区分不受修订切换影响：关系状态、揭示集合和记忆都挂在身份上，新修订上线不会重置它们。

## 7. 训练状态机

训练引擎接受当前状态和领域事件，返回新状态与待执行 effect：

```ts
type TrainingTransition = {
  state: TrainingState;
  effects: TrainingEffect[];
};
```

effect 只描述意图，例如：

- `playPrompt`
- `startRecording`
- `requestTranscription`
- `requestEvaluation`
- `persistBreakpoint`
- `recordEvidence`

Web 或 Flutter 平台层执行 effect 后，再将结果作为事件送回各自客户端编排器。两端通过共同 JSON fixtures 验证相同状态语义；所有影响证据和画像的结果仍由服务端重新校验。

每个异步 effect 携带：

- `sessionId`
- `attemptId`
- `generationId`
- `effectId`

只有仍属于当前 generation 的结果可以改变状态。

## 8. API 设计

Route Handler 的职责只有：

1. 解析登录用户。
2. 使用 Zod 校验输入。
3. 调用一个 application 用例。
4. 把领域结果转换为 HTTP/流式协议。
5. 记录相关 ID、延迟和结构化错误。

7.5a 的供应商观测由 `shared/observability` 定义纯 TypeScript DTO 和关联 ID（`requestId`、`sessionId`、`attemptId`、`conversationId`、`generationId`）。provider application 通过可选 `ProviderCallObserver` 写入 `provider_calls`；观测写入失败只能被吞并，不能改变学习、聊天或评分结果。聊天流响应回传 `x-request-id`，无效或缺失的客户端 ID 由服务端生成。

7.5b 的业务故障写入独立的 append-only `diagnostic_events`：只允许四类固定事件（异常断流、重复证据、记忆冲突、Storage 清理失败），通过 `dedupe_key` 幂等。事件 metadata 只能是短字符串、数字、布尔值或 null；内部查询端点 `/api/v1/internal/diagnostics` 需要 `DIAGNOSTICS_INTERNAL_TOKEN`，响应不包含用户 ID、正文、音频路径或令牌。聚合规则按事件类型和错误类型的滑动窗口产生 warning/alert，不发送外部通知。

对 Web 与 Flutter 开放的 Alpha API 使用显式版本前缀，例如 `/api/v1/`。推荐端点：

- `POST /api/v1/diagnostics`
- `GET /api/v1/internal/diagnostics`（服务端诊断查询，不对普通客户端开放）
- `GET /api/v1/learning/next-action`
- `POST /api/v1/practice/sessions`
- `POST /api/v1/practice/attempts`
- `POST /api/v1/practice/attempts/:id/audio-upload`
- `POST /api/v1/practice/attempts/:id/evaluate`
- `POST /api/v1/practice/sessions/:sessionId/activity`
- `GET /api/v1/profile`
  - `GET /api/v1/content/packs/:id`
  - `GET /api/v1/content/articles`
  - `GET /api/v1/content/articles/:articleId`
- `GET /api/v1/conversations`
- `POST /api/v1/conversations/:id/messages`
- `GET /api/v1/conversations/:id/stream`
- `POST /api/v1/relationships/:id/share-permission`
- `DELETE /api/v1/me/data`
- `GET /api/v1/media`
- `GET /api/v1/media/:stableKey/playback`
- `PUT /api/v1/media/:stableKey/progress`
- `GET /api/v1/lexicon/vocabulary`
- `GET /api/v1/lexicon/phrases`
- `GET /api/v1/corpus/search`
- `POST /api/v1/lexicon/assessments/:assessmentId/attempts`
- `/api/v1/internal/content-workflow/*`（同时要求用户会话和所有者 allowlist）

`GET /api/v1/profile` 的主投影返回词汇与短语、交流运用、语音表达、跟读表现四个板块的当前掌握度、可信度、适用证据覆盖和证据计数；当历史证据足够时还返回对比值，并提供最多三条只含日期、输入方式、来源标签和提示级别的脱敏代表性尝试。旧八维结果只保留为版本化历史投影或审计数据，不再作为主界面固定合同。响应不得包含原始答案、转写正文或音频引用。

画像、活动、关系记忆和保存语音资料的 Web 同源请求在缺少 Bearer token 时，会在请求携带会话 Cookie 的前提下回退到服务端会话校验；无 Cookie 的跨端请求仍必须提供 Bearer token。这样浏览器登录态与 Flutter/API 调用保持相同的所有权检查。

READ-003 的文章 detail 端点只接受稳定 `stableKey@version`，并在服务端按发布状态、版权状态投影纯文本段落；不会执行客户端传入的 HTML，也不会返回未发布版本。Web 阅读器和 Flutter `ArticleReaderPage` 以文章版本和内容哈希作为本地阅读状态边界，保存位置、短语、高亮和笔记时不写入 `evidence_events`、`mastery` 或 `confidence`。版本哈希变化只提示重新定位，旧版本标注不被静默覆盖；TTS/词语辅助失败不阻塞正文。READ-004 的四种迁移方向（摘要、观点、个人迁移、角色对话）只在用户主动进入口语复核时构造 `ArticleTransferTask` 并带文章版本进入现有训练页；阅读页的跳过、完成和打字草稿不会创建训练尝试或口语证据。

7.4a 的关系记忆控制通过 `GET /api/v1/profile/memories` 和 `DELETE /api/v1/profile/memories?memoryId=...` 提供。列表只返回当前用户拥有的记忆，删除由服务端所有权检查执行，并依赖外键级联清理相关角色共享授权；能力证据和画像不会随之删除。

7.4b 的语音数据控制通过 `GET /api/v1/profile/media` 和带 `kind`/`id` 的 `DELETE` 提供。列表排除 `ephemeral` 录音且不暴露 storage 路径；删除保存录音写入 `audio_assets.deleted_at`，删除 speech 转写清空对应练习尝试的 `response_text`，不删除追加式证据或技能快照。

7.4c 的账号级数据控制通过 `DELETE /api/v1/me/data` 提供。请求必须来自已验证会话、携带 `Idempotency-Key` 和 `DELETE_MY_DATA` 明确确认；服务端事务先删除用户证据，再删除用户 profile 触发其余私有数据级联，同时将 `provider_calls.user_id` 置空并清理 metadata。音频 Storage 路径先登记到无用户外键的 `privacy_cleanup_tasks`，提交后由内部 deleter 清理；供应商未配置或清理失败时保留可重试任务，不阻止私有数据库数据删除。

Lucía 的个人 Alpha 清理通过 `DELETE /api/v1/me/characters/lucia/data` 提供。请求必须来自已验证会话、携带 `Idempotency-Key` 和 `RESET_LUCIA_DATA` 明确确认；事务只删除当前用户与 Lucía 关联的会话、消息、关系记忆、指向 Lucía 的共享权限和关系快照。人物设定、好友介绍申请、学习证据、画像、音频、其他角色数据和公共内容不受影响。该操作可重复执行并返回删除计数；当前模型尚无独立 `relationship_events` 表，未来新增关系事件表时必须纳入同一事务和删除顺序。

账户身份通过独立 `account` 模块维护。`GET/PATCH /api/v1/me` 只返回显示名、不可变 `publicUid`、目标语言和头像最小 DTO；照片头像通过 `POST/DELETE /api/v1/me/avatar` 进入服务端校验与私有 Storage。`profiles.id` 不进入客户端 DTO，UID 查找能力预留给阶段 9 的 `/api/v1/friends/*`，不支持邮箱搜索或公开目录。账号删除事务会把 UID 写入 `reserved_public_uids` 后再删除 profile，保证 UID 不回收。

练习活动接口只接受客户端实例 ID、单调序号和 `active`/`inactive`/`ended` 生命周期事件。服务端写入接收时间并以 `(session_id, client_instance_id, sequence)` 幂等；热力图仅消费相邻活动心跳形成的有效秒数，超过 45 秒的间隔、后台/失焦区间和未完成尾部不计入学习时长。

API 错误使用稳定代码，不让前端解析供应商原始错误文本。

### 8.1 认证与会话边界

- 普通用户通过邮箱六位 OTP 登录；邮箱密码只作为预建测试账号的隐藏备用入口。
- Web 使用 Supabase SSR Cookie。`proxy.ts` 只做会话刷新和乐观路由保护，产品布局和 Route Handler 仍在服务端调用 `auth.getUser()` 做权威验证。
- Flutter 使用同一 Supabase Auth 项目，并把持久会话交给系统安全存储，不使用普通偏好存储保存刷新会话。
- Flutter 的 Token Gate 在令牌到期前 60 秒刷新；并发请求共享一次刷新，身份代际变化会使旧刷新结果作废。
- 401 默认不自动重放。只有调用者显式允许的安全请求可以重试一次；POST 还必须提供稳定幂等键。
- 客户端解析令牌或本地“已登录”状态只用于体验优化，不能替代服务端身份验证或 PostgreSQL RLS。
- 未登录用户只可访问介绍页和登录流程；私人产品页面必须经过服务端保护。

实现和环境配置见 `docs/authentication.md`。

## 9. 流式消息协议

聊天使用 NDJSON 或等价的可逐帧解析协议：

```json
{"meta":{"messageId":"...","generationId":"..."}}
{"delta":"Hola"}
{"delta":", ¿qué tal?"}
{"done":true}
```

错误帧：

```json
{"error":{"code":"PROVIDER_TIMEOUT","retryable":true}}
```

规则：

- 没有 `done` 的自然断流是失败。
- 用户主动停止可以保存已展示文本，但消息状态为 `stopped`。
- 只有 `completed` 消息参与记忆提取和完整学习评估。
- 重试创建新的 generation，不覆盖旧消息记录。

## 10. 幂等与并发

- 尝试提交以 `attemptId` 幂等。
- 证据事件以 `(attempt_id, skill_key, algorithm_version)` 唯一。
- 供应商调用保存外部请求 ID，重试前先查询已有终态。
- 技能快照使用 `revision` 乐观锁。
- 记忆候选提交使用稳定候选 ID，防止流重连重复写入。
- 旧 generation 结果可以被记录为诊断，但不能更新当前 UI 或能力状态。

## 11. 数据库与 RLS

- PostgreSQL Schema、连接和迁移的当前实现约定见 `docs/database.md`。
- Drizzle Schema 按 `users`、`content`、`training`、`evidence`、`characters` 和 `infrastructure` 分组；业务模块不得直接写其他模块拥有的表。
- 数据库结构只通过 `drizzle/` 中的版本化向前迁移改变，迁移生成后必须通过空库执行和漂移检查。
- 所有用户私有表都包含 `user_id`。
- RLS 默认拒绝，按最小操作开放。
- Web 和 Flutter 客户端都不能直接写 `evidence_events`、`user_skill_states`、`relationship_memories` 和 `provider_calls`。
- 内容公开查询只返回已发布版本。
- 管理或导入能力使用服务端专用角色，不暴露到浏览器。
- 删除账号时按明确顺序删除或匿名化用户数据，并记录不可逆操作结果。

## 12. 音频生命周期

1. 客户端请求短期签名上传信息。
2. 客户端上传受限类型和大小的录音。
3. 服务端确认所有权后调用转写或发音服务。
4. 生成评估和必要的派生数据。
5. 普通录音删除；只保留转写、指标和证据。
6. 用户明确保存的里程碑录音移动到长期区域。

任何日志都不能包含长期有效的签名 URL。

### 12.1 客户端平台能力

Web 与 Flutter 上层功能只依赖内部端口：

- `AudioRecorder`
- `AudioPlayer`
- `TextToSpeech`
- `SecureStorage`
- `Notifications`
- `AppLifecycle`
- `Connectivity`

Web 使用浏览器适配器。Flutter 优先使用成熟插件；插件不能可靠满足 AVAudioSession、通知、文件生命周期或商店能力时，再增加单一职责的 Swift/Kotlin/Windows 桥接。平台原始异常必须转换为稳定内部错误。

训练 Alpha 的 Web 适配器位于 `src/modules/providers/speech/browser-recorder.ts` 和 `src/modules/providers/tts/browser-tts.ts`。录音适配器只在内存中返回当前尝试的音频 Blob 与 `mimeType`/`sizeBytes` 元数据，不创建长期媒体资产。麦克风权限拒绝、格式不支持、录音失败和 TTS 不可用分别映射为稳定能力错误；麦克风启动失败直接把当前输出方式切换为文字，不产生能力证据。

`READ-TTS-002`：浏览器 TTS 在用户点击的同步调用中先 `speak()` 排入，再 `resume()` 恢复；Chrome 曾暂停的引擎可能将 `paused` 清为 false，却仍不开始朗读，不能只根据该标志跳过恢复。文章划词按钮显示当前播放状态，再点停止；朗读、试听与停止通过 generation 隔离过期回调，卸载时停止并使旧 generation 失效。保留启动/结束看门狗及可重试错误，不增加供应商调用、录音保留或学习证据。

2026-10-13 同任务续修：`speaking/pending` 仅代表队列活动，只有 utterance 的 start 才通知 UI 播放开始。默认音色尊重已保存西语偏好，其后优先本地 es-ES/本地西语。未开始的音色超时或报告语言/合成/网络不可用时，在取消原请求后尝试其他列出的西语音色，本地优先、最多三次；已经开始、用户取消或权限拒绝不触发自动回放。没有其他列出音色时保留一次同音色重试和指定 `lang` 的引擎兜底。启动总预算为本地 4 秒/在线 12 秒（无队列活动时分别在 2/6 秒先判失败）；已开始的长文保留原运行预算。适配器自己的 generation 防止旧失败在下一次点击/停止后发起回退。缺失 start 但实际已有音频的引擎仍可能被预算取消，不能把队列标志当作实际听感验证。

Flutter 的 `AudioRecorder` 和 `TextToSpeech` 端口继续位于 `apps/mobile/lib/core/platform/`，训练 fake 通过依赖注入验证成功、权限失败和资源释放路径。未安装平台插件或能力不可用时必须返回同一类稳定错误，并降级到文字输入。

当前没有 Mac/Xcode，因此 Flutter 公共代码、Dart 测试和 Windows/Web 宿主验证不能被表述为 iOS 已验证。iOS 录音、签名、TestFlight 和真机验收必须在可持续使用的 Mac 环境中完成。

## 13. 供应商抽象

业务代码只能依赖内部接口。适配器负责：

- 请求格式和认证。
- 超时、重试和取消。
- 供应商错误映射。
- 响应格式转换。
- 调用成本与延迟记录。
- 数据保留策略标记。

供应商选择不应改变 evidence、profile、training 或 conversation 的公共接口。

发音评测使用独立的 `PronunciationProvider`，不把 STT 转写或 LLM 文本判断当作发音证据。内部契约只接受短期音频、`es-ES`/`es-MX` locale、可选参考文本和 `attemptId`/`generationId`，返回可校验的发音、流利度、韵律指标及安全调用元数据，不返回原始转写正文，也不直接写入 evidence 或 profile。`quality: "insufficient"`、低置信度、静音和技术失败只能进入待验证或可恢复路径，不能产生负面能力证据。默认测试使用 fake；真实供应商调用必须单独触发。

训练 application 通过 `assessPronunciationAttempt` 编排发音调用：它负责检查 spoken output、抽样/明确复核资格和当前 `generationId`，再调用内部 `PronunciationProvider`。application 只返回 observation-only、pending-verification、recoverable-error 或 stale 结果，不把供应商分数当作语境成功、`mastery` 或 `confidence`，也不在该边界直接写入 `evidence_events`。后续 evidence application 只有在独立校准门槛和服务端规则满足后，才能消费有限的发音观察。

默认训练还可以调用独立的 `SpeechSignalAnalyzer`，只提取音频时长、有限能量启发式的语音占比和停顿信号。它与 `PronunciationProvider` 不共用评分 DTO，不产生发音分数、语境成功、`mastery` 或 `confidence`；分析失败、静音、过短音频和取消只能进入待验证或可恢复路径。外部教材音频回放工具只读文件并输出哈希和脱敏元数据，默认 dry-run，不复制、上传或把绝对路径写入清单。MiniMax 等多模态模型未来只能作为显式关闭的标注辅助，必须通过独立 Schema 和人工复核，不能直接写入学习证据。

任何小批量回放标注在调用供应商前都必须通过校准前置门禁。门禁同时要求回放清单条目授权已确认、来源许可已确认、第三方处理许可已确认、样本哈希唯一且批量不超过上限；缺少许可记录时只返回结构化阻塞原因。门禁是只读 dry-run，不读取或复制音频内容，也不写入证据、画像或供应商调用记录。

## 14. 可观测性

结构化日志至少包含：

- `requestId`
- `userIdHash`
- `sessionId`
- `attemptId`
- `conversationId`
- `generationId`
- `provider`
- `latencyMs`
- `resultCode`

禁止记录：

- 原始录音内容。
- 完整私密对话正文。
- API 密钥和访问令牌。
- 长期有效的存储地址。

关键指标：

- 训练完成和恢复成功率。
- STT 低置信度率。
- 评估结构校验失败率。
- 重复证据拦截次数。
- 聊天首 token 和完整响应延迟。
- 无 `done` 异常断流率。
- 记忆冲突和越权共享拦截次数。
- 每次有效训练和聊天的供应商成本。
- 每次内容运行的发现、重复、拒绝、处理、待审核、失败和估算成本。
- ASR 预算消耗、临时资产清理失败、来源连续失败和撤下内容索引残留。
- 对话 provider 安全门禁拦截率（按 provider、关系阶段和回复意图统计），用于判断是否需要调整 prompt 或增加受控重生成；门禁结果只记录稳定错误分类，不保存被拒绝的完整文本。

7.5a 已落地 `provider_calls` 的 `request_id`、`session_id`、`attempt_id`、`conversation_id`、`generation_id` 和 `error_type` 字段，并为 request/attempt 建立诊断查询索引。记录只保存结构化供应商元数据，不保存音频、完整对话或供应商响应正文。

## 15. 暂不拆分的边界

Alpha 不创建：

- 独立评分服务。
- 独立聊天服务。
- 消息队列集群。
- 单独推荐数据库。
- 多仓库前后端。
- Capacitor iOS 主客户端。
- 为 Flutter 页面建立等价 SwiftUI/UIKit 页面树。

只有出现可测量的性能、发布隔离或团队所有权问题时，才通过 ADR 评估拆分。

## 16. 架构决策记录

影响以下内容的变更必须新增 ADR：

- 技术栈或部署平台。
- 模块所有权和公共接口。
- 证据算法或画像语义。
- 数据保留和隐私边界。
- 角色记忆共享规则。
- 供应商数据处理方式。
- Alpha 延后范围的提前引入。

ADR 存放于 `docs/adr/`，格式为 `NNNN-short-title.md`。
