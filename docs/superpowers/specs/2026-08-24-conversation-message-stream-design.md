# ALPHA-027 对话消息流设计

- 日期：2026-08-24
- 状态：已获用户确认，已实现 ALPHA-027
- 任务：ALPHA-027
- 前置任务：ALPHA-026 Lucía 人物圣经

## 背景

当前 Web 和 Flutter 只有静态的 Lucía 对话预览，没有真实消息线程、流协议、取消和断流恢复。ALPHA-027 需要先把“像真实私信一样交流”的流程跑通，同时保持当前 Alpha 的边界：不提前接入真实 LLM、数据库消息持久化、关系记忆或实时双向语音。

## 决定

采用“协议 + 纯 fake application + 双客户端 UI”的纵向切片：

- 服务端使用本地确定性 fake 生成 Lucía 回复片段。
- Web Route Handler 输出明确的 NDJSON `meta / delta / done / error` 事件。
- Web 和 Flutter 各自实现 UI 和本地状态编排，不共享 UI 源码。
- 当前消息仅存在本次客户端会话内，不写 `conversations`、`messages` 或关系记忆表。
- 语音 composer 默认显示，但没有 STT 时只执行录音能力检测并降级为打字；不上传、不保存录音，也不伪造语音转写。

不采用真实 LLM/provider：它会引入费用、隐私传输、不可重复测试和超出当前 Alpha provider 决策的范围。也不把流式回复拆成独立服务或消息队列。

## 模块和文件

```text
src/modules/conversation/
  domain/stream-protocol.ts       # 事件 DTO、错误码、NDJSON 编解码
  domain/conversation-state.ts    # 本地消息状态与 generation 规则
  application/stream-reply.ts     # 可取消的确定性 fake async iterable
  index.ts

app/api/v1/conversations/[characterId]/stream/route.ts
app/(product)/chat/[characterId]/page.tsx
src/modules/conversation/ui/chat-thread.tsx
src/modules/conversation/ui/voice-composer.tsx

apps/mobile/lib/features/conversation/data/conversation_stream.dart
apps/mobile/lib/features/conversation/ui/chat_thread.dart
apps/mobile/lib/features/conversation/ui/voice_composer.dart
```

`/chat` 保留为 Lucía 的入口，链接到 `/chat/lucia`；不会新增角色选择器或开放角色创建。

## 流协议

每行是一个 JSON 对象，事件顺序为 `meta`、零个或多个 `delta`、最后一个 `done`；失败时使用 `error` 终止，不能同时伪造 `done`。

```ts
type ConversationStreamEvent =
  | {
      type: "meta";
      protocolVersion: "v1";
      characterKey: "lucia";
      characterVersion: number;
      generationId: string;
      messageId: string;
    }
  | {
      type: "delta";
      generationId: string;
      messageId: string;
      text: string;
    }
  | {
      type: "done";
      generationId: string;
      messageId: string;
    }
  | {
      type: "error";
      generationId: string;
      messageId: string | null;
      code: "stream-aborted" | "stream-failed" | "character-unavailable" | "input-invalid";
      retryable: boolean;
    };
```

解析器必须支持网络 chunk 在任意字符处切分，保留不完整行直到下一块到达；空行忽略，非法 JSON 或未知事件返回稳定 `stream-failed`，不把部分文本标记为完成。事件中的 `generationId` 是客户端当前请求的门牌，旧 generation 的所有事件都丢弃。

## Fake application

`streamReply` 接收：

- `characterKey`、`characterVersion`。
- 用户消息文本和 `clientMessageId`。
- 客户端生成的 `generationId`。
- `AbortSignal`。

它只允许 `lucia@1`，从 ALPHA-026 人物圣经读取角色身份边界，并基于固定输入映射返回自然、简短的西语回应。回复按固定片段拆分，测试可注入无延迟调度器；默认不依赖随机数、当前时间或网络。AbortSignal 触发后停止继续产出并返回 `stream-aborted`，不写任何持久化数据。

## 客户端状态和竞态

客户端本地状态至少区分：

- `idle`：可输入。
- `streaming`：已提交，正在接收 delta。
- `completed`：收到 done，角色消息才算完整。
- `cancelled`：用户主动停止，保留已收到的部分文本但标记未完成。
- `failed`：断流或协议错误，保留用户草稿和部分角色文本，允许重试。

发送规则：

