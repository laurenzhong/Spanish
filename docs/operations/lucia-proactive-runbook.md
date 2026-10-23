# Lucía 定时任务：固定运行代码

- 任务：`LUCIA-CI-001`
- 日期：2026-10-14
- 范围：仅 Lucía GitHub Actions 定时任务的代码来源；不部署网站、不执行迁移。

## 故障与证据

2026-10-14 北京时间 21:05 的运行 `38568949457` 在生成步骤返回
`CONVERSATION_UNAVAILABLE`。10:09 和 15:37 的运行也返回相同错误。
它们运行的 `main` 提交为 `eeb26bd34243b957509e0580e264eb004a91d51b`。

该版本的主动消息 repository 固定查询 `character_version = 1`，再按修订
`character_id` 查询用户关系与会话。只读数据库核验发现：Lucía v1 仍为
published，用户名下仍有 active 的历史关系，但 v1 会话为 0；v2 会话为 1，
稳定身份当前指针指向 v2。旧资格检查因此通过，随后找不到 v1 会话而失败。
07:36 的成功运行返回 `results: []`，没有实际生成消息，不能作为恢复证据。

## 临时恢复方式

Lucía workflow 的 checkout 固定到本仓库完整提交
`b6bfaae837e428b8e5c31f955d773392fecf085d`。
该提交包含 `CHAR-IDENTITY-001` 的身份 schema 与读写实现：按稳定身份读取
关系、会话与去重状态，写入消息和候选时双写身份与修订，保留版本审计。
完整提交与其 lockfile 一起使用，避免只复制某个 repository 而遗漏依赖。

固定 SHA 不随开发分支移动。这个 PR 只改 Lucía workflow 的运行代码来源，
不会把开发分支的其他功能合入 main，也不运行数据库迁移。完整 checkout
会包含该提交的其他文件，但唯一业务入口仍为 `pnpm conversation:proactive`。
该提交已经包含当前生产库所用的可空 identity 列；核验确认库中已有它们。

已有 schedule、用户名单、Environment、concurrency、provider 配置、安全门禁、
幂等与失败退出码继续生效。固定提交仍采用其原有 Asia/Shanghai 日期/时段；
本机未提交的 Madrid 时区修改不包含在此修复内。

## 验证与启用

1. 在固定提交的独立 checkout 运行主动消息领域、runner、workflow 和
   persistence 专项测试；另用“v1 关系 / v2 会话 / 同一身份”的回归 fixture
   对照旧 repository 与固定提交。测试只使用 fake provider 与 PGlite。
2. 真实库仅做 SELECT：确认当前身份指针为 published v2，并按身份找到现有
   会话与 active 关系。不调用真实 provider，不写候选或消息，不输出对话或凭据。
3. 合并 PR 后，观察下一次自然 schedule 的 checkout SHA、生成步骤与退出码。
   `suppressed` 是正常资格结果；空 results 只能说明没有到期时段。
4. 真实 provider、完整生成/事务写入与 GitHub runner 环境仍需下一次正常运行
   确认。准备 PR 时不手动触发，因为触发可能调用收费 provider 并发送主动消息。

## 后续与回退

待 `main` 正式包含稳定身份 schema、repository、角色 runtime 及其依赖，并完成
验证后，删除这个 checkout ref，让任务恢复使用 main。不要在新修订发布后把
任务固定回 v1，也不要复制或移动用户会话来适配旧代码。

如需回退本次配置，只撤销 checkout ref；这会恢复已知有故障的 main 运行代码，
不能称为业务恢复。不得通过 `continue-on-error`、退出码置零或关闭通知掩盖故障。
本次没有数据库写入，因此不需要数据回滚。

## 本次验证记录

- 固定提交的独立 checkout：Vitest **4 files / 13 tests** 通过，含额外复制的
  v1 关系 / v2 会话回归；旧 main repository 在该回归报
  `CONVERSATION_UNAVAILABLE`，恢复固定提交后通过。
- 固定提交全仓 `tsc --noEmit` 通过。初选较新提交 `6ddb335` 时词句模块
  有 16 条既有类型错误，最终改选 `b6bfaae`；两者 Lucía 运行模块及 schema
  没有差异，初选提交不进入本次 workflow。
