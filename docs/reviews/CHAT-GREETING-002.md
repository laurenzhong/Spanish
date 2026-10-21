# CHAT-GREETING-002：聊天中途 Lucía 再次以问候开场

2026-10-21，所有者报告：与 Lucía 的连续对话中，Lucía 重新发来打招呼的消息。截图最后一条为用户 `Pues sí, es una buena idea.` 之后 Lucía 回复 `¡Hola! ¿Qué tal te va con el día gris?`。本聊天负责，沿用共享分支 `codex/disable-legacy-readlang`，保留其他任务的在途改动。Commit：无；未提交、推送或部署。状态与最终结果同步于 `PROJECT_STATUS.md`。

## 1. 只读事实核查（真实库）

按所有者唯一用户只读查询真实会话与 provider 观测，未写入任何数据：

- 该轮用户消息 `Pues sí, es una buena idea.` `created_at=2026-10-21T08:58:07.845Z`（北京时间 16:58:07），`source_type=translation_assisted`；角色回复该轮 `generation_id=generation-9775efcd-a486-45fd-a2ab-96e25b312c33`、`source_type=conversation`、`reply_to_message_id` 指向该用户消息，不是主动消息。最终落库内容为 `¡Hola! ¿Qué tal te va con el día gris?`。
- 同一 generation 的 `provider_calls` 有两条：第一次 `status=failed / error_type=safety-gate`（约 4.9s），紧接着第二次 `status=succeeded`（约 1.3s）。即用户看到的是**唯一一次安全重生成**的结果，第一次被门禁拒绝的文本从未展示。
- 当天 Lucía 已经问候过：`Buenos días. Yo ya estoy en marcha…`（13:54，proactive）和 `¡Hola! Yo bien, ya funcionando a tope. ¿Tú qué tal?`（16:40）。该轮之前最近一条角色消息是 16:53 的 `Uff, los días de lluvia…`，不以问候开场。
- 该回复以两个气泡渲染（`splitReplyBubbles` 为空行分条），说明截图来自本工作区分支的 dev 应用，不是缺少本分支修复的默认分支构建。

## 2. 根因

- 同日重复问候门禁 `isRedundantGreetingReply`（[stream-reply.ts](../../src/modules/conversation/application/stream-reply.ts)）只取 `recentMessages` 中**最后一条**非空角色消息，判断它是否以问候开场；本例最后一条是 16:53 的 `Uff, los días de lluvia…`，因此返回 false，没有看到当天 16:40 已发生的问候。设计规格 §5.5/§9 要求的是“同一本地日内角色已经问候过、用户当前消息不是问候，就不得再以问候开场”，实现只覆盖了“连续两条都问候”的 2026-10-12 形态（`CHAT-GREETING-001`）。
- 第一次生成被其他门禁拒绝后，唯一一次重试只收到“纠正被点名缺陷”的指令；provider prompt 的问候规则同样只写“自己上一条消息已经问候过”，模型没有“今天已经问候过”的明确信号，于是重试改用 `¡Hola! + 新问题` 重新开场。该输出通过了只回看一条消息的旧门禁并落库。
- 该轮同时暴露出：重试可能修正原缺陷却引入另一项违规，而旧流程不会在重试里预先禁止问候。

## 3. 实现

- 新增纯领域 `src/modules/conversation/domain/local-date.ts`：把 `localDateInTimeZone` 从 application 迁出，供 `sameLocalDay` 投影与问候门禁共用同一套本地日换算（不复制第二份）。
- 新增纯领域 `src/modules/conversation/domain/greeting.ts`：`greetingOpener`（从 stream-reply 迁出，行为不变）与 `hasGreetedOnLocalDate(messages, localDate, timeZone)`——扫描当天**所有**角色消息，任一以问候开场即视为当天已问候；时间戳无法解析的消息忽略，不凭猜测拦截。
- `build-reply-context.ts`：`ReplyContext` 增加 `alreadyGreetedToday?`，使用未受 8,000 字符预算裁剪的 `recentMessages` 派生，避免长对话把当天更早的问候挤出上下文预算。
- `providers/conversation/conversation.ts`、`minimax-conversation.ts`、`openai-conversation.ts`：内部 provider DTO 与序列化 JSON 增加 `alreadyGreetedToday`；两家 system prompt 的同一条问候规则改为引用该字段（当天已问候且用户本条不是问候时不再问候；新本地日或用户重新问候仍可问候）。
- `stream-reply.ts`：门禁改为 `alreadyGreetedToday ?? hasGreetedOnLocalDate(recentMessages, currentLocalDate, conversationTimeZone)`，用户重新问候/跨日/缺时间戳的豁免不变；重试时若“当天已问候、用户本条不是问候、且被拒文本本身不是问候”，在既有重试指令后追加禁止问候的明确约束，并设置 `alreadyGreetedToday` 进入重试上下文。第二次仍以问候开场时按既有 fail-closed 规则发送 `stream-failed`，不产生 delta/done，不落完整助手消息。

