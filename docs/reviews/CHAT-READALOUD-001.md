# CHAT-READALOUD-001：聊天消息菜单为学习者自己的消息提供朗读

2026-10-21，所有者报告：“在聊天页面目前只有右击 Lucía 的消息会有朗读选项，右击我的消息也需要这个功能。”本聊天负责，沿用共享分支 `codex/disable-legacy-readlang`，保留其他任务的在途改动。Commit：无；未提交、推送或部署。状态同步于 `PROJECT_STATUS.md`。

## 1. 现有行为与改动

- 消息菜单在 [`chat-thread.tsx`](../../src/modules/conversation/ui/chat-thread.tsx) 里渲染：此前「朗读」菜单项仅在 `selectedMessage()?.role === "character"` 时出现；用户消息只有复制、引用回复、撤回、删除。
- 菜单本身只在消息已收到正文且未撤回时打开（右键 `openMessageMenu`、双击、`ContextMenu`/`F10+Shift` 键盘路径），撤回操作会把正文清空，因此不存在朗读撤回提示的路径，本次不需要额外门控。
- 改为两侧消息都渲染「朗读」，位置紧跟「复制」。角色消息继续额外提供「翻译/取消翻译」，学习者消息继续额外提供「引用回复/撤回/删除」。
- 朗读沿用组件已有的 `createReadAloud`（ADR-0019：统一 `speech-2.8-turbo` / `Spanish_SereneWoman`、鉴权 `/api/v1/tts`）与 `speakMessage` / `speakingMessageId` / `speechGenerationRef`：再次打开菜单显示「停止朗读」，切换消息、停止或卸载沿用原有释放与旧 generation 隔离。无新增 provider、API、数据库迁移、学习评分或证据写入。
- 菜单仍是 portal + fixed 定位；用户菜单从四项变为五项，桌面项高 34px、手机项高 44px，相关 E2E 高度上限同步更新。

## 2. 文件

- 实现：`src/modules/conversation/ui/chat-thread.tsx`。
- 测试：`tests/unit/conversation-thread.test.tsx`（用户菜单完整项列表改为含朗读；新增“朗读自己的消息并可停止”回归）、`tests/e2e/shared-read-aloud.spec.ts`（原聊天朗读用例追加学习者消息右键朗读与 trace 断言）、`tests/e2e/conversation.spec.ts`（用户菜单五项高度上限）。
- 文档：本文、`docs/architecture.md`、`docs/testing-strategy.md`、`PROJECT_STATUS.md`。

## 3. 验证

- 先红后绿：实现前 `node node_modules/vitest/vitest.mjs run tests/unit/conversation-thread.test.tsx` **2 failed / 27 passed**（用户菜单项列表与新增回归）；实现后同一文件 **29/29** 通过。同工作区在途 `CHAT-ASSISTANT-001` 用例后来加入同一文件，最终复跑 **30/30** 通过。
- 相关聊天 UI 回归：`conversation-thread`、`conversation-rhythm`、`conversation-assistant-panel`、`conversation-bubbles`、`conversation-cache-race`、`conversation-typing` 共 **6 files / 90 tests** 通过。
- 全树 `node node_modules/typescript/bin/tsc --noEmit` exit 0；改动 4 个 TS/TSX 文件 `node node_modules/eslint/bin/eslint.js --max-warnings=0` exit 0。
- Playwright（桌面 Chrome / 手机模拟，fake 共享朗读，不调用真实收费 provider）：`tests/e2e/shared-read-aloud.spec.ts` 桌面 **3/3**、手机 **3/3** 通过；其中聊天用例先读角色消息、停止后再右键学习者消息朗读，断言两次 `/api/v1/tts` 文本分别为 `Nos vemos mañana.` 与 `Me gusta el senderismo`、语言均为 `es-ES`。
- 该 spec 之外，`tests/e2e/conversation.spec.ts` 的“opens sent-message actions…”在当前共享工作树有**与本任务无关的既有失败**，因此不计为通过：① 菜单与气泡水平对齐差 **1.609px**（临时把朗读恢复为仅角色消息、即四项菜单后同样复现同一偏移，说明不是本次新增项导致）；② 撤回后未确认站内 `AlertDialog` 就断言 `data-withdrawn`（`UI-SYSTEM-002` 改成 `ConfirmActionDialog` 后该用例未同步，仍用原生 `page.once("dialog")`）。本次只按五项菜单更新高度上限；桌面在高度断言（184 ≤ 190）之后才因既有对齐断言失败，手机几何断言通过并继续到既有撤回断言失败。
- 未执行：全量 Vitest、全仓 lint、整套 E2E、生产 build、真实 MiniMax 朗读、iPhone Safari 真机。

## 4. 限制与用户验证

- 用户消息统一使用全站西语女声朗读；若用户发送中文或中西混输，合成音按西语发音规则处理，不代表该文本的准确发音。本次按所有者要求只做功能对齐，没有按语言隐藏入口。
- 只有已收到正文且未撤回的消息可以打开菜单并朗读；撤回后的消息仍只能查看撤回提示，行为不变。
- 打开菜单后如果气泡宽度因字体/动画尚未稳定，菜单可能相对气泡有约 1.6px 的既有水平偏移；这是改动前就存在的几何问题，与朗读功能无关，未在本任务扩大处理。
- 用户验证：刷新本机 `/chat/lucia`，右击（或双击）自己发送的任意消息，菜单应为“复制、朗读、引用回复、撤回、删除”；点击「朗读」应听到与 Lucía 消息相同的女声并读到这条西语原文，再次右键同一条消息显示「停止朗读」；Lucía 的消息菜单与朗读行为保持不变。
- 2026-10-21 19:22 所有者目检后回复“正常”：自己的消息右键朗读、停止与 Lucía 原有菜单均符合预期；视觉/交互验收通过，本任务关闭，不新增功能。
