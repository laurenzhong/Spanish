# 有效学习活动心跳与热力图时长设计

- 日期：2026-08-25
- 状态：Proposed
- 范围：个人 Alpha 学习热力图有效时长

## 背景

当前热力图从 `practice_sessions.started_at` 到 `completed_at` 推算时长，并按单会话封顶 45 分钟。这个值无法区分用户实际练习、页面空置、浏览器后台挂起和 App 进入后台，违反“有效学习时长排除空置、后台挂起和长时间无交互”的产品要求。

现有训练页使用 Web/Flutter 各自的 fake 训练循环，服务端已经有 `practice_sessions`、`practice_attempts` 和画像热力图读取路径，但尚无统一的活动采集协议。因此本设计先建立服务端权威的活动事实和跨端采集端口，再让热力图只消费这些事实。

## 目标与非目标

目标：

1. 只把前台/可见且近期有交互的连续活动计入有效时长。
2. 服务端决定时间区间，不接受客户端直接提交秒数或结束时间作为事实。
3. 心跳写入幂等，网络重试、重复发送和多端并发不会重复累计。
4. Web 与 Flutter 使用同一事件语义；平台生命周期差异隔离在各自适配器中。
5. 热力图仍只表达学习活动，不参与 `mastery`、`confidence` 或连续打卡惩罚。

非目标：

- 不追踪鼠标轨迹、键盘内容、音频内容或完整对话。
- 不把客户端本地计时作为服务端能力事实。
- 不为旧会话反推“看似精确”的有效时长；没有活动事件的旧会话按 0 分钟处理。
- 不在本任务引入离线事件队列、消息队列或独立遥测服务。

## 方案

### 1. 活动事件模型

在 `training` Schema 新增 `practice_session_activity_events`：

- `id`：UUID 主键。
- `user_id`、`session_id`：分别关联用户和练习会话，级联删除。
- `client_instance_id`：一次客户端安装/运行实例的随机 ID，不使用邮箱或设备指纹。
- `sequence`：客户端实例内递增序号。
- `event_type`：`active`、`inactive`、`ended`。
- `occurred_at`：服务端接收时间，默认 `now()`，不使用客户端时间。
- `created_at`、`updated_at`：审计字段。

唯一键为 `(session_id, client_instance_id, sequence)`；索引覆盖 `(user_id, session_id, occurred_at)`。表启用 RLS：用户只能读取自己的事件，客户端没有直接写权限，写入通过服务端 application。

`active` 表示客户端此刻仍在前台且最近有交互；`inactive` 表示页面失焦、文档隐藏、App 进入后台或客户端主动暂停；`ended` 表示训练会话结束并切断后续区间。事件不含原始输入、转写、音频或设备指纹。

### 2. 有效时长算法

领域层接收按服务端 `occurred_at` 排序的事件，按会话和客户端实例分别计算：

- 只有相邻两个 `active` 事件之间的区间可计入。
- 相邻事件间隔必须大于 0 且不超过 45 秒；超过阈值视为断开，避免网络恢复或后台挂起被补算。
- `inactive` 或 `ended` 会清空当前连续活动链；后续 `active` 从新的区间开始。
- 事件乱序先排序；相同序号重复事件由数据库幂等约束消除。
- 计算结果以秒保留到领域层，热力图展示时向上取整到分钟；单会话仍封顶 45 分钟，防止异常事件污染一天的总量。
- 有至少一个有效区间且有尝试的 `active`、`completed`、`abandoned` 会话都可以贡献时长；无尝试会话不计入热力图。

这是一种保守算法：突然关闭页面时未收到下一次心跳的尾部不会计入，宁可少算也不把空置算成学习。

### 3. API 与应用边界

新增版本化接口：

`POST /api/v1/practice/sessions/:sessionId/activity`

请求体只包含：

```json
{
  "clientInstanceId": "opaque-random-id",
  "sequence": 42,
  "eventType": "active"
}
```