## 4. 文件

- 实现：`src/modules/conversation/domain/{local-date,greeting}.ts`、`src/modules/conversation/application/{build-reply-context,stream-reply}.ts`、`src/modules/providers/conversation/{conversation,minimax-conversation,openai-conversation}.ts`。
- 测试：`tests/unit/greeting.test.ts`（新）、`tests/unit/conversation-provider-greeting.test.ts`（新）、`tests/unit/conversation.test.ts`（新增两例回归）。
- 文档：本文、`docs/architecture.md`、`docs/testing-strategy.md`、`docs/superpowers/specs/2026-08-29-conversation-context-continuity-design.md`、`PROJECT_STATUS.md`。

## 5. 验证

- 新增/相关聚焦：`tests/unit/greeting.test.ts` **15/15**、`tests/unit/conversation-provider-greeting.test.ts` **4/4**、`tests/unit/conversation.test.ts` **41/41**；合并相关 30 个 `tests/unit/conversation*` 与 `reply-plan`/`reply-continuity`/`proactive-message`/两家 provider/`character-provider-projection` 文件 **316/316** 通过（单 worker）。
- 全树 `node node_modules/typescript/bin/tsc --noEmit` exit 0；改动 10 个 TS/TSX 文件 `node node_modules/eslint/bin/eslint.js --max-warnings=0` 通过（无输出）。
- 变异验证：① 把同日扫描门禁临时改成恒 false，`conversation.test.ts` **3 failed / 38 passed**（两例新回归 + 原“同日问候两次”回归均失败），恢复后全绿；② 去掉重试里的禁止问候约束，对应回归 **1 failed**，恢复后全绿。
- 回归覆盖：本次真实 transcript（16:40 问候 → 16:47/16:53 普通消息 → 16:58 用户非问候）同日再问候被拦、重试改接内容后 done；以及“第一次因复用短语被拒、重试改用问候开场”的重试路径在第二次仍问候时无 delta/done、两次观测均为 `safety-gate`。

## 6. 限制与用户验证

- 门禁仍是有界规则：只识别明确问候开场（`hola`/`hey`/`buenas`/`buenos días`/`buenas tardes`/`buenas noches`/`qué tal`）与可解析时间戳；不覆盖任意改写、其他语言的问候或时间戳缺失的历史。`alreadyGreetedToday` 只减少模型违规生成，不替代门禁。
- 未调用真实 MiniMax/OpenAI provider 复聊（会消耗费用并写库），未跑全量 Vitest/E2E/build（共享树既有 OOM 与基线失败），未做浏览器逐帧或 iPhone Safari 真机验收。本次结论来自只读真实库/观测、离线 fake provider 回放和类型/单测门禁；不保证任意模型输出自然度。
- 该回复同时存在另一处独立语言质量问题：`la gente con paraguas transparentan un poco la escena`（形容词 `transparentes` 被写成动词、主谓不一致）；属模型西语生成质量，不在本任务的问候门禁范围内。
- 用户验证：刷新本机 `/chat/lucia`，在已经互相问候过的当天继续聊天（尤其连续多轮普通消息之后），新的回复不应再以 `¡Hola!`/`Buenos días…` 等问候开场；若用户重新问候或跨到下一本地日，Lucía 仍可正常问候。本地 dev server 会热更新，不需要重启。
