# CHAT-CONTINUITY-001：角色重复追问与最新消息承接

2026-10-16，所有者“嗯”确认检查后的回归修复建议，随后“可以”授权真实模型验证。本聊天负责，沿用共享分支 `codex/disable-legacy-readlang`。Commit：无；未提交、推送或部署。保留其他任务的在途改动。状态与最终结果同步于 `PROJECT_STATUS.md`。

## 问题与实现

用户说 `Por la tarde me fui a currar.`，角色仍回应“欢迎周末、今天准备休息还是出门”。只读检查确认当前配置数据库的 Lucía v2 已发布、current 指针正确，五条 `responseStyle` 与源文件相符。离线 fake 回放中，最新消息与历史完整传入，但截图回复会一次通过原安全门禁；此前 `openTopics` 只跟踪用户的问句，因此不会识别角色自己的反复追问。该结果不能证明截图原请求是否发生历史读取失败。

本次在共享 system 规则中明确最新消息优先、含糊肯定不能代选、过去动作不能变回未定计划、去上班不代表下班。纯领域函数从当前当地日角色消息识别泛化日程问题与散步/居家选择的重复追问；工作细节、明确不同时间范围、用户主动要求重问/重新讨论计划保留。未知/无效时间戳不推断为同日。原 `openTopics` DTO 及用户问答投影保持其原义。

命中时沿用一次有界 provider 重生成，提示优先承接最新内容；第二次仍违规时发送错误，不流出正文或 `done`。补充原语言检查对 `finde`/`fin de semana` 的覆盖。两个 provider 内部输入补齐已有运行时 `responseStyle` 的可选类型；HTTP 测试验证当前消息、历史顺序和角色规则仍完整。

真实模型复验又暴露三类问题，均先补失败回归再修复：一是求活动建议或要求重复问题时，原问题预算因用户句中有问号而禁止实质追问；现在两类明确请求可有一个实质问题，身份、情绪困扰、告别和亲密表达的零问题规则仍优先。明确重问时，复用短语检查只豁免问句，周围陈述仍检查。二是新追问省略“今晚”时，原重复检查未继承用户刚提供的时段；现在继承明确窗口，并允许用户在同一窗口主动重新求建议，明确退回旧时段的问题仍受检查。三是模型把自己提议的咖啡当成用户已喝、把未指定的周末上班说成周六上班；新增有界西语断言检查和具体纠正提示，问句、自述、假设建议及明确用户信息有测试。咖啡检查在用户消息、摘要或可读记忆已有咖啡提及时不凭缺省否定；这些检查不是通用事实核验器，也不验证任意记忆/摘要的事实正确性。

已发布人物圣经保持 v2 原样；未导入/发布新角色修订，未补年龄/职业/心理画像字段。本次没有数据库、公共 API、学习证据、关系记忆、数据保留或新日志字段变更。真实 provider 只接收合成回放，不写真实用户数据。

## 修改文件

- `src/modules/conversation/domain/reply-continuity.ts`：有界、纯 TypeScript 的重复安排问题、时段及两类不实归因检查。
- `src/modules/conversation/domain/reply-plan.ts`：明确重问/求活动建议的问题预算，复用领域请求识别。
- `src/modules/conversation/application/stream-reply.ts`：门禁与针对性重试提示。
- `src/modules/conversation/domain/language-purity.ts`：周末欢迎变体。
- `src/modules/providers/conversation/conversation.ts`：两个 provider 共用的当前回合优先规则及内部可选类型。
- `tests/unit/conversation-continuity-regression.test.ts`、`tests/unit/reply-continuity.test.ts`：新增回归与合法/非法/失败/取消/当地日边界。
- `tests/unit/language-purity.test.ts`、`tests/unit/minimax-conversation.test.ts`、`tests/unit/openai-conversation.test.ts`：语言变体与 fake HTTP 上下文完整性。
- `docs/architecture.md`、`docs/testing-strategy.md`、`docs/plans/2026-09-26-character-runtime-and-conversation-closure-implementation-plan.md`、`PROJECT_STATUS.md` 和本报告：范围、验收及限制。

## 验证

