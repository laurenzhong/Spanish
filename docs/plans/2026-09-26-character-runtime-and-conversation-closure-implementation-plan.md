# CONV-ROLE-001：角色运行时与对话闭环实施计划

- 日期：2026-09-26
- 状态：计划已获产品本人确认；阶段 0–1 代码切片已提交 `d5e3502`，隐私/身份后置修复已提交 `9acb380`，删除前记忆清理与历史隐私 mutation 修复已提交 `d02253c`，等待产品验收。阶段 2–4 尚未开始，阶段 5 默认不领取。当前仍未完成删除/撤回与关系记忆的原子事务、stream CAS 和完整语音/移动闭环，不能把当前切片视为对话功能已完全闭环。
- 建议分支：`codex/conv-role-001-character-runtime`（本轮实际工作树为 `codex/disable-legacy-readlang`；混合工作树只提交本任务相关文件）
- 设计依据：[角色运行时与对话闭环设计](../superpowers/specs/2026-09-26-character-runtime-and-conversation-closure-design.md)、[ADR-0009](../adr/0009-character-runtime-and-conversation-boundary.md)
- 前置关系：不改变当前内容供应队列；建议在 `PODCAST-001`/发布候选门禁完成后排期，除非产品本人明确重新排序

## 1. 目标

把“角色可调用”收敛为“已发布、可验证、具备明确能力边界的角色”，并把对话入口、流式回合、持久化、关系记忆、隐私删除和学习反馈串成一个可恢复闭环。

本任务第一阶段只正式开放 Lucía。Mateo/Inés 的人物内容不在同一实现切片内扩写；它们先作为 draft/coming-soon，未来是否建立 `basic` 人物包需要单独确认。

## 2. 范围与非目标

### 包含

- Lucía v1 人物资料冲突清单、版本和发布门禁；
- 角色生命周期与 capability policy 的服务端 DTO、repository/application 边界；
- 版本化 OpenAPI/JSON Schema 与稳定错误码，覆盖 `clientInputId`、`attemptId`、`generationId`、`characterVersion`、`inputMode`、`inputId`、转写置信度和 NDJSON `meta/delta/done/error` 帧；
- 所有角色列表、详情、创建、历史、搜索、stream 和主动消息的 `published`/权限检查；
- 通用角色关系读取和 provider-neutral runtime context；
- stream generation、retry、取消、队列、删除/撤回、认证和缓存隔离的可靠性修复；
- 移动 `/chat` 入口、语音 draft-review、回合反馈和关键深链回归；
- 角色与对话 provider replay、契约、领域、数据库和 Playwright 测试。
- 生产缺少数据库权限来源或真实 conversation provider 时的 fail-closed 错误路径；deterministic fake 仅用于测试或显式开发注入。

### 不包含

- 支付、订阅、角色商城、开放角色创建或多人社交；
- 实时双向语音、Web Push/APNs/FCM、本地离线 ASR；
- Mateo/Inés 的完整恋爱/主动消息系统；
- 向量检索、无限上下文、独立微服务或消息队列；
- Flutter 功能同步或 iOS 真机编译发布。

## 3. 任务切片与停点

| 阶段 | 未来切片（不是本轮领取的任务 ID） | 主要修改面 | 必须先通过的验收 | 停点 |
| --- | --- | --- | --- | --- |
| 0 | Lucía v1 冻结 | 人物 JSON、版本/审核 fixture、冲突记录 | 姓名/身份、透露策略、能力开关和 replay manifest 唯一 | **基础运行时 policy 已落地；canonical 姓名/审核/replay/数据库发布仍待产品确认** |
| 1 | 发布与目录边界 | `characters`、目录 DTO、list/detail/create/history/search/stream/intro route | draft 角色不可发现、不可创建、不可发送；直接 URL/API 返回稳定错误；已有旧历史只读 | **服务端 published gate 与 draft 隔离已落地；完整 API/RLS/只读 UI 契约仍待验收** |
| 2 | 运行时角色策略 | `CharacterRuntimePolicy`、通用关系读取、provider context | Lucía 真实 stage/summary 注入；角色 A 不读取角色 B；无 key 分支继承 | provider fake/replay 和关系隔离测试通过 |
| 3 | 回合可靠性与隐私 | stream application/repository、retry、CAS、删除/撤回、auth/cache | stale generation、丢 done、重复 retry、取消、删除竞态不重复收费/消息/记忆；撤回内容不进入搜索/上下文 | 领域/集成/数据库测试通过 |
| 4 | Web/PWA 闭环 | `/chat`、移动 rail/header、语音 composer、反馈抽屉 | 桌面/手机可进入 Lucía；录音→转写草稿→确认发送；错误可恢复；无数据时不伪造已保存 | 关键 Playwright 与人工移动验收通过 |
| 5 | 基础朋友（可选） | Mateo/Inés 各自人物包和 replay | 产品明确批准后，每个角色独立通过 basic 角色包、介绍、关系上限和回放 | 单独停点，不自动连续开放 |

