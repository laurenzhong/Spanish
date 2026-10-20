# MEDIA-SERIES-005：随便看看的来源与系列分散

- 日期：2026-10-16。
- 当前状态：实现、只读审核、domain/数据库联跑及专项浏览器验证完成；任务状态与 Commit 由主任务登记。
- 权威规格：[系列设计第 3.4 节](../superpowers/specs/2026-10-15-media-series-and-episode-navigation-design.md)、[实施计划第 6 节](../plans/2026-10-15-media-series-implementation-plan.md)、[ADR-0018](../adr/0018-media-series-directory.md)。
- 验证身份：AI 编码代理；本报告仅记录工程验证，不是内容语言或教学审核。

## 1. 改动与边界

仅“随便看看 / 换一批”的 `selectMediaBrowsePage` 顺序改变：先轮换稳定来源，每个来源内部轮换系列，再把同系列剩余成员按后续轮次补回。耗尽的组退出轮换，其余内容继续填满后续页，不用系列上限丢弃媒体。无系列成员各自作为独立组。

来源身份由 repository 私有构建并传给纯领域函数：视频使用合法 YouTube channel ID；播客使用规范化 HTTPS feed URL 的 SHA-256，去 fragment、排序 query 并使用 URL 标准化；已确认的 Language Reactor 混合目录使用登记来源身份，不冒充各节目 RSS。带凭据/签名参数、不合法或缺失来源以稳定媒体 ID 独立回退，不按 `sourceName`、系列显示标题或节目名称推测关系。内部来源键及 feed URL 不进入公开 DTO。

游标上下文保留 seed、filters、排除集合、pageSize、完整有序当前版本集合，并明确绑定来源身份、seriesKey 与目录 revision，包含本批被 exclude 的条目。即使更正后可见排列未变，旧游标也失效；个人播放进度与显示名不作为游标指纹。

普通 `list` 的最近收录、最新发布、最近继续排序不经过本轮分散；显式系列页/选集仍使用系列 repository 的顺序。没有新增公共 DTO/API 字段、端点、Schema、数据库迁移、推荐权重、供应商或证据写入。

## 2. 可比较样例

同一稳定来源，A 系列 8 集、B 系列 3 集、C 系列 1 集；稳定键使用 `video.alpha.1..8`、`video.beta.1..3`、`video.gamma.1`，seed 为 `00000000-0000-4000-8000-000000000001`。

| 顺序 | 前六项 |
| --- | --- |
| 原来源内直接 hash 排序 | C1、A8、A5、A4、A7、A6 |
| 新来源内系列轮换 | B1、A8、C1、B3、A5、B2 |

第一轮先出现三个不同系列；C 耗尽后继续轮换 A/B，B 耗尽后补回 A。全部 12 条保留且没有重复，不因系列较少提前报告耗尽。相同 seed 与集合保持确定性；换 seed 可以改变次序。

## 3. 自动验证与只读审核

主任务已执行 `media-browse.test.ts` 与新增 `media-browse-series.test.ts`：**2 文件、11 用例通过**。覆盖来源优先/系列次级轮换、同显示名不同来源、无来源独立回退、无系列独立组、不均衡系列、不同 pageSize 的完整分页、排除、逆序输入确定性、来源/归属/revision/页大小变化使旧游标失效，以及排除成员修订仍失效但私人进度变化不失效。

只读审核检查领域轮换、repository 的 `browseSourceIdentity`/`browse`/`list` 边界及新增单元、PGlite 与浏览器用例，未发现需要修改产品代码的问题。未仅凭显示名归并，队列耗尽后继续补齐，所有排序键都以稳定来源/系列/媒体身份构成。

新增 `tests/database/media-browse-series-persistence.test.ts` 使用本地 PGlite 执行真实 Drizzle SQL，验证合法频道 ID、显示名改名、RSS URL 规范化、LR 混合来源、无效/带凭据来源的独立回退、来源内系列补齐、跨用户进度、revision/source 变化及 currentVersion/版权/资产门禁。storage 最终相关联跑 **5 文件、24 用例通过**，两份受影响文件 lint 与全树 tsc 通过；由主任务确认结果。

`tests/e2e/media-browse.spec.ts` 复用纯排序函数与内部来源 fixture，桌面/手机三路径最终 **6/6 通过**（`.tmp-media-series-005-e2e.log`）：首轮前12项覆盖12系列、换批排除旧卡、筛选保持、加载更多不重、详情返回恢复同批/位置、切回 newest、故障保留当前卡片、重试与耗尽。该 E2E 的 browse API 是 fixture，不代表真实数据库；数据库正确性单列 PGlite 验证。先前004/005合跑为11通过1失败，不能表述为12项同轮全绿；最终005专项6/6单独记录。

004/005 最终专项 ESLint 与全树 typecheck 均由主任务确认 exit 0（`.tmp-media-series-004-005-lint-final.log`、`.tmp-media-series-004-005-typecheck-final.log`）。

## 4. 文件范围与复验

- 产品：`src/modules/media/domain/media-browse.ts`、`src/modules/media/repositories/drizzle-media-repository.ts`。
- 测试：`tests/unit/media-browse.test.ts`、新增 `tests/unit/media-browse-series.test.ts`、新增 `tests/database/media-browse-series-persistence.test.ts`、`tests/e2e/media-browse.spec.ts`；原 `media-browse-persistence` 继续作现有门禁回归。
- 文档：本报告、`docs/architecture.md`、`docs/testing-strategy.md`；状态与计划由主任务维护。

人工复验：在学习页选“随便看看”或点击“换一批”，观察不同来源与来源内不同系列先轮换；继续分页应补回同系列剩余成员。保留筛选后换批、进入详情再返回，应恢复原批次与位置；切回普通排序和进入系列页仍按原语义展示。目录归属发生修订时，旧换批游标应提示重新读取，不能悄悄跳页。

## 5. 限制与交接

本轮没有生产写入、真实收费供应商或外部媒体调用。PGlite 不能替代远程 Supabase/RLS 与真实并发验证；fixture 浏览器不能替代 iPhone Safari/PWA 真机。全仓 lint/Vitest/E2E 与生产 build 不由聚焦结果替代；共享树已有其他任务变更，未进行混合提交或推送，Commit 待主任务整理登记。下一建议切片为 MEDIA-SERIES-006 白名单采集的待确认系列建议，不允许自动确认或发布。
