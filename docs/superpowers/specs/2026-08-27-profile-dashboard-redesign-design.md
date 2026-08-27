# Profile Dashboard 重设计切片

- 日期：2026-08-27
- 状态：待产品审阅
- 关联任务：`ALPHA-033`
- 关联页面：Web `/me`、Flutter `ProfilePage`
- 关联规范：[产品设计](2026-08-20-spanish-speaking-learning-platform-design.md)、[Web UI 研究](2026-08-26-web-ui-design-research-and-scheme.md)

## 1. 背景

当前“我的”页面把能力画像、学习活动、关系记忆、语音资料和账号删除放在一条长页面中。Web 端能力数据和热力图已经通过服务端读取，但页面缺少真实的下一步行动，八维图、维度详情和表格存在重复。Flutter 端仍使用固定的 14 天演示活动、固定的最近证据和本地演示删除状态，造成跨端语义不一致。

本切片将“我的”从数据仪表盘调整为“能力中心”：先回答用户最近真实完成了什么、证据有多可靠以及下一步如何继续；活动和隐私管理作为独立分区。服务端评分、证据追加、`mastery`/`confidence` 分离、口语优先、低置信度不扣分和 RLS 所有权规则均保持不变。

## 2. 目标与非目标

### 目标

- 为 Web 与 Flutter 提供同源的 Profile Dashboard DTO。
- 首屏展示真实能力摘要、时间窗口、口语验证和最近证据。
- 只有存在服务端推荐时才显示下一步 CTA；不伪造练习入口。
- 将进步、活动、数据与隐私分层，并在移动端保持可单手操作。
- 数据不足、空结果、服务错误和不可用状态可解释且可恢复。
- 保留能力证据可追溯性，并提供真实练习深链。

### 非目标

- 不新增总分、积分、连续打卡、排行榜或商业配额。
- 不改变评分算法、技能快照重算规则、证据表或隐私授权语义。
- 不实现完整 BI 分析、用户对比或外部数据导出新格式。
- 不在本切片实现 iOS 真机音频验收。

## 3. 方案决策

采用“统一 Dashboard DTO + 页面分层”的方案，而不是只做 Web 视觉调整或重做完整分析系统。

### 3.1 服务端聚合

新增 profile application 聚合用例（名称可在实现时按现有模块约定确定），并通过版本化 API 返回页面所需投影。Route Handler 只负责鉴权、Zod 校验、调用用例和协议转换；repository 仍只读取 profile 模块拥有的数据。

Dashboard 聚合至少包含：

```ts
type ProfileDashboard = {
  generatedAt: string;
  window: { from: string; to: string };
  summary: {
    verifiedAxes: number;
    totalAxes: number;
    evidenceCount: number;
    speechVerificationCount: number;
    activeDays: number;
  };
  nextAction: NextAction | null;
  strongestAxes: ProfileAxisSummary[];
  developingAxes: ProfileAxisSummary[];
  axes: ProfileAxis[];
  recentEvidence: EvidenceSummary[];
  activity: ActivitySummary;
  availability: {
    profile: "ready" | "insufficient" | "unavailable";
    activity: "ready" | "empty" | "unavailable";
  };
};
```

字段必须是明确 DTO，不向客户端扩散数据库行类型。`recentEvidence` 只返回场景、日期、输出方式、提示级别、结果摘要和深链所需稳定 ID，不返回原始录音、完整私密对话或供应商原始响应。

`evidenceCount` 的文案使用“能力证据”；口语数据单独使用 `speechVerificationCount`。没有足够样本时返回 `null` 或 `insufficient`，不把缺失数据格式化成 `0%`。

### 3.2 Web 信息架构

`/me` 顶部使用三个可深链的分区：

1. **进步**（默认）：摘要、唯一真实下一步、能力列表、最近证据。
2. **活动**：默认最近 12 周活动，显示有效学习和自主表达；完整 365 天作为次级查看。
3. **数据与隐私**：关系记忆、共享权限、保存录音/转写和账号数据操作。

首屏不展示完整证据表。八维能力默认使用状态列表；仅在所有相关轴有足够数据时提供可选图形视图。任何行动按钮都必须有导航、状态变化或可恢复错误。

### 3.3 Flutter 信息架构

Flutter 使用相同的 Dashboard DTO 和稳定错误码，不再本地生成活动、最近证据或删除结果。移动端使用顶部分段控件或可访问的 Tab 语义切换“进步 / 活动 / 数据与隐私”，保持底部五项产品导航不变。

数据删除、共享撤销和语音删除均调用服务端 API，并显示确认、处理中、成功、延迟清理或可重试失败。没有网络时显示不可用状态，不将本地缓存描述为已完成服务端操作。

## 4. 状态与错误处理

每个分区遵循：

```text
idle → loading → ready
                 ├→ empty
                 ├→ error (retryable)
                 └→ unavailable
```

- `loading`：骨架或明确处理中说明。
- `empty`：说明为什么为空和如何产生第一条真实记录。
- `insufficient`：说明样本量不足，不绘制误导性能力轮廓。
- `error`：保留已知数据并提供真实重试。
- `unavailable`：说明 Alpha 限制，不显示假按钮。

异步加载使用 generation/active guard，旧响应不得覆盖当前状态。Dashboard 读取失败不影响训练证据；删除失败不得从 UI 移除服务端仍存在的记录。

## 5. 指标语义

- **掌握程度（mastery）**：当前技能状态的能力估计。
- **证据可信度（confidence）**：支持该估计的证据可靠程度。
- **口语验证**：来自自主开口且通过服务端校验的样本数量。
- **能力证据**：参与技能快照的有效证据数量。
- **有效学习活动**：前台、近期且符合活动规则的活动，仅用于活动视图和热力图。

禁止将学习时长、打字、低置信度转写或技术失败当作正向口语能力证据；禁止因活动中断降低掌握度。

## 6. 测试与验收

### 服务端与契约

- Dashboard schema、OpenAPI 和 TypeScript/Dart fixture 一致。
- 当前用户隔离、空数据、数据库不可用和推荐为空均有测试。
- `mastery` 与 `confidence` 分离；技术失败、低置信度和 typing 不产生负面能力更新。
- recent evidence 不含原始音频、完整私密文本、令牌或签名 URL。

### Web

- 首屏只出现一个视觉同权的下一步 CTA，且只在 `nextAction` 存在时出现。
- 能力不足时显示解释性空状态，不绘制虚假轮廓。
- 12 周活动视图可选择日期/周并显示真实摘要；旧 365 天视图为次级入口。
- 关系记忆、语音和账号删除均有确认、结果和失败重试。
- 320、375、414、768、1024、1440 宽度无横向溢出，键盘和屏幕阅读器可操作。

### Flutter

- 使用真实 Dashboard fixture 渲染同等状态。
- 不再出现固定演示日期、演示证据或“只移除当前设备”的伪删除文案。
- 服务端删除失败时保留记录并显示可重试状态。
- `flutter analyze`、`flutter test` 覆盖加载、空、失败、删除确认和跨端字段语义。

## 7. 交付边界

实现仅涉及 profile 模块的 DTO/application/API、Web `/me` 页面和组件、Flutter Profile 页面、共享契约 fixture、相关测试与必要文档。不修改训练评分算法、数据库表结构或角色记忆权限模型。

