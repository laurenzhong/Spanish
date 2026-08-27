# Generate Story 私有生成文章设计

- 日期：2026-08-27
- 范围：个人 Alpha，阅读工作流增量
- 状态：设计已确认，待实现计划
- 相关任务：READ-006（建议任务 ID）
- 参考：[Readlang Story Bot](https://readlang.com/storyBot)、[Readlang article reader](https://readlang.com/library/6a8970cc201825d7541080f8/from/0)、现有阅读库与规范化阅读器设计

## 1. 背景与目标

当前 `/read` 书架中的 `Generate Story` 只是占位按钮。用户需要一个可以根据兴趣和语言水平生成西语文章的真实入口，并能像其他阅读内容一样在阅读器中打开、保存和删除。

第一版使用仓库已经接入的 MiniMax M3 服务端 provider。生成结果是当前用户私有的 `AI draft`，自动进入 `My Texts`，不进入公共文章库，不写入口语能力证据、技能画像、角色事实或关系记忆。

目标：

1. 用户从阅读书架进入独立的 Generate Story 页面。
2. 用户提交有限且可校验的生成参数，服务端生成并保存一篇完整西语文章。
3. 生成文章复用现有文章阅读器、版本哈希、阅读状态、词语辅助和本地恢复语义。
4. 生成失败、取消、重复提交、供应商异常和用户删除都有明确、可恢复的结果。

非目标：

- 不把生成文章发布到 Public Texts 或内容审核队列。
- 不实现用户上传文本、任意 URL 抓取、RSS、Newsletter、音频生成或实时流式写作。
- 不把阅读、词语查询、TTS、打字或生成行为当作口语能力证据。
- 不新增独立微服务、支付、额度系统或开放角色商城。

## 2. 调研与视觉决策

Readlang Story Bot 的实际页面采用浅色内容区、标题和简短说明、按行排列的标签与控件、语言/体裁/难度/长度选择，以及一个清晰的全宽 `Generate Story` 主按钮。页面信息密度低，用户能先理解参数再提交；生成说明位于表单上方，隐私/分享语义也在提交前明确呈现。

Sueño 采用已确认的 B 方案：独立页面，不在书架上打开侧滑面板。保留 Readlang 的表单层级和单一主 CTA，但使用 Sueño 现有产品壳层、纸面背景、细边框、深色正文和绿色/陶土色语义色，不复制 Readlang 品牌、机器人插画、公共分享承诺或付费入口。

### 2.1 页面布局

- 路由：`/read/generate`。
- 顶部：返回阅读链接、阅读/Generate Story 面包屑和页面标题。
- 主体：桌面端约 640–720px 的单列生成工作台；不使用嵌套卡片。
- 标题下方使用一段短说明，解释“生成后自动保存到 My Texts”。
- 表单控件按标签分组，输入框和选择控件保持稳定高度；主按钮至少 44px 高。
- 页面底部显示 `AI draft · 私有 · 不计入口语评分`，不使用长篇功能说明或营销文案。

### 2.2 响应式

- 320–699px：单列、16px 两侧内边距、控件自然换行，禁止横向滚动。
- 700px 以上：表单保持单列，难度和长度可在同一行；体裁使用等宽分段控件。
- 生成中保留页面高度和控件位置，不因 loading 文案改变布局。
- `prefers-reduced-motion` 下不使用面板滑入或进度动画。

## 3. 用户流程

```text
/read 书架
  → 点击 Generate Story
/read/generate
  → 填写主题、难度、长度、体裁、关键词
  → POST /api/v1/read/generated-stories
  → 校验 provider 响应并写入私有文章
  → 跳转 /read/article/{stableKey}@1
  → 文章显示 AI draft，并可在 My Texts 打开/删除
```

### 3.1 输入

| 字段 | 规则 | 默认值 |
| --- | --- | --- |
| 主题/提示词 | 必填，去除首尾空白，1–500 字符；拒绝空白和控制字符 | 无 |
| CEFR | `A1`、`A2`、`B1`、`B2` | `B1` |
| 长度 | `short`（约 300–450 词）、`medium`（约 700–900 词）、`long`（约 1,200–1,500 词） | `medium` |
| 体裁 | `story`、`dialogue`、`guide` | `story` |
| 关键词 | 可选，最多 8 个；每项 1–40 字符，总字符数不超过 240 | 空 |

表单不接受用户历史文章、聊天内容、画像、记忆或音频作为上下文。关键词使用逗号输入，服务端重新拆分和校验，不信任客户端数组。

### 3.2 状态

- `idle`：可编辑并提交。
- `loading`：禁用重复提交，显示取消按钮；不显示虚假百分比。
- `success`：收到完整文章 DTO 后导航到阅读器。
- `error`：保留所有输入，展示统一错误和重试动作。
- `cancelled`：请求终止，页面回到可编辑状态，不创建文章。

成功后阅读器显示来源 `Sueño Story Bot` 和 `AI draft` 标记。生成文章可被收藏/取消收藏，但始终只在拥有者的 `My Texts` 中出现。

## 4. 服务端架构

### 4.1 模块边界

- `src/modules/providers/story-generation/`：定义 `StoryGenerationProvider`、MiniMax M3 适配器、统一错误和响应 Schema。
- `src/modules/reading/`：定义生成文章的输入 DTO、私有文章 repository/application、My Texts 合并投影和删除级联入口。
- `src/modules/content/`：保留公共文章投影；新增私有生成文章投影适配，但不改变公共 bundle 发布门禁。
- `app/api/v1/read/generated-stories/`：只负责鉴权、Zod 校验、调用 application、HTTP 错误映射和 DTO 转换。
- `app/(product)/read/generate/`：独立页面和表单状态；React 不直接访问数据库。

### 4.2 生成数据流

1. Route Handler 验证当前用户、解析 `Idempotency-Key` 和 JSON body。
2. Application 规范化主题、长度和关键词，生成内部 `requestId`，调用 `StoryGenerationProvider`。
3. MiniMax 适配器只发送结构化生成参数和固定 system prompt，设置 30 秒 timeout，并合并调用方 AbortSignal。
4. Provider 返回后先通过严格 Zod Schema，再执行纯文本清洗、段落拆分、长度上限和字段规范化。
5. Application 在一个数据库事务中创建内部文章载体、生成文章所有权/元数据和文章段落；事务提交前不向客户端返回成功。
6. 返回文章 reader DTO，客户端导航到现有阅读器。

不保存 `generating` 半成品。客户端取消或 provider 异常不会留下空文章；如果数据库事务失败，provider 结果不写入日志正文，也不向客户端伪装成功。

### 4.3 Provider 契约

```ts
type StoryGenerationInput = Readonly<{
  prompt: string;
  cefr: "A1" | "A2" | "B1" | "B2";
  length: "short" | "medium" | "long";
  format: "story" | "dialogue" | "guide";
  keywords: readonly string[];
}>;

type GeneratedStoryPayload = Readonly<{
  title: string;
  summary: string;
  segments: readonly string[];
  cefr: StoryGenerationInput["cefr"];
  topics: readonly string[];
  register: "neutral" | "informal" | "formal";
}>;
```

Provider 输出必须是 JSON，不接受 Markdown、HTML 或工具调用包装。标题、摘要、段落和主题均有长度上限；至少一个非空段落，正文总长度不超过 8,000 字符。系统 prompt 要求西语正文、适合目标 CEFR、段落清晰、避免未经验证的实时新闻/地点/线下行动断言，并将现实信息写成一般性或明确虚构的内容。

## 5. 数据模型与隐私

新增 `user_generated_articles` 私有表，至少包含：

- `id`、`user_id`、`article_version_id`（唯一外键）。
- `prompt`、`cefr`、`length`、`format`、`keywords`。
- `provider`、`model_version`、`provider_request_id`、`request_id`、`idempotency_key`。
- `content_hash`、`status`（第一版只持久化 `ready`）、`created_at`、`updated_at`。

生成事务同时创建内部 `article_sources`、`articles`、`article_versions` 和 `article_segments` 载体，使已有 `user_reading_progress`、`user_article_saves`、`user_article_highlights` 外键和版本冲突逻辑继续适用。生成源使用 `sourceType = ai-generated`、`sourceName = Sueño Story Bot`，只由带拥有者过滤的私有 repository 投影；公共文章列表和公共内容 API 不查询这些记录。

所有私有生成表和内部文章载体必须通过 `user_generated_articles.user_id` 做服务端所有权检查，并启用 `user_id = auth.uid()` RLS。账号删除遵循现有数据删除事务，先删除生成记录和相关用户阅读数据，再清理无用户外键的内容载体。生成文章删除 API 必须验证拥有者，且客户端成功后清理对应 localStorage 阅读缓存。

`prompt` 属于用户私有数据：普通诊断日志不记录它；provider 观测只保存 request ID、模型、延迟、状态、错误类别和估算成本。不得保存原始 provider prompt/response、API key 或签名 URL。

## 6. API 契约

### `POST /api/v1/read/generated-stories`

请求：

```json
{
  "prompt": "在社区花园认识新朋友",
  "cefr": "B1",
  "length": "medium",
  "format": "story",
  "keywords": ["amistad", "café"]
}
```

必须携带 `Idempotency-Key`。成功返回 `apiVersion` 和完整 `ArticleReaderProjection`，其 `origin` 为 `generated`，并带文章 ID、内容哈希和段落。

稳定错误：

- `AUTH_REQUIRED`：无有效会话。
- `VALIDATION_FAILED`：输入或 provider JSON 不符合 Schema。
- `RATE_LIMITED`：供应商限流，可重试。
- `PROVIDER_TIMEOUT`：30 秒超时，可重试。
- `PROVIDER_UNAVAILABLE`：供应商、数据库或网络暂不可用，可重试。
- `CONFLICT`：同一幂等键对应请求参数不一致，禁止覆盖原文章。

### `GET /api/v1/read/generated-stories`

只返回当前用户的卡片投影，支持 `cursor`、`pageSize` 和标题/摘要搜索；不返回段落正文。`My Texts` 将它与用户收藏的公共文章合并，但不把生成文章混入 Public Texts。

### `GET /api/v1/read/generated-stories/:id`

只读当前用户拥有的完整 reader DTO。不存在、非本人或已删除统一返回 `RESOURCE_NOT_FOUND`，不泄露所有权信息。

### `DELETE /api/v1/read/generated-stories/:id`

验证所有权后删除生成元数据、内部文章载体和关联阅读状态；重复删除返回幂等成功或 `RESOURCE_NOT_FOUND`，不得删除其他用户数据。

## 7. 前端集成

- 书架按钮从占位 toast 改为导航到 `/read/generate`。
- Generate 页面使用受控表单和 AbortController；组件只调用 API，不写数据库。
- 成功后使用服务端返回的稳定文章 ID 导航，不在客户端拼接未经校验的内容。
- My Texts 卡片展示 `AI draft`，保留打开、收藏/取消收藏和删除；删除前使用现有确认语义，成功后移除列表项和本地阅读缓存。
- 阅读器只增加来源/草稿标记，正文、词语辅助、TTS 和本地状态逻辑复用现有实现。
- 生成文章的阅读/打字/词语/TTS 行为不触发训练、证据、画像或角色记忆 API。

## 8. 错误、取消与竞态

- 每次生成拥有 `requestId`；客户端每次重新生成创建新的 AbortController，旧请求回调不能覆盖当前状态。
- 服务端 provider timeout 和客户端主动取消都终止 fetch；客户端主动取消不写记录。
- 只有明确收到完整 JSON 并通过 Schema 校验才进入数据库事务。
- 同一 `Idempotency-Key` 重试时先查询终态；已成功返回原文章，参数冲突返回 `CONFLICT`。
- provider 返回低质量或无法清洗的内容时返回 `VALIDATION_FAILED`/`PROVIDER_UNAVAILABLE`，不降级生成假文章。
- 无数据库或无 `MINIMAX_API_KEY` 时显示明确不可用状态；阅读书架和已有文章仍可正常使用。

## 9. 测试与验收

### 9.1 单元与契约

- 输入 Schema 覆盖空主题、超长主题、非法 CEFR/长度/体裁、关键词上限。
- MiniMax provider 覆盖正确 JSON、Markdown 包装、缺字段、超长段落、HTTP 401/429/5xx、超时和 AbortSignal。
- 幂等覆盖相同 key 重试、参数冲突和 provider 失败后重试。
- 纯文本清洗覆盖 HTML/script、空段落、控制字符和 8,000 字符上限。
- 私有 repository 覆盖用户 A/B 隔离、非本人读取/删除、级联删除和阅读状态外键。
- 生成文章投影覆盖 `origin = generated`、AI draft 标签和公共列表排除。

### 9.2 Web 与 E2E

1. `/read` 点击 Generate Story 后进入 `/read/generate`。
2. 空主题阻止提交；合法表单提交显示 loading 和取消动作。
3. 成功响应导航到 reader，正文和 `AI draft` 来源标记可见。
4. provider 失败、超时、限流、无 key 和无数据库显示可重试/不可用状态，并保留输入。
5. 取消不会产生文章；重复提交不会产生重复文章或重复 provider 成本。
6. My Texts 显示生成文章，打开、删除和刷新后的列表状态正确。
7. 生成文章阅读断点、词语辅助和本地恢复正常；无 `evidence_events`、画像或角色记忆写入。
8. 320、375、414、768、1024、1440px 检查无横向溢出、遮挡或按钮布局跳动。

### 9.3 Flutter 边界

本切片先实现 Web 端和共享 API 契约；Flutter 只在生成 API DTO 和阅读器入口需要时接入，公共 Dart 测试覆盖相同 JSON fixture。Windows 上的 `flutter analyze`/`flutter test` 不能表述 iOS 编译、签名或真机验证通过。

## 10. 实施顺序与退出条件

1. 添加 StoryGenerationProvider、MiniMax M3 适配器、Schema、错误映射和契约测试。
2. 添加数据库迁移、`user_generated_articles` repository/application、RLS 和账号删除清理。
3. 添加生成文章私有投影并接入 My Texts/reader API。
4. 添加 `/read/generate` 页面、书架导航、loading/取消/错误/成功状态。
5. 添加单元、API、数据库隔离和 Playwright 回归；同步 OpenAPI、架构、隐私和测试文档。

退出条件：已登录用户可以在 Web 完成“填写参数 → 生成 → 私有保存 → 阅读器打开 → My Texts 删除”闭环；未登录、无 key、超时、取消、重试和 provider 损坏响应均有诚实状态；生成内容不进入公共文章库、不污染口语能力事实，且关键用户数据通过 RLS 与所有权检查隔离。

## 11. 自审结论

- 没有未决的 TODO、TBD 或未定义字段；输入、状态、错误和删除语义已明确。
- B 方案的独立页面与“进入 My Texts”的私有生命周期一致；公共文章投影和生成文章投影边界清楚。
- 生成文章复用现有 `article_version` 外键，因此不会另造一套阅读状态协议；所有权仍由 `user_generated_articles` 强制。
- 一次性 JSON 生成与显式 Schema 校验避免半成品落库；幂等键和 generation/request ID 覆盖重试与竞态。
- 已排除公共发布、任意网页导入、实时语音、支付和复杂服务边界，符合 Alpha 范围。
- 测试矩阵覆盖 provider、数据库 RLS、删除、前端状态和跨视口回归；未把阅读或打字行为误计为口语证据。
