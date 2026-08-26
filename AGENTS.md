# AGENTS.md

本文件约束在本仓库工作的所有编码代理。目标是稳定推进西班牙语沉浸式口语平台，并保护学习评分、用户隐私、角色一致性和个人 Alpha 范围。

## 1. 开始任务前

按顺序执行：

1. 阅读 `README.md`。
2. 阅读 `PROJECT_STATUS.md`，确认当前任务 ID、状态、分支、依赖和验收条件。
3. 阅读 `docs/superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md`。
4. 阅读 `docs/superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md` 和 `docs/adr/0001-nextjs-web-flutter-clients.md`。
5. 阅读 `docs/plans/2026-08-20-personal-alpha-implementation-plan.md` 的当前任务章节。
6. 阅读与任务相关的 `docs/architecture.md`、`docs/content-authoring.md` 或 `docs/testing-strategy.md`。
7. 检查 `git status --short --branch` 和最近提交，保留用户及其他代理已有改动。
8. 明确本次只完成一个任务 ID；如果范围跨多个阶段，先拆分。

没有现成代码路径时，不凭经验猜测接口；先以设计和实施计划为权威。

### 多模型与分支协调

- `PROJECT_STATUS.md` 是当前阶段、任务分配和下一步的权威入口。
- 只领取状态为 `ready` 且没有其他负责人或活动分支的任务。
- 一个分支只处理一个任务 ID，分支名称优先使用状态页指定名称。
- 不修改其他模型负责的任务状态，不重新排列全局任务队列。
- 分支内发现超出范围的依赖时停止扩张，将问题作为阻塞交给协调者或用户。
- 分支完成后提供结构化交接：Commit、修改文件、测试、限制和建议下一步。
- 合并者负责在 `main` 更新状态页；简单分支不各自维护重复日志。
- 跨多个会话的复杂任务才创建 `docs/tasks/<TASK-ID>.md`，并从状态页链接。

## 2. 产品不变量

任何实现不得破坏以下规则：

- 首页必须根据学习状态提供唯一且真实的主动作：没有学习记录时显示“开始第一次练习”，存在稳定断点时优先显示“继续学习”；两种状态都不要求先选择时长、模式或内容类型，调整入口只能渐进式提供。
- 听说是核心；读写是静默环境下的延续，不等价于口语证据。
- 用户完整表达前不得纠错或打断。
- 评分以语境成功为先，不要求匹配唯一参考句。
- 自然替代表达可以完成交际任务。
- 打字不能提高发音、语流或真实口头反应。
- 低置信度转写和技术失败不能产生负面能力证据。
- 熟练度 `mastery` 与可信度 `confidence` 分离。
- 学习时长只用于热力图，不参与能力评分。
- AI 好友首先自然回应用户，教学目标只能创造机会，不能控制对话。
- 私密关系记忆默认不向其他角色共享。
- 角色不得把虚构房源、地点、线下约见或现实行动说成真实存在。
- 用户直接询问角色是否为 AI 时必须如实回答。

## 3. Alpha 范围

未经用户明确批准，不提前实现：

- 支付、订阅或商业额度。
- 完整内容管理后台。
- 实时双向语音通话。
- 大规模角色商城或开放角色创建。
- 独立微服务和复杂消息队列。
- Android、Windows、macOS 的商店发布与完整平台打磨。
- 用 SwiftUI/UIKit 重写 Flutter 主要页面。
- 本地离线 ASR 或用户音频媒体库。

这些能力是延后，不是永久取消。需要时先更新设计或 ADR，再进入实施计划。

## 4. 架构规则