- PR 自身原有 workflow 单测 **1/1**、PyYAML 解析及 SHA / Environment /
  contents:read / 失败策略检查、定向 ESLint 与 `git diff --check` 通过。
- 初次真实库 SELECT 核验成功；后续只读复测遇到本机 DNS `getaddrinfo ENOENT`，
  不把连接复测记为通过，也不把它解释为本次 GitHub 的业务错误。没有输出库地址。
- 未跑全量 Vitest/lint/E2E/build：PR 不改产品源代码；固定运行提交已做全仓类型
  检查和主动消息领域/数据库专项。未安装第二份依赖，独立 checkout 使用本机
  已有 node_modules junction；GitHub 仍将按固定提交的 lockfile 全新安装。
- 未运行真实生成、收费 provider、候选/消息写入或手动 workflow dispatch；
  生产恢复须在合并后由下一次自然 schedule 验证。
- 额外的行为回归保留于共享工作树
  `tests/database/proactive-message-persistence.test.ts`，没有混入 main PR，
  因为 main 尚无 identity schema。它在固定 runtime 的独立 checkout 实跑，
  随后应由 `CHAR-IDENTITY-001` 合并者纳入对应代码分支。

## 2026-10-15 合并记录

> 更新：下方是 13:23 合并当时的历史核验，后续 17:26/22:19 的运行已使用
> 修复提交并进入 provider 阶段。新的接口空值故障见文末，不再是会话版本问题。

用户授权后，PR #77 已转就绪并于北京时间 **13:23** 合并至 main；
Merge Commit `118b350196489de40240e1ef9ad29e6eda7dd9e8`。
合并后经 GitHub contents API 核对，main workflow 的 checkout ref 为
`b6bfaae837e428b8e5c31f955d773392fecf085d`。

截至合并后核验，最近的 run 仍为 `38682503024`（北京时间 12:38），
运行旧 `eeb26bd` 并报 `CONVERSATION_UNAVAILABLE`；尚无合并后的新运行。
本次只确认配置已合入，实际生成/事务仍等待正常 schedule 验收。
没有手动 dispatch，也没有额外调用收费 provider 或写消息；不以旧任务的
成功空结果代替新配置验收。GitHub 调度存在延迟，不能承诺下个刻钟就有结果。

## 2026-10-15 22:40：MiniMax 接口空值配置纠正

22:21 收到的邮件对应 run `38750360953`（北京时间 22:19–22:20），
更早的 run `38713003738`（17:26）也有相同错误。checkout 已使用
`b6bfaae837e428b8e5c31f955d773392fecf085d`，依赖安装成功；最新运行三个
时段均返回 `provider-unavailable`，不再出现旧 `CONVERSATION_UNAVAILABLE`。

GitHub Environment 未配置 `MINIMAX_API_ENDPOINT`。workflow 显式把这个变量
传入进程时，值是空字符串；MiniMax factory 使用
`options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint`，
空字符串不会触发默认值，最终 fetch 收到空 URL。URL 解析失败被 adapter
包装为 `provider-unavailable`，因此日志看起来像供应商不可用。

本机用 fake key 与 fake fetch 对照（不联网、不读取对话、不写消息）：
空字符串复现 `provider-unavailable`；显式使用代码既有默认接口后，请求能
正常构造且 fake 响应解析成功。北京时间 **22:40** 已把
`content-production.MINIMAX_API_ENDPOINT` 显式设置为
`https://api.minimaxi.com/anthropic/v1/messages`，并回读确认。
没有更换 API key、供应商或模型，没有手动 dispatch 或额外生成消息。

后续正常运行应确认不再因空 URL 失败，并检查完整生成或正常抑制结果。
fake 对照不能代替 GitHub 网络、真实凭据与真实回复验证，因此尚不宣称
生产生成恢复。本次仅修配置，不重跑全量代码测试。通用 factory 对空白
配置的防御仍待独立代码修复；目前这个非密钥 Environment 变量必须保留。

