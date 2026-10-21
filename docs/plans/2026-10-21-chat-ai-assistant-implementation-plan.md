# 聊天 AI 助手实施计划（CHAT-ASSISTANT-001）

- 日期：2026-10-21
- 状态：`review`（服务端与客户端实现完成，待在真实环境验证）
- 设计权威：[2026-10-21 聊天页 AI 助手设计](../superpowers/specs/2026-10-21-chat-ai-assistant-design.md)
- DTO 权威：`src/modules/conversation/schemas/conversation-assistant.ts`
- 交接：[CHAT-ASSISTANT-001](../reviews/CHAT-ASSISTANT-001.md)

## 1. 需求

所有者要求：在聊天页面右上角「更多对话操作」（三个点）菜单里增加 AI 助手，用于

1. 不知道该怎么回复时询问可用的西语回复；
2. 检查自己编辑/准备发送的西语是否有语法错误；
3. 了解某句西语的句子构成成分。

产品边界：只读本人与当前已发布角色的已完成、未撤回消息；不写消息/记忆/能力证据；不自动发送；不新增独立的 AI 助手联系人；不持久化助手对话；朗读必须走统一 MiniMax 女声（ADR-0019）。

## 2. 任务切片

| ID | 范围 | 主要文件 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| `CHAT-ASSISTANT-001-S` | 服务端 provider / application / route / 契约 | `src/modules/providers/assistant/**`、`src/modules/conversation/{application,repositories,http}/**`、`app/api/v1/conversations/[characterId]/assistant/route.ts`、`contracts/**` | 共享 DTO | 聚焦 Vitest 绿、全树 typecheck 0、无真实 provider/DB 调用、无内容日志、无写表 |
| `CHAT-ASSISTANT-001-U` | 聊天顶栏菜单入口 + 助手面板 + 客户端请求 + 单测/E2E | `src/modules/conversation/ui/{chat-thread,conversation-assistant,request-conversation-assistant}*`、`tests/unit/conversation-assistant-panel.test.tsx`、`tests/e2e/chat-assistant.spec.ts` | 共享 DTO | 聚焦 UI Vitest 绿、Escape/外部点击/关闭 abort+停止朗读、填入草稿不自动发送、E2E 桌面路径（可运行则必须通过） |
| `CHAT-ASSISTANT-001-D` | 设计/架构/测试/状态页/交接文档 | `docs/**`、`PROJECT_STATUS.md`、`README.md` | S/U | 文档与实现一致、测试结果如实记录 |

## 3. 执行顺序

1. Lead 写设计规格与共享 Zod DTO。
2. S 与 U 并行实现；两者不修改对方文件、不提交、不清理共享工作树。
3. Lead 汇总后做集成审查：隐私与无写入、门禁顺序、abort/竞态、焦点/无障碍、样式与移动端。
4. 独立验证：聚焦 Vitest、全树 `tsc --noEmit`、改动文件 ESLint、可行时跑新增 E2E。
5. 更新 `docs/architecture.md`、`docs/testing-strategy.md`、`PROJECT_STATUS.md` 和[交接](../reviews/CHAT-ASSISTANT-001.md)。

## 4. 验证命令（本机无 pnpm，使用本地 Node）

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/conversation-assistant-provider.test.ts tests/unit/conversation-assistant.test.ts tests/unit/conversation-assistant-route.test.ts tests/unit/conversation-assistant-panel.test.tsx tests/unit/conversation-thread.test.tsx tests/contracts/conversation-assistant-contract.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js <changed ts/tsx files> --max-warnings=0
node node_modules/@playwright/test/cli.js test tests/e2e/chat-assistant.spec.ts --project=desktop-chromium
node node_modules/vitest/vitest.mjs run tests/contracts/expression-assist-contract.test.ts tests/unit/conversation-tts-route.test.ts
```

不运行全量 Vitest / 整套 E2E / 生产 build（共享工作树既有 OOM 与基线失败），也不调用真实 MiniMax、真实数据库或迁移；这些边界在交接中如实标注。

## 5. 不变量检查清单

- [x] 客户端上下文不进入请求；服务端只读本人已完成未撤回消息。
- [x] 不写 message / memory / relationship / evidence / user_skill_states（application 依赖只有只读端口与 metadata observer）。
- [x] 无自动发送；「填入输入框」后仍需用户显式发送（单测与 E2E 断言零 stream 请求）。
- [x] 日志与 provider_calls 不写问题、目标句、对话正文或模型输出（route/application 测试断言记录中不含正文）。
- [x] 朗读只走 `useReadAloud`/`createReadAloud`，不调用 `speechSynthesis`（E2E 断言统一 TTS trace）。
- [x] 旧响应、关闭、切角色、卸载后均不写状态；请求/朗读/监听器已释放（panel 单测覆盖 abort/停止/旧响应丢弃）。
- [x] 语法/成分/回复建议不产生任何学习评分或能力证据。

## 6. 结果（2026-10-21）

- 集成完成，`review`；Commit 无，全部为工作区改动。
- Lead 复跑聚焦 **122/122**、全树 `tsc --noEmit` exit 0、改动文件 ESLint 0、桌面 E2E **2/2** 独立通过。
- 未执行：真实 MiniMax/真实 DB、全量 Vitest、整套 E2E、生产 build、Safari 真机；详见[交接](../reviews/CHAT-ASSISTANT-001.md)。
