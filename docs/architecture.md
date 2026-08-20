# 个人 Alpha 架构边界

- 状态：实施基线
- 适用范围：个人 Alpha
- 详细产品要求：[设计规范](superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)

## 1. 架构目标

个人 Alpha 使用一个 Next.js/TypeScript 模块化单体。目标是在不提前拆微服务的前提下，让训练、评分、画像、推荐、角色、记忆和供应商集成保持清晰边界，可以独立测试和替换。

架构优先保证：

- 训练流程可恢复、可测试。
- 学习证据可审计、画像可重算。
- AI 与语音供应商可替换。
- 角色记忆不会越权共享。
- 技术故障不会污染能力评分。
- Web Alpha 的领域逻辑未来可以被 iOS 客户端复用。

## 2. 运行时视图

```text
手机浏览器 / PWA
  ├─ React 页面与组件
  ├─ 浏览器 TTS、录音、权限
  └─ 会话级短期状态与草稿
            │ HTTPS / 流式响应
            ▼
Next.js 模块化单体
  ├─ Route Handlers：鉴权、校验、协议转换
  ├─ Application：用例编排与事务边界
  ├─ Domain：纯业务规则和状态机
  ├─ Repository：数据库访问接口与实现
  └─ Provider Gateways：STT、发音、LLM、TTS、地点
            │
            ├─ Supabase PostgreSQL / Auth / Storage
            └─ 外部 AI、语音与地点供应商
```

## 3. 目录与职责

```text
app/
  (auth)/                 # 登录与账号页面
  (product)/              # 学习、探索、对话、我的
  api/                    # 薄 Route Handlers
src/
  modules/
    content/              # 内容图谱、导入、发布与查询
    training/             # 训练计划、状态机、断点
    evidence/             # 评估结果、证据强度、事件写入
    profile/              # 技能快照、场景状态、进步解释
    recommendation/       # 唯一下一动作
    characters/           # 人物圣经与固定事实
    memory/               # 关系记忆、权限、冲突检查
    conversation/         # 对话、回复规划、消息流
    providers/            # 外部供应商适配器
  shared/
    auth/                 # 服务端身份解析
    db/                   # Drizzle 客户端与共享事务工具
    validation/           # 通用 Zod 工具
    observability/        # 日志、追踪、调用成本
    ui/                   # 无业务含义的基础组件
content/                  # 版本化内容源
drizzle/                  # 数据库迁移
tests/
  fixtures/               # 固定音频、文本、角色和证据样本
  contracts/              # 供应商与协议契约测试
  e2e/                    # Playwright
```

## 4. 分层规则

每个业务模块可以包含：

```text
domain/          # 纯 TypeScript 规则，不访问 IO
application/     # 用例编排、权限、事务和端口调用
repositories/    # 数据访问接口及实现
schemas/         # 外部输入和持久化边界校验
ui/              # 模块专用 React 组件
```

依赖方向：

```text
UI / Route Handler → Application → Domain
                         │
                         ├→ Repository interface → DB implementation
                         └→ Provider interface   → Vendor adapter
```

硬性规则：

- `domain` 不导入 React、Next.js、Drizzle、Supabase SDK 或供应商 SDK。
- Route Handler 不直接实现评分、推荐或记忆规则。
- React 组件不直接写数据库。
- 模块不能直接更新其他模块拥有的表；必须调用对方 application 接口。
- `shared` 不能反向依赖任何业务模块。
- 跨模块共享的数据使用小型显式 DTO，不导出内部数据库行作为公共 API。

## 5. 模块所有权

| 模块 | 拥有的规则 | 主要数据 |
|---|---|---|
| content | 内容版本、审核、图谱和发布 | expressions、tags、scenarios、content_packs |
| training | 当前训练计划、状态机和断点 | practice_sessions、practice_attempts、learning_breakpoints |
| evidence | 尝试评估和证据强度 | evidence_events |
| profile | 技能快照、场景状态和解释 | user_skill_states、user_scene_states |
| recommendation | 候选排序与下一动作 | 默认不拥有持久表，读取其他模块投影 |
| characters | 人物圣经、固定事实和揭示策略 | characters、character_canon_facts |
| memory | 关系记忆、共享权限和冲突 | relationships、memories、permissions |
| conversation | 会话、消息和回复生命周期 | conversations、messages |
| providers | 供应商适配和统一错误 | provider_calls、audio_assets |

## 6. 关键领域边界

### 6.1 训练完成不等于能力掌握

`training` 只回答“用户当前正在做什么、流程走到哪里”。`evidence` 判断本次尝试提供了什么证据，`profile` 决定技能状态如何变化。

禁止在训练页面完成回调中直接把场景标记为掌握。

### 6.2 证据事件与技能快照

`evidence_events` 是追加式事实，至少保存：

- `attempt_id`
- `skill_key`
- `observed_value`
- `evidence_strength`
- `output_mode`
- `prompt_level`
- `tag_weight`
- `evaluation_confidence`
- `algorithm_version`
- `occurred_at`

`user_skill_states` 是派生快照，至少保存：

- `mastery`
- `confidence`
- `oral_coverage`
- `evidence_count`
- `last_verified_at`
- `revision`
- `algorithm_version`

每次证据写入和快照更新在同一事务中完成。定期重算用于验证快照没有漂移。

### 6.3 内容版本

- 内容源使用稳定 `external_id`。
- 每次教学含义变化增加版本。
- 已产生学习证据的版本不可原地重写。
- 训练尝试保存实际内容版本。
- 推荐器只使用已发布、适合当前母语且审核通过的内容。

### 6.4 人物固定事实与关系记忆

