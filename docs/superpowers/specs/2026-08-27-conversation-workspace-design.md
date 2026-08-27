# Sueño 对话工作区设计与技术方案

- 日期：2026-08-27
- 状态：待产品审阅
- 适用范围：个人 Alpha Web/PWA 与 Flutter 客户端
- 关联任务：UI-008、阶段 6.2、6.3、6.4、6.5
- 关联规范：`docs/superpowers/specs/2026-08-26-web-ui-design-research-and-scheme.md`

## 1. 决策摘要

对话工作区采用 **B + A + C**：

- 桌面端采用联系人 rail + 单一消息流；`/chat` 与 `/chat/[characterId]` 保持同一工作区语义。
- 移动端退化为沉浸式单线程私信，顶部返回联系人，底部固定 composer。
- 聊天后的学习反馈放在用户主动打开的可折叠抽屉，不进入实时消息流。
- 默认输入方式是语音，但采用“录音 -> 临时转写 -> 用户确认/修改 -> 发送”，不实现实时双向语音。
- 保留现有 `meta -> delta -> done -> error` 流协议、`generationId` 竞态保护和完整 `done` 门槛。

对话首先是关系交流。学习机会、反馈和记忆提取只能在自然回合之后发生，不能把页面变成实时评分面板。

## 2. 调研依据

### 2.1 主流私信

Apple Messages、WhatsApp、Telegram、Signal 形成了稳定的一对一聊天语法：紧凑身份头部、连续消息流、消息级操作、语音消息和明确的失败/送达反馈。可迁移的是低干扰节奏与渐进式操作，不是在线状态、真人社交网络或隐私语义。

### 2.2 协作聊天

Slack 官方线程指南说明，线程将具体讨论移出主流，并支持在桌面并排打开、单独管理通知。Discord 的线程模式提供了相近的上下文收纳思路。Sueño 将这种抽屉/线程语义限制用于聊天后反馈、关系记忆控制和好友介绍请求。

### 2.3 AI 语言学习