- 使用单仓库和远程模块化单体，不随意创建新的服务边界或新 Git 仓库。
- 目录优先按业务 feature 组织。
- 服务端 `domain` 保持纯 TypeScript，不依赖 React、Next.js、Drizzle、Supabase 或供应商 SDK。
- Flutter 客户端位于 `apps/mobile`，主要页面使用 Dart/Flutter，不通过 Capacitor WebView 承载。
- Web 与 Flutter 不共享 UI 源码；共享 OpenAPI/JSON Schema、内容源、稳定错误码和 `contracts/fixtures` 一致性样本。
- 客户端状态不能成为能力事实；评分、证据、画像、记忆权限和角色安全必须由服务端重新校验。
- Flutter 平台能力通过内部端口隔离；只有成熟插件不足时才增加单一职责的 Swift/Kotlin/Windows 桥接。
- Route Handler 只负责鉴权、Zod 校验、调用 application 用例和协议转换。
- React 组件不直接访问数据库，不承载复杂业务流程。
- Application 层定义事务边界并调用 repository/provider 接口。
- 模块不能直接写其他模块拥有的数据表。
- `shared` 只能包含真正无业务含义的通用能力，不能变成杂物目录。
- 公共接口使用明确 DTO，不把数据库行类型扩散到 UI 和其他模块。
- 先允许局部重复，模式稳定后再抽象；不要预建万能框架。

## 5. 状态与异步可靠性

- 复杂训练流程必须使用可测试的状态机或纯编排器。
- 每次录音、转写、评估和聊天生成使用 `attemptId`/`generationId`。
- 旧 generation 的回调不得更新当前状态。
- 副作用必须可取消，并显式处理取消、超时、重试和异常断流。
- 谁创建资源谁负责释放；录音、流、定时器和对象 URL 都要有明确生命周期。
- 没有显式 `done` 的消息流不能当作成功完成。
- 写操作必须考虑幂等；重试不能重复生成证据、消息记忆或供应商费用。
- 错误、加载、空状态和恢复路径必须显式设计。

## 6. 数据规则

- PostgreSQL 是学习证据、画像和关系记忆的权威来源。
- `evidence_events` 只追加，不原地修改历史评分。
- `user_skill_states` 是可重算快照，不是原始事实。
- 每条尝试保存实际内容版本、算法版本和供应商信息。
- 客户端不能直接写证据、画像和关系记忆。
- 所有用户私有数据必须受 RLS 和服务端所有权检查保护。
- 数据库结构只通过版本化迁移变更。
- 不手工修改生产数据库来绕过迁移。
- 删除或匿名化用户数据时遵循文档化顺序并报告结果。

## 7. 语音、AI 与供应商

- 业务模块只依赖内部 provider 接口。
- API 密钥只存在服务端。
- 供应商响应必须转换为内部类型并通过 Zod 校验。
- 记录供应商、模型版本、延迟、请求 ID、置信度和估算成本。
- 普通聊天不默认调用高成本严格发音评分。
- 地点、活动、交通和房源信息必须可验证；无法验证时只能给一般建议。
- LLM 输出不能直接写入画像、人物圣经或关系记忆，必须经过规则和权限检查。
- Prompt 不是安全边界；关键不变量必须由代码校验。

## 8. 内容规则

- 正式内容遵循 `docs/content-authoring.md`。
- 核心表达必须包含语境、语用、变式、提示、标签权值和审核状态。
- 未审核内容不能在生产环境发布。
- 核心表达和语用说明需要西班牙母语者审核。
- 中文教学说明需要教学视角审核。
- 内容导入必须先完整校验，再事务写入；失败时不得部分发布。
- 已产生学习证据的内容版本不能静默覆盖。
- 外刊和第三方内容必须保存来源与许可；禁止未经授权复制全文。
- AI 生成内容是草稿，不自动获得发布资格。

## 9. 角色与记忆规则

- 人物圣经和单个用户的关系记忆分开存储。
- 角色固定事实版本化，新增事实先做冲突检查。
- 必须区分“人物设定存在”和“已经向当前用户透露”。
- 候选记忆保存来源、置信度、敏感级别和共享范围。
- 教学画像不能被当作角色间闲聊资料。
- 新角色获得用户信息前需要明确共享许可。
- 记忆冲突时暂停写入，不能让模型自行编造解释。
- 只有完整完成的聊天轮可以提取长期记忆。