## 2026-10-18：发布 lucia@3 后固定 runtime 能力清单过期

用户下午与晚上再次收到失败邮件：run `39102100304`（13:53）、
`39119266872`（18:26）、`39134486134`（22:06）均以 `CHARACTER_UNAVAILABLE`
退出 1。未到期的调度仍返回 `{"results":[]}` 并显示成功，所以邮件只在进入
三个到期时段后出现。

根因不是数据库或 provider：固定提交 `b6bfaae` 的运行时能力清单只登记
`lucia@1/v2`，而生产库已于 **2026-10-16 22:05** 发布 `lucia@3` 并翻转身份
指针；`findLucia` 先按身份读取当前修订，再用静态清单校验能力，查不到 v3
就整体失败。也就是说，**发布新人物修订不只要写库，还必须让运行时代码
认识该修订**。

修复 Commit `3bd7f4bcd5b71d98fae58cd91268cb8bda2af0f4`（分支
`codex/lucia-proactive-v3-runtime`，tag `lucia-runtime-v3`），在固定 runtime
基线上：

- 在 `characterRuntimeDefinitions` 登记 `lucia@3`（published、proactive）；
- 静态目录投影升到 v3，携带已发布修订的 8 条 `responseStyle`；
- runner 与手动 proactive route 经服务端 resolver 取已发布快照并显式传给
  生成/预览，缺少快照时失败关闭，不再静默使用静态人物；
- 首次用户回复前返回 `awaiting-first-user-message`，不让调度器抢在
  authored opening 之后继续发消息。

验证：独立 worktree 全仓 `tsc --noEmit` exit 0；相关单测 8 文件 84 项通过
（唯一失败的 `lucia-data-route` 认证用例在未改动的同一 checkout 也失败，
属本机 Next request scope 基线）；只读生产探针得到 catalog v3 →
resolved v3（8 条规则）、关系 active、三个时段到期，且不再抛
`CHARACTER_UNAVAILABLE`。未部署网站、未迁移或写生产库、未提交应用代码到
main。

**后续约定**：每次发布新的人物修订后，必须同时把该修订登记进运行时代码
的能力清单、更新静态目录回退，并把本 workflow 的 `ref` 指到包含这些改动的
提交；否则定时任务会以同一个 `CHARACTER_UNAVAILABLE` 失败。main 正式接入
身份实现后移除本 pin，改回跟随 main。

## 2026-10-18 22:29：合并后 dispatch 验证