人物圣经是全局角色事实，关系记忆是某个用户与角色的共同历史，两者不可混写。

必须区分：

- 事实存在于人物设定。
- 事实已经向当前用户透露。
- 用户告诉当前角色的信息。
- 用户允许分享给其他角色的信息。
- 只供教学推荐使用的画像。

## 7. 训练状态机

训练引擎接受当前状态和领域事件，返回新状态与待执行 effect：

```ts
type TrainingTransition = {
  state: TrainingState;
  effects: TrainingEffect[];
};
```

effect 只描述意图，例如：

- `playPrompt`
- `startRecording`
- `requestTranscription`
- `requestEvaluation`
- `persistBreakpoint`
- `recordEvidence`

浏览器或 application 层执行 effect 后，再将结果作为事件送回状态机。

每个异步 effect 携带：

- `sessionId`
- `attemptId`
- `generationId`
- `effectId`

只有仍属于当前 generation 的结果可以改变状态。

## 8. API 设计

Route Handler 的职责只有：

1. 解析登录用户。
2. 使用 Zod 校验输入。
3. 调用一个 application 用例。
4. 把领域结果转换为 HTTP/流式协议。
5. 记录相关 ID、延迟和结构化错误。

推荐的 Alpha API：

- `POST /api/diagnostics`
- `GET /api/learning/next-action`
- `POST /api/practice/sessions`
- `POST /api/practice/attempts`
- `POST /api/practice/attempts/:id/audio-upload`
- `POST /api/practice/attempts/:id/evaluate`
- `GET /api/profile`
- `GET /api/content/packs/:id`
- `GET /api/conversations`
- `POST /api/conversations/:id/messages`
- `GET /api/conversations/:id/stream`
- `POST /api/relationships/:id/share-permission`
- `DELETE /api/me/data`

API 错误使用稳定代码，不让前端解析供应商原始错误文本。

## 9. 流式消息协议

聊天使用 NDJSON 或等价的可逐帧解析协议：

```json
{"meta":{"messageId":"...","generationId":"..."}}
{"delta":"Hola"}
{"delta":", ¿qué tal?"}
{"done":true}
```

错误帧：

```json
{"error":{"code":"PROVIDER_TIMEOUT","retryable":true}}
```

规则：

- 没有 `done` 的自然断流是失败。
- 用户主动停止可以保存已展示文本，但消息状态为 `stopped`。
- 只有 `completed` 消息参与记忆提取和完整学习评估。
- 重试创建新的 generation，不覆盖旧消息记录。

## 10. 幂等与并发

- 尝试提交以 `attemptId` 幂等。
- 证据事件以 `(attempt_id, skill_key, algorithm_version)` 唯一。
- 供应商调用保存外部请求 ID，重试前先查询已有终态。
- 技能快照使用 `revision` 乐观锁。
- 记忆候选提交使用稳定候选 ID，防止流重连重复写入。
- 旧 generation 结果可以被记录为诊断，但不能更新当前 UI 或能力状态。

## 11. 数据库与 RLS

- 所有用户私有表都包含 `user_id`。
- RLS 默认拒绝，按最小操作开放。
- 客户端不能直接写 `evidence_events`、`user_skill_states`、`relationship_memories` 和 `provider_calls`。
- 内容公开查询只返回已发布版本。
- 管理或导入能力使用服务端专用角色，不暴露到浏览器。
- 删除账号时按明确顺序删除或匿名化用户数据，并记录不可逆操作结果。

## 12. 音频生命周期

1. 客户端请求短期签名上传信息。
2. 客户端上传受限类型和大小的录音。
3. 服务端确认所有权后调用转写或发音服务。
4. 生成评估和必要的派生数据。
5. 普通录音删除；只保留转写、指标和证据。
6. 用户明确保存的里程碑录音移动到长期区域。

任何日志都不能包含长期有效的签名 URL。

## 13. 供应商抽象

业务代码只能依赖内部接口。适配器负责：

- 请求格式和认证。
- 超时、重试和取消。
- 供应商错误映射。
- 响应格式转换。
- 调用成本与延迟记录。
- 数据保留策略标记。

供应商选择不应改变 evidence、profile、training 或 conversation 的公共接口。

## 14. 可观测性

结构化日志至少包含：

- `requestId`
- `userIdHash`
- `sessionId`
- `attemptId`
- `conversationId`
- `generationId`
- `provider`
- `latencyMs`
- `resultCode`

禁止记录：

- 原始录音内容。
- 完整私密对话正文。
- API 密钥和访问令牌。
- 长期有效的存储地址。

关键指标：

- 训练完成和恢复成功率。
- STT 低置信度率。
- 评估结构校验失败率。
- 重复证据拦截次数。
- 聊天首 token 和完整响应延迟。
- 无 `done` 异常断流率。
- 记忆冲突和越权共享拦截次数。
- 每次有效训练和聊天的供应商成本。

## 15. 暂不拆分的边界

Alpha 不创建：

- 独立评分服务。
- 独立聊天服务。
- 消息队列集群。
- 单独推荐数据库。
- 多仓库前后端。

只有出现可测量的性能、发布隔离或团队所有权问题时，才通过 ADR 评估拆分。

## 16. 架构决策记录

影响以下内容的变更必须新增 ADR：

- 技术栈或部署平台。
- 模块所有权和公共接口。
- 证据算法或画像语义。
- 数据保留和隐私边界。
- 角色记忆共享规则。
- 供应商数据处理方式。
- Alpha 延后范围的提前引入。

ADR 存放于 `docs/adr/`，格式为 `NNNN-short-title.md`。
