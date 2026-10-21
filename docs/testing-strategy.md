# 测试与质量策略

`CHAT-ASSISTANT-001`（2026-10-21）：聊天页 AI 助手先写设计规格与共享 DTO，再服务端/客户端并行实现。服务端 4 文件 **71 项**：provider fake-fetch 覆盖四类 intent 请求序列化、```json 围栏解析、非法 JSON/缺 answer/超限数组/未知字段、401/403/429/5xx/网络失败、超时/取消（即使 fetch 忽略 abort）/已取消请求/未配置密钥，且断言请求不含客户端伪造上下文；application 覆盖 DTO 校验、目录/发布/对话能力门禁、数据库当前发布版本不符、联系人非 active、版本/上下文读取失败、structure 回退最后一条角色消息与无目标句 400、provider 错误映射、30 秒截止/外部 abort/晚到 provider 结果、响应 DTO 归一化、metadata observer 失败不影响成功，并断言依赖只有只读端口与伪装写端口不可达；route 覆盖 401（无效 bearer 不回退 cookie）、畸形 JSON/32KiB 上限、400/403/404/429/499/503/504 映射、`private, no-store`、attemptId 回显、`provider_calls` 仅元数据且不含问题/回答、零真实 fetch；契约测试用 Ajv 双向校验两份 JSON Schema 与 Zod 一致并断言 OpenAPI 路径存在。客户端 panel/thread **51 项**：菜单顺序 [AI 助手, 搜索消息, 关系资料与清理]、打开/关闭焦点返回与 Escape、四类请求体（reply 可带补充说明、grammar 面板优先回退聊天草稿、structure 空白回退、question 表单）、语法空目标与超长补充说明本地提示且零请求、answer/建议/修正/成分结构化渲染、「填入输入框」只写草稿并恢复焦点且从不请求 stream、朗读走统一 TTS fake 的播放/停止/关闭取消、错误重试新 attemptId、旧响应/已关闭面板不回填、转录跨关闭保留但切角色清空。桌面 Chromium E2E **2/2**（独立 `PLAYWRIGHT_PORT`/`NEXT_DIST_DIR`，避免与并发会话默认 E2E 服务冲突）覆盖从三个点菜单打开、请求回复建议、朗读合成音、填入草稿不发送、显式发送仅产生一个 stream 请求且助手回答不进入聊天、重开保留转录与 Escape 焦点返回。Lead 复跑聚焦 **122**（上述 6 文件；补强后 panel 21/21）、全树 `tsc --noEmit` exit 0、改动文件 ESLint 0、E2E 2/2 独立通过；未调用真实 MiniMax/数据库，未跑全量 Vitest/整套 E2E/生产 build/Safari 真机，见[交接](reviews/CHAT-ASSISTANT-001.md)。

`CHAT-READALOUD-001`（2026-10-21）：先补失败回归再实现。`tests/unit/conversation-thread.test.tsx` 的用户消息菜单断言改为 `复制/朗读/引用回复/撤回/删除`；新增“朗读自己的消息并可停止”用例，断言发往统一朗读客户端的文本与 `es-ES`、`stop` 被调用、停止后菜单重新显示「朗读」。`tests/e2e/shared-read-aloud.spec.ts` 在原角色消息用例后追加学习者消息的右键朗读与累计 trace 断言，桌面/手机 Chromium 均通过（朗读 fake，不发真实收费请求）。`tests/e2e/conversation.spec.ts` 的用户菜单高度上限按五条菜单项更新（桌面 34px 行、手机 44px 行），宽度/贴边/主题色仍保留。注意：该 spec 中“opens sent-message actions…”在本次改动前的共享工作树已有两处与本任务无关的既有失败——菜单水平对齐 1.609px（临时恢复四条菜单后同样复现）与撤回后未确认站内 `AlertDialog` 即断言已撤回（UI-SYSTEM-002 之后未同步）；不能用它作为本任务通过依据，也不能放宽断言掩盖。完整结果与限制见[交接](reviews/CHAT-READALOUD-001.md)。

`CHAT-GREETING-002`（2026-10-21）：先补失败回归再修。`tests/unit/conversation.test.ts` 用本次真实 transcript（16:40 问候 → 16:47/16:53 普通消息 → 16:58 用户 `Pues sí, es una buena idea.`）断言同日再以问候开场被拦并重生成、重试改接内容后 done；另一例覆盖“第一次因复用短语被拒、唯一重试却改用问候开场”，断言重试指令追加禁止问候约束，第二次仍问候时无 delta/done 且两次观测均为 `safety-gate`。`tests/unit/greeting.test.ts` 覆盖问候识别、当天任意角色消息命中（上一条不问候也命中）、跨本地日/缺/坏时间戳/仅用户问候不误判，以及 `buildReplyContext` 的 `alreadyGreetedToday` 派生；`tests/unit/conversation-provider-greeting.test.ts` 用两家 provider 的 fake HTTP 验证序列化上下文含该字段、system 指令引用该字段，并验证 false 时正常传递。变异验证：禁用同日扫描后对应回归 3 项失败，去掉重试约束后 1 项失败，恢复后全绿。默认测试不调用真实 provider、不写真实用户数据；真实聊天复聊、全量 Vitest/E2E/build、Safari 真机与任意模型自然度未验证，见[交接](reviews/CHAT-GREETING-002.md)。

`MEDIA-WORD-003`（2026-10-18）：`media-word-sentence-grouping.test.ts` 覆盖 provider 逐词单元分组成句子时的精确 UTF-16 offsets/时间、标点与句末引号、>1000ms 间隔与 240 字符切句、多词元/重叠/非整数/超 duration 的 fail-closed；`content-media-runtime-word-timeline.test.ts` 用 fake `SpeechToTextProvider` 验证 live 词级适配输出合法 words、纯文本 provider 仍走原平均回退且不产生 words；`media-transcript-words.test.ts` 验证 media-processing 小 DTO 透传与非法结构拒绝；`media-review-input-projection.test.ts` 验证评审/修订模型输入与 inputHash 不含 `segment.words` 而真实草稿/contentHash 仍覆盖；`process-media-candidate-word-timeline.test.ts` 走 application 路径验证词级输出写入候选草稿后 contentHash 自洽、准备审核通过；`media-segment-timeline.test.ts` 增加合法 words 通过、非法 words 拒绝、无 words 历史草稿照常通过。约定：默认测试不调用真实 ASR/翻译 provider、不写真实数据库；真实回填、翻译修正、版本化发布与发布后 words 覆盖率另以只读 DB/脚本证据记录，fake 时间戳不能代替真实 provider 词级响应，Chromium 也不能代替真实听音或 iPhone Safari。完整命令、计数与限制见[交接](reviews/MEDIA-WORD-003.md)。

`CHAT-RHYTHM-001`（2026-10-17）：气泡测试覆盖1/2/3/4条、空行/CRLF规范化、单换行不拆、完整安全门禁、全轮提问预算、间隔取消和持久代次失效。上下文回归保留超过历史预算的20条未回应消息，先前AI问询和显式中文请求仍可得到回答；两家provider fake HTTP验证完整批次序列化。客户端用可控流验证首条前追加、已显示前缀后重组、旧响应/旧finally、无done、停止、整批重试、20条上限保留草稿、权限/角色/卸载清理与缓存恢复；删除/撤回后用权威历史清理依赖回复，验证隐藏取消标记、无关活流长前缀及草稿保留、角色切换晚回调与强制读取旧缓存隔离。PGlite使用真实repository验证批次原子性、有序来源/完整批次幂等、代次认领/CAS、取消标记、较早来源撤回/删除、RLS及所有权；route契约验证完成后按各来源提取记忆、重放不收费/不重复记忆。桌面/手机Chromium测试验证实际页面分条、连续发送与删除后即时清理。真实模型仅使用合成输入另做有界检查；远端仅验证版本化迁移、既有数据hash及只读角色RLS，不以此替代真实写入路径验收。不能以fake证明自然度，也不能以Chromium证明iPhone Safari真机。详细命令和最终结果见[专项交接](reviews/CHAT-RHYTHM-001.md)。

`LUCIA-BIBLE-RESET-001`（2026-10-16）：先用回归复现 identity/traits 丢失、reveal 策略丢失、provider 正文泄露不可揭示事实、主动消息忽略已发布快照及已有聊天追加初识消息。人物 schema/canon 测试保留 Martín/24/Madrid 等既有身份并要求 v3→v2 变更记录；import/runtime/projection 测试检查版本绑定策略、无策略旧记录失败关闭、contextual 主题与 gradual/relationship 阶段过滤，两个 fake HTTP provider 同时验证 system 与正文投影。conversation 测试覆盖直接 AI 问询不能回答“真人”、自然承接与安全重试；proactive 单测及 route 契约覆盖生成/预览接收 resolver 快照、无快照不调用 provider、首次完成用户消息前不发送日常主动消息。PGlite 联系人测试覆盖空会话首条开场、幂等重试、旧消息无开场标记不插入；重置相关隐私事务另外覆盖目标身份限定及派生状态清理。es-ES、canon 与 zh-CN 教学风险由独立 AI 分维度审核，记录明确 AI 身份，不能当作真人复核。默认测试不调用收费 provider、不写真实用户数据；真实发布、清空后读取、首条开场与用户实际聊天仍需分别证明。最终命令、结果及限制见[交接](reviews/LUCIA-BIBLE-RESET-001.md)。

`READ-LOAD-001`（2026-10-16）：`read-page.test.tsx` 先复现未捕获的包装查询/DNS 错误及连接初始化失败，再覆盖二次分页读取失败、失败后重试成功和原筛选/页码保持；`read-shelf-unavailable.test.tsx` 验证独立错误态与显式刷新。专用 `tests/e2e/read-library-unavailable.config.ts` 将数据库限定为不可连接的 loopback 地址，默认 E2E 跳过此专用用例；通过该配置在桌面/手机 Chrome 实跑真实 repository 失败、导航保留、44px 按钮、RSC 重试请求、在途禁用/aria-busy、URL 保持、无横向溢出与零 pageerror。测试不连接真实库或收费 provider；连接恢复另以只读真实 repository 核验，不能用 fake 或空结果代替。结果与中间失败见 [交接](reviews/READ-LOAD-001.md)。

`CHAT-CONTINUITY-001`（2026-10-16）：`conversation-continuity-regression.test.ts` 使用用户提供的截图对话作为离线 fixture，先复现“用户去上班后仍问今天做什么”，再覆盖原欢迎前缀/无前缀变体、一次纠正、重试耗尽无 delta/done、首轮正常承接和取消前不生成。真实模型暴露的咖啡归因、未指定周末变周六、求建议/重问被零问题预算拒绝，也先补失败回归；三类违规重试耗尽均不流出正文。`reply-continuity.test.ts` 覆盖角色而非仅用户的重复追问、工作细节、新时段继承、同窗口主动重开建议、跨当地日、UTC 日期差异、缺失/无效时间戳、用户重问及归因检查的合法问句/自述/假设边界；不会将去上班推断为已下班。两个 provider 用 fake HTTP 验证当前消息、历史顺序与角色表达规则没有被覆盖；语言测试补 `finde`/`fin de semana`。默认测试不调用付费 provider、不写真实用户数据。所有者另行授权的真实 MiniMax 合成三轮复验与数据库DNS限制独立记录，不以fake或目录快照冒称持久化端到端验证。完整结果及全量限制见 [交接](reviews/CHAT-CONTINUITY-001.md)。

`YOUTUBE-EXACT-001`：先用fake契约复现旧适配器拒绝精确ID配置，再实现直接官方API定点查询。覆盖只请求本页ID/频道复验/乱序响应/异常与重复ID、limit分页/省略项推进/末页复位重验、游标模式/版本/来源/频道/有序IDs/offset篡改与旧feed兼容、各既有媒体门禁、取消、响应大小、禁止API重定向和错误脱敏。application取消回归先失败再修复，断言晚到结果不提交候选/游标。无真实API或供应商，最终计数及门禁范围见[交接](reviews/YOUTUBE-EXACT-001.md)。

`CHAT-ASSIST-003`（2026-10-16）：单输入框翻译改造最终UI/状态5文件85项、桌面/手机Chromium14/14及5文件专项lint通过，全树typecheck通过。覆盖仅一个输入框、输入不自动请求、空稿聚焦、显式使用/编辑/发送、错误重试/30秒截止、修改源文/取消后恢复原稿不复活旧结果、Escape/焦点、隐藏/不可用清理、来源/队列/重试/下一轮，以及中文输入法Enter。布局核验浅深主题320/375/768/1440px、44px按钮、短译文预览<=220px、320×560长译文局部滚动、宽度变化后输入框不截行；最终截图等待主题按钮颜色稳定后人工复核。中途Windows内存/线程失败及后续串行复验、生产build和未跑全量/真实Safari等边界见[交接](reviews/CHAT-ASSIST-003.md)。无真实收费provider调用。

`MEDIA-RIGHTS-001`：fake回归先在旧实现复现20失败/1通过；专项覆盖已字幕路径绕过门禁、来源和候选自身权利、缺失/过期/错误受众/操作/云处理许可、ASR整链零副作用预检、逐段复验、外部取消、忽略abort的晚到成功/失败、清理期撤权、旧revision/generation不回写及私用许可隔离。三个strict来源schema兼容缺字段的旧策略，拒绝无效新增授权。仅使用fake，不调用收费provider或真实数据库；最终计数及全量限制见[交接](reviews/MEDIA-RIGHTS-001.md)。

`CHAT-ASSIST-002`（2026-10-16）：先复现不应显示辅助标注的失败，再移除输入区及消息标注，仍验证内部来源/下一轮重置/队列/重试。相关UI4文件45项、桌面/手机Chromium10/10和5文件专项lint通过。全树typecheck因未修改的内容处理application/测试缺 `processingAudience` 共10项失败，不记通过；未重跑全仓lint/Vitest/整个E2E/build与真实供应商/数据库/Safari。调研来自已取得的官方文本，静态交互提案未替换产品。具体文件、来源、命令和限制见[交接](reviews/CHAT-ASSIST-002.md)。

`CHAT-ASSIST-001`（2026-10-16）：专项覆盖中文/混输与原西→中provider契约、鉴权/当前角色版本/联系人/本用户上下文隔离、撤回过滤、流式body上限、无消息/记忆/证据写入、30秒截止及忽略abort的晚到结果；attempt单飞、独立等待者取消、TTL/容量/冲突，以及辅助来源的显式发送、关闭后口述、队列、重试和持久化幂等。桌面/手机Chromium新增E2E **10/10**通过，包含浅深主题、320/375/768/1440px与44px控件、生成/朗读/填入/编辑/发送、503恢复、关闭与过期响应；音频和收费provider均为fake。全树typecheck、生产build和改动TS专项lint通过；全仓lint OOM，全量Vitest及扩展聊天E2E存在失败，不能记为全量通过，尚未以隔离基线证明其归因。真实Supabase/RLS、收费MiniMax、扬声器及iPhone Safari/PWA未验证；完整文件/命令/计数见[交接](reviews/CHAT-ASSIST-001.md)。

`TTS-LATENCY-001`：共享朗读回归覆盖完整播放后重播不发HTTP、controller隔离、stop/隐藏/pagehide/退出/会话变化清理、旧响应不回填、失败不缓存、60秒过期及8段/4MiB LRU边界、订阅/定时器释放和重叠attempt生命周期。长文首段<=180、后续<=1000且完整保留/串行按需；短句、固定女声与原有取消/鉴权/供应商契约回归保留。桌面和手机文章真实按钮模拟800ms音频请求延迟，测量点击→blob play调用并断言重播零新增请求，退出后必须重新请求。HTMLAudio事件为fake，计时不代表真实扬声器起声、MiniMax冷生成或iPhone Safari/PWA真机；无真实收费provider调用。结果与全量限制见[性能交接](reviews/TTS-LATENCY-001.md)。

`MEDIA-SERIES-006`（2026-10-16，待确认采集建议）：media纯建议单元 **1 file / 6 tests**、新内部契约与既有workflow契约 **2 files / 7 tests**、adapter及回归 **3 files / 20 tests**、真实PGlite候选建议组合 **1 file / 3 tests**、原pipeline baseline **4 files / 20 tests** 分次通过；最终专项lint与全树typecheck通过。验证结构身份/确定性key、unknown/0编号、feed/playlist/冲突warning、仅unconfirmed、拒目录/批准字段、publicURL与凭据语义以及JSON/Zod结构边界、旧candidate metadata兼容。adapter验证原请求数量、fake忽略abort仍不返候选、缺ID/title不猜测和draft/hash隔离；PGlite用完整合法draft验证重复候选不重写、source CAS回滚/过期generation拒绝、媒体目录/版本/evidence零写入，review_ready仍因缺独立内容审核拒绝发布。JSON Schema不替代运行时URL安全与来源白名单；不真实抓取或调用收费provider，聚焦与全量门禁边界见[006交接](reviews/MEDIA-SERIES-006.md)。

`MEDIA-SERIES-005`（2026-10-16，换批多样性）：来源/系列领域与既有换批回归 **2 files / 11 tests**、storage 相关最终联跑 **5 files / 24 tests** 分次通过，覆盖双层轮换、不均衡组完整补齐、无来源/无系列独立回退、显示名不影响身份、分页不漏不重/排除/确定性，以及来源/归属/revision/pageSize（含exclude成员）变化拒绝旧游标而私人进度不改变批次。新增 PGlite 系列换批专项复核真实 channel/feed/LR 身份、查询门禁、进度隔离和无显见顺序变化时的游标失效。005桌面/手机三路径 **6/6** 单独通过；先前004/005联跑11通过1失败不记为12项通过。浏览器用fixture验证前12项不同系列、筛选/排除/更多、历史返回、普通排序退出、失败与耗尽；不把fixture排序当成真实repository证明。最终专项lint及全树typecheck通过。无公共 DTO/API 扩展，普通list和系列顺序不改；细节及全量限制见[005交接](reviews/MEDIA-SERIES-005.md)。

`MEDIA-SERIES-004`（2026-10-16，视频播后推荐）：工作台/组件最终 **2 files / 35 tests**、adapter/fixture **3 files / 18 tests**、后端联跑 **4 files / 30 tests** 分次通过。单元覆盖当前 ended 与历史 completed/暂停/逐句暂停/近尾分离、技术失败后迟到 ended 拒绝与恢复、重复结束及 StrictMode 请求去重、1/6 卡片与无效协议、20 秒截止/不响应取消的 fetch/重试/旧响应、重播/seek/版本/资产/实例清理和进度失败不阻塞。PGlite 推荐专项新增 8 项，实跑 SQL 验证有序后续优先/前集补足、episodic 日期排序、版本/版权/撤下/资产过滤、跨用户进度、一条窄查询且不读取字幕或写证据。桌面/手机 Chromium 播后三路径 **6/6** 通过，验证播放器下方/字幕外、六卡/排除自己、手动导航和进度恢复、不抢焦点/滚动、不自动播放、无横向溢出及零证据写入；已读取截图。最后failure-ref修复后专项lint与全树typecheck复跑通过。fixture 的 DOM ended 不代表真实媒体自然结束、YouTube SDK 或 Safari/PWA 真机；全仓门禁和最终结论见[004交接](reviews/MEDIA-SERIES-004.md)。

`MEDIA-SERIES-003`（2026-10-16，系列导航）：卡片/导航/列表三个文件累计 **30项分次通过**（最新导航12项，前轮卡片2项、列表16项），fixture/路由 **2 files / 22 tests**、实际媒体 repository 与 PGlite 回归 **7 files / 21 tests** 通过。验证独立链接、真实可见摘要、目录缓存之外的更新/归档、20条分页与晚页 anchor、前后集、空/失败/失效游标、20秒截止/取消/旧generation、抽屉焦点限制/恢复及局部滚动；portal必须继承产品壳浅深主题，关闭焦点恢复使用preventScroll避免页面跳动。列表Zod必须保留series且兼容旧响应。E2E gate 需同时非生产与显式启用，系列窄读取不得调用字幕/播放查询，fake写入必须拒绝；所有选集目标仍可按原fixture打开。主题修复后最终桌面/手机系列路径 **10/10** 与原视频/播客 **18/18** 分次通过，不能表述为同一轮28项全绿；最终11路径lint、全树typecheck及隔离生产build通过，结果见[003交接](reviews/MEDIA-SERIES-003.md)。320/375/768/1440px浅深主题检查及375/1440截图不代表Safari/PWA真机或全仓lint/Vitest/E2E门禁通过。当前视频ended后的推荐仍属004，不能以导航测试替代。

`MEDIA-SERIES-001`（2026-10-16，目录基础）：聚焦 **8 files / 67 tests** 通过，包括系列领域、application、Route、JSON Schema/OpenAPI及原媒体兼容6文件51项，另有真实PGlite迁移7项与实际repository SQL9项。覆盖成员单一归属、正且唯一位置、跨类型拒绝、季/集号0与null、排序、有界分页/晚页anchor/邻接、最多6条后续优先推荐、currentVersion/版权/资产到期/撤下、游标失效、事务回滚、双方revision显式移动、幂等与追加审计、两账号进度隔离，以及普通角色权限拒绝和无RLS策略时的拒绝。HTTP覆盖无效bearer不回退cookie、owner allowlist、未知参数拒绝、1MiB流式body上限及取消、400/401/403/404/409/503和private/no-store。`db:check`、13个新增TS文件专项lint及最新全树typecheck通过；全仓lint因OOM终止，全量Vitest发现既有基线错误后中断，均不记通过。迁移测试只加载媒体所需前置链，尚未执行完整空库/上版本迁移链、真实Supabase迁移/角色/双连接并发、build或E2E；后续002–004库存与UI验收仍待执行。命令与限制见 [001交接](reviews/MEDIA-SERIES-001.md)。

`TTS-READALOUD-001`：所有合成朗读用通用 `/api/v1/tts` 与共享HTMLAudio客户端。供应商fake契约验证固定女声/模型/速度、hex响应/元数据、HTTP及业务限流和预取消；application验证用户隔离、并发复用、失败短期拒绝、到期和取消等待不重复调用。客户端覆盖长文保留全文、串行请求、playing才start、失败/超时/取消、跨实例互斥及URL/监听器释放；路由覆盖鉴权优先、严格输入与no-store。UI/E2E用共享客户端或MP3/HTMLAudio fake替代原speechSynthesis mock，不能真实收费；静态约束阻止产品新调用浏览器合成。真实MiniMax只允许单独明确的手动冒烟，不进入默认测试。Chrome触屏仿真不作为Safari音频解锁/实际发音验收。

`MEDIA-SERIES-000`（2026-10-15，计划，未实施/未执行测试）：[系列计划](plans/2026-10-15-media-series-implementation-plan.md)要求领域与真实SQL覆盖单一归属/顺序/可见计数、当前版本/版权/资产门禁、撤下、事务/CAS/幂等与跨用户进度隔离，迁移/RLS不可用fake替代。UI/E2E须验证当前视频有效ended才显示播放器下方最多6条同系列其他视频；暂停/逐句暂停/接近末尾/历史completed不触发，排除自己、无自动连播、错误/超时可重试、重播隐藏、切集/换版本/旧generation隔离、进度写入失败不阻塞展示且无新证据。另验系列页/选集/分页定位与320–1440px、44px、抽屉焦点恢复。浏览分散和采集建议分别验证完整稳定分页与不自动确认/发布。fake结束事件不冒称真实媒体或Safari真机验证，详细切片验收见计划。

语料长段回归（`CORPUS-REDESIGN-001`）：`corpus-excerpt.test.ts` 验证完整句界、标点/重音原样、跨句全部命中连续保留、无命中与单句安全回退；UI验证长段命中句、朗读/对照与显示一致、展开原段、已有译文不被错误配给节选。Playwright在桌面和手机复验长文章后部命中、实际合成接口文本及完整段落展开。

`CORPUS-REDESIGN-001`：真实SQL的PGlite最小表验证无出现索引仍可查询、完整原文/既有译文/同版本前后文、连续/全部词与重音/词边界、来源与类型轮转、总量/越界页、发布/清权/审核/当前版本及owner隔离。最小表来自真实schema，不代替全迁移/RLS角色验收；PGlite仅适配execute返回封装，SQL不mock。Route测试覆盖显式无效Authorization不回退session、401/400/503与no-store；Ajv合同保持旧API。UI覆盖URL/历史/旧响应/超时/重试/无效DTO、最多三条对照、合成朗读和无结果恢复；来源定位回归先红再绿，含文章hash优先和媒体稀疏index/t=0/冲突参数。Playwright覆盖桌面/手机320–1440px、浅深主题、44px高度、完整原段/翻译/对照/分页/零写入、音频失败与不支持、版本化文章新标签页及媒体实际seek。另只读检查真实库数量与查询时间；不冒称真实登录、原音听感或Safari真机完成。

`PHRASE-CONTENT-003`：新增 `phrasebook-v3.test.ts` 保护120条/每主题20条、旧60条逐项与ID不变、规范化表达唯一、完整Schema及7个内容依赖哈希，既有v1/v2审核回归不变。UI测试先复现逐句按钮缺失和取消收藏后不停播，再验证纯西语文本、状态、停止、收起和外部storage事件移除条目。`phrasebook-dialogue.spec.ts` 用原生语音fake验证每句/es-ES、单活动切换、旧回调隔离、停止/收起/切主题/自测/取消收藏、失败重试和不支持恢复；扩充E2E验证新报修表达、收藏刷新、自测迁移参考和长句在320/375/768/1024/1440px、浅深主题、44px按钮。真实音色与Safari真机仍须单独验证。

`PHRASE-CONTENT-002`：`phrasebook-expansion.test.ts` 验证原24条逐项与ID不变、v2的60条/每类10条、表达唯一、完整Schema和5个内容依赖哈希；原版审核哈希测试保留。UI回归验证实际主题计数及自测参考/核心朗读的准确文本与停止。`phrasebook-expansion.spec.ts` 验证预存首版收藏兼容与新增表达搜索、展开、自测；既有浏览器测试改验当前60条/每类10条。原生speechSynthesis fake验证参考及核心句/es-ES、按钮状态、手动停止、收起核心句、切题、退出和不支持恢复；44px按钮和截图复核。真实发音听感和iPhone Safari仍需真机验证，不能以fake替代。

`PHRASE-REDESIGN-001`：`phrasebook.test.tsx` 验证每类覆盖、完整对话、唯一 ID、严格 Schema、内容版本/双维度审核哈希、去重音搜索、主题/空态恢复、账号隔离及刷新收藏、存储失败、遮挡回想、参考答案、自测与浏览零 API 写入、朗读不支持提示。`phrasebook.spec.ts` 验证浏览器实际收藏持久化、迁移题干与参考、重练子集、键盘退出/焦点恢复，以及桌面/触屏 320/375/768/1024/1440px、浅深主题和44px主要操作；截图人工复核。阅读入口 E2E 改验真实的24条手册内容，不再断言无数据库就必须报短语库错误。浏览器验证不替代 Safari 真机或实际语音听感。

`VOCAB-PANEL-002`：词架单元先复现标记/例句顺序和开关详情丢失选中词位置，验证默认折叠、可展开的用法、双语署名保留与切词重置。estar 回归使用真实审核数据，验证变形独立可见且第 8 项之后的形式仍完整呈现。`vocabulary-panel.spec.ts` 在桌面/触屏浏览器的 375/1024/1440px 验证全量 7922 词、首次开关选中词纵向偏移不超过 3px、连续切词列宽稳定、中等宽度抽屉不挤词表、modal/inert 释放、查词、Escape/Back、零证据写入、estar 全部已有形式可滚动查看和浅深主题无横向溢出；保存截图人工复核。例句及查词使用 fake，estar 形式使用真实页面数据，不代表真实音频、供应商或 iPhone Safari 真机。词页既有测试仍断言已被历史任务移除的 `Language Reactor 词典释义` 标题时，必须单列基线失败，不修改断言掩盖它。

`PODCAST-UI-001` 加载态补回归：`media-detail-loading.test.tsx` 先复现播客错误使用通用视频骨架，再验证紧凑音频/上下结构、无重复当前片段、无伪交互控件和通用视频兼容。专用 `podcast.e2e-loading` fixture 仅在非生产且 `AUTH_E2E_ENABLED=1` 时延迟 3 秒，Playwright 在真实 Next loading 边界验证桌面/手机播放器高度小于 150px、宽度上限 960px、进度占位宽度大于 120px、文本位于下方且无页面横向溢出，以及内容返回后骨架替换为可用播放器；保存截图人工复核。路由前缀只决定骨架展示，不参与媒体权限、类型或播放校验。

`PODCAST-UI-001`：播客单元回归验证当前句仅存在于文本区、跳句后不出现重复区、隐藏字幕不泄漏当前句且播放器仍可用。复用视频工作台/Plyr 回归检查共享组件生命周期。播客 Playwright 使用独立的非生产 36 句 fixture 和 fake 音频，在 320/375/768/1024/1440/1920px 验证上下布局、960px 阅读宽度上限、紧凑播放条、无页面/控制横向溢出、进度条宽度大于 120px、手机按钮至少 44px、设置菜单实际可点且不被裁剪、文本区不被底栏遮挡、字幕居中和手动滚动不移动播放条、关闭/恢复跟随、双语/隐藏恢复以及原有点词/朗读/进度路径；保存截图复核。字幕时间与 fake 媒体仅验证交互，不代表真实音频解码、听感或 iPhone Safari/PWA。

- 适用范围：个人 Alpha
- 目标：优先防止能力评分污染、用户数据越权、流程无法恢复和 AI 角色失真

> 2026-09-11 起，个人 Alpha 只以响应式 Web/PWA、桌面浏览器和 iPhone Safari 为活动客户端范围。Flutter 测试条目保留为历史与未来恢复参考，但不再是普通 Web 任务或发布候选门禁；只有明确修改 `apps/mobile` 时才执行。Playwright WebKit 不能替代真实 iPhone Safari 的麦克风、键盘、安全区和生命周期验收。

## 1. 测试原则

`MEDIA-LOAD-001` 骨架等待续修：`media-transcript-loading.test.tsx` 覆盖 SSR 只生成首批 32 句及远处当前句、所有字幕最终按原 index 补齐、跳句立即呈现、隐藏/换版本/卸载取消旧批次。既有完整字幕 E2E 先跳到 846 句再校验最终全部 848 行，保留逐词高亮、双语和前后跳句断言。数据库连接测量必须采用 Next 实际使用的 `.env.local` 优先级；仅通过 `dotenv/config` 读 `.env` 的结果不代表本机页面。隔离真实库测量只读并屏蔽进度写入，明确区分冷编译、标题出现、完整行挂载与音视频解码；E2E cookie 不代表真实 Supabase 登录或 Safari 真机。

`MEDIA-LOAD-001`：`media-stream-source.test.ts` 使用 PGlite 验证视频/播客当前版本窄投影只发出一次 SQL、不查询字幕或私人进度、第二次读取可发现撤下，以及版权/过期/归档拒绝。`media-stream-route.test.ts` 使用不含字幕或进度的 source fake 验证 Range 正常响应、未登录/invalid bearer 拒绝、撤下时不发上游请求，以及既有来源回退和重定向门禁。完整字幕用例与桌面/手机媒体 E2E 继续验证末尾字幕、跳句和进度。真实数据库只读测量区分完整播放与窄源读取耗时；该耗时不能替代实际网络、媒体解码或 Safari 真机体验。

`LEARN-NAV-PERF-001`：`learn-page.test.tsx` 断言直访骨架由页面内 `LearnLibrarySkeleton` 提供、路由 `loading.tsx` 只剩中性壳（无 `.media-grid`、有 `role="status"` “正在打开…”）；`media-card-link.test.tsx` 覆盖 hover 100ms 延迟、离开取消、同 href 去重、focus/touchstart 立即预热、`onInvalidate` 复位、pending 指示及原 href/可访问性不变。开发模式浏览器验证：直访 `/learn` 初始 HTML 含网格骨架；不悬停点击卡片只出现中性壳、全程无网格；悬停后点击可直接进入详情骨架。Next 开发模式关闭预取（`createPrefetchURL` 返回 null），所以意图预取的服务器预热效果只在生产构建验证；开发模式不把“预取生效”当作结论。

`MEDIA-DETAIL-PROGRESSIVE-001`：`media-playback-overview.test.ts` 用 PGlite 验证 overview 复用当前版本/发布/版权/可用/过期门禁、只统计 approved 句数且不读字幕文本或 words；`media-playback-route.test.ts` 验证默认响应不变、`include=text` 时所有 `words` 为 null 且身份/片段一致、非法 `include` 返回 400。`media-detail-loading.test.tsx` 验证页面 Suspense fallback 就是同一详情骨架（含播客紧凑布局）；`media-source-position.test.ts` 通过兄弟模块验证 `?t=`/`?segment=` 位置解析。`media-detail-experience.test.tsx` 使用 fake fetch 覆盖 loading→text→ready、词级失败保留文本并单独重试、版本不一致拒绝、超时/取消/卸载/StrictMode 去重与旧响应隔离；`video-learning-workbench.test.tsx`/`podcast-audio-player.test.tsx` 验证字幕后到不重建播放器、深链一次定位、错误重试；`segment-transcript.test.tsx` 验证 loading/error/text_ready 与 words 合并不重置增量挂载。Lead 真实库只读浏览器复核（当前网络较慢，仅代表本机）：真实视频直访 h1 618ms、字幕 2.0s、词级合并 4.7s；从资料库点击视频 h1 815ms、字幕 3.7s，且无网格骨架；真实播客直访 h1 957ms。这些数字区分 dev 编译、数据库网络与渲染，不代表生产/Safari，也不替代真实播放与听感验收。

`MEDIA-WORD-001` / `MEDIA-WORD-002`：`media-lexical-drawer.test.tsx` 覆盖字幕原句/词典共用协议、即时词形回退、缺失与故障区分、畸形响应、重试与 20 秒截止、单词合成音准备/start/停止；按 2026-10-15 用户要求，点词直接生成解析，验证词典挂起不阻塞解析、普通重渲染与 StrictMode effect 重放不重复生成、同词不同原句重新解释、移除闲置/缺词/按需提示、断流重试/30 秒截止及切词取消旧响应。自动结果不抢键盘焦点，Escape 保持可用。`media-word-explanation-request.test.ts` 覆盖 JSON 校验、分块 UTF-8、必须 done、错误事件、响应体上限与挂起 reader 取消。工作台回归验证点词暂停、关闭不续播、内部键盘操作和 Escape 焦点恢复；桌面/手机媒体 E2E 复用词典/AI/TTS fake，验证原句、查词、朗读仅当前词/es-ES、自动解释且只有一次请求、语料链接和底部导航间距。fake 不代表真实供应商响应、扬声器听感或 iPhone Safari；共享树其他字幕任务失败分别记录。

- 优先测试状态流转和领域规则，而不是只测试页面元素存在。
- 外部 AI、语音和地点服务必须通过内部契约隔离。
- 测试必须覆盖失败、取消、过期回调、重试和重复提交。
- 技术失败不得产生负面能力证据，这是最高优先级不变量。
- 数据隔离、删除和记忆共享属于产品功能，必须自动测试。
- Lucía 好友申请必须覆盖 pending/accept/decline、重复审批（包括 authored opening message 幂等）、用户隔离，以及未 active 时聊天流不得创建会话或消息。
- 7.4a 记忆控制必须覆盖用户隔离、删除后的共享授权级联和 UI 的明确删除确认。
- 7.4b 语音数据控制必须覆盖排除 ephemeral 录音、用户所有权、转写删除不修改 evidence，以及桌面/手机删除确认路径。
- 7.4c 账号级数据控制必须覆盖证据先删、profile 级联、provider_calls 去标识化、Storage 清理失败可重试、幂等重复请求和跨用户隔离。
- 7.4d 账户资料必须覆盖 public UID 格式/唯一性/删除后不回收、头像来源与 EXIF 清理、头像 Storage 失败恢复、资料并发冲突、RLS 所有权，以及 Web 菜单/移动抽屉的键盘与安全区路径。
- 7.4e Lucía 角色级清理必须覆盖明确确认、用户所有权、事务原子性、消息/关系记忆/关系快照删除、指向 Lucía 的共享授权撤销、好友申请/学习数据/其他角色保留和幂等重复请求。
- 7.5a 供应商观测必须覆盖关联 ID、成功/失败/取消状态、错误码、延迟、观测写入失败不污染业务结果，以及日志/metadata 不含正文和音频。
- 7.5b 诊断事件必须覆盖四类事件、dedupe 幂等、metadata 脱敏、内部端点越权拒绝、滑动窗口告警阈值，以及备份恢复后的 RLS/迁移验收。
- READ-005 阅读持久化必须覆盖进度 upsert 幂等、保存/高亮/笔记隔离、内容哈希版本冲突、外部 URL 规范化去重、RLS 跨用户拒绝，以及账号删除后的阅读表级联清理。个人书架（`/read/saved-items`）还必须覆盖发布/版权/私人文章可见性、搜索分页、稳定段落定位、拥有者限定的幂等移除、收藏文章取消收藏后从书架消失、私人故事需确认才可删除，以及这些操作都不写能力证据。
- 场景实战必须覆盖临时人物与长期角色/记忆隔离、完整文字轮次、逐条错误标记、一次性 Provider 切换、稳定断点、跨设备 revision 冲突和当天/1/3/7 天复现计划。
- 自动内容供应必须覆盖来源游标、三层去重、权利/预算门禁、候选状态、两个审核维度、显式发布、撤下和 30/7 天/即时清理策略。
- 视频与播客必须覆盖同一版本化片段和来源位置语义、播放进度、字幕缺失、资产失效、快捷键、自动暂停和移动端词句抽屉。
- 词句与语料必须覆盖 verified/pending lemma、短语重叠、连续短语与 `all` 多词匹配、KWIC 边界、撤下内容不可见、私人来源所有权和文字考察幂等证据。
- 阅读页 UI 必须覆盖短语卡默认代表例句、语料查询 URL 恢复、来源跳转位置、无结果恢复动作、过期查询响应隔离，以及 44px 触摸目标和浏览不写能力证据。
- 四板块画像必须覆盖输出方式路由；文字、低置信度、技术失败和跟读不得污染不适用板块。
- 高成本 E2E 只覆盖关键纵向路径，细节下沉到单元和集成测试。

## 2. 工具基线

计划使用：

- Vitest：领域和 application 单元测试。
- React Testing Library：组件交互和可访问性。
- Playwright：手机视口端到端测试。
- 真实 iPhone Safari：麦克风、输入法、安全区、PWA 主屏和生命周期人工验收。
- Supabase CLI 或隔离测试数据库：迁移、RLS 和事务测试。
- 固定 fake adapters：默认测试不调用收费供应商。
- 词语解释 provider 必须用 fake fetch 覆盖词语/句子 `selectionType` 请求字段、MiniMax M3 响应 Schema、`stream: true`、多段 `delta`、最终 `done`、鉴权/限流/超时/取消、异常断流和无效 JSON；阅读器组件/E2E 通过本站接口拦截验证常用词命中时不调用 API、未命中词和拖选句子的 loading、增量预览、成功和可恢复失败状态，不能触发真实收费调用。
- 每个角色对话 provider adapter 必须用 fake fetch 覆盖隐私过滤上下文、各自响应 Schema、鉴权/限流/超时/取消、无效响应和请求 ID；契约只断言统一内部结果，不调用真实收费 API。对话流测试必须确认 provider 文本仍只在 `done` 后持久化；失败/取消只产生错误事件，不生成 fallback 角色文本、完整助手消息或关系记忆。
- 对话流还必须覆盖 safety-gate 拦截：问题压力或身份声明越界时记录 `safety-gate` 观测并发送可恢复错误，不持久化被拒绝文本；低压力 reciprocal question 在策略允许时应通过。
- 语言纯度是 safety-gate 的一部分：西语回复中出现汉字、假名或谚文时必须拒绝，最多重生成一次，且断言流出的 delta 中不出现被拒绝文本；用户显式要求“用中文回复”或“responde en inglés”时才允许切换语言，普通西语对话不能被误判为切换请求。
- safety-gate 重生成必须最多执行一次；测试需断言第二次仍失败时不再调用 provider，且只有通过门禁的最终文本才能发送 `done` 和进入持久化。
- 主动消息必须覆盖 Lucía 关系未 active、暂停、每日/每周频率、4 小时冷却、未回应后仍可继续发送、时间槽 dedupe 重试，以及 provider/安全门禁失败不写入消息；同一候选只能原子地产生一条 `source_type=proactive` 消息。主动消息没有用户轮次可以证明语言切换，因此其安全门禁必须强制纯西语：正文含汉字、假名或谚文时整条候选失败并记录 `safety-gate`，不写入任何用户可见消息。主动消息生成必须读取当前会话已完成消息（与普通回复相同的撤回/空正文过滤），并覆盖：provider 收到 `recentMessages`、`openTopics`、`currentLocalDate` 与 `Europe/Madrid` 时区；用户已答过的选择问句或已问已答问题被 `repeatsAnsweredQuestion` 拦截且最多重生成一次；第二次仍重复时整条候选失败、不写入消息；无历史、无匹配或仅有一个已知选项时不误拦。查询层测试覆盖 `listRecentMessages` 只返回已完成消息、按时间正序并遵守 limit，且不跨用户返回其他会话。
- 对话消息操作必须覆盖用户所有权校验、复制/引用菜单可访问性、删除与撤回的幂等和过期撤回；撤回后消息不得进入搜索、角色上下文、关系记忆或学习证据，回复流竞态也必须覆盖。
- 对话工作区必须覆盖真实会话列表 DTO（只返回当前用户会话、最后消息摘要和时间）、无会话/数据库不可用状态、历史加载 skeleton、长列表上滑不被强制滚动和移动端可访问消息操作。语音 composer 必须覆盖录音取消、转写中止/超时、空转写、provider 失败、过期回调和“确认后才发送”；转写音频不得进入持久化或学习证据。
- 媒体资料库必须覆盖发布/版权/可播放三重投影门禁、稳定版本 ID、过期播放地址、完整已审核片段（含超过 500 条的长媒体）、进度 revision/CAS 与相同请求幂等回放。Route 测试覆盖列表参数、鉴权、400/404/409/503 映射；数据库测试覆盖撤下后不可播放或写进度以及跨用户隔离。页面和 Playwright 必须确认 `/learn` 不再出现旧 Hero、开始/继续 CTA 或任务时间线，并在 320–1440px 直接显示搜索、类型导航、地区/难度/时长筛选、媒体卡或真实空状态；手机顶部不得出现重复头像入口。
- OpenAPI/JSON Schema 与稳定错误码：保证当前 Web 契约明确，并为未来恢复其他客户端保留边界。

具体版本在工程脚手架阶段锁定。

## 3. 测试层级

字幕居中跟随 `MEDIA-TRANSCRIPT-001`：`segment-transcript.test.tsx` 先复现当前句贴底，验证换句居中、首尾限制、关闭/恢复跟随、同句逐词刷新不拉回和字幕模式变化；`video-learning.spec.ts` 用非生产专用 30 句媒体 fixture，在桌面/手机 Chromium 验证真实 DOM 居中几何、跟随开关、双语/隐藏恢复，桌面同时检查页面位置不动。媒体使用 fake，不访问收费 provider，不代表真实解码、音画同步或 iPhone Safari 真机验收。

学习页换批 `LEARN-BROWSE-001`：`media-browse.test.ts` 覆盖整库选材、来源轮换、稳定 ID 排除、确定性完整分页、目录/筛选变化使游标失效和耗尽；`media-library-browse.test.tsx` 覆盖按钮实际换卡、筛选、加载去重、失败保留与重试、显式重新浏览、频道竞态和返回重新验证。Route 与 JSON Schema 验证鉴权（invalid bearer 不回退 cookie）、有界请求和稳定错误码。`media-browse-persistence.test.ts` 用完整媒体迁移基线的 PGlite 验证发布/版权/可播放过滤、分页、撤下和不同用户的即时进度，复用媒体 RLS 测试。`media-browse.spec.ts` 用只读接口拦截验证桌面/手机的不同批次、筛选 URL、分页、详情返回顺序/位置、退出浏览排序、错误/耗尽与 44px 按钮；没有数据库写入或真实收费 provider，不称为真实媒体/iPhone Safari 验收。

同任务故障恢复：首屏 unavailable 和空网格换批失败均不得展示“内容准备中”或筛选零结果；重试失败继续保留错误，成功返回卡片或真实零结果才清除错误。单元测试验证保留筛选和 no-store；桌面/手机 E2E 覆盖首屏失败、一次失败重试、再次成功。真实连接排查须使用未缓存查询或直接 repository 读取，避免目录缓存掩盖数据库不可用；只读真实 DB + E2E cookie 的检查能验证目录和进度查询，不能替代真实 Supabase 登录、完整壳层或 Safari 真机验收。

同日换批文案修订：加载及失败均不出现换批状态句；断流、失败和超时后原卡片保留，按钮恢复，后续点击仍可换卡。fake time 覆盖 22 秒慢成功和 45 秒硬超时；普通列表保持 20 秒。E2E 断言用户换批的 POST 响应，排除带 cursor 的预取响应，仍保留失败状态码、卡片不变及后续耗尽等断言。

同日滚动回归：单元复现观察点持续相交时追加一页后停住、五列网格为补齐整行而提前拉页、30 个滚动事件写入历史 30 次；断言修复后续页自动到达、列数不驱动加载、200ms 合并与详情点击前准确保存。`media-library-scroll.spec.ts` 使用真实 IO、240 条固定目录、换批后完整刷新，连续下滑到全部卡片，断言稳定 ID 无重复、末页停止以及 30 帧滚动的历史写入有界、最终位置一致；保留原有详情往返顺序/位置测试。`learn-page.spec.ts` 的筛选空结果必须通过显式成功零结果读取产生，不能把禁用数据库的 E2E 首屏错误当空库。性能结论限于历史写入次数和消除多余渲染/加载，不以头部 Chrome 自动化声称 iPhone Safari 实际帧率。

文章布局修复 `READ-LAYOUT-002`：`article-layout.spec.ts` 验证阅读器不渲染分类导航、文章顶栏贴顶、顶栏/阅读面按实际内容列对齐、标题不覆盖操作按钮、无横向溢出；浅/深主题覆盖 320/375/768/960/1440/1920px。滚动后检查单行 sticky 位置，工具面板和拖动边界须在顶栏下缘之后；返回文章库须恢复分类导航、当前文章标签和货架边距。`read-section-layout.test.tsx` 同时验证文章路由加载态隐藏导航、其他阅读页保持导航。阅读状态写入和解释接口均拦截，无真实供应商调用；复用文章工具/朗读专项和阅读器/阅读壳层单元测试。手机 Chromium 只验证视口布局，不代表 iPhone Safari/PWA 真机验收。

文章划词朗读修复 `READ-TTS-002`：`browser-speech.test.ts` 验证必须先排入再恢复暂停队列；`article-reader-speech-feedback.test.tsx` 验证可见播放状态、再次点击停止、旧 attempt 不覆盖新词状态及无声失败可重试。`article-read-aloud.spec.ts` 在桌面/手机 Chromium 中覆盖恢复、停止和无声超时，使用 fake 引擎与解释接口拦截，不调用收费 provider。真实 Chrome 的独立暂停探针另验证 start/end 事件；这些事件不能替代用户设备的实际听感或 iPhone Safari 真机验收。

续修回归还覆盖 `speaking=true` 但无 start 的失败音色必须切到另一西语音色、默认本地优先且保存偏好仍生效、准备阶段不得显示正在朗读、网络/合成失败只在未开始时回退、取消/新点击阻止旧回退。浏览器弱引用/强制 GC 检查覆盖 utterance 在排队期间存活、完成后可回收。真实 Chrome 另以一个被拦截的失败音色验证回退到未拦截的 Microsoft Laura 并自然 start/end；明确区分 fake 失败端与真实回退端，不声称测量了扬声器输出。

词汇页展示收敛 `VOCAB-UI-001` 使用 `vocabulary-page.test.tsx` / `vocabulary-shelf.test.tsx` 覆盖简洁工具栏、标记、朗读状态与错误在侧栏内显示；`lexicon-library.spec.ts` 覆盖搜索、真实空/错状态和窄屏无溢出。`scripts/verify-vocabulary-toolbar-browser.ts` 对配置真实词表的本地 `AUTH_E2E_ENABLED` 服务进行只读检查：浅/深主题 × 320/375/640/768/1440px，搜索和开关 44px 命中区、首屏单词宽度、键盘开关、本机标记、词卡无音源状态文案及关闭生命周期。音频使用 fake，不访问收费 provider，不作为真实音频或 iPhone Safari 验收。测试脚本的本机标记位于临时浏览器上下文，关闭即销毁。

2026-10-20 所有者要求点击「朗读单词」后不显示“合成音/准备中”字样：`vocabulary-shelf.test.tsx` 改为断言词卡内无这类文案，加载/播放/结束/取消/重试一律以按钮停止标签、`aria-busy`、`aria-pressed` 和错误提示断言；`scripts/verify-vocabulary-toolbar-browser.ts` 同步改为断言词卡无状态文案，不新增真实 TTS 或收费调用。

### 3.1 领域单元测试

`VOCAB-SHELF-001` 加载续修：`vocabulary-shelf-load.test.ts` 覆盖完整参考词表同序、无伪造次数/例句、快速真实数据、成功零结果、失败时搜索（含重音）、1500ms 上限、晚成功/异常隔离和 timer 释放。页面回归验证无 DB/异常仍可搜索和默写且提示例句不可用，保持空态与原正常路径。`lexicon-library.spec.ts` 在明确禁用 DB 的桌面/手机环境验证全部 7922 个真实参考词、过滤顺序、本机标记、默写正确反馈/退出恢复、搜索空态与零 API 写入；不以此代替真实 DB 或 Safari 真机验证。

`VOCAB-RECALL-001` 判题反馈补充：UI 回归验证独立正确的喜悦文字、已提示/自行确认成功的区分、错误/重音错误的 aria-invalid、中文待确认不误判、参考重音字母标记、输入描述与编辑后清除旧反馈。Chrome 脚本在浅/深 × 320/375/1440px 中检查四种判题徽章、装饰图标、输入底色变化、重音标记和徽章文字 AA 对比度（至少 4.5:1），并验证普通偏好的 260ms 轻弹及减少动态偏好下禁用动画；继续保留 Enter、重练、退出恢复、44px 和零 API 写入回归。

`VOCAB-RECALL-001` Enter 导航补充：领域和 UI 测试覆盖检查当前词后聚焦下一空位、跳过已填写项、回到前面漏填项、全填/空答案/中文待确认停留、输入法 Enter 不移动、模式与重练隔离及退出重启；不因导航批改其他答案。Chrome 脚本在浅/深 × 320/375/1440px 中断言实际焦点、中文确认后继续、单题重练停留以及零 API 写入。

`VOCAB-RECALL-001`：`vocabulary-recall.test.ts` 验证西语大小写/Unicode/重音及 ñ/ü 区分、完整中文释义/明确并列项匹配、未知说法待确认、空项不判错、冻结条目、两个模式隔离、非法/过期条目动作、提示与自行确认的区分、重复批改及错词重练。`vocabulary-recall-ui.test.tsx` 验证原行输入/恢复、缺释义跳过、无已知词、输入法组合阶段 Enter 不提交、答案旁路关闭、自动音取消、提示后填写不算独立匹配、搜索恢复、标记保留和卸载清理；普通动态偏好下退出旋转完成后才恢复原词，卸载取消 timer。`scripts/verify-vocabulary-recall-browser.ts` 使用临时上下文中的本机标记和 fake TTS，仅只读访问已配置词表，不调用收费供应商、写证据/画像或保存答案；桌面/手机、浅/深主题覆盖无横向溢出与 44px 控件，普通动态偏好检查 perspective、rotateX 动画和退出，减少动态效果直接切换。先滚动至受测行再检查隐藏状态，避免 `content-visibility: auto` 的离屏延迟布局误判。真实 Safari 单列验收，不以 Chromium 手机视口冒充。

`VOCAB-TATOEBA-002`：`tatoeba-audio.test.ts` 验证音频许可独立、未知/空许可拒绝、官方复数 audios URL/ID/作者校验和 sentence ID 配对；词架测试覆盖复制成功/失败重试、原声加载/实际进度/结束/错误/超时、过期回调和取消资源，不用 TTS 掩盖失败。回归包含 playing 但进度为零、开始后停滞、相同时间事件不能续期、缓冲恢复和结束清除超时。`scripts/verify-tatoeba-audio-browser.ts` 对配置真实词表的 `AUTH_E2E_ENABLED` 服务进行 Playwright 验证（浅/深 × 320/375/1440px、44px 图标、剪贴板、播放/停止），fake 与真实音频检查分开；五条真实 Tatoeba 流播需 playing、currentTime 前进与 ended、非静音且有音量，以及内存解码非零波形，音频不保存。不能把 fake 通过、解码或播放器事件称为扬声器听感/iPhone Safari 验收。

产品本人追加授权无原声例句使用浏览器 TTS 后，该任务增加合成路径：完整西语句子/语言、点击播放不显示准备/加载/播放状态文案（只用按钮图标、停止标签与 aria 状态）、start 后按钮切换为停止、结束复位、错误归属该句及重试、没有 start 的超时、原声/合成互斥、过期回调和隐藏取消。浏览器布局脚本同时覆盖“合成朗读”入口与停止（fake TTS，不称为听感）；真实原声另检查自动发音开启且单词查询延迟时的 generation 互斥。序列化的 Playwright initScript 不使用依赖 tsx `__name` 辅助函数的内部命名闭包；原声捕获的 ended 检查保存的来源，因为应用及时释放 src。

覆盖纯 TypeScript：

- 训练状态机。
- 训练计划生成。
- 提示依赖和输出方式可靠度。
- 证据强度和重复衰减。
- 技能快照更新。
- 场景状态判定。
- 推荐候选排序。
- 人物事实冲突。
- 记忆分类和共享权限。

服务端评分和权限规则不复制到客户端作为权威实现。暂停维护的 Flutter 客户端只有在任务明确修改时才补充对应 Dart 单元测试。

要求：

- 不访问网络和真实数据库。
- 时间、随机数和 ID 可注入。
- 同一输入产生确定结果。
- 每个 bug 修复先添加可以复现问题的测试。

### 3.2 Application 集成测试

覆盖：

- 事务边界。
- 幂等提交。
- 乐观并发。
- 证据事件与技能快照一致性。
- 断点保存和恢复。
- 内容版本切换。
- 完整消息后记忆提取。
- 异常断流不提交完整记忆。

### 3.3 数据库与 RLS 测试

必须验证：

- 用户 A 不能读取或修改用户 B 的学习和关系数据。
- 浏览器角色不能直接写证据、画像和关系记忆。
- 未发布内容不会通过公开查询返回。
- 普通证据事件不能更新或删除。
- 删除账号按政策清除或匿名化数据。
- 阅读私有表只允许当前用户访问；删除账号不删除公共文章；旧内容哈希不能覆盖当前版本的标注。
- 迁移可以从空库执行，也可以从上一版本升级。

### 3.4 供应商契约测试

为每类供应商维护固定输入集：

- STT：清晰西语、噪声、静音、口音、截断和错误格式。
- 发音：目标句、明显音素错误、语流停顿和无有效语音。
- LLM 评估：标准答案、自然替代、部分成功、无关回答和注入文本。
- LLM 对话：完成、超时、取消、异常断流和结构损坏。
- Story Generation：输入校验、MiniMax M3 JSON 契约、Markdown/字段损坏、超长正文、鉴权/限流/超时/取消、幂等重试和供应商 request ID；数据库测试覆盖生成文章的用户隔离、非本人读取/删除、级联清理及阅读状态复用。Generate Story 表单和 E2E 使用 fake provider 或诚实错误路径，不触发真实收费请求；成功生成的 AI draft 不得出现在公共文章 API，也不得产生口语证据、画像或角色记忆。
- 地点：有效结果、过期信息、无结果和来源缺失。
- 内容来源：YouTube 官方 API/RSS、播客 RSS、文章 RSS 和专用适配器的分页、ETag/Last-Modified、限流、异常编码、失效来源和字段缺失。YouTube 契约测试还必须覆盖重复 ID、非公开/不可嵌入、频道不一致、非西语声明、区域限制、时长边界、Creative Commons 许可不匹配、确定性内容哈希和字幕缺失降级。播客契约测试必须覆盖 GUID 与规范化 URL 去重、重发内容哈希、enclosure HTTPS/allowlist/重定向/MIME/大小/404、合法与非法 WebVTT、条件请求和取消；所有默认请求使用 fixture/fake fetch，不访问公网。
- 内容处理：媒体 ASR、翻译、切句和词形分析的完成、取消、超时、结构损坏、低置信度、成本和临时资产清理。

契约只断言内部统一格式和错误分类，不把供应商专有字段泄漏到业务测试。

发音 provider 契约还必须断言 locale、音频大小和格式校验、`usable`/`insufficient` 结果语义、取消和稳定错误码；不得在结果或日志测试中出现原始转写正文、原始音频或长期签名 URL。

### 3.5 组件测试

重点覆盖：

- 录音权限拒绝后出现打字入口。
- 用户说话期间不出现纠错。
- 提示逐级展开且记录级别。
- 反馈默认只突出关键问题。
- 流式聊天停止、重试和草稿保留。
- 数据不足的四板块能力不会绘制虚假分数；历史八维明细同样保持数据不足语义。
- 键盘和屏幕阅读器可以完成主流程。

以上交互由 React Testing Library 覆盖，不使用页面快照替代状态和行为断言。

### 3.6 端到端测试

使用手机视口覆盖少量高价值路径：

1. 登录 → 初次诊断 → 有限画像。
2. 从场景历史恢复稳定断点 → 语音输出 → 反馈 → 画像更新。
3. 麦克风拒绝 → 打字输出 → 口语待验证。
4. 使用三级提示 → 证据强度降低。
5. 刷新页面 → 从稳定断点恢复。
6. 阅读内容包 → 打字回复 → 后续口语复核。
7. 文章阅读 → 选择迁移方向 → 保存/跳过打字草稿，或主动进入带文章上下文的口语复核。
8. Lucía 对话 → 完整流结束 → 关系记忆。
9. 异常断流 → 重试 → 不产生重复记忆或证据。
10. 好友介绍 → 用户同意 → 最小信息共享。
11. 用户查看并删除关系记忆或保存录音。
12. 探索场景 → 选择表达 → 临时人物多轮实战 → 条件变化 → 完整复盘 → 到期复现。
13. 场景回复断流或评估失败 → 保留稳定断点 → 重试且不重复轮次、证据或费用。
14. 学习页直接显示视频/播客 → 搜索/筛选 → 官方嵌入或音频播放 → A/S/D/Q 与自动暂停 → 字幕模式/逐句定位 → 查词 → revision/CAS 恢复位置。视频 E2E 必须拦截所有站外网络并注入 fake YouTube player；播客 E2E 使用本地最小音频 fixture 和浏览器媒体端口桩，覆盖桌面与移动 Chromium，但不得描述为真实媒体质量验证。两类 fixture seam 只允许非生产 E2E 固定 stable key，不能进入普通目录或冒充真实发布素材。
15. 阅读页词汇/短语/语料 → 跳回文章段落或媒体时间点 → 完成纯文字词句考察。
16. 阅读器保存词语/高亮 → `/read/saved-items` 搜索或按类型筛选 → TTS/导出/回到原文/显式移除；整个链路不得调用 evidence/profile 写入。
17. `/read/vocabulary` 默认学习词表必须只来自 `reviewStatus: reviewed` 的已审核常用词条，每个词都有中文释义与用法，词目唯一、CEFR 合法、`forms` 已归一且不与其他词条冲突；`café`、`»casa«`、`quiero`、`están`、`casas` 等带重音、标点或屈折形式的选中词必须解析到同一词条。学习卡片必须展示释义、发音入口、真实语料例句（含中文翻译与来源）和状态标记，且状态标记只写入浏览器的按用户隔离存储，不产生 evidence/profile 写入。
18. `GET /api/v1/read/vocabulary-example` 必须要求会话、拒绝非西语词形输入（含注入式 payload），命中不到语料时返回空数据而不是错误，并且只返回已发布、版权清晰、审核通过的段落；`?view=frequency` 的语料词频仍覆盖大小写/重音归一、频次排序、搜索和撤下内容不可见，且不能在请求内把全部段落读入内存。
19. 所有者候选库 → 请求修改/拒绝/双维度批准 → 显式发布/撤下；非所有者全程拒绝。
20. 四板块能力 → 代表性证据可追溯；数据不足不绘制虚假值。

Playwright 覆盖桌面 Chromium、iPhone 视口和必要的 WebKit 行为；真实 iPhone Safari 另行验证麦克风、音频中断、键盘、安全区、前后台生命周期和主屏 PWA 恢复。

### 3.7 API 契约与未来客户端兼容

- TypeScript 客户端与服务端读取 `contracts/fixtures/` 中的训练状态转换、错误映射和提交 DTO 样本。
- API Schema 变更必须检测生成类型或校验器是否过期。
- 同一内容版本和用户输出产生唯一、幂等的服务端提交字段。
- 服务端拒绝客户端伪造的评分、画像和记忆权限字段。
- 协议版本不兼容时返回稳定错误，不能静默接受含义不一致的数据。

## 4. 核心不变量测试矩阵

| 不变量 | 必须存在的测试 |
|---|---|
| 自然替代表达不判失败 | evaluator 单元 + 固定 LLM 回放集 |
| 打字不提高发音和语流 | evidence/profile 单元 + E2E |
| 低置信度转写不扣分 | evaluator 单元 + STT 契约 |
| 技术失败不污染画像 | application 集成 + E2E |
| 重复同句不能无限刷分 | evidence 单元 + 数据库幂等 |
| confidence 下降不降低 mastery | profile 单元 |
| 旧异步结果不能覆盖新状态 | training/chat 竞态测试 |
| 没有 done 的流不是完成 | 流协议单元 + application 集成 |
| 私密关系记忆不自动共享 | memory 单元 + RLS/集成 |
| 场景掌握需要口语覆盖 | scene status 单元 |
| 学习时长不参与能力评分 | profile 单元 |
| 能力图历史值与代表性尝试可追溯且脱敏 | profile 单元 + 画像 E2E |
| 热力图排除后台空置和长间隔 | activity domain + API/数据库幂等 + Web lifecycle test |
| 用户说话时不被纠错 | 组件测试 |
| 临时人物不进入长期关系记忆 | scenario-practice application + 数据库集成 |
| 没有 done 的场景回复不落为完整轮次 | 流协议 + application 集成 |
| Explore 建议只从已发布/本人私人且可开始的场景选择 | explore 领域单元 + Route + 所有权数据库集成 |
| 场景建议不使用学习时长、低置信度转写或技术失败 | explore 领域单元 + 固定上下文样本 |
| 过期场景建议响应不能覆盖用户最新选择 | Explore 组件竞态测试 |
| Explore 搜索忽略大小写、标点和西语重音，多词仍按 AND 匹配 | explore 领域单元 + 页面组件测试 |
| Explore 五类筛选、URL 恢复和无结果恢复动作保持一致 | Explore 组件 + Playwright 深链测试 |
| Explore 私人来源不可用时只退化为公共目录，不泄露或伪造私人结果 | application 投影单元 + Dashboard Route Schema 测试 |
| Explore 在 320/375/414px 不横向溢出，关闭私人生成后焦点回到来源表达 | Playwright 视口回归 + 组件焦点测试 |
| 收藏表达不能引用其他用户的阅读选区或复盘 | application + Route + RLS/所有权数据库集成 |
| 私人场景生成重试不重复写入，同键异输入拒绝 | application 幂等单元 + 数据库唯一约束 |
| Provider 失败、取消、非法 Schema 或丢失选中表达时不保存半成品 | scenario-generation 契约 + application 单元 |
| 私人场景只能由拥有者读取、开始、归档和进入建议候选 | Route + repository + RLS/所有权数据库集成 |
| 每日自动化不能直接发布 | acquisition application + publication gate + E2E |
| 权利不明或预算不足不能下载/ASR | source policy + budget policy + adapter contract |
| 重复来源/URL/哈希不能重复候选、版本或费用 | domain + database uniqueness + scheduler replay |
| ASR 临时音频在所有终态删除 | processing application + cleanup repository + failure tests |
| 撤下文章/媒体不能继续出现在目录或语料 | content/media repository + corpus query + E2E |
| 观看、阅读、查词和收藏不产生能力证据 | evidence application + media/read E2E |
| 文字词句考察不要求口头回答且只更新词句能力 | lexical assessment + evidence/profile integration |
| 文字对话不更新语音，跟读不证明自主交流 | evidence routing + four-capability profile |
| 手机顶部无重复头像且底部“我的”可达 | product shell component + multi-viewport Playwright |

## 5. 训练状态机测试

每个状态至少测试：

- 合法事件产生正确下一状态和 effect。
- 非法事件不会改变状态。
- 退出和取消会清理活动 effect。
- 过期 `generationId` 被忽略。
- 录音完成、转写失败、评估失败分别可恢复。
- 语音切换打字保留同一学习目标。
- 提示级别只增不减，并写入尝试记录。
- 完成微循环创建稳定断点。

使用表驱动测试覆盖状态 × 事件组合，避免只测试一条 happy path。

## 6. 评分回放集

建立版本化评估样本：

```text
tests/fixtures/evaluation/pronunciation-v1/
  manifest.json
  clear-es-es.json
  natural-alternative-es-es.json
  phoneme-error-es-es.json
  pausing-es-es.json
  noise-es-es.json
  silence-es-es.json
  low-confidence-es-es.json
  truncated-es-es.json
  clear-es-mx.json
  natural-alternative-es-mx.json
