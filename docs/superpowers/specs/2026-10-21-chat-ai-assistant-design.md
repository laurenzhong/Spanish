# 聊天页 AI 助手（CHAT-ASSISTANT-001）设计

- 日期：2026-10-21
- 状态：已实现，`review`（2026-10-21；实现与验证见[交接](../../reviews/CHAT-ASSISTANT-001.md)）
- 范围：Next.js 响应式 Web/PWA 聊天页面
- 关联：CHAT-ASSIST-001/002/003（输入区翻译辅助）、ADR-0019（统一合成朗读）、`docs/architecture.md` 对话章节

## 1. 背景与目标

所有者要求在聊天页面右上角「更多对话操作」菜单里增加一个 AI 助手，用于三类真实学习需求：

1. 不知道该怎样回复对方时，向 AI 助手要可用的西语回复；
2. 不确定自己编辑或准备发送的西语是否存在语法错误，让 AI 助手检查；
3. 想知道某句西语的句子构成成分（主语、谓语、宾语、状语等）。

AI 助手是**学习工具**，不是新的角色，也不进入角色私信历史。它必须遵守个人 Alpha 的隐私与能力边界：

- 只读当前用户与当前已发布角色之间已经完成、未撤回的消息，不接受客户端伪造上下文；
- 不写消息、关系记忆、人物事实、能力证据或评分；
- 不自动发送任何消息；只有学习者显式点「填入输入框」并自行发送才进入聊天；
- 供应商调用只记录元数据（providerType=assistant、model、延迟、请求 ID、费用估算），日志不写问题、草稿、对话正文或模型输出；
- 普通聊天不调用高成本严格发音评分；AI 助手同样不产生任何口语/能力证据。

本文档是实现和测试的权威契约。`src/modules/conversation/schemas/conversation-assistant.ts` 是请求/响应 DTO 的单一来源。

## 2. 入口与交互

### 2.1 入口

聊天顶栏「更多对话操作」菜单（`src/modules/conversation/ui/chat-thread.tsx`）新增第一项 **「AI 助手」**，保留「搜索消息」「关系资料与清理」。点击后关闭菜单并打开助手面板。

### 2.2 面板

`ConversationAssistant`（`src/modules/conversation/ui/conversation-assistant.tsx`）是聊天线程内的非模态浮层：

- 桌面（≥960px）：贴聊天面板右侧的浮层，宽约 400px，位于顶栏下方、输入区上方；不遮挡输入框的发送能力。
- 手机（<960px）：接近全屏的面板，带遮罩，关闭按钮和 Escape 均可退出；输入区与安全区适配。
- 标题「AI 助手」，一行说明「问怎么回复、检查语法，或分析句子成分。」
- 顶部三个快捷操作（role=button）：
  - **帮我回复**：`intent=reply`。若面板输入框已有文字，作为 `question` 一起发送（例如“想拒绝她的邀请，怎么回？”）。
  - **检查语法**：`intent=grammar`，`targetText` 依次取面板输入框文字、当前聊天输入框草稿；两者都空时提示先写/粘贴一句西语并把焦点移入面板输入框，不发请求。
  - **分析句子成分**：`intent=structure`，`targetText` 有则用面板输入框文字；没有则发空目标，由服务端回退到当前对话里角色最后一条完整消息（面板提示会说明这一点）；没有任何可分析句子时返回明确错误。
- 底部一个多行输入框 + 发送按钮：发送 `intent=question`，`question` 必填（1–800 字符）。
- 面板内保留本次会话的临时问答记录（关闭面板后再打开仍保留，切换角色或刷新页面即丢失；不写数据库、不写 localStorage）。
- 结果渲染：
  - 始终显示 `answer`（中文解释，`white-space: pre-wrap`）；
  - `reply` 的建议列表：西语（`lang="es"`）+ 中文说明，每条有「填入输入框」和「听一遍/停止」；
  - `grammar` 的 `correctedSentence`（有则显示）与 `corrections` 列表（原句 → 修改 + 解释），有修正句时提供「使用修正句」；
  - `structure` 的 `structure` 列表（成分片段、中文成分名、解释）。
  - 「填入输入框」调用 `onApply(text)`：写入聊天草稿、关闭面板、焦点回到聊天输入框；是否发送由用户决定。
  - 朗读西班牙语统一走 `useReadAloud`/`createReadAloud`（ADR-0019 固定 Serene Woman），不允许浏览器 `speechSynthesis`。