本轮只记录 umbrella 任务 `CONV-ROLE-001`，未来每个实现切片领取时再由协调者分配唯一任务 ID。不得跨阶段顺手发布角色或新增未批准能力；阶段 5 默认不领取。

### 3.1 本轮实际交付（阶段 0–1 基础切片）

- 新增 `CharacterRuntimePolicy` 与 `resolveConversationCharacter`：真实运行时要求 `characters.status = published`；无数据库或真实 provider 时生产 fail-closed，deterministic fake 只保留给测试/E2E/显式开发注入。
- 会话列表、搜索、详情、history、stream、消息操作、主动消息和介绍入口增加角色生命周期/能力门禁；Mateo/Inés 继续保持 `draft/coming-soon`，不创建新关系、会话或共享授权。
- 已有旧角色历史的 API 投影支持 `readOnly` 标记；只读历史入口与客户端完整展示仍作为后续补强项，不将此切片宣称为完整 UX 闭环。
- 浏览器历史与联系人缓存使用服务端生成的用户 scope，并在登出、切号或请求迟到时中止/忽略旧 generation；介绍接受即使没有共享记忆，也必须重新校验来源角色仍可用。
- 本轮没有把 Lucía 人物 JSON 或数据库记录改成 `published`，也没有解决 `Lucía García` / `Lucía Martín` 的 canonical 选择。

### 3.2 本轮复核后置修复（`9acb380`、`d02253c`）

- 撤回用户消息后，联系人预览、未读数和历史搜索均排除指向该消息的 assistant；删除用户消息时在同一事务内删除其 assistant 回复，重复删除保持幂等。由于 `relationship_memories.source_message_id` 使用 `ON DELETE SET NULL`，`d02253c` 已改为先验证消息归属、先清理来源关系记忆，再删除消息；记忆清理失败时保留源消息并返回可重试错误。跨模块原子事务仍未建立，撤回路径的失败重试与 completion/withdraw/delete CAS 仍属于阶段 3。
- 角色运行时不再在已发布数据库版本缺少 active facts 时恢复静态人物 biography；只保留必要的 AI 身份边界，其他未持久化 reveal policy 的事实继续按 `never` 处理。
- 账号、头像、账号数据、Lucía 数据、provider 偏好和转写入口统一使用 request-bound auth helper；显式 invalid Bearer 不再回退到 cookie 身份。未读徽标按账号 scope/generation 隔离，scope 切换、登出和迟到响应不会复用旧账号数量。
- Lucía 好友申请和 authored opening 明确标注为虚构故事背景，不把文化活动或线下见面描述成现实经历。
- 本修复仍不宣称阶段 3 已完成：completion/withdraw/delete 的并发 CAS、撤回路径关系记忆失败重试、父消息存在性校验、逐路由 Schema 补齐、语音 draft/review 和移动验收保留在后续停点。

## 4. 先写测试的要求

### 4.1 角色与发布

- draft/retired 角色不出现在联系人、会话列表、搜索或公开详情。
- 直接 stream、history、create、proactive 请求返回稳定的角色不可用/权限错误。
- 草稿介绍接受不能创建关系、会话或共享授权；已有旧版本历史只读、不可发新消息。
- 角色版本改变时，旧消息和关系记忆仍引用旧版本，不能静默覆盖。
- 场景临时人物不写入长期角色、会话或关系记忆。

