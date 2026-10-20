# CHAT-PROACTIVE-CONTINUITY-001：主动消息使用会话上下文与重复追问门禁

2026-10-19/20，所有者报告：Lucía 当天主动发来两条消息；第一条的时间戳是否对应周一；第二条重新问“平时更常拍人还是拍风景”，而这个问题此前已经问过且用户已经回答。本聊天负责，沿用共享分支 `codex/disable-legacy-readlang`，保留其他任务的在途改动。Commit：无；未提交、推送或部署。状态与最终结果同步于 `PROJECT_STATUS.md`。

## 1. 只读事实核查（真实库）

按所有者与主动消息 allowlist 的唯一用户只读查询真实会话（未写入任何数据）：

- 第一条 `source_type=proactive` 消息 `created_at=2026-10-19T03:24:16.513Z`，即北京时间 2026-10-19 11:24:16；第二条 `2026-10-19T09:12:43.416Z`，即北京时间同日 17:12。两天前（10-17）用户确实已说过 `A mí me gusta fotografiar temas de gente y paisajes.`，Lucía 当时也追问过 `¿Qué tipo de paisajes te llaman más...?`；10-19 17:12 的主动消息又发出 `¿Tú sueles disparar más a gente o a paisajes?`。两条主动消息分别对应 `daily_share` 的 `slot-1` / `slot-2` 候选，属当前多时间槽设计的正常调度数量。
- 日期本身没有缺陷：2026-10-19 是周一；聊天界面展示的完整时间精确到秒（`2026年10月19日 11:24:16`）来自“点击消息展开精确时间”，普通分隔只在跨日或间隔超过 5 分钟时显示时间；数据库时间按浏览器 `Asia/Shanghai` 正常换算。所有者看到的“今天应该是周一”与截图日期一致。
- 真实库中两条与摄影有关的记忆一条为 `candidate`（“la fotografía urbana”），另一条为 `conflict`（“fotografiar temas de gente y paisajes”）；普通上下文投影会过滤 `conflict`，因此旧实现即使有记忆也不能凭它知道用户已经回答过。

## 2. 根因

主动消息生成路径把 provider 输入固定为 `recentMessages: []`、`rollingSummary: null`、`openTopics: []`，既没有最近会话消息，也没有 `currentLocalDate`/时区投影，只拿人物快照、关系摘要和可读记忆。因此模型无法知道“人还是风景”已经被回答过，也无法知道当前角色本地日期（可能写出与当天不符的星期表述）。主动消息的文本门禁 `isProactiveMessageSafe` 只检查语言纯度、敏感词、问题预算和长度，不比对历史，所以重复追问可以一次通过。真实截图内容与上述数据完全吻合，不是渲染或日期换算问题。

## 3. 实现

- `src/modules/conversation/repositories/proactive-message-repository.ts` 增加 `listRecentMessages(userId, limit)`；drizzle 实现只读取该用户 Lucía 会话中 `status=completed` 的消息，按时间正序返回并限制上限，撤回/流式中/空正文不进入上下文。
- `src/modules/conversation/application/generate-proactive-message.ts`：生成与预览统一通过 `buildReplyContext` 组装上下文（最近已完成消息、`openTopics`、`characterClaims`、`openCommitments`、`currentLocalDate`、`Europe/Madrid` 时区、可读记忆），provider 还收到针对主动消息的连续性指令；`previewLuciaProactiveMessage` 新增可选 `now` 以便确定性测试。
- `src/modules/conversation/domain/proactive-message.ts` 新增纯领域 `repeatsAnsweredQuestion(recentMessages, reply)`：① 选择问句 `X o Y` 的两个选项都已在近期用户消息中出现；② 近乎逐字重复角色已问且下一条用户消息已作答的问题（显著词 Jaccard ≥ 0.75 且至少 4 个词）。无历史、无法解析或只有一个已知选项时不拦，避免把自然追问误判为重复。
- 生成器：先通过原有 `isProactiveMessageSafe`；若 `repeatsAnsweredQuestion` 命中，则带针对性指令最多重生成一次；第二次仍命中即整条候选失败并记录 `safety-gate`，不写入任何用户可见消息。预览走同一门禁但从不落库。
- `minimax-conversation.ts` / `openai-conversation.ts` 两个 provider 的 system prompt 增加 `inputKind=proactive` 的上下文规则：`recentMessages`/`memories`/`openTopics` 是已经发生的对话，不得追问用户已提供的信息、不得重复已问已答的问题、不得复用自己的上一条消息；继续旧话题时必须补充真正新的观察，纯陈述也是完整主动消息。