- 状态：空状态（介绍三种用途）、加载（禁用操作、可取消/关闭即 abort）、错误（就地显示、保留上次输入、可重试）、无建议/无结构块时只显示 answer。
- 关闭：× 按钮、Escape、点击面板外部；关闭时 abort 在途请求并停止朗读；打开时焦点进入面板，关闭后焦点回到「更多对话操作」按钮。
- 角色切换/卸载：取消请求、清空临时记录，旧响应不得写入。

### 2.3 不做

- 不把助手回答写入聊天、不新增消息类型、不做自动建议气泡；
- 不持久化助手对话，不提供单独助手联系人；
- 不修改角色回复 provider/system prompt；
- 不产生证据、评分、关系升级或记忆。

## 3. 服务端契约

新路由：`POST /api/v1/conversations/{characterId}/assistant`，鉴权、`cache-control: private, no-store`。

请求（`conversation-assistant-request.schema.json`）：

```json
{
  "intent": "reply | grammar | structure | question",
  "characterVersion": 1,
  "attemptId": "uuid",
  "question": "可选，≤800 字符；question intent 必填",
  "targetText": "可选，≤2000 字符；grammar intent 必填"
}
```

成功响应（`conversation-assistant-response.schema.json`）：

```json
{
  "apiVersion": "v1",
  "data": {
    "attemptId": "uuid",
    "intent": "reply",
    "answer": "中文解释",
    "suggestions": [{ "spanish": "…", "chinese": "…" }],
    "corrections": [{ "original": "…", "corrected": "…", "explanation": "…" }],
    "structure": [{ "fragment": "…", "role": "主语", "explanation": "…" }],
    "correctedSentence": null
  }
}
```

约束：`answer` 必填；`suggestions` ≤3、`corrections` ≤8、`structure` ≤12；可选块缺失时 UI 只显示 answer。服务端不得因为可选块缺失而失败（provider 只被要求返回 JSON、`answer` 必有）。

错误码沿用既有稳定错误码，不新增：`VALIDATION_FAILED` 400、`AUTH_REQUIRED` 401、`CONTACT_REQUIRED` 403、`CHARACTER_UNAVAILABLE` 404、`RATE_LIMITED` 429、`PROVIDER_TIMEOUT` 504、`CONVERSATION_UNAVAILABLE`/`CONTACT_UNAVAILABLE`/`PROVIDER_UNAVAILABLE` 503、取消 499。

### 3.1 应用层 `consult-conversation-assistant.ts`

依赖（全部可注入，便于测试）：

- `repository`：只读 `getCurrentPublishedVersion(characterKey)` + `listContext(userId, characterKey)`（最近 8 条完成、未撤回、所属消息未被撤回；本项目 `role` 投影为 `user`/`character`）；
- `getContactStatus`：与 expression-assist 相同的联系人门禁；
- `provider`：`ConversationAssistantProvider`；
- `signal`、`allowStaticFallback`、`onProviderResult`（记录 provider 元数据）。

流程：

1. Zod 校验请求；
2. 静态角色目录版本一致 + 人物发布/对话能力门禁（与 expression-assist 相同）；
3. 数据库存在时校验当前已发布版本与联系人状态；
4. 读取最近 8 条上下文（单条截断 2000 字符）；失败 → `CONVERSATION_UNAVAILABLE`；
5. 目标句解析：`grammar` 必须有 `targetText`（schema 已保证）；`structure` 无 `targetText` 时取上下文中最后一条角色消息，仍无 → `VALIDATION_FAILED` 400，提示「当前没有可分析的西语句子」；
6. 30 秒总截止 + 请求 abort；调用 provider；
7. 用 `conversationAssistantDataSchema` 校验并归一化 provider 输出（空数组/null 补齐），校验失败 → `provider-response-invalid`（503 可重试）；
8. 返回 `{ attemptId, intent, … }`；不写任何数据表。