1. 生成新的 `generationId` 和 `clientMessageId`，先把用户消息追加到本地线程。
2. 收到 `meta` 后创建角色消息占位。
3. 只有匹配当前 generation 的 `delta` 才能追加文本。
4. 只有匹配当前 generation 的 `done` 才能把角色消息标记为完整。
5. 取消、断流和路由卸载都 abort 当前流；旧 promise 的回调不能改变新线程状态。
6. 重试沿用原用户文本但创建新的 generation，不重复插入用户消息。
7. 没有 done 的角色消息不能触发长期记忆提取；本任务本身不实现记忆提取。

重复提交由 `clientMessageId` 在本地状态层去重。未来接入数据库时，该字段直接映射到现有 `messages` 幂等约束，但本任务不写库。

## Route Handler 边界

Route Handler 负责：

- 从请求验证用户身份。
- 校验 character key、版本、client message 和 generation DTO。
- 调用 `streamReply`。
- 将事件编码为 `application/x-ndjson`，设置禁止缓存的响应头。
- 将输入错误、角色不可用和 fake stream 错误映射为稳定 HTTP/事件错误。

Route Handler 不负责生成回复规则、不读写数据库、不提取记忆，也不接受客户端提交的评分、画像或权限字段。

## 语音与打字边界

`voice-composer` 默认呈现语音入口，复用现有浏览器录音能力和 Flutter 平台端口。由于没有 STT provider：

- 麦克风不可用时直接显示打字输入。
- 录音结束后没有可验证转写时不发送假文本，转到打字输入。
- 不上传、不长期保存普通录音。
- 聊天消息可以在完整 `done` 后产生有界、可解释的上下文证据，但不能单独证明完整八维能力。
- 已验证语音聊天可为语流节奏、表达准确、交际策略、语块调用和迁移表达贡献有限证据；发音严格证据仍需要明确的语音评估路径。
- 纯文字聊天可为表达准确、交际策略、语块调用和迁移表达贡献有限证据；轮次衔接只能作为交际策略/互动信号，不能冒充语音语流或发音证据。
- 技术失败、低置信度转写、缺少 `done` 或未完成的聊天轮不得写入能力证据。

这保持“语音优先”的产品方向，同时不把技术演示误认为真实语音理解。

## 测试策略

领域和 application 单测：

- 任意 chunk 边界的 NDJSON 解析。
- 正常 `meta → delta → done` 流。
- 缺失 done 不完成。
- 非法事件、错误事件和 AbortSignal。
- 旧 generation 的 delta/done/error 被忽略。
- 取消保留部分文本并允许重试。
- 重试不重复追加用户消息。
- 重复 clientMessageId 去重。

React 测试：

- 用户消息先出现，角色消息按 delta 增长。
- 完成状态只在 done 后出现。
- 停止、断流、重试和键盘提交。
- 麦克风不可用时打字入口可用。

Flutter 测试：

- 相同协议事件解析和本地状态转移。
- 取消、断流、重试和旧 generation。

Playwright 覆盖：

- `/chat/lucia` 发送一条消息并完成流式回复。
- 中途停止后不显示完成状态，重试后生成新回复。
- 手机视口不横向溢出。

不运行真实 provider，不新增数据库迁移，不把页面快照当作流完成断言。

## 已知限制和后续

- fake 回复只用于验证协议和体验，不代表最终角色生成质量。
- 本任务不保存消息，因此刷新页面会丢失本地线程；持久化属于后续消息/关系任务。
- 没有 STT 的语音路径只验证能力降级，真实语音消息需要后续 provider 任务。
- 关系记忆仅在完整 `done` 后由 ALPHA-028 处理；该任务已完成。

## ALPHA-029 回复规划扩展

ALPHA-029 在不改变流协议的前提下，将回复过程拆为“结构化计划 → 西班牙语表面文本”两步：

- `reply-plan.ts` 根据用户当前消息判断真实回应、情绪、关系阶段、追问/分享/换题和回复长度。
- `build-reply-context.ts` 组合人物快照、近期消息、当前关系可读记忆和可选教学机会；关系记忆只能通过 `listReadableMemories` 投影进入上下文，跨角色私密记忆被过滤。
- `generate-character-reply.ts` 以 deterministic fake 生成表面文本，保留 AI 身份如实回答、情绪优先和现实世界边界。
- 教学机会只能附加到自然的追问或改述机会，不能替代用户内容的回应，也不能把教学画像当作社交记忆。
- 记忆读取失败降级为空记忆上下文；回复仍可完成。流开始前取消返回 `stream-aborted`，没有 `done` 的流仍不触发记忆提取。

本扩展不接入真实 LLM/provider，不新增客户端 UI 或评分写入；现有 `meta`、`delta`、`done`、`error` 和 generation 语义保持不变。
