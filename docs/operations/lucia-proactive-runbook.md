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

用户授权后，PR #77 已转就绪并于北京时间 **13:23** 合并至 main；
Merge Commit `118b350196489de40240e1ef9ad29e6eda7dd9e8`。
合并后经 GitHub contents API 核对，main workflow 的 checkout ref 为
`b6bfaae837e428b8e5c31f955d773392fecf085d`。

截至合并后核验，最近的 run 仍为 `38682503024`（北京时间 12:38），
运行旧 `eeb26bd` 并报 `CONVERSATION_UNAVAILABLE`；尚无合并后的新运行。
本次只确认配置已合入，实际生成/事务仍等待正常 schedule 验收。
没有手动 dispatch，也没有额外调用收费 provider 或写消息；不以旧任务的
成功空结果代替新配置验收。GitHub 调度存在延迟，不能承诺下个刻钟就有结果。