### 3.2 Provider `providers/assistant`

- 接口：`ConversationAssistantProvider.assist(input, { signal })`；
- 内部输入：`intent`、`question`、`targetText`、`characterDisplayName`、`recentMessages`；
- 结果：结构化字段 + `provider/modelVersion/providerRequestId/latencyMs/estimatedCostMicros`；
- MiniMax adapter：沿用 `https://api.minimaxi.com/anthropic/v1/messages`、`MINIMAX_API_KEY`/`MINIMAX_API_ENDPOINT`、30 秒超时、`thinking: disabled`、非流式；
- System prompt 要点：你是西语学习助手，用简体中文解释、西语例子必须是自然 `es-ES`；按 intent 输出 JSON，只输出 JSON；`reply` 给 1–3 条可直接发送的自然回复并解释语气差异；`grammar` 指出错误、给最小修正和修正后整句；`structure` 按主语/谓语/宾语/状语等拆分并说明；`question` 回答学习者的问题；不要编造角色或现实事实、不评判学习者人格、不索要隐私；不得输出 markdown 代码围栏以外的内容（解析时兼容围栏）；
- 非法 JSON / Schema 不符 / 空 answer → `provider-response-invalid`；401/403 auth、429 rate-limited、5xx unavailable、超时/取消按现有 provider 错误语义；
- 单元测试只用 fake fetch，不调用真实收费 provider。

## 4. 隐私与观测

- 请求正文、草稿、目标句、对话正文、AI 输出不写普通日志；
- `provider_calls` 记录 `providerType="assistant"`、`provider`、`modelVersion`、`providerRequestId`、`status`、`latencyMs`、`estimatedCostMicros`、`errorType`、`requestId`、`attemptId`，不写内容；
- 客户端只发送学习者主动输入的问题/目标句；上下文由服务端读本人数据；
- 结果仅存在组件内存，不写 localStorage/sessionStorage。

## 5. 测试要求

- Provider：fake fetch 覆盖四类 intent 的请求序列化与成功解析、markdown 围栏、非法 JSON、缺 answer、超时、取消、401/429/5xx、未配置 key、超长；
- Application：版本/发布/联系人门禁、上下文读取失败、structure 回退最后一条角色消息、无目标句 400、provider 错误映射、abort/超时、Schema 归一化、确认依赖只有只读；
- Route：401、400、404、403、503、200 + no-store、错误码映射；
- UI：菜单项出现并打开面板；三个快捷操作的请求体；question 发送；grammar 空目标提示；结构结果渲染；建议「填入输入框」写入草稿且不发送；朗读走 fake read-aloud；错误重试；关闭 abort + 停止朗读 + 焦点返回；Escape/外部点击；不出现自动发送或证据写入；
- E2E（Playwright）：mock `/api/v1/conversations/lucia/assistant`，从菜单打开、请求回复建议、填入草稿、显式发送（发往 stream 的是用户草稿文本），并确认助手调用不产生消息；至少桌面视口。
- 聚焦验证命令（本机无 pnpm，用本地 Node 直接调用）：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/conversation-assistant*.test.ts tests/unit/conversation-assistant-panel.test.tsx tests/unit/conversation-thread.test.tsx
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0
```

## 6. 已知限制

- 回复建议质量依赖模型；服务端只做 Schema、安全与门禁校验，不能保证语用最优；
- 每次点击都会产生一次真实 provider 费用，不做跨进程缓存/幂等（attemptId 只用于观测与客户端竞态隔离）；
- 不持久化助手对话，刷新即丢失；
- 语法/成分分析是学习辅助，不进入评分或能力证据；
- 未验证真实 MiniMax 输出质量、iPhone Safari 真机与生产部署。
