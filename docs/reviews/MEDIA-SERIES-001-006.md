# MEDIA-SERIES-001–006：整体验收与交接

- 日期：2026-10-16。
- 完成范围：所有者确认的001–006均已实现，进入review；具体实现/变更文件见各切片交接。没有自动连播、通用CMS或新客户端。
- 工作树：沿用已登记共享分支 `codex/disable-legacy-readlang`，保留其他任务已有改动。Commit：无；未提交、推送或部署。
- 权威：[设计](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)、[ADR-0018](../adr/0018-media-series-directory.md)、[实施计划](../plans/2026-10-15-media-series-implementation-plan.md)、[状态页](../../PROJECT_STATUS.md)。

## 完成的任务

| 任务 | 交付与文件入口 | 独立交接 |
| --- | --- | --- |
| 001 | `media`系列领域/application/repository、`src/shared/db/schema/media-series.ts`、0046迁移、鉴权只读/所有者写入route、OpenAPI/JSON Schema | [001](MEDIA-SERIES-001.md) |
| 002 | `content/media-series/alpha-series-v1.json`、`scripts/import-media-series.ts`、`application/import-media-series.ts`及真实目录受控导入 | [002](MEDIA-SERIES-002.md) |
| 003 | 卡片独立系列链接、`learn/series/[seriesKey]`、`media-series-page`/`media-episode-picker`、fresh批量摘要、手机主题与焦点 | [003](MEDIA-SERIES-003.md) |
| 004 | `media-learning-workbench`真实ended接线、`media-series-recommendations`/request/纯reducer/CSS、播放器generation与浏览器回归 | [004](MEDIA-SERIES-004.md) |
| 005 | `domain/media-browse.ts`、主repository内部稳定来源map、来源内系列轮换、完整分页及revision游标失效 | [005](MEDIA-SERIES-005.md) |
| 006 | `propose-media-series-suggestion`与独立domain/schema、RSS/LR adapter及normalizer、内部candidate metadata契约、候选持久化/门禁回归 | [006](MEDIA-SERIES-006.md) |

共同更新架构、数据库、内容、测试与采集runbook文档；各交接的文件清单仅覆盖对应切片，不把共享树其他任务改动算入本需求。

## 产品与真实数据

学习页保持单集直接开始。确认归属后可查看系列与选集；当前视频真正结束才在播放器主列下方显示最多六条同系列其他视频。暂停、逐句暂停、近尾位置、技术失败和历史completed不触发；重播/seek回内容区、换集/版本/资产/实例清空并隔离旧事件/响应。读取错误局部重试、20秒截止、空结果隐藏；点击才跳转，原进度恢复，不自动play/滚动/focus，也不新增能力证据。

换批先轮换稳定来源，再轮换来源内系列，独立媒体各自成组；不足时补回所有剩余条目，不提前耗尽。普通排序和专用系列顺序不改。来源/系列revision变化拒绝旧游标。采集建议只属于未确认候选元数据，不能确认归属、改变draft/hash或授予内容发布资格。

0046已通过既有Drizzle迁移机制应用；首批9系列、63成员、9条追加审计已按文件哈希受控导入。最后只读复验仍为9/63/9；Peppa目录25集、首屏20并有后页、推荐6条，全部同系列video且排除当前稳定媒体。日志 `.tmp-media-series-final-real-read.log`。002已记录导入前后媒体版本/字幕/进度/evidence的聚合指纹一致。后续切片没有再次写真实目录、采集或调用收费provider。

## 最终通过的验证