```

每个样本包含：

- 情境和交际任务。
- 参考表达，但不作为唯一答案。
- 用户输出和输出方式。
- 转写置信度；回放集只保存合成短语，不保存供应商原始转写正文。
- 预期语境结果和允许范围。
- 不应更新的技能。
- 人工解释、审核状态和允许的分数范围。

发音回放集使用 `pronunciation-v1` manifest 进行完整性校验。样本不得包含音频、供应商原始响应、API 凭据或完整私密对话；`pending` 标注不能被当作已完成母语者审核。静音、低置信度、截断和技术失败样本的预期技能更新必须为空。

任何 evaluator 或 prompt 变更都运行完整回放集并比较差异。

## 7. AI 角色质量评测

Lucía 的 provider A/B 回放基线位于 `tests/fixtures/evaluation/lucia-provider-v1/`。`manifest.json` 和 `cases.json` 固定人物版本、关系阶段、当天状态、用户输入、语义计划、问题预算和情绪上限；回放不得把具体 provider 名称写入场景。每个 provider 的输出另行记录延迟、费用、人工评分和硬门禁结果，不能把某个 provider 的措辞当作标准答案。

固定对话集至少覆盖：

- 用户开心、焦虑、抱怨和不想学习。
- 用户突然换话题。
- 用户给出兴趣、学校和城市计划。
- 用户抱怨房东等私密信息。
- 用户询问角色年龄、住所、专业和是否为 AI。
- 用户要求真实餐厅、活动、房源或线下约见。
- 角色准备介绍新好友。

评测维度：

- 是否先回应用户真实内容和情绪。
- 是否保持人物语气和已知事实。
- 是否自然继续对话。
- 是否出现教学腔或强行目标句型。
- 是否泄漏其他关系记忆。
- 是否把虚构地点或行动当作现实事实。
- 直接询问是否为 AI 时是否如实回答。

角色 prompt、人物圣经或记忆策略变更后必须运行该评测集。

### 7.1 角色运行时与对话闭环门禁

`CONV-ROLE-001` 的测试必须把“角色可生成回复”和“角色可以作为正式联系人”分开验证：

- **发布与能力**：`draft`/`retired` 角色不能出现在生产联系人发现、可创建会话列表或新消息入口；直接创建、stream、retry、proactive 和记忆写入返回稳定的角色不可用/能力错误。已有用户拥有的旧版本历史可以在所有权和版本检查后只读恢复，但不能发送新消息或更新关系派生状态。`published` 版本、人物版本号和 capability policy 必须来自服务端，不能由客户端或 provider 决定。
- **角色隔离**：provider 输入只包含当前角色的人物事实、当前用户可读的该角色关系和已完成消息；Lucía 的恋爱、主动消息、时区、claims/commitments 不得泄漏到 Mateo/Inés。场景临时人物不得创建长期角色、会话或关系记忆。
- **关系连续性**：按 `(userId, characterKey, characterVersion)` 读取 status、stage、summary、revealed canon keys 和共享权限；接受不同角色介绍后，各自的 stage/summary 可独立恢复。缺失关系不能静默提升为 active。
- **provider 事实边界**：fake provider 输出不能新增人物固定事实、关系升级、共享许可或现实行动；Schema/安全门禁失败不落完整 assistant、不更新关系或长期记忆。直接询问 AI 身份、现实地点/线下约见和产品元话语应有固定回放断言。
- **流式幂等**：无 `done` 不算完成；旧/错误 `generationId` 的 `done` 不更新当前 UI；重试、断流恢复、取消、队列停止和离页最多产生一次 provider 终态、一个 assistant 和一组派生状态。测试必须断言不会重复收费、消息、记忆或关系事件。
- **删除与隐私**：删除/撤回操作幂等；流进行中撤回不会在完成回调后写入 assistant、搜索、上下文、记忆或学习证据。无效 Bearer 不能静默回退到另一个 cookie 身份，客户端历史缓存必须按用户隔离。
- **语音闭环**：录音、转写、可编辑 draft、重录/取消和用户确认分别覆盖成功、超时、取消、空转写、低置信度和 provider 失败；临时音频在所有终态删除，输入方式/置信度/attempt/generation 元数据不丢失。
- **入口与恢复**：桌面和 320–1440px 移动视口都能进入至少一个已发布角色；介绍接受后联系人刷新，错误状态区分登录/权限/未发布/可重试/不可重试；移动 dialog 有焦点陷阱和 Esc/返回语义，搜索深链可定位长列表目标消息。
- **回合反馈**：完整回合后反馈区分文字交流、语音表达、跟读和未验证观察；技术失败、低置信度转写和打字不会伪造口语能力证据。

这些断言优先使用领域、application、数据库/RLS、provider contract/fake 和少量 Playwright 测试覆盖；禁止用页面快照代替 generation、权限、幂等和隐私断言。每个正式角色应有独立 replay manifest，回放只比较人物一致性、自然回应、现实边界、隐私和压力感，不要求 provider 产生同一句话。

## 8. 时间、成本与性能

Alpha 性能预算：

- 首页已登录数据尽量在 2 秒内可交互。
- 本地状态切换和提示展开不等待网络。
- 聊天先显示已发送消息和自然处理状态。
- 记录 STT、评估、首 token 和完整响应的 p50/p95。
- 供应商调用测试默认使用 fake；真实回归集限制次数并单独触发。

成本测试：

- 每次训练和聊天保存估算调用成本。
- 防止重试或竞态导致重复收费调用。
- 普通聊天不默认调用严格发音评分。

## 9. 隐私与安全测试

- 上传 URL 短期有效且只能写指定对象。
- 文件类型和大小限制不能只在客户端实现。
- 普通录音处理后按策略删除。
- 日志快照扫描不包含令牌、完整对话或签名 URL。
- prompt injection 不能绕过地点验证、记忆共享和评分 Schema。
- 用户删除数据操作要求重新确认身份并记录结果。

## 10. 测试命令

`MEDIA-PLAYER-002`：`media-plyr-default.test.tsx` 的 fake 按真实 Plyr 语义在 destroy 后恢复克隆节点，分别验证托管视频/YouTube/播客在进度 DTO 与回调刷新时保持原实例、源切换创建连接中的新节点、卸载只销毁一次以及旧事件无效。加载阶段不得渲染已退役的自动暂停 checkbox；已有句末暂停用 Q 验证行为，内置按钮由浏览器回归验证。`video-learning.spec.ts` 连续发送 30 次位置更新和重复 ready，确认原视频节点、内置控件和进度同步均存活。E2E 使用 fake 媒体/SDK 与隔离数据库，不能表述为真实影片解码或 iPhone Safari 真机通过。

工程建立后的基线命令：

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:e2e
pnpm build
```

