# CHAT-ASSISTANT-001 交接：聊天页 AI 助手

- 日期：2026-10-21
- 状态：`review`（实现完成，待在真实环境验证）
- 分支/工作区：沿用共享分支 `codex/disable-legacy-readlang` 的共享工作树，保留所有其他在途改动
- 设计：[聊天 AI 助手设计](../superpowers/specs/2026-10-21-chat-ai-assistant-design.md)
- 计划：[聊天 AI 助手实施计划](../plans/2026-10-21-chat-ai-assistant-implementation-plan.md)
- **Commit / 推送 / 部署：无。** 全部改动只在工作区。

## 1. 完成内容

聊天页右上角「更多对话操作」菜单新增第一项 **AI 助手**，打开聊天线程内的非模态学习助手面板，支持所有者要求的三类能力：

1. **帮我回复**：`intent=reply`，服务端读取本人与当前角色的最近 8 条已完成、未撤回消息，内部 MiniMax provider 返回 1–3 条自然 `es-ES` 回复建议；每条可「填入输入框」（只写聊天草稿，仍需用户自行发送）或「听一遍」（统一 MiniMax 女声，ADR-0019）。
2. **检查语法**：`intent=grammar`，目标句优先取面板输入框文字，否则取聊天输入框当前草稿；两者都空时面板就地提示，不发请求。返回中文解释、原句→修正与修正后整句，可「使用修正句」。
3. **分析句子成分**：`intent=structure`，可输入句子；不输入时由服务端回退到当前对话中角色最后一条完整消息，没有可分析句子时返回明确中文错误。返回成分片段、中文成分名（主语/谓语/宾语/状语等）与解释。
4. **自由提问**：底部输入框发送 `intent=question`（1–800 字符），中文回答并给出西语例子。

其他行为：

- 面板内保留本次会话的临时问答记录（关闭再打开仍在，切换角色/刷新即丢失），不写 localStorage/sessionStorage，不建数据库记录；
- 回复建议与修正句「填入输入框」只写可编辑草稿并恢复聊天输入焦点，**不会自动发送**，也不调用 `/stream`；
- 加载/错误/重试/取消、Escape、点击外部、关闭按钮、焦点进入与返回「更多对话操作」、旧响应隔离、关闭时 abort 请求并停止朗读；
- 朗读只走 `useReadAloud`/统一 `/api/v1/tts`，不使用浏览器 `speechSynthesis`；
- 桌面右侧浮层、手机近全屏 sheet（backdrop + safe-area、44px 触控目标），浅/深主题沿用 `--conversation-*` token。

## 2. 服务端边界

新路由 `POST /api/v1/conversations/:characterId/assistant`（鉴权、`cache-control: private, no-store`）：

- application 重验静态角色目录版本、发布/对话能力门禁、数据库当前发布版本与联系人状态（与 expression-assist 同构）；数据库不可用时的静态回退只在既有非生产门禁开启时允许；
- 只读 repository 仅暴露 `getCurrentPublishedVersion` 与 `listContext`（最近 8 条 completed、排除被撤回消息的回复、单条 2000 字符）；**没有** message/memory/relationship/evidence/评分写入口；
- 客户端只发送学习者主动输入的问题/目标句，对话上下文由服务端读取本人数据；
- 30 秒总截止 + 请求 abort；内部 `providers/assistant` 适配 MiniMax Anthropic 兼容非流式 JSON（`MINIMAX_API_KEY`/`MINIMAX_API_ENDPOINT`、thinking disabled、Zod 严格校验）；非法 JSON/Schema 失败关闭为 `PROVIDER_UNAVAILABLE`/可重试；
- 错误码复用既有稳定码（400 VALIDATION_FAILED、401 AUTH_REQUIRED、403 CONTACT_REQUIRED、404 CHARACTER_UNAVAILABLE、429 RATE_LIMITED、499/503 PROVIDER/CONVERSATION/CONTACT unavailable、504 PROVIDER_TIMEOUT），未新增公共错误码；
- `provider_calls` 记 `providerType="assistant"` 与 provider/model/requestId/status/latency/estimatedCost/errorType/requestId/attemptId；**不记录**问题、草稿、目标句、对话正文、模型输出。日志无新增正文。

## 3. 文件

新增：

- `src/modules/providers/assistant/{assistant,minimax-assistant,index,server}.ts`
- `src/modules/conversation/repositories/conversation-assistant-repository.ts`
- `src/modules/conversation/application/{conversation-assistant-error,consult-conversation-assistant}.ts`
- `src/modules/conversation/http/read-conversation-assistant-body.ts`
- `src/modules/conversation/schemas/conversation-assistant.ts`（请求/响应 DTO 与类型，客户端与服务端共享）
- `app/api/v1/conversations/[characterId]/assistant/route.ts`
- `src/modules/conversation/ui/{conversation-assistant.tsx,conversation-assistant.css,request-conversation-assistant.ts}`
- `contracts/schemas/v1/conversation-assistant-{request,response}.schema.json`
- 测试：`tests/unit/conversation-assistant-provider.test.ts`(23)、`conversation-assistant.test.ts`(19)、`conversation-assistant-route.test.ts`(26)、`conversation-assistant-panel.test.tsx`(21)、`tests/contracts/conversation-assistant-contract.test.ts`(3)、`tests/e2e/chat-assistant.spec.ts`(2)
- 文档：设计规格、实施计划、本交接

修改：