## 10. 测试要求

所有功能和修复遵循 `docs/testing-strategy.md`。

最低要求：

- 新领域规则有单元测试。
- 状态机变更覆盖合法、非法、失败和过期回调。
- 数据访问变更覆盖 RLS、幂等或事务边界。
- 供应商适配器有契约测试和 fake。
- 关键用户路径变更更新 Playwright 测试。
- Bug 修复先增加可复现测试。

禁止：

- 删除测试或放宽关键断言来通过 CI。
- 用真实收费供应商运行默认测试。
- 用页面快照替代评分和状态流转断言。

工程脚手架完成后，相关检查为：

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
```

涉及 Flutter 客户端时还需运行：

```powershell
flutter analyze
flutter test
```

在没有 Mac/Xcode 的环境中，不得把 Flutter 公共测试通过表述为 iOS 编译或真机验证通过。

跨模块、迁移或发布候选还需运行：

```powershell
pnpm test:e2e
pnpm build
```

## 11. 隐私与日志

- 普通录音评测完成后删除。
- 长期保存录音必须由用户明确确认。
- 日志不得写入原始录音、完整私密对话、访问令牌、API 密钥或长期有效签名 URL。
- 使用 hash 或内部 ID 关联用户，不在普通诊断日志记录邮箱和姓名。
- 新增埋点前说明用途、字段和保留时间。
- 使用用户数据改进模型需要单独、明确同意。

## 12. Git 与文件安全

- 保留用户和其他代理的已有改动，不覆盖无关文件。
- 不使用 `git reset --hard`、强制 checkout 或未授权清理。
- 不提交 `.env`、密钥、录音、生产数据或本地参考仓库。
- 不提交 Apple 签名证书、provisioning profile、私钥或未加密商店凭据。
- 提交保持单一目的，标题使用清晰英文前缀，例如 `docs:`、`feat:`、`fix:`、`test:`、`refactor:`。
- 每个 Alpha 任务或阶段子切片提交完成并推送后，必须立即同步更新 `PROJECT_STATUS.md`；如果新增了子任务、调整了顺序或改变了范围，同时更新实施计划和相关架构、隐私或测试文档。状态页至少记录实现 Commit、修改范围、测试结果、已知限制和下一项任务；文档同步应作为同一任务的后置提交并一并推送。
- 当前仓库未复制 Echo-Loop 源码或资源。用户说明自己曾参与贡献并得到作者允许，后续可以建立专门任务评估复用；实际复制前必须在仓库记录授权人、授权形式、文件/提交范围、商业与闭源许可、署名要求，以及其他贡献者代码是否被覆盖。无法证明额外授权覆盖的部分继续按 AGPL-3.0 处理。

## 13. 文档与 ADR

以下变更必须同步更新文档：

- 产品不变量或 Alpha 范围。
- 模块边界和公共接口。
- 数据模型和迁移策略。
- 评分、画像或推荐算法语义。
- 角色身份、记忆共享和隐私策略。
- 供应商选择和数据保留方式。

重大架构决策写入 `docs/adr/NNNN-short-title.md`，包括背景、决定、替代方案和后果。

## 14. 任务完成定义

完成任务前检查：

1. 实现范围与当前计划一致，没有顺手加入延后功能。
2. 类型检查和相关测试通过。
3. 错误、取消、空状态和竞态已处理。
4. 没有能力评分污染、越权数据访问或敏感日志。
5. 文档、Schema 和迁移与实现一致。
6. `git diff` 只包含预期改动。
7. 已向协调者提供状态页需要的 Commit、测试和下一步信息。

最终交付说明必须包含：

- 完成的任务。
- 修改的文件。
- 执行的测试及结果。
- 未执行的全量检查及原因。
- 用户可以如何验证。
- 已知限制和下一项建议任务。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
