# ADR-0010：白名单文章的 AI 双审与策略化自动发布

- 日期：2026-09-18
- 状态：Accepted
- 任务：`OPS-003`
- 影响：文章自动采集、AI 审核身份、发布授权、运行配置、审计与撤下
- 关联：[ADR-0007](0007-owner-authorized-ai-content-review.md)、[ADR-0008](0008-content-led-learning-and-automated-ingestion.md)、[实施计划](../plans/2026-09-18-daily-reviewed-article-publication-implementation-plan.md)

## 背景

产品所有者要求后续每天获取 50 篇文章，自动完成语言/教学审核并发布。当前实现和既有决定仍有四个差距：

1. GitHub Actions 只执行 `discover --all-enabled`，没有串联处理、审核、结构校验和发布。
2. 当前 `--limit 50` 是每个来源的发现上限，不是文章流水线的每日全局上限。
3. ADR-0008 明确规定每日任务只进入候选库，仍需所有者显式发布；自动发布会取代这条文章侧决定。
4. 当前 `publishCandidate` 接收所有者用户 ID，并把发布审计写成 `codex-ai-owner-authorized-review`。无人值守 runner 不能伪装成交互式所有者操作。

目标仍然是每天最多处理 50 个合规文章候选。来源不足、许可不明、正文不可提取或审核失败时可以少于 50，不能用越权来源或低质量内容补足数量。

## 提议的决定

本决定只有在状态改为 `Accepted` 后才能实施；在此之前保持 ADR-0008 的候选库与人工显式发布规则。

### 1. 只开放文章，不扩展到媒体

策略化自动发布第一版只允许 `contentType=article`。视频、播客、ASR、翻译和托管继续保持候选审核与显式发布，不继承本授权。

### 2. 使用全局日配额

- 每个 Asia/Shanghai 自然日最多新获取 50 个文章候选，所有来源共享配额。
- 单来源另设上限，避免某个来源占满每日配额；第一版建议默认 10，可逐来源降低。
- 每日目标是“最多 50 个合规候选”，不是必须发布 50 篇。
- 重试、重复 URL、相同内容哈希和已存在版本不重复消耗发布配额；真实外部请求和费用仍计入运行报告。

### 3. 来源必须显式允许自动发布

除现有 `enabled=true`、`rightsStatus=verified` 和完整权利策略外，来源还必须具有版本化的文章自动发布策略：

- 允许保存和展示全文的明确许可类型；
- 许可证据 URL、署名文本、允许的 feed/article host；
- `automatedPublication.enabled=true`；
- 单来源日上限；
- 策略版本和批准时间；
- 可立即关闭的来源级开关。

非盈利、个人使用或来源提供 RSS 都不自动构成全文转载许可。

### 4. 固定的阶段与独立记录

每个冻结 `candidateRevision + contentHash` 依次经过：

1. 发现与 URL/内容去重；
2. 有界正文获取和结构化规范化；
3. 来源、权利、语言、长度和恶意内容初筛；
4. `content-es-ES` 独立审核；
5. `teaching-zh-CN` 独立审核；
6. `structure` 确定性校验；
7. 自动发布策略再次校验；
8. 显式调用发布用例，生成不可变文章版本；
9. 词句/语料索引；
10. 脱敏报告和失败清理。

两个 AI 审核维度必须是独立 attempt，读取相同冻结输入，分别产生状态、notes、模型版本和输入哈希。审核身份继续如实使用 `codex-ai-owner-authorized-review`，不能描述为真人或母语者签字。

### 5. 自动发布使用独立 actor

新增服务端自动发布用例和 actor，例如：

```text
article-auto-publication:<policy-version>
```

它不能调用需要交互式 `ownerUserId` 的 Route Handler，也不能把无人值守运行记录为用户点击。发布事务仍必须：

- 重新读取 candidate、source policy 和全部 review；
- CAS 校验 revision 与 content hash；
- 只接受当前 revision 的三个 approved gate；
- 写入 `owner-release` 审计记录，记录 actor、policy version、run ID 和发布时间；
- 原子创建不可变文章版本并更新公开投影；
- 任何一步失败时撤销公开投影，不把部分成功报告为发布完成。

这里的“自动发布”仍是一次明确、可审计的状态转换，不是因为审核通过就在查询层自动显示。

### 6. 分阶段开关

生产环境必须支持以下互斥模式，默认从最安全模式开始：

```text
disabled -> discover-only -> review-only -> auto-publish
```

还需要全局停止开关、来源级停止开关、每日候选上限、每日发布上限和单次运行上限。配置缺失、值非法或策略版本不匹配时必须 fail closed。