- `src/modules/conversation/ui/chat-thread.tsx`：菜单项「AI 助手」（第一项）、面板状态/外部点击/Escape/焦点返回、渲染面板；保留文件内其他会话在途的「双方消息均可朗读」改动
- `tests/unit/conversation-thread.test.tsx`：菜单三项顺序断言 + AI 助手打开/关闭焦点用例；保留其他在途改动
- `contracts/openapi/v1/openapi.json`：新增 assistant POST 路径
- `README.md`、`docs/architecture.md`、`docs/testing-strategy.md`、`PROJECT_STATUS.md`：文档索引与状态同步

无数据库迁移、无新增依赖、未修改 `app/globals.css`、未修改角色 provider/system prompt、未修改共享 DTO 之外的服务端公共契约。

## 4. 验证（Lead 独立复跑）

工作目录 `D:\workspace`，本机无 pnpm，使用本地 Node：

- 聚焦 Vitest（Lead 复跑）：
  `node node_modules/vitest/vitest.mjs run tests/unit/conversation-assistant-provider.test.ts tests/unit/conversation-assistant.test.ts tests/unit/conversation-assistant-route.test.ts tests/contracts/conversation-assistant-contract.test.ts tests/unit/conversation-assistant-panel.test.tsx tests/unit/conversation-thread.test.tsx`
  → **6 files / 121 tests passed**（服务端 23+19+26+3，UI 20+30）。补强「回复补充说明超长本地拦截」用例后 panel 单文件 **21/21**（合计 122）。
- 全树类型检查：`node node_modules/typescript/bin/tsc --noEmit` → **exit 0**
- 改动文件 ESLint `--max-warnings=0`（provider/application/repository/http/route/UI/测试）→ **exit 0**
- E2E（Lead 独立运行，隔离端口/构建目录避免与并发会话冲突）：
  `$env:PLAYWRIGHT_PORT="3113"; $env:NEXT_DIST_DIR=".next/e2e-lead-assistant"; node node_modules/@playwright/test/cli.js test tests/e2e/chat-assistant.spec.ts --project=desktop-chromium --reporter=line`
  → **2 passed (15.3s), exit 0**
- 邻接回归：服务端实现者跑了 expression-assist contract、conversation-tts-route、expression-assist application/route **55/55** 与 media-series-suggestion-contract（扫描全部 schemas/v1 的严格 Ajv）**4/4**；Lead 的聚焦 6 文件运行包含 conversation-thread 现有 30 项（含并发会话新增的 own-message 朗读用例）通过。

未运行（如实标注）：全量 Vitest、整套 E2E、生产 `next build`（共享工作树既有 OOM/基线失败与其他会话在途改动）；真实 MiniMax provider 调用、真实数据库/RLS、数据库迁移、iPhone Safari/PWA 真机、真实扬声器听感。

## 5. 已知限制与风险

1. **未做真实 provider 验证**：JSON 输出质量、提示词遵从度与实际回复自然度未知；provider 层对多余顶层键严格拒绝（会返回 503 而非静默丢弃），真实环境若模型偶发额外字段需按观测放宽 provider 局部解析（公共 DTO 仍保持严格）。
2. **未在真实数据库执行 repository SQL**（本机无 `DATABASE_URL`）：只读上下文查询是从 expression-assist 逐行移植（8 条 vs 6 条），RLS/撤回父消息过滤需在 DB 可用时复核；`provider_calls.providerType="assistant"` 为 text 列、未发现 DB 约束，但首次真实写入应核对。
3. **无跨进程幂等/缓存**（设计 §6）：每次点击都是一次真实计费调用；attemptId 只用于观测与客户端竞态隔离，不能防止重复点击产生的多笔费用（UI 在 pending 时禁用快捷操作）。
4. 面板对话不持久化，刷新即丢失；移动端 sheet 无焦点陷阱（非模态语义）；「填入输入框」后的聊天焦点用 `.conversation-composer textarea` DOM 查询（VoiceComposer 未暴露 ref），如后续重构 composer 需同步。
5. 桌面浮层固定 `top:84px/bottom:100px` 相对聊天线程定位，超长引用/多行草稿使输入区变高时可能轻微遮挡，需要时再调 CSS。
6. 语法/成分分析只是学习辅助，不进入评分或能力证据；AI 回复建议不保证语用最优。

## 6. 用户验证建议

刷新本机已加载改动的 `/chat/lucia`：

1. 点右上角「…」→「AI 助手」，面板打开且焦点在输入框；点「帮我回复」应出现 1–3 条西语建议，点「填入输入框」后聊天输入框出现该句但**不会自动发送**，再自行点发送才会进入聊天。
2. 在聊天输入框写一句有语法错误的西语，打开助手点「检查语法」，应显示中文解释、修正与修正后整句；点「使用修正句」把修正写回输入框。
3. 点「分析句子成分」不输入内容时，应分析 Lucía 最后一条消息；输入一句西语则分析该句，显示成分/角色/解释。
4. 底部输入框问「虚拟式和条件式有什么区别？」应得到中文回答；生成中点关闭应取消请求并停止朗读，Escape/点击面板外可关闭，焦点回到「…」按钮。

## 7. 下一步建议

1. 由所有者在本地真实登录状态与真实 MiniMax（`MINIMAX_API_KEY`）下实聊验证三类帮助的实际输出质量与费用。
2. 数据库可用时跑一次只读 repository 查询，核对 8 条上下文/撤回父消息过滤与 `provider_calls` 记录（不含正文）。
3. 由协调者在合并对账时决定本任务与共享分支其他在途改动的提交/合并方式；本任务无 Commit。
4. 若真实输出常出现额外 JSON 字段，另立小切片放宽 provider 解析并补观测，不改公共 DTO。