- 修复前：截图原回复和移除欢迎前缀的版本均一次放行；新增 stream 回归有3项失败，证明原问题。新领域文件尚未创建时领域套件不能解析，单列而不冒称测试断言失败。
- 修复后：最终相关12个文件 **192项通过**（`--maxWorkers=1`），包含新回归、领域边界、既有聊天/计划/圣经/运行时、两个 provider、Route持久化及线程组件。没有放宽现有断言。中间新增回归按预期失败；有一次聚焦双文件运行伴随worker内存分配失败，不算完整通过，改用单worker后重跑。开发中修正过 OpenAI 请求体结构误读、未使用参数警告、窗口豁免过宽与门禁接线遗漏，最终结果以上述完整运行计。
- 最终全树 `corepack pnpm typecheck` 通过；10个改动TS文件专项 ESLint 通过。
- 严格生产构建通过，显式退出码0、TypeScript检查完成、77/77页面。使用现有隔离目录 `.next/prod-check`，`CIRCLE_NODE_TOTAL=2` 令 Next 默认页面worker降为1，`NEXT_MEASUREMENT_BUILD=0`，未跳过类型检查；未改构建配置。
- 全仓 `corepack pnpm lint` 失败：V8约2GiB堆上限OOM，exit134。
- 全量 `corepack pnpm test --run` 启动后进程异常退出，exit `-1073740791`（`0xC0000409`），没有完整测试统计或明确OOM诊断，不能视为通过，也未据此断言是本次改动或既有基线导致。
- 聊天发送/失败重试的桌面/手机 Playwright 首轮3/4通过，桌面首例在 `browserContext.newPage` 时 `Target crashed`；该例无业务断言结果。结束重型检查后串行复验同一4项 **4/4通过**（exit0）。测试端口为3137，禁用真实数据库和收费provider；此浏览器回归验证发送/错误恢复UI，不冒称验证模型生成质量。

本机临时日志：`.tmp-chat-continuity-lint.log`、`.tmp-chat-continuity-full-test.log`、`.tmp-chat-continuity-build.log`、`.tmp-chat-continuity-build-followup.log`、`.tmp-chat-continuity-e2e.log` 与 `.tmp-chat-continuity-e2e-retry.log`。不提交这些机器日志。

## 所有者授权的真实模型复验

初始只读数据库核验确认过 Lucía v2；复验时远端数据库主机解析返回 `ENOTFOUND`，因此没有完成生产数据库到生成的端到端复验。改用本地目录的 v2 快照，逐条比较五条 `responseStyle` 与人物圣经一致；使用真实 MiniMax-M3，经现有 `buildReplyContext` 与 `streamReply` 路径连续三轮，上一轮成功输出进入下一轮合成历史。为解决本机直连 `ECONNRESET`，只给命令进程使用 Windows 已配置代理，没有修改系统或环境文件。

最终实际结果：

1. `Por la tarde me fui a currar.`：初稿“plan de sábado”被拦截，唯一一次重生成改为承接下午工作并询问工作内容，未再断言喝过咖啡或指定周几；约3.35秒，两次生成。
2. `Ahora sí he terminado. ¿Qué me recomiendas hacer esta noche?`：给出晚餐/电影建议及一个偏好问题，首次完成，约1.57秒。省略重复的时段词不再误拦。
3. `Perdona, no entendí tu pregunta de antes. ¿Puedes repetir la pregunta?`：重复上一轮的居家/出门选择，首次完成，约1.22秒。

三个最终输出均有 `done`；共4次真实生成。该有界回放符合本次三个场景验收，不证明任意长对话质量。中间回放中的喝咖啡/周六杜撰和误拦均保留在本机忽略目录，不能将那些轮次算作质量通过。最后回复仍有早餐愿望等非必要铺垫，表达自然度并非全面达标。provider 的 `estimatedCostMicros` 为 `null`，不虚报金额或免费。

合成评估脚本及结果在 `tmp/evaluation/chat-continuity-001/`（git忽略）；不提交原始模型结果，不保存真实私密对话。最后的同窗口主动求建议边界修订另有单元回归，未再增加付费回放。

## 用户验证与限制

本地开发服务加载改动后，在先前聊过散步/咖啡的线程发送 `Por la tarde me fui a currar.`，检查是否围绕工作自然回应，且不反复询问泛化的今日休闲安排、不擅自认定下班、喝过咖啡或指定周几。再主动说 `Ahora sí he terminado. ¿Qué me recomiendas hacer esta noche?` 和 `¿Puedes repetir la pregunta?`，检查正常转向及重问。真实模型试用可能产生供应商费用；本任务已运行合成评估，但未代发到真实聊天线程。

本检查只覆盖明确的西语日程及两类归因模式，不能证明任意语义同义改写都被识别，也不能保证每次真实模型输出贴题。未运行整个E2E集合、远端RLS/迁移、Safari/PWA真机；数据库网络阻塞下的目录快照回放不代替真实持久化链路。没有数据访问变更。下一建议在数据库连接恢复后验收真实线程的连续对话；人物身份/性格字段进入运行时属于独立任务。本任务不是完整的CONV-ROLE阶段2–4交付。