| 检查 | 结果 | 本地日志 |
| --- | --- | --- |
| 系列、换批、播放器及建议联合Vitest（单worker） | 27文件 / 199用例通过 | `.tmp-media-series-final-focused.log` |
| 全仓API契约 | 29文件 / 123用例通过 | `.tmp-media-series-final-contracts.log` |
| 桌面/手机媒体浏览器联合专项 | 40/40通过：系列导航、播后推荐、换批、原视频和播客 | `.tmp-media-series-final-e2e.log` |
| TypeScript | 全树通过 | `.tmp-media-series-006-typecheck.log`；生产构建也执行严格TS检查 |
| ESLint | media/content-acquisition全模块、learn及系列route、相关单元/数据库/契约/E2E通过 | `.tmp-media-series-final-lint-scoped.log` |
| Drizzle一致性 | `db:check`通过 | `.tmp-media-series-final-dbcheck.log` |
| 生产构建 | 串行复验成功，严格类型检查与77/77页面生成 | `.tmp-media-series-final-build-serial.log` |
| 差异空白检查 | `git diff --check`退出0，仅本机LF/CRLF提示 | 本次命令输出 |

006另有原RSS/LR adapter联跑3文件20项、原采集pipeline4文件20项通过；这些批次与上述联合专项有重叠，不相加当作无重复总数。003/004桌面手机截图已复核，覆盖320/375/768/1440及主题；浏览器媒体事件明确使用fixture/fake。

## 未通过或未完成的全量检查

默认全仓 `pnpm lint` 因 `Zone Allocation failed` 退出3221226505。全量Vitest即使单worker也记录非系列测试失败并随后发生Zone内存错误；全套320项E2E尝试中出现浏览器/开发服务 `Data cannot be cloned, out of memory` 和一次content-pack listening路径超时。为停止内存故障后的无效等待，只终止本次日志对应、已核对命令行的测试进程树，未终止用户3000服务或其他会话进程。两项全套均未完成，不能算通过。

首次与这些大检查并行的build也在页面收集时发生内存错误，随后单独串行build已成功。最终通过的40项媒体E2E与199项联合测试均为独立完整执行，不用它们代替全套结论。全量失败日志为 `.tmp-media-series-final-{lint-full,vitest-full,e2e-full,build}.log`。

全量Vitest中已观察到词频物化、文章发布、桌面导航、词汇页、账号数据和热力图失败；另以 `.tmp-media-series-final-outside-failures.log` 独立复跑，完整结果为7文件失败、10用例失败/31通过。可定位的原因包括：词频fixture超过36小时有效期转为两条查询；文章fixture缺`user_generated_articles`迁移；账号/Lucía路由mock在Next请求作用域外调用cookies；侧栏展开/收起按钮、词汇面板文案与当前实现不符；热力图起始日期断言不符。它们不在本系列切片修改范围，未逐项回退共享树做改动前对照，不一概宣称为历史基线，也未放宽断言或顺手修复。既有已知OOM/迁移基线限制与本次系列专项通过分别记录。

## 用户验证、限制与下一步

1. 登录学习页，从Peppa等已确认内容打开“查看系列”，检查本站收录数量、分页和单集直接入口。
2. 打开任一确认系列的视频，播放至自然结束；下方出现同系列其他视频，点击目标集恢复已有进度。重播/seek回内容区后推荐消失；关闭网络后读取失败只影响推荐，可局部重试。
3. 学习页“换一批”查看来源及系列轮换，连续加载并返回历史页面，检查无漏重及批次恢复。
4. 所有者现有候选预览的结构化数据可读`metadata.mediaSeriesSuggestions`；建议保持unconfirmed。确认仍走既有media所有者用例与证据/CAS/幂等审计。

真实iPhone Safari/PWA、外部YouTube SDK与视频解码自然结束尚未完成真机验收；本地浏览器fake不代替它们。数据库迁移/初始目录是真实应用，但全迁移链、真实双连接竞争、远程Supabase普通用户RLS等未由本轮PGlite覆盖。历史完全重复候选不会自动回填建议，证据不足的既有媒体继续独立；视频channel本身不提供系列证据。

建议下一项：所有者用真实视频及iPhone完成上述人工路径，并在独立任务处理全仓失败/环境内存限制；共享树按任务整理后再决定提交与发布。
