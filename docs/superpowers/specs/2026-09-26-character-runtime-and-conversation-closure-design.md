# 角色运行时与对话闭环设计

- 日期：2026-09-26
- 状态：产品本人已确认进入实施计划；实现尚未开始
- 任务：`CONV-ROLE-001`
- 适用范围：个人 Alpha、Next.js Web/PWA、长期 AI 角色对话
- 关联 ADR：[ADR-0009：版本化角色运行时与对话闭环边界](../../adr/0009-character-runtime-and-conversation-boundary.md)
- 关联设计：[Lucía 人物圣经与行为画像设计](2026-08-28-lucia-character-bible-and-behavioral-profile-design.md)、[对话连续性与关系上下文设计](2026-08-29-conversation-context-continuity-design.md)

## 1. 决策摘要

“能调用 AI 模型”不等于“已经存在一个可长期使用的角色”。角色必须同时具备版本化人物设定、能力策略、关系边界、记忆权限、现实边界和可回放的质量基线。

个人 Alpha 先只把 Lucía 作为正式长期角色。Mateo 和 Inés 保留为草稿/即将开放角色；在各自最小人物包、发布审核和回放集完成前，不出现在正式联系人目录，也不能通过直接 URL 或 API 开始生产会话。场景练习中的服务员、工作人员等临时人物继续留在 `scenario-practice`，不进入长期角色、联系人或关系记忆。

对话闭环定义为：

```text
入口 → 已发布角色与关系门禁 → 发送文本/语音草稿
  → 可取消、可重试且 generation 安全的流
  → done 后唯一持久化
  → 历史恢复与关系/记忆派生
  → 删除、撤回、权限和失败状态可恢复
  → 对用户可理解的回合反馈
```

## 2. 产品不变量

1. 角色目录是已发布角色的投影，不是静态 prompt 变量的列表。
2. `draft`、`retired` 或关系未建立的角色不能以“可聊天”状态出现在生产 UI。
3. 人物圣经、角色能力和关系记录由服务端持有；客户端不能写入事实、记忆、关系阶段或发布状态。
4. 人物固定事实、已经向当前用户透露的事实、用户私密信息和可共享记忆必须分层保存。
5. 只有完整 `done` 的对话轮可以更新长期记忆、开放话题或关系派生状态。
6. provider 只生成候选表面文本；不能直接新增人物事实、升级关系、开启主动消息或改变共享权限。
7. 生产环境没有可用的持久化权限来源或真实 conversation provider 时必须 fail closed，返回可恢复的 `CONVERSATION_UNAVAILABLE`/provider 错误；确定性 fake 只允许测试或显式开发注入，不能冒充正式角色回复。
8. 用户直接询问角色是否为 AI 时必须如实回答；角色不能把虚构地点、房源、线下见面或现实行动说成真实存在。
9. 角色能力是显式 policy，不通过 `characterKey` 分支隐式继承 Lucía 的恋爱、主动消息或时区逻辑。
10. 临时场景人物不创建长期 `characters`、`conversations`、关系记忆或联系人。

## 3. 角色分类与生命周期

### 3.1 生命周期

`lifecycle` 与能力开关独立建模：

```ts
type CharacterLifecycle = "draft" | "published" | "retired";

type CharacterRuntimePolicy = {
  conversation: "disabled" | "basic" | "full";
  proactiveMessages: boolean;
  romanticSubtext: boolean;
  introductions: boolean;
  persistentMemory: "none" | "private";
  maxRelationshipStage:
    | "new_contact"
    | "getting_to_know_you"
    | "familiar"
    | "close_friend";
  voiceInput: boolean;
};
```

生产资格要求 `lifecycle = published`，且人物版本、语言审核、教学审核、结构校验和必要的回放门禁均通过。前端隐藏不是授权边界；联系人发现、详情、创建、搜索、新消息、stream、主动消息和联系人接受接口都要重新检查。已有用户拥有的旧版本会话可以按所有权和版本引用只读恢复，但必须标记为只读、禁止新消息和关系派生，不应为了隐藏草稿而静默删除历史。

### 3.2 三类长期/短期人物