只有任务明确修改暂停维护的 Flutter 代码时：

```powershell
flutter analyze
flutter test
```

以上 Flutter 检查不是当前 Web/PWA 发布门禁。iPhone Safari 的真机录音和页面行为必须单独记录，不能用桌面 WebKit 结果替代。

开发过程中优先运行相关测试。跨模块、迁移、发布候选或用户明确要求时运行全套。

## 11. 合并门禁

代码合并前必须：

- 相关测试通过。
- 新规则有单元测试。
- 新失败分支有测试或明确说明无法自动化的原因。
- Schema/迁移同步更新。
- 内容变更通过自动校验和所需人工审核。
- 没有新增敏感日志。
- 受影响文档已更新。

禁止通过删除测试、放宽关键断言或跳过 RLS 来让检查变绿。

## 12. 人工 Alpha 检查

自动测试不能替代以下人工体验：

- 是否愿意继续说或聊。
- 反馈是否显得可信和克制。
- 训练是否像真实沟通而不是题库。
- Lucía 是否像持续存在的朋友。
- 手机端录音、键盘切换和单手操作是否自然。
- iPhone Safari/PWA 安全区、系统权限、音频中断、耳机切换和前后台恢复是否自然。
- 四板块能力和进步证据是否真的帮助定位问题。
- 视频/播客资料库是否打开即能选内容，没有任务式欢迎和模式选择负担。
- 词汇、短语、语料与文字考察是否保留上下文，并且不会被误解为口语评分。
- 四板块能力是否比旧八维图更容易理解，且与代表性证据一致。
- 内容工作流是否能解释候选来源、处理成本、审核和发布/撤下结果。