### 7. 受控启用

建议的启用顺序：

1. fake 全链路；
2. 一个来源、一个条目的公网 dry-run，只取元数据；
3. 一个来源、一个候选进入 review-only；
4. 人工核对两份 AI 审核和结构结果；
5. 自动发布一个文章版本并验证阅读、词句索引和撤下；
6. 同一范围重跑，确认无重复版本、审核和发布；
7. 连续 7 天 review-only 报告无阻断问题后，才允许将生产模式改为 `auto-publish`；
8. 逐步提升全局上限到 50。

### 8. 失败、撤下与报告

- 单候选失败不推进它的发布状态，也不阻止其他候选进入独立终态。
- 来源权利、正文身份或内容哈希变化立即停止该候选；不能沿用旧审核。
- 自动发布的每篇文章可按 run ID 或 source policy version 批量定位，并走现有 archived/撤下流程。
- 日志只记录内部 ID、来源 stable key、步骤、数量、状态、稳定错误码、耗时和估算成本，不记录正文、密钥或私人数据。
- 当日少于 50 篇时报告原因分布，不自动放宽许可、语言或质量阈值。

## 与既有 ADR 的关系

- 如果本 ADR 被接受，它只取代 ADR-0008 第 9 条中“文章必须由所有者逐条显式发布”的部分。
- 白名单、权利、双维度审核、结构校验、版本化、事务发布、撤下和内容证据隔离继续有效。
- ADR-0007 的个人 Alpha 授权继续有效；产品开始面向其他真实用户前必须重新决策外部复核门槛，本自动发布授权同时失效。

## 替代方案

### 保持候选库和逐条发布

风险最低，但不能满足每日自动发布目标，保留为 `review-only` 回退模式。

### AI 自动审核，所有者批量发布

比逐条发布节省操作，但仍依赖每天人工进入工作台；可作为启用自动发布前的观察阶段。

### 第一天直接全量自动发布 50 篇

上线快，但会同时放大来源许可、正文抽取、模型误审和撤下风险，不采用。

### 引入独立工作流服务或消息队列

Trigger.dev、Inngest 或 Temporal 能提供持久工作流，但当前 GitHub Actions、PostgreSQL run/attempt 记录和模块化单体足够；个人 Alpha 暂不增加服务边界。

## 后果

正面：

- 日常文章供应可在无人值守时完成，并保持每一项审核和发布可追溯。
- 全局配额、来源策略和 kill switch 限制错误扩散。
- 运行时不会冒充所有者点击，审计身份更准确。

代价与风险：

- 需要新的策略配置、自动化 actor、评测集、工作流步骤和撤下演练。
- AI 双审仍可能共同犯错；许可或事实不确定的内容必须保持草稿。
- 每日 50 个合规候选不等于每日必然新增 50 篇公开文章。

## 批准前待确认

1. 是否接受推荐的 7 天 `review-only` 观察期。
2. 初始允许自动发布的文章来源和每来源日上限。
3. 每日 50 指“新候选上限”还是“成功发布目标”；推荐前者。
4. 自动发布生产模式由谁、在何处开启；推荐受保护的 GitHub Environment 人工批准配置变更。
5. 失败/异常是否需要外部通知；默认只写运行报告，不发送第三方消息。

## 批准记录（2026-09-18）

- 产品本人批准按 `disabled → discover-only → review-only → auto-publish` 分阶段实施。
- 首阶段固定进行 7 天 `review-only`；每日 50 是全局合规新候选上限，不是必须成功发布 50 篇；单来源默认上限为 10。
- 生产模式只能通过受保护的 GitHub Environment 开启；默认只写脱敏运行报告，不发送外部通知。
- 产品本人已指定 `https://readlang.com/es/links` 为第一批授权入口。2026-09-19 的 Playwright 页面快照登记了原有 57 个 URL、55 个外部主机，并在 `readlang-links-v2` 中增加 5 个 CNN Español 新闻 URL 与 2 个 Literatura.us 作品 URL；版本化策略见 `content/source-policies/readlang-links-v2.json`。Readlang 页面未来新增的 URL/主机不自动继承授权，必须刷新快照并提交新的策略版本。运行时只允许精确快照 URL（Readlang 自身使用已授权路径前缀），逐跳校验 HTTPS、重定向、Content-Type、响应大小和正文可提取性。
- 审核 provider 默认是已配置的 MiniMax M3（`CONTENT_ARTICLE_REVIEW_PROVIDER=minimax`）；fake provider 仅可在非生产环境并显式设置 `CONTENT_ARTICLE_ALLOW_FAKE_REVIEW=1` 时使用。
