# 文档导航与维护

什么时候读：需要定位资料、修改规则/配置/流程或交接时。需要项目背景时从 [项目 README](../README.md) 开始；按下表读取相关章节，实时任务只在 [PROJECT_STATUS](../PROJECT_STATUS.md) 维护。

## 权威分工与阅读路径

| 要做的事 | 先读 | 再读或核对 |
| --- | --- | --- |
| 启动网站、配置登录 | [README](../README.md)、[认证](authentication.md) | [.env.example](../.env.example)、[数据库](database.md)；不需要先采集媒体 |
| AI 执行任务 | [AGENTS](../AGENTS.md)、[执行约束](agent-rules.md)受影响章节 | 领取/交接时查状态页；按需查对应计划与模块 |
| 内容驱动学习/词句/画像改造 | [当前规格](superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)、[ADR-0008](adr/0008-content-led-learning-and-automated-ingestion.md) | [实施计划](plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md)当前任务；规格不是完成清单 |
| 媒体首页/详情 UI | 上述当前规格 | 本机未提交首页设计 `docs/superpowers/specs/2026-09-14-learn-home-001-design.md`（提交后再建立链接）、[详情设计](superpowers/specs/2026-09-15-media-detail-learning-workbench-design.md)、[详情计划](plans/2026-09-15-media-detail-learning-workbench-implementation-plan.md) |
| 来源、审核、字幕、托管 | [内容制作规范](content-authoring.md) | [媒体运行手册](operations/media-content-workflow.md)、[ADR-0007](adr/0007-owner-authorized-ai-content-review.md)、[ADR-0009](adr/0009-hosted-media-assets.md) |
| 模块/API/数据库修改 | [架构](architecture.md)、[API 契约](../contracts/README.md) | [数据库](database.md)、相关 Schema/迁移；实际运行配置不承担文档导航 |
| 验证、故障回归、交接 | [测试策略](testing-strategy.md) | [真实 iPhone 清单](testing/scenario-practice-iphone-safari-checklist.md)、[备份恢复演练](operations/backup-restore-drill.md) |
| 场景、角色、评分和隐私 | 执行约束及架构相关章节 | 下方历史基础规格中的对应领域；被替代的入口/客户端要求不再实施 |
| 追溯旧结论 | [状态历史](tasks/PROJECT-STATUS-HISTORY.md)、相关 ADR | Git 提交与具体工作树；历史测试不代表当前工作树通过 |

环境变量清单与示例维护在 `.env.example`，实际默认值/加载顺序以当前分支配置和脚本为证；认证语义归 authentication，数据库连接/迁移归 database，媒体配置与操作归运行手册。不要复制真实 `.env`。供应商套餐限制需目标环境核实，不从应用默认值推导。

## 资料索引

以下保留原 README 的研究和设计入口，按任务查阅，不要求全读。2026-08-20 产品设计与 2026-09-11 场景设计的评分/角色/隐私领域继续参考；入口、四板块画像和客户端范围以明确的取代说明为准。历史任务排队信息只用于追溯。