每周将人工发现转化为可复现样本；能自动化的回归必须加入测试集。

### MEDIA-SEGMENT-CAP-001：完整字幕回归

`media-playback-segment-cap.test.ts` 验证 501/848/1025 条已审核字幕完整投影、pending 过滤、原 index 和末尾词时间轴；`media-playback-segments.test.ts` 使用包含 artwork、words、CEFR 和托管视频规则的 PGlite 迁移基线，逆序插入长字幕并混入待审核句、旧版本句，验证真实 repository 完整排序和版本隔离。契约接受 848 条及可空 words，并继续拒绝内部定位字段；工作台与桌面/手机 Playwright 验证末尾高亮、双语和逐句导航。浏览器 fixture 使用 fake 媒体，不代表真实解码或 Safari 真机。实际数据库只读核验原视频 848 条/末条 54:30.460，无供应商或写操作。已有 `media-persistence.test.ts` 缺 artwork 迁移造成的失败需单列，不得算作通过；全量检查的既有失败/OOM 如实记录。

### VOCAB-AUDIO-001：2026-10-13 单词统一 TTS

以 suponer 可用媒体 clip 作为回归，先证明旧 UI 失败，再断言只合成显示词/es-ES、零 word-audio 请求/媒体实例。替换旧词音媒体测试为准备/start/end、失败/超时/重试、过期回调、切词/关闭/Escape/隐藏/卸载和双向例句互斥测试，保留领域、路由兼容及 Tatoeba 全部测试。浏览器脚本以真实 Chrome TTS 检查 suponer 手动/自动在 375/1440px 的 start/end、按钮复位和零媒体请求，日志不含签名 URL。原声例句与无录音 TTS 的既有浏览器路径继续验证。Safari 真机和用户扬声器听感另行验收；全量基线限制需在状态页如实记录。