| 类型 | 当前角色 | 允许能力 | 明确禁止 |
| --- | --- | --- | --- |
| `full` 长期角色 | Lucía | 文字；审核通过后可启用语音、私密关系记忆、主动消息 | 未经显式 policy 不得默认恋爱或跨角色共享 |
| `basic` 基础朋友 | Mateo、Inés（未来） | 接受介绍后文字聊天、有限关系阶段、角色私密记忆 | 主动消息、恋爱分支、跨角色自动共享、超过 `close_friend` 的关系升级 |
| `scenario-npc` 临时人物 | 餐厅服务员、工作人员等 | 当前场景内多轮练习与复盘 | 长期联系人、关系记忆、角色目录、好友介绍 |

尚未完成的人物只能是 `draft`/`disabled`。若需要展示模型能力，应使用独立的“实验对话”入口，明确不保存长期关系和记忆，不能把实验结果冒充正式角色。

## 4. 角色人物包

每个可发布角色都必须拥有独立、版本化的人物包。最小结构如下：

```ts
type CharacterBible = {
  characterKey: string;
  version: string;
  lifecycle: CharacterLifecycle;
  identity: {
    displayName: string;
    locale: "es-ES" | "es-MX" | string;
    location: string;
    occupation: string;
  };
  personality: {
    behaviorSummary: string[];
    responseStyle: string[];
    stressAndRepair: string[];
  };
  canonFacts: Array<{
    key: string;
    statement: string;
    revealPolicy: "never" | "relationship-gated" | "direct" | "any-user";
  }>;
  conversationPolicy: {
    teachingMode: "natural-first" | "explicit-on-request";
    questionBudget: "low" | "adaptive";
    correctionTiming: "after-complete-turn";
  };
  relationshipPolicy: {
    enabled: boolean;
    maxStage: CharacterRuntimePolicy["maxRelationshipStage"];
    romanticSubtext: boolean;
    consentSignals: string[];
  };
  memoryPolicy: {
    persistence: "none" | "private";
    shareRequiresExplicitPermission: boolean;
    conflictAction: "pause-and-review";
  };
  safetyBoundaries: string[];
  evaluationManifest: string;
};
```

人物设定的存在不代表已经向用户透露。provider 输入使用服务端构建的最小摘要和当前用户可读投影，不直接读取原始人物 JSON、数据库行或其他角色的私密关系记忆。

## 5. Lucía v1 冻结工作

Lucía 是第一份完整人物包，但在进入 `published` 前仍需完成以下冻结项：

1. 统一姓名、年龄/年龄策略、城市、职业、语言地区和初次相识骨架。现有设计文档的 `Lucía García` 与当前 JSON 的 `Lucía Martín` 冲突，必须由产品本人选择一个版本并写入人物版本，不能让代码隐式选择。
2. 把性格、语言风格、教学策略、问题预算、情绪强度上限和修复方式写成 provider-neutral 行为摘要。
3. 明确关系阶段的进入、停留、降速和修复事件；沉默不能被当作同意，恋爱表达不是默认能力。
4. 明确固定事实、短期生活片段、可揭示事实和不可验证现实信息的边界。
5. 明确主动消息、语音、好友介绍和私密记忆的 capability；每项 capability 都要有失败、取消、静音和撤销路径。
6. 运行 Lucía provider 回放集，覆盖自然回应、换话题、低能量、AI 身份、现实边界、隐私泄漏、重复话题和 provider 失败。
7. 角色版本发布后不可静默覆盖已有消息、关系记忆或回放输入；变更生成新版本并保留旧版本引用。

## 6. Mateo/Inés 的开放策略

Mateo 和 Inés 不自动继承 Lucía 的人物、时区、恋爱或主动消息策略。若未来要开放，每个角色分别完成：

- 身份、语言地区、职业/兴趣和 10–20 条固定事实；
- 每条事实的透露规则、来源和版本；
- 自己的 response style、冲突/修复和现实边界；
- 介绍来源、接受条件和独立关系记录；
- `basic` capability policy 与 `close_friend` 上限；
- 独立 provider replay/evaluation manifest；
- 发布前的 `es-ES`/`zh-CN` 内容审核与产品本人验收。

第一版不做其他角色主动消息、恋爱支线、跨角色自动传递用户信息或复杂角色网络。用户明确授权的单条共享仍必须走现有权限流程，并以目标角色为范围。

## 7. 对话闭环要求

### 7.1 入口与可用性

