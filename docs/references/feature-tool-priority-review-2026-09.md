# 功能差距与开源工具审查清单（2026-09）

本清单用于个人 Alpha 的功能审查，不代表已经批准引入任何第三方运行时。排序依据是对当前学习闭环、阅读词句、探索场景、角色真实性和每日内容供应的直接价值，之后才考虑规模化能力。

## 当前差距与执行顺序

| 优先级 | 功能 | 当前状态 | 下一步验收 |
| --- | --- | --- | --- |
| P0 | 学习页主题分类 | 已有独立实现，待集成验证 | `/learn` 主题导航、URL 保持筛选、空结果恢复、移动横向滚动 |
| P0 | 阅读词汇/短语书架 | 主线已有 domain/application/repository/UI，待集成验证 | `/read/vocabulary`、`/read/phrases`、出现索引、familiar/revisit/ignore CAS |
| P0 | 探索三视图 | 已有场景、表达、内容包视图和收藏/生成入口，待集成验证 | 推荐理由、无结果 fallback、显式生成确认、来源隐私、320–1440px 无溢出 |
| P0 | 角色完整性 | 角色目录与记忆已有；需要把人物圣经注入每个 provider，并验证关系门禁 | Lucía/Mateo/Inés 的稳定语气、事实边界、AI 身份诚实、关系与共享记忆隔离 |
| P0 | 每日文章供应 | 已实现 `disabled → discover-only → review-only → auto-publish`、每日最多 50 篇、MiniMax 双审核 | 先 discover-only，再 review-only 观察 7 天，人工抽查后才允许 protected Environment 开启发布 |
| P0 | Readlang 授权来源 | 已登记 2026-09-18 页面快照中的 57 个 URL、55 个主机；不得扩展为任意公网抓取 | 运行时继续执行精确 URL 快照、HTTPS、重定向、MIME、大小、正文和权利校验 |

## GitHub 工具候选

### P0：优先采用或仅作为离线工具

1. [mozilla/readability](https://github.com/mozilla/readability)（Apache-2.0，约 11k stars）
   - 用途：Readlang allowlist 内文章的正文抽取候选器。
   - 方案：只接在候选发现/处理层；输入先过 HTTPS、host、重定向、Content-Type、大小和权利策略，输出纯文本后再进入 `content-es-ES` 与 `teaching-zh-CN` 审核。不能单独决定发布，也不能扩大 allowlist。
2. [open-spaced-repetition/free-spaced-repetition-scheduler](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) 或 FSRS 纯领域移植（MIT）
   - 用途：词汇与短语的复习间隔。
   - 方案：先定义本项目的 `familiar/revisit/ignore` 意图和 mastery/confidence 边界，再以适配器接入；不把阅读、时长、TTS 或跟读当作口语证据。
3. [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)（MIT）
   - 用途：离线评测 MiniMax 双审核 prompt、角色一致性、AI 身份诚实、拒绝越权和隐私隔离。
   - 方案：在 CI/本地 fixture 中运行，不进入生产请求路径，不发送真实用户私密记忆。
4. [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue)（MIT）
   - 用途：当 50 篇/日的串行处理不足时提供有界并发和限流。
   - 方案：只有测得瓶颈后再引入；并发额度、来源上限、失败隔离和全局每日上限必须由现有 application 层保持权威。

### P1：下一阶段审查，暂不接入

- [mem0ai/mem0](https://github.com/mem0ai/mem0)（Apache-2.0）：只研究长期记忆数据模型。当前已有角色/用户/共享许可/敏感级别边界，不能直接替换。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)（MIT）：只有角色流程需要持久化图状态时才评估；个人 Alpha 目前的模块化单体不需要增加编排运行时。
- [wallabag/wallabag](https://github.com/wallabag/wallabag)（MIT）：参考保存、正文抽取和标注边界，不复制整套后端。
- [readest/readest](https://github.com/readest/readest)（AGPL-3.0）：参考桌面阅读器、TTS 和高亮交互；不复制代码，许可证需要单独审查。

### P2：暂不采用

- [omnivore-app/omnivore](https://github.com/omnivore-app/omnivore)（AGPL-3.0）：范围过大且许可证不适合当前个人 Alpha。
- [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub)（AGPL-3.0）：不能替代已授权来源，也会模糊 allowlist 边界。
- [apify/crawlee](https://github.com/apify/crawlee)（Apache-2.0）：能力过宽，容易诱发任意爬取，不符合来源策略。
- [nektos/act](https://github.com/nektos/act)（MIT）：仅可作为本地 GitHub Actions 演练，不替代真实 protected Environment。
- `semantic-kernel`、`langchainjs`、Temporal/Inngest/Trigger.dev/Mastra：与当前 MiniMax provider 和模块化单体边界重叠，暂不新增服务边界。

## 每日发布分阶段门禁

| 阶段 | 默认行为 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `disabled` | 不发现、不审核、不发布 | 初始及任何异常 | 明确配置模式和 policy version |
| `discover-only` | 最多发现 50 篇候选，不审核、不发布 | allowlist、权利、结构日志可审计 | 候选字段/hash/revision 稳定，失败可隔离 |
| `review-only` | 执行独立 `content-es-ES` 与 `teaching-zh-CN` MiniMax 审核，不发布 | 至少一轮 discover-only 成功 | 观察 7 天并完成人工抽查 |
| `auto-publish` | 仅发布双审通过且结构校验、CAS、权利复核通过的候选 | 产品本人确认、protected Environment、kill switch | 任一门禁失败立即回到 `review-only` 或 `disabled` |

任何阶段都必须记录 `codex-ai-owner-authorized-review`，审核 provider 只审核冻结输入，不能直接写库或发布。Readlang 页面未来出现的其他 URL 或外部主机不会自动获得授权，必须刷新快照并登记新的策略版本。

## 待产品本人审查

请先审查 P0 的四个工具选择：Readability、FSRS、Promptfoo、P-Queue。默认执行方案是只接入 Readability 适配器、FSRS 领域适配器和 Promptfoo 离线评测；P-Queue 等容量证据后再决定。P1/P2 不进入当前运行时。