- [当前任务与项目状态](../PROJECT_STATUS.md)
- [完整产品设计](superpowers/specs/2026-08-20-spanish-speaking-learning-platform-design.md)
- [Web 优先的个人学习产品与场景实战设计](superpowers/specs/2026-09-11-web-first-personal-learning-and-scenario-practice-design.md)
- [自动内容供应与词句学习重构设计](superpowers/specs/2026-09-12-automated-content-supply-and-lexical-learning-redesign.md)
- [自动内容供应与词句学习重构实施计划](plans/2026-09-12-automated-content-supply-and-lexical-learning-implementation-plan.md)
- [Web/PWA 场景学习闭环实施计划](plans/2026-09-11-web-first-scenario-practice-implementation-plan.md)
- [阅读库与西语文章内容体系设计](superpowers/specs/2026-08-26-reading-library-and-article-content-design.md)
- [UI-009：Readlang 阅读工作台技术设计](superpowers/specs/2026-08-26-readlang-reading-workbench-technical-design.md)
- [Web UI 设计研究与页面方案](superpowers/specs/2026-08-26-web-ui-design-research-and-scheme.md)
- [探索页桌面 Web 技术调研](superpowers/specs/2026-08-28-explore-page-desktop-web-technical-research.md)
- [探索页桌面 Web 视觉与交互方案](superpowers/specs/2026-08-28-explore-page-desktop-web-design.md)
- [探索页桌面 Web 实施计划](plans/2026-08-28-explore-page-desktop-web-implementation-plan.md)
- [电脑端 Web 界面密度与操作层级收敛设计](superpowers/specs/2026-09-12-desktop-web-interface-density-and-action-hierarchy-design.md)
- [电脑端 Web 界面密度与操作层级收敛实施计划](plans/2026-09-12-desktop-web-interface-density-and-action-hierarchy-implementation-plan.md)
- [媒体详情与视频学习器视觉设计](superpowers/specs/2026-09-15-media-detail-learning-workbench-design.md)
- [媒体详情与视频学习器实施计划](plans/2026-09-15-media-detail-learning-workbench-implementation-plan.md)
- [历史：Web 与 Flutter 多平台架构设计](superpowers/specs/2026-08-20-multiplatform-client-architecture-design.md)
- [个人 Alpha 实施计划](plans/2026-08-20-personal-alpha-implementation-plan.md)
- [架构边界](architecture.md)
- [数据库与迁移](database.md)
- [认证与会话](authentication.md)
- [跨客户端 API 契约](../contracts/README.md)
- [ADR-0002：个人 Alpha 改为 Web/PWA 优先](adr/0002-web-pwa-first-personal-alpha.md)
- [ADR-0008：内容驱动学习入口与自动采集审核链路](adr/0008-content-led-learning-and-automated-ingestion.md)
- [历史 ADR-0001：Next.js Web 与 Flutter 客户端](adr/0001-nextjs-web-flutter-clients.md)
- [内容制作与审核规范](content-authoring.md)
- [测试与质量策略](testing-strategy.md)
- [Echo-Loop 参考评审](references/echo-loop-review.md)
- [编码代理工作规范](../AGENTS.md)

## 证据和冲突处理

- **当前事实**：标明分支/Commit、文件或配置、核对日期。代码存在、已合入 main、远端部署、真实验收是四个不同结论。
- **用户要求/批准设计**：写入规格或 ADR；未实施不能写“已具备”。用户明确的新要求若改变重大决策，先记录取舍和范围。
- **已验证经验**：给出适用环境、可复现条件、验证方法和结果来源。历史记录引用为“当时实测”，不能写成本次复测。
- **待验证**：明确证据缺口和下一检查。未经读取的摘要、其他会话的完成宣称不能独立证明实现。
- **历史/已替代**：保留原语境，在原文标注替代范围并链接当前正文；不改写为当时就正确。

发生冲突时先判定是否为不同分支、环境、任务或设计/实现层次，再核对用户授权、明确取代关系和代码证据。不能仅按日期覆盖，也不能让代码缺陷反过来取消产品约束。无法裁决的范围/安全/供应商决策交回用户；项目文件不覆盖更高优先级指令。

ADR 目前有多个相同数字前缀（如 0002、0003、0004）；引用使用完整文件名和标题，不能仅写“ADR-0002”让读者猜。不重命名历史文件来破坏引用；新 ADR 先检查现有编号。

## 维护约定

- 新增能力/规则更新对应规格与领域正文；重大取舍补 ADR；范围/顺序变化同步计划；实现与验收状态只更新状态页。
- 配置变化先同步 `.env.example` 的安全示例和对应操作指南，注明当前代码是否已提交、部署是否已验证。不要为导航给程序配置加字段。
- 简单排障更新测试策略或媒体运行手册已有条目；复杂跨会话任务用 `docs/tasks/<TASK-ID>.md` 并从状态页链接。一次性样本 ID、计数和日志留在任务历史，不升级为通则。
- 优先修订原条目，不叠加相互冲突的“最新说明”。状态页只留当前核对、阻塞与入口；旧交接移入现有历史文件，保留日期、Commit、结果和限制。
- 交接模板统一在 [状态页](../PROJECT_STATUS.md#更新模板)。分支同步与合并者 main 对账的职责见执行约束；不要复制第二套模板。

结束前做低风险检查：

1. 链接与锚点、命令脚本、配置变量和引用文件确实存在于当前分支；移动文档同步修正相对路径和入口。
2. 新增经验有证据和适用范围；当前状态不借用其他分支/历史测试；明确未执行项。
3. `git diff --check`、逐文件 diff；核对只改授权范围，保留已有修改、不含密钥/原始私密数据。
4. 文档-only 变更通常只做静态检查，不为验证执行迁移、部署、采集、收费调用或数据清理。命令未运行就不报告通过。
5. 不为每次对话新增文档。下次审计沿用本索引和权威条目做增量维护。
