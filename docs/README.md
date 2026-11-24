# Sueño 文档

从[仓库 README](../README.md)查看产品入口和本地启动步骤。下文按主分支代码介绍当前功能，并记录仍在候选工作区的改动。[项目状态](../PROJECT_STATUS.md)记录任务分支和验收结论。

## 当前产品细节

### 学习、阅读与探索

- 学习页直接打开视频和播客资料库。“换一批”保留筛选条件。媒体详情提供逐句操作、字幕查词和播放位置；已组织成系列的内容提供选集，同系列视频可在播完后手动切换。[内容驱动学习入口](adr/0008-content-led-learning-and-automated-ingestion.md) · [媒体系列目录](adr/0018-media-series-directory.md)
- 阅读区有「文章、词汇、短语、语料、已保存」五个入口。私人 AI 故事保存在个人书架。高频词表支持「标为已知」和双向默写。词汇标记保存在当前浏览器。
- 主分支的短语手册有 120 条表达，覆盖六个主题，提供用法、示例对话、回想和自测。短语手册的收藏保存在当前浏览器，按账号区分。语料页支持按原词序或同段包含全部词查询文章与字幕，可以对照用例并回到对应段落或播放位置。[短语手册](adr/0016-practical-phrasebook.md) · [短语内容审核](reviews/PHRASE-CONTENT-003.md) · [真实语料查询](adr/0017-corpus-example-workspace.md)
- 探索中的临时人物用于场景实战。多轮表达后的复盘按沟通目标组织，历史练习可从探索页回看。[Web/PWA 场景实战设计](superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)

### 对话、能力与账号

- Lucía 是当前开放的长期 AI 角色。Mateo 和 Inés 仍待开放。对话中可使用回复建议、语法检查、句子分析与自由提问，建议填入草稿后由学习者编辑并发送。关系记忆默认按角色隔离，跨角色共享需授权。[角色运行时](adr/0009-character-runtime-and-conversation-boundary.md) · [聊天 AI 助手](superpowers/specs/2026-10-21-chat-ai-assistant-design.md)
- 「我的 → 能力与活动」展示四板块能力和活动热力图。个人自查用于复习，活动时长用于热力图，能力评分依据适用的评估证据。[架构边界](architecture.md)
- 邮箱验证码是普通登录入口。启用注册的环境允许新邮箱请求验证码时创建账号。面向其他真实用户使用前，须按仓库规则重新决定外部母语和教学复核门槛。[认证与会话](authentication.md) · [编码代理工作规范](../AGENTS.md)
## 候选能力

截至 2026-11-24，候选工作区已有词汇账号同步与分组复习、150 条表达的短语手册、学习轨迹笔记、账号数据导出和完整注销、一次性账号邀请及所有者监管后台。相关功能仍待合入主分支。Lucía 的真实登录态、长历史和重试恢复证据对应指定 Preview 版本。iPhone Safari/PWA 后台恢复及多人运营另有验收范围。真实用户之间的好友邀请与私聊仍是设计提案。

## 开发与运营

| 需要查找 | 文档 |
| --- | --- |
| 模块所有权、数据和接口 | [架构边界](architecture.md) · [数据库与迁移](database.md) · [OpenAPI 与 JSON Schema](../contracts/README.md) |
| 制作、审核和导入内容 | [内容制作与审核规范](content-authoring.md) · [版本化内容源](../content/README.md) |
| 白名单采集、候选、发布与撤下 | [内容采集运行手册](operations/content-acquisition-runbook.md) · [文章受控自动发布 ADR](adr/0010-reviewed-article-auto-publication.md) |
| 账号和所有者内容工作流 | [认证与会话](authentication.md) · [内容采集运行手册](operations/content-acquisition-runbook.md) |
| 测试、验收与发布 | [测试与质量策略](testing-strategy.md) · [发布候选运行手册](operations/release-candidate-runbook.md) |
| 角色版本与合成朗读 | [角色修订运行手册](operations/character-revision-runbook.md) · [统一朗读 ADR](adr/0019-unified-minimax-read-aloud.md) |

## 设计与决策

- [初始产品设计](superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)记录评分、角色和隐私的起点。客户端范围见 [Web/PWA 优先 ADR](adr/0002-web-pwa-first-personal-alpha.md)。
- [自动内容供应与词句学习重构设计](superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)及其[实施计划](plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md)记录影音入口、词句语料和四板块能力的演变。
- [角色运行时与对话闭环设计](superpowers/specs/2026-09-26-character-runtime-and-conversation-closure-design.md)及其[实施计划](plans/2026-09-26-character-runtime-and-conversation-closure-implementation-plan.md)记录角色版本、关系与流式对话。具体实现任务和验收见[项目状态](../PROJECT_STATUS.md)。
- [全部 ADR](adr/) · [产品规格](superpowers/specs/) · [实施计划](plans/) · [验收与审核记录](reviews/)