### 4.2 Provider 与上下文

- provider 输入只包含当前发布角色、当前用户可读记忆和当前角色关系。
- active Lucía 的真实 stage/summary 不回落为默认值；Mateo/Inés 的状态不读取 Lucía。
- provider 失败、非法 Schema、取消和 safety-gate 失败不写完整 assistant、关系记忆或关系升级。
- 缺少真实 provider 或数据库权限来源时返回 `CONVERSATION_UNAVAILABLE`/可重试 provider 错误，不把 deterministic fake 当作正式回复。
- 每个正式角色拥有独立 replay manifest；测试使用 fake，不调用真实收费供应商。

### 4.3 流、重试与幂等

- 无 `done` 不算完成；错误 generation 的 `done` 不更新当前 UI。
- 丢包后重试最多产生一次 provider 终态、一个 assistant 和一组派生状态。
- 用户取消、离页、队列停止和过期回调不会静默继续发送。
- 错误码能区分登录、权限、角色未发布、联系人未接受、可重试和不可重试错误。

### 4.4 数据与隐私

- 消息、assistant 回复、搜索、上下文和关系记忆按当前用户隔离。
- 删除/撤回重复调用幂等；流进行中撤回不会在 done 后写入 assistant 或记忆。
- 阶段 3 必须以父消息锁/CAS 或等价的权威状态检查协调完成、撤回和删除：assistant completion 只能写入仍存在且未撤回的父消息，删除父消息后不得留下孤儿 assistant，撤回竞态不得产生关系记忆或学习证据。
- 删除用户消息与其来源关系记忆必须采用原子事务，或采用“先清理记忆、失败则不删消息并返回可重试错误”的隐私优先方案；不能依赖 `ON DELETE SET NULL` 后再按 source ID 补偿清理。
- 角色退回 `draft`/`retired` 后，历史会话仍不可发送新消息，但用户的删除/撤回等隐私操作必须继续可用。
- 无效 Bearer 不回退到另一个 cookie 身份；客户端历史缓存按用户 ID 隔离。
- 临时录音在成功、失败、取消和超时后删除；低置信度转写不创建口语证据。

### 4.5 Web/PWA 体验

- `/chat` 桌面、375/390px 移动视口均能进入已发布 Lucía；介绍接受后联系人即时刷新。
- 移动 dialog 支持焦点陷阱、Esc/返回和屏幕阅读器；搜索深链可定位超过首屏的消息。
- 语音完成 draft-review（编辑、重录、取消、确认）；普通文字输入在麦克风失败时可用。
- 完整回合有可关闭的反馈入口，区分文字/语音证据，不把技术失败呈现为评分。

## 5. 实现边界

- Route Handler 只做鉴权、Zod 校验、application 调用和协议转换。
- `characters` 拥有人物版本与固定事实；`memory` 拥有关系记忆和共享权限；`conversation` 拥有消息生命周期；provider 只依赖内部 DTO。
- `characterVersion` 由已发布人物版本服务端决定，并写入会话/消息/关系派生引用；禁止在 route 或 repository 中硬编码版本 `1`，旧版本会话按版本只读恢复。
- 角色目录只能投影已发布版本，不能成为第二套人物事实来源。
- 不以客户端状态、角色名称或 prompt 作为安全边界；关键能力和权限由服务端 policy 重新校验。
- 所有副作用绑定 `attemptId`/`generationId`；所有写操作考虑重试和 CAS。

## 6. 迁移顺序与兼容

1. 先增加 runtime policy/版本引用和读取端口，不删除现有人物 JSON、消息或关系表。
2. 将静态 catalog 改为已发布角色的服务端投影；旧 UI 只在收到明确 `available` capability 时显示 composer。
3. 为 Lucía 建立 canonical v1；旧版本只读，已有会话继续使用其版本上下文。
4. 将关系读取从 Lucía 专用接口抽象为按 `userId + characterKey + characterVersion` 查询；保留 Lucía contact endpoint 作为兼容协议。
5. 在可靠性修复完成前，不打开 Mateo/Inés 的 production composer。

