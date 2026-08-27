# 对话工作区视觉实现计划

## 范围

本切片落地已确认的 Conversation Workspace 视觉方案，只修改 Web 对话页面内容区域，不修改 `AppShell`、`BottomNavigation` 或服务端聊天协议。

## 交付项

1. `/chat` 联系人 rail、Lucía 预览和介绍请求入口收敛为编辑式工作台。
2. `/chat/[characterId]` 使用联系人 rail + 单一消息 canvas；移动端退化为沉浸式单线程。
3. `ChatThread` 更新身份文案、消息文本块、流式/失败/停止状态和消息级可访问语义。
4. `VoiceComposer` 使用连续的 v6 编辑工作面：Mic / 文本 / Send，录音时 X / 计时 / Stop，同一位置切换。
5. 追加对话专用响应式样式：中性底色、细分隔线、砖红动作色、无渐变和大气泡；不改变全局导航令牌。

## 验证

- 相关 Vitest：`conversation-thread.test.tsx` 与 `conversation.test.ts`。
- `pnpm lint`、`pnpm typecheck`。
- 浏览器检查桌面 1024/1440px、移动 375/390px，确认无横向溢出、导航未改动、输入与停止行为可观察。

## 限制

- 本切片不新增实时双向语音、STT 供应商或反馈抽屉后端能力。
- 现有录音 provider 无可验证转写时继续提供文字降级提示；不伪造语音证据。