PR [#78](https://github.com/laurenzhong/Spanish/pull/78) 已合入 main
（merge `707a79b238af46eb9f5ddeb3cbadfa79af16fd98`，workflow 更新提交
`e380325`，checkout ref 为 `3bd7f4bcd5b71d98fae58cd91268cb8bda2af0f4`）。
北京时间 **22:29** 手动 dispatch run
[`39136141749`](https://github.com/laurenzhong/Spanish/actions/runs/39136141749)
成功，耗时约 45 秒，`pnpm install` 与生成步骤均成功：

```json
{"date":"2026-10-18","generated":1,"suppressed":2,"failed":0,
 "results":[{"status":"generated","messageId":"cd6d715d-9f97-4782-bdbc-1402b500d4f8"},
            {"status":"suppressed","reason":"cooldown"},
            {"status":"suppressed","reason":"cooldown"}]}
```

三个到期时段中第一个真实生成，其余两个按 4 小时冷却正常抑制，退出码 0。
只读核对：`messages` 行为 `role=character`、`status=completed`、
`source_type=proactive`，关联角色修订 v3；候选为 `generated` 且无错误码。
未部署网站、未迁移，也没有额外写其他用户数据。

下一次自然 schedule 仍需按惯例核对 checkout SHA 与结果；同一 workflow 与
同一命令已完成真实 provider 生成的端到端验证，因此不再等待空 `results`
作为恢复证据。

## 2026-10-20：安全门拒绝的重试与原因码（LUCIA-CI-003）

2026-10-20 13:07（北京时间）的定时 run `39373158863` 结果为
`{"generated":0,"suppressed":0,"failed":1,"reason":"safety-gate"}`：
provider 返回的样本被 `isProactiveMessageSafe` 拦截（该门禁是设计内的
防御，不是基础设施故障），但旧实现只记录笼统的 `safety-gate` 且不再重采样，
workflow 因此失败并发送邮件。相邻三次调度（16:29Z、21:12Z、00:23Z）均成功。

修复 Commit `d4962811e6c245db2e9f490a1e3598cdd8f41e39`（分支
`codex/lucia-proactive-v3-runtime`，tag `lucia-runtime-v3.1`）：

- `proactiveMessageSafetyViolation` 为每条规则返回稳定原因码
  （`unsupported-script`、`question-policy`、`markdown` 等），
  `isProactiveMessageSafe` 只是它的布尔包装；生成/预览把
  `safety-gate-<code>` 写入候选与运行结果，不记录消息正文。
- 定时 runner 对单个时段最多尝试 3 次生成，只在 `provider-unavailable`
  或 `safety-gate-*` 时重试；候选由 repository 重新置为 generating，
  因此每次重试都会向 provider 重新采样。
- 3 次仍被拒绝仍会失败，保留对持续提示词/模型回归的告警；不接受把安全
  门禁降级为静默通过。

验证：全仓 `tsc --noEmit` exit 0；4 个相关测试文件 **32 项**通过；定向
ESLint exit 0。workflow 的 checkout ref 同时更新为本提交。

合并与真实运行：PR [#81](https://github.com/laurenzhong/Spanish/pull/81)
于北京时间 **14:47** 合入 main（merge `a8eaff9`，workflow 更新提交
`3fbeb97`）。**14:48** 手动 dispatch run
[`39382437757`](https://github.com/laurenzhong/Spanish/actions/runs/39382437757)
成功（约 50 秒）：

```json
{"date":"2026-10-20","generated":1,"suppressed":1,"failed":0,
 "results":[{"status":"generated","messageId":"cb265178-09ea-4b7a-adb0-ba20b27e4a26"},
            {"status":"suppressed","reason":"cooldown"}]}
```

今早被安全门禁拦截的时段在重采样后真实生成；第二个到期时段按 4 小时冷却
正常抑制，退出码 0。后续若再次出现 `safety-gate-<code>`，应按原因码排查
提示词或模型，连续两次以上同类拒绝需要另立修复，而不是继续增加重试次数。

## 2026-10-22：连接层 statement timeout 崩溃（LUCIA-CI-004）

2026-10-22 07:18（北京时间）的自然调度 run `39692576920`（main `bf7ef5c`，
实际 checkout 固定提交 `d496281`）在生成步骤以
`PostgresError: canceling statement due to statement timeout`（SQLSTATE `57014`）
退出 1；日志里没有 `LUCIA_PROACTIVE_FAILED` JSON，也没有运行结果行。相邻调度
（04:02、前一日 23:58）成功，09:30 手动 dispatch 复跑也成功，说明数据库当时已经
恢复，属于一次瞬时取消而不是持续故障。

只读定位：被取消的语句不是 runner 自己的查询，而是 postgres.js 在连接第一条
语句前执行的内部 `fetch_types` 目录查询（`select ... from pg_catalog.pg_type ...`）。
驱动在 `ReadyForQuery` 中调用 `fetchArrayTypes()` 时没有保留或等待它的 promise，
因此服务器端取消该语句后，这个 rejection 绕过脚本自己的 `main().catch`，Node 以
`triggerUncaughtException` 直接崩溃。证据：默认连接的首条语句就是该目录查询；
连接 URL 加 `fetch_types=false` 后该内部语句消失（postgres.js `debug` 钩子实测）；
runner 只读标量与 JSON 列，不依赖数组类型解析。

修复 Commit `0c63a746cfb4ab666b016cb49e59aac6f2dea636`（分支
`codex/lucia-proactive-v3-runtime`，tag `lucia-runtime-v3.2`）：

- 定时 runner 连接前给 `DATABASE_URL` 增加 `fetch_types=false`，关闭上述内部
  查询；其他使用方保持 postgres.js 默认。
- runner 入口安装 `unhandledRejection` / `uncaughtException` / `main` 失败报告：
  统一同步输出一行 `{"code":"LUCIA_PROACTIVE_FAILED","reason":...,
  "message":...,"pgCode":"57014"}`（只把 5 位 SQLSTATE 记为 `pgCode`）并立即
  exit 1，避免下次只看到裸的 `triggerUncaughtException`。
- 单测补充连接 URL 与失败 JSON 的断言；本 workflow 的 checkout ref 更新为该提交。
- main 的 runner 同步加入相同硬化（当前仍由 pin 保护，尚未被调度使用）。

验证：固定 runtime 与 main 全树 `tsc --noEmit` 均 exit 0；`lucia-proactive-runner`
（固定 runtime 6 项 / main 5 项）与 `lucia-proactive-workflow` 1 项通过；改动文件
ESLint exit 0；真实 transaction pooler + 真实库只读路径（固定非到期时钟）返回
`results: []`、约 2.1 s、未调用 provider 也未写消息；指向无效连接地址时入口
输出单行 JSON 并 exit 1。

GitHub 环境验证：从修复分支手动 dispatch run
[`39708037334`](https://github.com/laurenzhong/Spanish/actions/runs/39708037334)
结论 success，checkout ref 为 `0c63a74`，生成步骤输出
`{"date":"2026-10-22","generated":0,"suppressed":1,"failed":0, ... "reason":"daily-limit"}`
并 exit 0；当日额度已满，因此这次验证没有调用 provider、也没有写消息。
同日 09:41 的自然调度 run `39707140882`（旧 pin `d496281`）也已 success，
说明数据库侧在崩溃后已恢复。

回退：只把 workflow 的 checkout ref 回退到 `d496281`；不要通过忽略退出码、
`continue-on-error` 或关闭通知掩盖故障。本修复没有数据库写入，不需要数据回滚。

限制/下一步：没有在 GitHub runner 上复现那次瞬时取消本身（数据库侧触发条件
不可得，复跑已成功）；`OPS-LUCIA-PIN-001` 仍待处理，移除 pin 前必须保留
`d496281`/`0c63a74` 上的 safety-gate 重试与本次连接层硬化。

## 2026-10-23：主动消息混入英语（CONV-LANG-002）

2026-10-23 11:29:36（北京时间）的自然调度 run
[`39895246964`](https://github.com/laurenzhong/Spanish/actions/runs/39895246964)
（main `ef78463`，实际 checkout 固定提交 `0c63a74`）成功生成并写入了一条
主动消息，但正文混入英语：

> Buenos días. Acabo de Wake Up y foster me he acordado de ti. Oye, ¿has desayunado ya?

只读库确认：`messages` 行 `c4f22ac3…`（`source_type=proactive`、
`2026-10-23T03:29:36.133Z`、`generation_id=8d88c62f…`），对应 `daily_share`
候选 `660d2b6c…`（`dedupe_key=lucia:daily_share:2026-10-23:slot-1`）为
`generated`，没有错误码；全库只有这一条消息含 `wake`，`foster` 在消息、记忆、
人物包和仓库中零匹配，因此是真实 provider 生成时混入的英语，不是用户回显。
根因有两层：`language-purity` 的 `containsUnsupportedScript` 只查汉字/假名/
谚文，英语与西语同属拉丁字母，整条消息越过脚本门禁；该时段
`dailyState=waking`，provider system prompt 用英文写着 “such as waking up,
coffee, breakfast…”，模型把英文指导照抄成 `Wake Up` 并额外生成了一个英语词
`foster`。prompt 不是安全边界，文本门禁又没有英语检查。

修复 Commit `5b83aaab31a6fec983f817ac87857630476c2b6a`（分支
`codex/lucia-proactive-v3-runtime`，tag `lucia-runtime-v3.3`）：

- `conversation/domain/language-purity.ts` 增加高精度英语片段检测：已报告短语
  （`wake up`、`good morning`、`thank you`、`that's great`、`by the way`、
  `I miss you` 等）与英语功能词/小品词整词表；单词只在原文小写时命中
  （`token.original === token.lower`），因此首字母大写的标题/人名/缩写
  （`It`、`The Beatles`、`IT`、`síndrome de Down`）与去重音同形词 `aré`
  不会误判。
- `proactiveMessageSafetyViolation` 增加稳定原因 `english-fragment`，生成/预览
  写为 `safety-gate-english-fragment`；runner 既有的 `safety-gate-*` 最多 3 次
  重采样路径自动生效，3 次仍被拒仍按失败告警，不写入消息。
- 两家 provider 的 prompt 明确“消息必须全西语、不得从英文指令复制单词”，
  `dailyState=waking` 的正文示例改为 `Me acabo de despertar`、`el café`、
  `el desayuno`、`empezar el día`。
- 同一 PR 在 main 的产品代码加入相同语言门禁：普通对话回复也拒绝英语片段，
  只放行“用户本轮显式要求其他语言”或“恰好一个且全部词元来自用户本轮消息”
  的引用；重试指令点名真正未被引用的片段。

验证（全部实跑）：固定 runtime 聚焦 5 文件 **50/50**、runner **6/6**、
workflow **1/1**，全树 `tsc --noEmit` exit 0、改动文件 ESLint exit 0；main
聚焦 5 文件 **100/100**、全树 `tsc --noEmit` exit 0、改动 10 个 TS/TSX 文件
ESLint exit 0；真实 MiniMax-M3 合成探针 2/2 输出纯西语且通过门禁；只读扫描
真实库 37 条已完成消息只有本次事故被命中；2,232 条西语 Tatoeba 例句与
bundle/人物包 8,500+ 条西语文本零误报；临时移除门禁后新增用例 5 项失败，
恢复后通过。

workflow 的 checkout ref 同时更新为 `5b83aaa`。

合并与生产验证：PR [#85](https://github.com/laurenzhong/Spanish/pull/85) 于
北京时间 **15:42** 合入 main（merge `e7a3386`，实现提交 `bed6963`/`04afff7`）。
GitHub schedule 当日自 03:29Z 之后数小时未触发（最近自然 run 仍是
`39895246964`），因此用 `workflow_dispatch` 做一次受控验证：run
[`39919703135`](https://github.com/laurenzhong/Spanish/actions/runs/39919703135)
（main `e7a3386`）success，checkout ref 为 `5b83aaa`，生成步骤输出
`{"generated":2,"suppressed":0,"failed":0,...}`：slot-1 命中当天已有的
`generated` 候选，幂等返回原 `messageId=c4f22ac3…`；slot-2 真实调用 provider
并写入新消息 `messageId=f6962fc8…`。只读核对：新消息为纯西语、不含英语片段
（运行手册不记录正文），对应候选 `dedupe_key=lucia:daily_share:2026-10-23:slot-2`
为 `generated`、`last_error_code=null`。该次 dispatch 写入的是当天到期 slot-2
的正常主动消息（真实 provider，计入当日额度），不是测试消息；若当日额度已满
或未到期，dispatch 只会返回 suppressed，不能作为本条修复的反证。

回退：只把 workflow 的 checkout ref 回退到 `0c63a74`（恢复旧语言门禁）；
不要通过忽略退出码、`continue-on-error` 或关闭通知掩盖故障。本次没有数据库
写入，不需要数据回滚。

限制/下一步：英语检测是有界高精度启发式，未报告的单个英语实词、句子开头的
首字母大写英语（如 `The best.`）与已移除的常见借词（`and`/`after`/`down` 等）
仍可能通过，靠其他标记词兜底；它是 fail-closed 取舍，不做全文语言识别。
GitHub 的 `*/15` schedule 在本仓库当日实际间隔可达数小时，因此生产验证使用了
一次显式 dispatch；后续自然调度仍需按惯例核对 checkout SHA 与结果（预期为
`5b83aaa`）。`OPS-LUCIA-PIN-001` 仍待处理，移除 pin 前必须保留 `d496281`/
`0c63a74`/`5b83aaa` 上的 safety-gate 重试、连接层硬化与本次英语门禁。
