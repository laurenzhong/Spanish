# ALPHA-026 Lucía 人物圣经设计

- 日期：2026-08-24
- 状态：已获用户确认，待文档审阅
- 任务：ALPHA-026
- 范围：人物内容源、人物 Schema、纯领域 canon 校验和单元测试

## 背景

ALPHA-027 的对话消息流需要一个稳定、可审计的人物事实来源。人物圣经是全局角色设定，不能与某个用户的关系记忆、教学画像或聊天消息混写。Lucía 的身份可能在产品迭代中调整，因此系统不能把初始身份当成永远不可变的代码常量，也不能静默覆盖已经发布或已经向用户揭示的事实。

## 决定

建立 `characters` 业务模块的最小纯逻辑切片：

- `content/characters/lucia.json` 保存版本化人物内容，初始为 `draft`、版本 `1`。
- `src/modules/characters/schemas/character-bible.ts` 定义严格的 TypeScript DTO 与 Zod 边界 Schema。
- `src/modules/characters/domain/canon-checker.ts` 提供确定性、无 IO 的人物事实和版本校验。
- 单元测试覆盖初始人物、重复事实、版本升级、身份变化和揭示冲突。

本任务不实现聊天页面、消息流、关系记忆、数据库迁移、provider 或人物 UI。

## 人物内容模型

人物圣经至少包含：

- `stableKey`、`version`、`status`、`displayName`、`avatarUrl`、`homeLocation`。
- `identity`：核心身份字段，包括年龄、成长地/居住地和教育/职业描述。
- `personality`：性格、语气、主动程度、回应节奏和话题偏好。
- `relationships`：已知人物关系，只描述角色设定中的关系，不保存用户关系历史。
- `facts`：可版本化事实，每条包含 `factKey`、`value`、`sensitivity`、`version`、`isActive`、`reveal`。
- `reveal`：事实的默认揭示范围和触发说明；它描述“可以如何揭示”，不记录某个用户是否已经知道。
- `changeLog`：版本变更原因和前一版本引用。

初始 Lucía v1 固定：24 岁、在马德里长大并生活、数字传播与新媒体硕士。像“母亲为意大利人”这样的新背景事实可以在后续版本加入，不默认写入 v1 核心身份。

## 版本和身份变化

版本规则分三层：

1. 未发布且未揭示的草稿可以在同一版本内编辑。
2. 已发布或已向用户揭示的事实不能原地覆盖；任何语义变化都必须创建更高版本，并填写 `changeReason`。
3. 年龄、城市、教育/职业等核心身份变化不是永久禁止，但校验器必须返回 `identity-change-requires-version`；如果候选版本与已揭示事实冲突，还必须返回 `revealed-fact-conflict`，阻止静默发布。

旧的关系记忆不自动改写，后续记忆任务按产生时的人物版本处理迁移或冲突。

## Canon 校验接口

`canon-checker.ts` 保持纯 TypeScript，不依赖 React、Next.js、数据库或 provider。建议暴露：

- `validateCharacterBible(input)`：解析并检查单个人物圣经的结构、枚举、事实键唯一性和版本内部一致性。
- `checkCharacterRevision(current, candidate, context)`：比较两个版本，返回 `ok` 或结构化问题列表。`context` 包含当前发布状态、已揭示事实键和是否允许草稿编辑。
- `canPublishCharacterRevision(current, candidate, context)`：只允许通过结构校验、版本规则和揭示冲突检查的候选版本发布。

错误至少区分：重复事实键、版本未递增、缺少变更原因、核心身份变更需新版本、已揭示事实冲突、敏感事实扩大默认揭示范围和草稿不可生产发布。

校验器只报告事实一致性和发布门禁，不自行修改候选内容，也不推断用户记忆。

## 数据流和边界

内容文件先经过 Schema 和 canon 校验，再由后续内容导入流程处理。当前任务不增加数据库表；现有 characters 表和 `canonFacts` 结构作为未来导入边界，不能被 UI 直接写入。用户是否已看到某条事实属于关系/揭示状态，不能写回全局人物圣经。

所有初始内容保持 `draft`，未经语言、教学和角色一致性审核不得进入生产查询。

## 测试策略

单元测试必须覆盖：

- 初始 Lucía v1 通过结构和身份基线校验。
- 同一版本重复 `factKey` 被拒绝。
- 草稿未发布时的允许编辑路径。
- 已发布人物同版本修改被拒绝。
- 核心身份变化要求新版本并记录原因。
- 新版本新增“母亲为意大利人”等普通背景事实通过。
- 已揭示核心事实被候选版本冲突覆盖时被拒绝。
- 敏感事实默认揭示范围扩大时被拒绝。
- draft 人物不能通过生产发布门禁。

## 已知限制

- 本任务不决定最终人物头像资源，也不验证外部地点或现实人物关系。
- 不提供用户级揭示状态存储；该状态留给关系记忆/对话任务。
- 不实现人物版本迁移 UI 或管理后台。