## 7. 验证命令

实现阶段按切片运行聚焦检查：

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm test:e2e
pnpm build
```

涉及数据库/迁移时增加空库、RLS、幂等和回滚验证；涉及 iPhone Safari/PWA 的部分另行记录真机结果，不能用桌面 Chromium 代替。

### 7.1 本轮验证记录

- 实现 Commit：`d5e3502`（`feat: enforce published character conversation runtime`）；隐私/身份后置修复：`9acb380`（`fix: close conversation privacy and identity leaks`）与 `d02253c`（`fix: remove memories before conversation deletion`）。
- 此前依赖完整时角色/会话/网络/认证聚焦回归：21 files / 96 tests 通过（包含数据库持久化、偏好/TTS envelope、草稿门禁、无数据库 fail-closed、共享权限撤销和持久化事实隐私回归）；本提交另新增缓存竞态 2 条、空共享 source gate 1 条回归。
- `pnpm test:contracts`：23 files / 85 tests 通过；核心会话 history/list/message/search/stream JSON Schema、OpenAPI 路径和统一错误 envelope 已同步。
- 当前复核的 Node-only 聚焦测试 3 files / 13 tests 通过（直接调用工作树 Vitest CLI）；此前扩大聚焦运行在 worker OOM 后报告 14 files / 50 tests 通过。浏览器测试因工作树依赖缺少 `@asamuzakjp/css-color`/`picocolors` 未能启动，受影响 ESLint 因缺少 `@babel/core` 未能重跑；`pnpm exec tsc --noEmit` 仍被并行媒体 `src/modules/media/ui/media-library.tsx:282` 阻断，筛选输出未发现本任务源文件错误。
- 已用包含完整 `0013_smart_stick.sql` 的 PGlite 迁移集合验证 withdrawn assistant 的预览/未读/搜索过滤、删除事务同时删除用户消息和 assistant、来源关系记忆在删除前清理，以及 draft 角色历史消息仍可删除/撤回；路由单测还验证记忆清理失败时源消息保留并可重试。
- 阶段 3 尚未完成：stream 当前仍可能在最终 `isMessageWithdrawn` 检查前写入 assistant，`completeAssistantMessage` 也尚未验证父消息仍存在且未撤回；撤回路径的记忆清理失败重试、删除/撤回与关系记忆的 CAS/事务设计仍待实现。
- 仍未完成全量 unit/E2E/build、introductions/proactive/preferences/translation/TTS 的逐路由 Schema 补齐、完整 RLS/只读历史 UI、真实 provider/远端数据库和 iPhone Safari/PWA 验收。
- 角色数据库当前尚未保存人物事实的 `reveal/audience/trigger` policy；运行时对非 AI 身份事实保守按 `never` 处理。Lucía 发布前必须完成版本化 reveal 持久化与关系阶段过滤，不能把静态 fallback 当作生产事实。

## 8. 产品验收清单

- [ ] 只看到并能进入已发布 Lucía；草稿角色显示明确的尚未开放状态。
- [ ] 首次 AI 身份披露、现实边界、关系阶段和角色能力说明可理解但不打扰聊天。
- [ ] 文本和语音都能完成“发送→流结束→历史恢复”；刷新、断网、取消和重试不重复生成。
- [ ] 删除/撤回后，搜索、上下文、assistant 回复和关系记忆不再泄漏被撤回内容。
- [ ] Lucía 的回复自然承接用户，不因学习目标强行纠错或追问；完整回合反馈不把聊天变成题库。
- [ ] 真实 provider、真实关系数据和 iPhone Safari/PWA 结果分别记录，不用 fake 结果冒充生产质量。

## 9. 完成定义

本任务只有在阶段 1–4 的自动化门禁、Lucía 人工回放和桌面/移动关键路径通过后，才可以把 Lucía 标记为生产 `published`。阶段 5 即使未实施，也不阻塞 Lucía；若未来开放 Mateo/Inés，必须新建或明确领取独立任务并更新本计划、ADR、测试策略和状态页。