## 4. 文件

- 实现：`src/modules/conversation/{application/generate-proactive-message.ts,domain/proactive-message.ts,repositories/proactive-message-repository.ts,repositories/drizzle-proactive-message-repository.ts}`、`src/modules/providers/conversation/{minimax-conversation.ts,openai-conversation.ts}`。
- 测试：`tests/unit/proactive-message.test.ts`（上下文投影、真实截图重复问句被拦、一次重生成、二次失败、旧安全门禁回归）、`tests/database/proactive-message-persistence.test.ts`（`listRecentMessages` 只返回 completed、正序、limit，且不跨用户泄漏）。
- 文档：本文、`docs/architecture.md`、`docs/testing-strategy.md`、`docs/superpowers/specs/2026-08-28-lucia-relationship-growth-and-proactive-messaging-design.md`、`PROJECT_STATUS.md`。

## 5. 验证

- `tests/unit/proactive-message.test.ts` **17/17**、`tests/database/proactive-message-persistence.test.ts` **4/4**、`tests/unit/lucia-proactive-runner.test.ts` **3/3**、`tests/unit/lucia-proactive-route.test.ts` **3/3**、`tests/unit/minimax-conversation.test.ts` **9/9**、`tests/unit/openai-conversation.test.ts` **10/10**，合计 **46/46**（`--maxWorkers=1`）。
- 全树 `node node_modules/typescript/bin/tsc --noEmit` 通过（exit 0，无输出）。
- 真实 MiniMax-M3 有界合成回放（只使用虚构历史，不读取真实用户对话、不写数据库、不代发消息）：provider 收到 7 条最近消息、`currentLocalDate=2026-10-19`、`Europe/Madrid`；一次生成即通过门禁，输出围绕“最近有没有出去拍照”的新问题，没有重问“人还是风景”，未触发重生成。该结果只证明这一组合成场景，不保证任意模型输出自然度。

## 6. 限制与用户验证

- `repeatsAnsweredQuestion` 是有界词法检查，不理解任意同义改写；它能拦截本次报告的两个形状，但不能证明所有“已知信息被重新提问”都会被识别。
- 主动消息的每日 3 条/4 小时间隔是多时间槽设计的服务端资格规则，本次没有改变频率；当天两条来自 slot-1/slot-2。若希望减少主动消息数量，需要另立产品任务调整资格，不在本修复内顺手修改。
- 只读核查发现“已提交到默认分支的 runner 默认时区是 `Asia/Shanghai`，而架构文档与共享工作树的在途改动使用 `Europe/Madrid`”，本任务未改动这条在途差异，也没有提交/部署；GitHub 定时 workflow 仍按默认分支已提交代码运行，下一次提交合并前线上主动消息仍是旧逻辑。
- 未跑全量 Vitest/E2E/build、远端迁移/RLS、Safari 真机；没有向所有者的真实聊天线程写入测试消息。
- 所有者验证：在本地已加载本改动的 dev server 上，用真实账号打开 `/chat/lucia`，通过开发预览入口（`POST /api/v1/conversations/lucia/proactive` 带 `preview: true`）或下一次本地生成，检查主动消息会引用已有对话且不再追问“人还是风景”；本地写入一条真实主动消息会进入聊天历史且消耗当日额度，属预期。