- [Duolingo Max](https://blog.duolingo.com/duolingo-max/)：Video Call 从最近学习主题开始，允许自由延展，完成后提供 transcript；Roleplay 使用场景提示，完成后提供反馈，并允许从消息菜单报告错误。
- [Speak](https://www.speak.com/)：Learn -> Practice -> Apply，最后一步是无压力的真实往返对话。
- [ELSA Speak](https://www.elsaspeak.com/en/)：双语 AI tutor、现实角色扮演和个性化语音反馈。
- [Talkpal](https://www.talkpal.ai/)：沉浸式对话、语音/文字练习和即时反馈。
- [Apple Messages 支持](https://www.apple.com/ios/messages/)：回复指定消息、跨会话搜索和失败恢复等消息级能力。
- [Slack Threads 指南](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions)：线程、桌面并排查看和通知管理。

WhatsApp、Telegram、Signal、Discord、Character.AI 的部分官方页面在调研环境中无法稳定抓取；它们没有被作为关键事实的唯一来源，后续可做一次人工产品审阅。

## 3. 范围与非目标

### 3.1 本设计覆盖

- Lucía 联系人列表、置顶关系和介绍请求入口。
- 消息流、空状态、流式回复、停止、断流、重试和草稿恢复。
- 文字输入、语音录音、临时转写确认和发送。
- 消息级可访问操作菜单。
- 聊天完成后的 1-3 条代表性反馈抽屉。
- Web/Flutter 共享 DTO、错误码语义和关键状态测试。

### 3.2 明确不做

- 开放社交 feed、真人匹配、群聊、视频通话或实时双向语音。
- 实时分数、逐句红笔纠错、连胜、经验值或虚构的在线地点。
- 消息反应、转发、跨会话搜索和复杂附件系统；先为后续扩展保留边界。
- 角色商城、角色开放创建和跨角色自动共享私密记忆。

## 4. 信息架构与排版

### 4.1 路由

| 路由 | 责任 |
| --- | --- |
| `/chat` | 联系人、Lucía 置顶关系、好友介绍请求和空状态 |
| `/chat/[characterId]` | 当前角色的完整消息流与 composer |
| `/api/v1/conversations/[characterId]` | 鉴权后的历史消息读取 |
| `/api/v1/conversations/[characterId]/voice-input` | 临时音频转写，不持久化原始录音 |
| `/api/v1/conversations/[characterId]/stream` | 发送已确认文本并生成角色回复 |

### 4.2 桌面布局（>= 1024px）

现有 `AppShell` 保留全局产品导航。对话内容区内部使用三层：

1. 联系人 rail：宽 256-280px；显示 Lucía 置顶、其他已授权角色和介绍请求。
2. 消息 canvas：最小 560px，消息正文最大约 680px；顶部身份栏 64px，底部 composer 80-96px。
3. 上下文抽屉：宽 300-340px，仅在用户打开反馈、记忆或介绍请求时出现；默认不占主流空间。

rail 与消息 canvas 在同一工作区内切换，不复制一套桌面聊天页面。消息 canvas 使用暖纸面背景、细边框和低饱和赤陶色用户气泡；不为每条一对一消息重复显示头像。

### 4.3 移动布局（320-767px）

- 顶部栏高度 56-64px：返回、头像、角色名、关系标签、更多菜单。
- 消息区内边距 16-20px；气泡最大宽度 84-88%。
- composer 使用安全区 padding；键盘出现时不能遮挡输入、停止或发送按钮。
- 联系人 rail 退化为独立 `/chat` 页面，当前对话只保留返回入口。
- 底部产品导航不应覆盖 composer；必要时由产品壳层为聊天页提供额外底部空间。

### 4.4 身份与文案

显示“Lucía Martín / 主要好友 / 文字和语音都可以”。不显示“在线”“正在 Madrid”等实时 presence。角色位置只能在角色设定语境中出现，不能被读作现实在线事实。角色详情或直接问答中必须如实说明 AI 身份。

## 5. 组件边界

### 5.1 Web

- `ConversationWorkspace`：响应式 rail、canvas 和抽屉布局，不承载供应商或数据库逻辑。
- `ConversationContactRail`：联系人、置顶和介绍请求导航。
- `ConversationHeader`：角色身份、关系语义、当前状态和菜单入口。
- `ChatThread`：消息列表、日期分隔、空状态、滚动锚点和 `aria-live`。
- `ConversationMessage`：按角色、完成态和输入方式渲染气泡；不直接写数据库。
- `MessageActionMenu`：复制、重新发送失败消息和后续可扩展动作；桌面 hover 与移动长按都必须有键盘等价路径。
- `VoiceComposer`：录音、转写、草稿确认、文字降级、发送和停止。
- `AfterTurnFeedbackDrawer`：只有完整回合后由用户主动打开，显示 1-3 条反馈。

### 5.2 Flutter

在 `apps/mobile/lib/features/conversation/` 中提供语义等价但非共享 UI 源码的：

- `ConversationWorkspacePage`
- `ConversationContactRail`
- `ChatThread`
- `ConversationMessageTile`
- `VoiceComposer`
- `AfterTurnFeedbackSheet`

Flutter 只消费共享协议和 fake fixture，不复制服务端评分、记忆或权限规则。

## 6. 回合状态机

UI 层状态至少包含：

| 状态 | 用户可见行为 | 允许的副作用 |
| --- | --- | --- |
| `idle` | 可录音、打字、发送 | 无 |
| `recording` | 显示计时和停止/取消 | 持有麦克风流；退出必须释放 tracks |
| `transcribing` | 显示处理中，可取消 | 调用 STT；不写消息、不写证据 |
| `draft-review` | 播放、编辑、重录、发送 | 只保存内存草稿或本地短期草稿 |
| `streaming` | 显示部分回复和停止按钮 | 接收当前 generation 的 `delta` |
| `completed` | 显示完整回复，可打开反馈 | 允许候选记忆提取；不自动显示分数 |
| `cancelled` | 保留已收到部分并可重试 | 不提取长期记忆，不写学习证据 |
| `failed` | 明确失败原因和重新发送 | 旧消息保持可见；重试必须幂等 |
| `offline` | 保留草稿，说明暂不可发送 | 不调用网络；恢复后由用户重试 |

所有回调都必须携带 `attemptId` 或 `generationId`。旧 generation 的 `meta`、`delta`、`done` 和错误事件不得改变当前 UI。没有 `done` 的角色回复永远不是完成回合。

## 7. 语音回合与协议

### 7.1 临时转写端点

`POST /api/v1/conversations/{characterId}/voice-input` 使用 `multipart/form-data`，字段为：

```text
audio             Blob, 受限 MIME，服务端再次校验大小和类型
clientInputId     稳定幂等键
attemptId         本次录音回合 ID
generationId      本次转写 generation
locale            es-ES 或 es-MX
```

响应 DTO：

```json
{
  "data": {
    "inputId": "voice-input-...",
    "transcript": "...",
    "confidence": 0.84,
    "confidenceAvailability": "provider",
    "provider": "fake|openai|local-whisper",
    "modelVersion": "...",
    "retentionPolicy": "ephemeral"
  }
}
```

音频只在 application/provider 生命周期内存在，完成或失败后删除。响应不返回原始音频 URL，不把完整私密对话写入日志。

### 7.2 发送端点扩展

现有 stream 请求保持向后兼容，增加：

```json
{
  "characterVersion": 1,
  "text": "用户确认后的文本",
  "inputMode": "text|voice",
  "inputId": "voice-input-...",
  "transcriptConfidence": 0.84,
  "clientMessageId": "client-...",
  "generationId": "generation-..."
}
```

只有用户确认后的转写文本才进入消息持久化。低置信度、静音、格式错误、取消和供应商失败显示恢复路径，不产生负面能力证据。

### 7.3 流协议

继续使用现有协议：

- `meta`：创建角色消息并绑定 `messageId`。
- `delta`：追加文本片段。
- `done`：标记完整消息，允许关系记忆 application 继续处理。
- `error`：携带稳定错误码和 `retryable`。

客户端只接受当前 `generationId` 的事件。重试使用新 generation，但复用同一稳定用户消息键，避免重复消息、重复记忆或重复供应商费用。

## 8. 数据与隐私

现有 `conversations`、`messages`、`character_relationships` 和 `relationship_memories` 继续作为权威来源。为区分文字与语音转写，数据库迁移可在 `messages` 增加：

- `input_mode`: `text | voice`
- `transcript_confidence`: nullable real，范围 0-1
- `input_id`: nullable text，唯一性由 conversation + client message 约束保障

这几个字段只保存回合元数据和用户确认后的文本，不保存原始音频。RLS、所有权检查、追加式证据和关系记忆共享权限保持不变。记忆提取只在角色消息收到 `done` 且用户回合完整结束后触发。

## 9. 错误与恢复文案

| 场景 | 页面行为 |
| --- | --- |
| 麦克风拒绝/设备不支持 | 保留文字输入，说明“请改用文字输入”，不扣分 |
| 转写低置信度 | 显示转写文本和“重录/改写”，不直接发送 |
| STT 超时或格式错误 | 保留录音回合的本地状态；允许重录或文字发送 |
| 流断开且无 `done` | 保留部分回复并标记未完整送达；显示重新发送 |
| 用户主动停止 | 显示已停止；不进入长期记忆和能力证据 |
| 网络离线 | 保留草稿和最后可见消息；恢复后由用户明确重试 |
| 消息数据库不可用 | 显示非阻塞状态提示；当前聊天结果不伪装成已保存 |

错误、加载、空状态和恢复状态都必须是可访问文本，不只依赖颜色或动画。

## 10. 可访问性与视觉令牌

- 沿用现有暖米白、深墨色、赤陶色、辅助青绿色令牌，不创建单独聊天主题。
- 所有操作命中区至少 44x44px；icon-only 控件必须有 `aria-label` 和 tooltip。
- `ChatThread` 使用 `aria-live="polite"`，流式处理中不强制抢焦点；发送后焦点回到 composer。
- 消息菜单必须支持键盘打开、关闭和 Escape；移动长按必须有按钮等价路径。
- 录音、转写、流式、取消和失败都通过 `role="status"` 或 `role="alert"` 暴露。
- `prefers-reduced-motion` 下关闭消息滑入和自动滚动动画。
- Spanish 内容保持原文优先；中文说明、释义和反馈只能按需展开。

## 11. 测试验收矩阵

### 11.1 Domain/Application

- 状态机覆盖合法、非法、取消、失败、重试和过期 generation。
- parser 拒绝无效 NDJSON、缺少 `done` 和错误 generation。
- voice input 幂等、MIME/大小校验、低置信度不写负面证据。
- 完整回合才触发记忆提取；断流和取消不触发。
- 重试不重复消息、记忆、证据或供应商调用。

### 11.2 Web/Flutter 组件

- 空状态、文字输入、录音权限失败、转写确认和文字降级。
- 流式回复、停止、断流恢复、重试和草稿保留。
- 消息菜单键盘和移动等价操作。
- 反馈抽屉只在完成回合后出现，默认不显示实时分数。

### 11.3 E2E

- 桌面联系人 rail -> Lucía -> 发送 -> `done` -> 打开反馈。
- 手机视口返回、键盘、录音失败、文字发送和断网恢复。
- 刷新后历史消息恢复；旧 generation 回调不覆盖新状态。
- 服务失败不产生错误评分，数据库不可用时不显示虚假保存成功。

### 11.4 Flutter

使用 `contracts/fixtures/` 共享 stream/error/state 样本运行 `flutter analyze`、`flutter test` 和 fake integration test。Windows 环境通过不能表述为 iOS 真机录音或 Xcode 构建通过。

## 12. 实施切片建议

1. `CONV-UI-01`：桌面/移动工作区壳层、联系人 rail、消息 header 和空状态。
2. `CONV-UI-02`：消息流状态展示、停止/断流/重试和消息级可访问菜单。
3. `CONV-VOICE-01`：录音回合、临时 STT application、确认/修改/重录流程。
4. `CONV-VOICE-02`：stream DTO 扩展、消息输入元数据迁移和幂等测试。
5. `CONV-FEEDBACK-01`：完整回合后的反馈抽屉和关系记忆/共享状态入口。
6. `CONV-CROSS-01`：Web/Flutter fixture、一致性测试和 320-1440px 回归。

每个切片只修改一个任务范围；跨模块迁移、协议或隐私边界变更时同步更新数据库、架构和测试文档。

## 13. 验收条件

- 用户能在桌面和移动端从联系人进入 Lucía，并完成文字回合。
- 语音失败时可无损降级到文字；低置信度和技术失败不产生负面能力证据。
- 生成流的停止、断流、重试、旧 generation 和无 `done` 行为可观察且可测试。
- 聊天主流不显示实时评分；完整回合后用户可主动打开有限反馈。
- 私密关系记忆只在完整回合后提取，默认不向其他角色共享。
- Web 与 Flutter 对状态、错误码和请求字段保持语义一致。
- 无虚构在线地点、线下行动、真人身份或已保存成功状态。

本文件是实现前设计规格，不改变当前服务端评分、画像、记忆权限或 Alpha 延后范围。正式实现前须由产品本人审阅并确认；确认后再生成详细 implementation plan。