Route Handler 负责认证、Zod 校验、会话所有权检查和协议转换；application 调用 repository 以 `(sessionId, clientInstanceId, sequence)` 幂等追加事件。重复请求返回成功但不增加事实。会话不存在或非本人会话返回稳定错误码；`active`/`inactive` 只接受仍为 `active` 的会话，`ended` 在会话已进入 `completed`/`abandoned` 后仍可幂等接受一次，以覆盖客户端先完成会话、后发送最后事件的竞态。

训练会话创建/完成接口沿用现有 session application 边界；活动接口不允许客户端直接修改 `practice_sessions` 的状态或时间字段。若当前 fake 训练循环没有服务端会话 ID，采集器保持 no-op，不阻塞训练主流程；真实会话接入时由 session application 注入 ID。

### 4. 跨端采集

共享协议只定义事件类型、实例 ID、序号和发送失败语义，不共享 UI：

- Web 适配器监听 `visibilitychange`、窗口焦点和交互事件；可见且最近交互时以约 15 秒节奏发送 `active`，隐藏/失焦发送 `inactive`。
- Flutter 适配器通过 `WidgetsBindingObserver` 监听 resumed/paused/inactive，并由训练页面交互或定时器产生同语义事件。
- 发送失败可丢弃并在下一序号继续；不在本地补造过去时间，不阻塞录音、输入或训练状态机。
- 发送副作用可取消；组件卸载、会话完成和 App 退出负责停止定时器并尽力发送 `ended`。

### 5. 热力图读取

`ProfileRepository.listLearningSessions` 读取会话和活动事件，返回内部 DTO 的 `activeSeconds`；`buildLearningHeatmap` 不再读取 `startedAt/completedAt` 推算时长，只消费 `activeSeconds`。响应 DTO、日期点击详情和能力评分语义保持不变。

热力图接口不返回活动事件明细，只返回按天聚合的分钟数、场景、独立表达次数和技能标签。日志只记录请求 ID、用户 hash、会话 ID 和结果码，不记录活动事件正文或客户端实例 ID 的可逆映射。

## 错误、竞态与隐私

- 未登录、会话不属于当前用户、事件类型非法和序号非法分别映射稳定错误码。
- 旧客户端重复发送同一序号不会重复计时；不同实例并发写入按服务端时间排序后分别计算。
- 服务端数据库不可用时活动发送失败不影响训练，热力图显示可恢复错误或已有空状态。
- 活动事件属于用户私有数据，跟随会话和账号删除级联清理；不保存页面内容、输入正文、音频或设备指纹。
- 活动时长永远不写入 `evidence_events`、`user_skill_states` 或任何能力评分字段。

## 测试与验收

领域单元测试覆盖：连续心跳、`inactive`/`ended` 切断、超过 45 秒断开、乱序、重复事件、无尝试会话、跨天聚合和单会话封顶。

数据访问和 Route Handler 测试覆盖：所有权、RLS、幂等重试、已结束会话拒绝和稳定错误码。Web 组件测试覆盖可见/隐藏与交互节奏；Flutter test 覆盖 resumed/paused 和资源释放。画像 E2E 覆盖发送活动后热力图只显示有效分钟，并确认后台间隔不计入。

完成后执行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm test:e2e`、`pnpm build`；因会修改 `apps/mobile` 或共享 Flutter 协议，还需 `flutter analyze` 和 `flutter test`。没有 Mac/Xcode 时不将这些结果表述为 iOS 编译或真机通过。

## 取舍与后果

心跳事件比客户端直接上报时长多一次写入和聚合成本，但服务端可明确拒绝后台长间隔并保持跨端语义一致。保守算法会少算突然退出前的尾部时间，这是有意选择：热力图宁可低估，也不能把页面空置误报为学习。旧会话改为 0 分钟可能让历史热力图变淡，但避免伪造历史证据；新会话开始产生活动事件后逐步恢复真实数据。