- 桌面和手机 `/chat` 都能进入至少一个已发布角色；无会话时仍提供明确的 Lucía 入口或真实空状态。
- 联系人 rail、移动 header、搜索和好友介绍接受后状态保持同步。
- 草稿/未发布角色的详情页显示“尚未开放”，不显示可发送 composer；直接 URL/API 创建新会话或发送消息返回稳定的角色不可用错误。若用户拥有该角色的历史会话，只能以版本固定的只读历史打开。

### 7.2 回合可靠性

- 每个用户输入拥有 `clientInputId`、`attemptId` 和 `generationId`。
- 只有明确 `done` 且通过 Schema/安全门禁的 provider 输出才能创建唯一 assistant 消息。
- 旧 generation、错误 generation、重复 retry、断流恢复和取消都不能重复调用 provider、消息或记忆。
- 错误码必须区分未登录、无权限、角色未发布、联系人未接受、可重试 provider 失败和不可重试安全拒绝。
- 联系人介绍接受、关系创建和会话创建必须在同一事务内重新检查已发布版本；草稿角色不得因为接受请求而生成关系、会话或共享授权。
- 队列中的消息在取消、离页、失败和恢复时有明确策略；不能在用户停止后静默继续发送。

### 7.3 隐私与数据生命周期

- 删除/撤回用户消息必须幂等，并级联清理对应 assistant 回复、搜索投影、上下文、候选记忆和未完成派生状态。
- `withdrawn`、未完成流和低置信度/技术失败不得进入关系记忆或学习证据。
- 认证失败不能从无效 Bearer 静默回退到另一个 cookie 身份；历史缓存必须按用户隔离。

### 7.4 语音与学习反馈

- 语音必须经过录音、转写、可编辑 draft、重录/取消、用户确认后才进入文字发送流。
- 记录 `inputId`、输入方式、转写置信度和 attempt/generation；临时音频在所有终态删除。
- 完整回合提供克制的反馈入口，区分文字交流、语音表达、跟读和未验证证据；技术失败不能伪装成评分。

### 7.5 关系与上下文

- 使用通用 `getCharacterRelationship(userId, characterKey, characterVersion)`，返回 status、stage、summary、revealed canon keys 和可读记忆。
- `buildReplyContext` 只消费服务端的 `CharacterRuntimePolicy` 与关系快照；不得按角色 key 复制 Lucía 专属分支。
- 只有完整回合更新开放话题、摘要、关系事件候选或长期记忆；冲突时暂停写入并保留人工/规则复核入口。

## 8. 实施顺序与停点

实施任务详见 [CONV-ROLE-001 实施计划](../../plans/2026-09-26-character-runtime-and-conversation-closure-implementation-plan.md)。顺序固定为：

1. 冻结 Lucía v1 与角色发布/能力契约；
2. 全链路 `published` 门禁和角色目录权威投影；
3. 通用角色运行时 policy、关系读取和 provider-neutral context；
4. stream/retry/取消/删除/撤回/认证缓存的幂等与隐私修复；
5. 移动入口、语音 draft-review、回合反馈和深链回归；
6. 产品本人决定是否为 Mateo/Inés 建立 `basic` 人物包；未批准前不实施。

每一步完成后暂停，先运行对应测试并由产品本人验收；不得通过提前发布草稿角色来证明流程“看起来可用”。

## 9. 非目标

- 支付、订阅、角色商城、开放角色创建或多人社交。
- 实时双向语音通话、Web Push/APNs/FCM。
- 向量数据库、无限历史检索或复杂消息队列。
- 用模型自动改写人物圣经、关系阶段、记忆共享权限或现实事实。
- 为了让 Mateo/Inés 出现在 UI 中而复制 Lucía 的恋爱、主动消息或关系成长逻辑。

## 10. 开放决策

以下决定在实现 Lucía 发布门禁前必须明确记录：

1. Lucía 的正式姓名和人物版本号。
2. Alpha 是否保留恋爱暗示；若未确认，默认关闭。
3. 主动消息夜间策略和用户本地免打扰优先级。
4. 是否把 Mateo/Inés 作为 `basic` 角色开放，还是继续保持 coming-soon。
5. 回合反馈第一版展示哪些文字/语音观察，避免把自然聊天变成评分面板。
